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
import { tg, botForSchool } from './telegram.service.js';
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
      const found = await pool.query<{ id: string; full_name: string; school_id: string }>(
        school
          ? `SELECT id, full_name, school_id FROM parents WHERE school_id = $2 AND phone = $1`
          : `SELECT id, full_name, school_id FROM parents WHERE phone = $1`,
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
      await pool.query(
        `UPDATE parents
            SET telegram_chat_id = $2, telegram_verified_at = now(), notify_enabled = true
          WHERE id = $1`,
        [parent.id, chatId],
      );

      const kids = await pool.query<{ name: string }>(
        `SELECT s.last_name || ' ' || s.first_name AS name
           FROM student_parents sp
           JOIN students s ON s.id = sp.student_id
          WHERE sp.parent_id = $1 AND s.status = 'active'
          ORDER BY s.last_name`,
        [parent.id],
      );

      await say(
        token, chatId,
        `✅ Ulandingiz, ${parent.full_name}.\n\n` +
        (kids.rowCount
          ? `Farzandlaringiz:\n${kids.rows.map((k) => `• ${k.name}`).join('\n')}\n\n` +
            `Davomat va to'lov haqidagi xabarlar shu yerga keladi.`
          : `Farzandingiz ro'yxatga qo'shilgach xabarlar shu yerga keladi.`),
        { remove_keyboard: true },
      );
      res.sendStatus(200);
      return;
    }

    res.sendStatus(200);
  }),
);
