/**
 * Telegram webhook — OCHIQ yo'l (autentifikatsiyasiz), Telegram serveri uradi.
 *
 * Himoya ikki qatlamli: manzildagi tasodifiy segment qaysi maktab ekanini
 * aniqlaydi, va Telegram har so'rovda yuboradigan
 * X-Telegram-Bot-Api-Secret-Token sarlavhasi o'sha qiymatga teng bo'lishi
 * kerak. Ikkalasi ham to'g'ri kelmasa so'rov jim tashlanadi.
 *
 * Ota-onani ulash: /start -> "Raqamingizni yuboring" tugmasi -> Telegram
 * TASDIQLAGAN raqam keladi (qo'lda yozilmaydi, soxtalashtirib bo'lmaydi) ->
 * parents.phone bilan solishtiriladi.
 */
import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { ah } from '../../utils/http.js';
import { tg, botForSchool, childCard, childrenOf } from './telegram.service.js';
import { notifyStaff } from '../staffbot/staffbot.service.js';
// Import bilan BIR XIL qoida — aks holda bazadagi raqam bilan mos kelmaydi.
import { normalizePhone } from '../../utils/phone.js';

/**
 * Xabar yuborish HECH QACHON webhookni yiqitmasligi kerak: Telegram
 * muvaffaqiyatsiz webhookni qayta yuboraveradi, natijada bog'lanish
 * takror-takror ishlab, ota-ona ham bir necha xabar olardi.
 */
async function say(token: string, chatId: number, text: string, markup?: unknown) {
  try {
    await tg(token, 'sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML',
      ...(markup ? { reply_markup: markup } : {}),
    });
  } catch (err) {
    console.error('telegram sendMessage:', (err as Error).message);
  }
}

export const telegramRoutes = Router();

interface TgUpdate {
  message?: {
    chat: { id: number };
    from?: { id: number; first_name?: string };
    text?: string;
    contact?: { phone_number: string; user_id?: number };
  };
}

const ASK_CONTACT = {
  keyboard: [[{ text: '📱 Raqamni yuborish', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

/**
 * Tasdiqlash tugmalari ODDIY klaviatura (inline emas): inline tugma
 * `callback_query` yuboradi, webhook esa faqat `message` ga o'rnatilgan.
 * Allaqachon ulangan maktablarda tugma jimgina ishlamay qolardi.
 */
const YES = "✅ Ha, bu mening farzandim";
const NO = "❌ Yo'q, bu mening farzandim emas";
const ASK_CONFIRM = {
  keyboard: [[{ text: YES }], [{ text: NO }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

telegramRoutes.post(
  '/webhook/:secret',
  ah(async (req, res) => {
    const { secret } = req.params;

    // Telegram sarlavhasi ham mos kelishi shart — manzilning o'zi yetarli emas.
    if (req.header('X-Telegram-Bot-Api-Secret-Token') !== secret) {
      res.sendStatus(200); // Telegram qayta urinmasin
      return;
    }

    // Maktabning o'z boti bo'lsa — maktab shu yerdan aniq.
    const { rows } = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM schools WHERE telegram_webhook_secret = $1`,
      [secret],
    );
    const school = rows[0] ?? null;
    const isPlatform = !school && secret === env.telegram.webhookSecret;
    if (!school && !isPlatform) {
      res.sendStatus(200);
      return;
    }

    const update = req.body as TgUpdate;
    const msg = update.message;
    if (!msg) { res.sendStatus(200); return; }

    const token = school
      ? (await botForSchool(school.id))?.token ?? env.telegram.token
      : env.telegram.token;
    if (!token) { res.sendStatus(200); return; }

    const chatId = msg.chat.id;

    // ---------------------------------------------------------- /start
    if (msg.text?.startsWith('/start')) {
      await say(
        token, chatId,
        `Assalomu alaykum!\n\n` +
        (school ? `<b>${school.name}</b>\n\n` : '') +
        `Farzandingiz haqidagi xabarlarni olish uchun telefon raqamingizni yuboring. ` +
        `Raqam maktab ro'yxatidagi raqam bilan solishtiriladi.`,
        ASK_CONTACT,
      );
      res.sendStatus(200);
      return;
    }

    // ---------------------------------------------------------- kontakt
    if (msg.contact) {
      // Boshqa odamning kontaktini yuborishi mumkin — faqat o'zinikini qabul qilamiz.
      if (msg.contact.user_id && msg.from && msg.contact.user_id !== msg.from.id) {
        await say(token, chatId, "Iltimos, o'zingizning raqamingizni yuboring.", ASK_CONTACT);
        res.sendStatus(200);
        return;
      }

      const phone = normalizePhone(msg.contact.phone_number);
      if (!phone) {
        await say(
          token, chatId,
          "Raqamni o'qib bo'lmadi. Iltimos, maktab ma'muriyatiga murojaat qiling.",
          { remove_keyboard: true },
        );
        res.sendStatus(200);
        return;
      }
      // Chat RAQAMGA bog'lanadi: bitta odamning ikki raqami ikki xil chat
      // bo'lishi mumkin va ikkalasiga ham xabar borishi kerak.
      const found = await pool.query<{ id: string; parent_id: string; full_name: string; school_id: string }>(
        school
          ? `SELECT pp.id, pp.parent_id, p.full_name, pp.school_id
               FROM parent_phones pp JOIN parents p ON p.id = pp.parent_id
              WHERE pp.school_id = $2 AND pp.phone = $1`
          : `SELECT pp.id, pp.parent_id, p.full_name, pp.school_id
               FROM parent_phones pp JOIN parents p ON p.id = pp.parent_id
              WHERE pp.phone = $1`,
        school ? [phone, school.id] : [phone],
      );

      if (found.rowCount === 0) {
        // Bazada bor-yo'qligini oshkor qilmaymiz.
        await say(
          token, chatId,
          "Bu raqam ro'yxatda topilmadi. Iltimos, maktab ma'muriyatiga murojaat qiling.",
          { remove_keyboard: true },
        );
        res.sendStatus(200);
        return;
      }

      if (found.rowCount! > 1) {
        // Platforma botida bir raqam bir necha maktabda uchrashi mumkin.
        await say(
          token, chatId,
          "Raqamingiz bir nechta maktabda ro'yxatda. Maktabingiz bergan havola orqali kiring.",
          { remove_keyboard: true },
        );
        res.sendStatus(200);
        return;
      }

      const parent = found.rows[0];
      const kids = await childrenOf(parent.parent_id);

      // Raqam mos kelgani yetarli emas: raqam boshqa odamga o'tib ketgan yoki
      // ro'yxatga xato yozilgan bo'lishi mumkin. Shuning uchun chat
      // bog'lanadi, lekin ota-ona farzandini TASDIQLAGUNCHA xabar ketmaydi.
      await pool.query(
        `UPDATE parent_phones
            SET telegram_chat_id = $2,
                telegram_verified_at = CASE WHEN $3 THEN NULL ELSE now() END,
                telegram_rejected_at = NULL,
                notify_enabled = NOT $3
          WHERE id = $1`,
        [parent.id, chatId, kids.length > 0],
      );

      if (!kids.length) {
        // Tasdiqlaydigan narsa yo'q — farzand ro'yxatga qo'shilgach keladi.
        await say(
          token, chatId,
          `✅ Ulandingiz, ${parent.full_name}.\n\n` +
          `Farzandingiz ro'yxatga qo'shilgach xabarlar shu yerga keladi.`,
          { remove_keyboard: true },
        );
        res.sendStatus(200);
        return;
      }

      await say(
        token, chatId,
        `Assalomu alaykum, ${parent.full_name}.\n\n` +
        (kids.length === 1 ? 'Sizning farzandingiz:' : 'Sizning farzandlaringiz:') +
        `\n\n${kids.map(childCard).join('\n\n')}\n\n` +
        `<b>Ma'lumotlar to'g'rimi — haqiqatan ham sizning farzandingizmi?</b>`,
        ASK_CONFIRM,
      );
      res.sendStatus(200);
      return;
    }

    // ---------------------------------------------------- tasdiq: Ha / Yo'q
    const answer = confirmAnswer(msg.text);
    if (answer) {
      // Tasdiq kutayotgan raqam chat bo'yicha topiladi.
      const { rows: pending } = await pool.query<PendingPhone>(
        `SELECT pp.id, pp.parent_id, pp.school_id, pp.phone, p.full_name
           FROM parent_phones pp JOIN parents p ON p.id = pp.parent_id
          WHERE pp.telegram_chat_id = $1 AND pp.telegram_verified_at IS NULL`,
        [chatId],
      );
      const pp = pending[0];
      if (!pp) {
        // Tugma eski xabardan bosilgan bo'lishi mumkin.
        await say(
          token, chatId,
          "Tasdiqlash kutilayotgan ma'lumot yo'q. Boshlash uchun /start yuboring.",
          { remove_keyboard: true },
        );
        res.sendStatus(200);
        return;
      }

      if (answer === 'yes') {
        await pool.query(
          `UPDATE parent_phones
              SET telegram_verified_at = now(), telegram_rejected_at = NULL,
                  notify_enabled = true
            WHERE id = $1`,
          [pp.id],
        );
        await say(
          token, chatId,
          `✅ Rahmat, ${pp.full_name}. Ma'lumot tasdiqlandi.\n\n` +
          `Endi davomat, to'lov va kutubxona haqidagi xabarlar shu yerga keladi.`,
          { remove_keyboard: true },
        );
        res.sendStatus(200);
        return;
      }

      // "Yo'q" — xabar yuborilmaydi va ma'muriyat ogohlantiriladi.
      await pool.query(
        `UPDATE parent_phones
            SET telegram_rejected_at = now(), telegram_verified_at = NULL,
                notify_enabled = false
          WHERE id = $1`,
        [pp.id],
      );
      await alertStaffAboutMismatch(pp);
      await say(
        token, chatId,
        `Rahmat. Ma'lumot maktab ma'muriyatiga yuborildi — ular siz bilan bog'lanishadi.\n\n` +
        `Sizga hech qanday xabar yuborilmaydi.`,
        { remove_keyboard: true },
      );
      res.sendStatus(200);
      return;
    }

    res.sendStatus(200);
  }),
);

interface PendingPhone {
  id: string;
  parent_id: string;
  school_id: string;
  phone: string;
  full_name: string;
}

/** Tugma matni yoki oddiy "ha" / "yo'q" — ikkalasi ham qabul qilinadi. */
function confirmAnswer(text?: string): 'yes' | 'no' | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  if (t.startsWith('✅') || t === 'ha' || t.startsWith('ha,')) return 'yes';
  if (t.startsWith('❌') || t === "yo'q" || t === 'yoq' || t.startsWith("yo'q,")) return 'no';
  return null;
}

/**
 * "Bu mening farzandim emas" — ma'muriyat uchun ogohlantirish.
 *
 * Ikki joyga ketadi: xizmat boti (darhol ko'rinadi) va "Xabarlar" bo'limi
 * (bot ulanmagan bo'lsa ham yozuv qoladi). Ma'lumot tuzatilmaguncha bu
 * raqamga hech qanday xabar yuborilmaydi.
 */
async function alertStaffAboutMismatch(pp: PendingPhone): Promise<void> {
  const kids = await childrenOf(pp.parent_id);
  const names = kids.map((k) => k.name).join(', ') || 'farzand biriktirilmagan';
  const text =
    `⚠️ <b>Ota-ona ma'lumotni tasdiqlamadi</b>\n` +
    `${pp.full_name} (${pp.phone}) botda "bu mening farzandim emas" dedi.\n` +
    `Biriktirilgan o'quvchi: ${names}\n\n` +
    `Raqam yoki biriktirish xato bo'lishi mumkin — tekshirib ko'ring. ` +
    `Tuzatilgunga qadar bu raqamga xabar yuborilmaydi.`;

  // Xabar ketmasa ham webhook yiqilmasligi kerak.
  void notifyStaff(pp.school_id, text);

  // Yozuv "Xabarlar" ro'yxatida qoladi. `inapp` Telegram navbatiga tushmaydi,
  // shuning uchun darhol 'sent'.
  await pool.query(
    `INSERT INTO notifications
       (school_id, parent_id, parent_phone_id, student_id, channel, kind, body, status, sent_at)
     VALUES ($1, $2, $3, $4, 'inapp', 'parent.link.rejected', $5, 'sent', now())`,
    [pp.school_id, pp.parent_id, pp.id, kids[0]?.id ?? null,
     `${pp.full_name} (${pp.phone}) farzand ma'lumotini tasdiqlamadi: ${names}`],
  );
}
