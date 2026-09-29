/**
 * Navbatdagi bildirishnomalarni yuborish.
 *
 * Xabar hodisa sodir bo'lgan joyda NAVBATGA qo'yiladi (attendance.confirm,
 * payment.create...), yuborish esa shu yerda — alohida. Sabab: to'lov qabul
 * qilish Telegram javob berishini kutib turmasligi kerak. Telegram sekin
 * ishlasa yoki javob bermasa, kassir baribir ishlayveradi.
 *
 * Ikki kanal bor: `telegram` (bepul, botga ulanganlarga) va `sms` (pullik,
 * Eskiz orqali). Ular bir-birini almashtirmaydi — qo'shiladi. Kim qaysi
 * kanaldan oladi, navbatga QO'YISHDA hal bo'ladi; bu yerda faqat jo'natiladi.
 */
import { pool, type Db } from '../../db/pool.js';
import { botForSchool, sendToParent } from '../telegram/telegram.service.js';
import { accountFor, sendSms, type SmsAccount } from '../sms/sms.service.js';

/** Shuncha urinishdan keyin xabar "failed" bo'ladi va qayta urinilmaydi. */
const MAX_ATTEMPTS = 5;

interface QueuedRow {
  id: string;
  school_id: string;
  body: string | null;
  kind: string;
  channel: string;
  chat_id: string | null;
  phone: string | null;
  attempts: number;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
}

/** Xabarni "yuborilmadi" deb belgilaydi; urinishlar tugasa qayta urinilmaydi. */
async function markFailed(id: string, error: string, final = true): Promise<void> {
  await pool.query(
    `UPDATE notifications
        SET attempts = attempts + 1,
            error = $2,
            status = CASE WHEN $4 OR attempts + 1 >= $3 THEN 'failed' ELSE 'queued' END
      WHERE id = $1`,
    [id, error, MAX_ATTEMPTS, final],
  );
}

/**
 * Bitta SMS xabarini jo'natish.
 *
 * `provider_id` saqlanadi: Eskiz yetkazilganlikni keyinroq alohida so'rov
 * (DLR) bilan aytadi, uni xabarga bog'lash uchun boshqa kalit yo'q.
 */
async function dispatchSms(
  n: QueuedRow,
  acc: SmsAccount | null,
  result: DispatchResult,
): Promise<void> {
  if (!n.phone) {
    await markFailed(n.id, "raqam yo'q");
    result.skipped += 1;
    return;
  }
  if (!acc) {
    // Qayta urinishning ma'nosi yo'q: hisob ulanmagan ekan, u o'z-o'zidan
    // paydo bo'lmaydi. Admin ulagach xabarni qo'lda qayta navbatga qo'yadi.
    await markFailed(n.id, "maktabga ham, platformaga ham SMS hisobi ulanmagan");
    result.skipped += 1;
    return;
  }

  const r = await sendSms(acc, n.phone, n.body ?? '');
  if (r.ok) {
    await pool.query(
      `UPDATE notifications
          SET status = 'sent', sent_at = now(), attempts = attempts + 1,
              provider_id = $2, to_phone = COALESCE(to_phone, $3), error = NULL
        WHERE id = $1`,
      [n.id, r.id ?? null, n.phone],
    );
    result.sent += 1;
  } else {
    // Eskiz sababni aytadi (balans, tasdiqlanmagan shablon, noto'g'ri nik) —
    // matn o'zgarmaguncha qayta urinish foydasiz, shuning uchun darhol failed.
    await markFailed(n.id, r.error ?? 'Eskiz xabarni qabul qilmadi');
    result.failed += 1;
  }
}

/**
 * Navbatdan bir porsiya oladi va yuboradi.
 *
 * `FOR UPDATE SKIP LOCKED` — bir nechta nusxa (yoki qo'lda chaqiruv) bir vaqtda
 * ishlasa ham bitta xabar ikki marta ketmaydi.
 */
export async function dispatchQueued(limit = 50): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, failed: 0, skipped: 0 };

  const { rows } = await pool.query<QueuedRow>(
    `SELECT n.id, n.school_id, n.body, n.kind, n.attempts, n.channel,
            pp.telegram_chat_id::text AS chat_id,
            COALESCE(n.to_phone, pp.phone) AS phone
       FROM notifications n
       LEFT JOIN parent_phones pp ON pp.id = n.parent_phone_id
      WHERE n.status = 'queued' AND n.channel IN ('telegram','sms') AND n.attempts < $1
      ORDER BY n.created_at
      LIMIT $2
      FOR UPDATE OF n SKIP LOCKED`,
    [MAX_ATTEMPTS, limit],
  );
  if (!rows.length) return result;

  // Bot ma'lumotini har maktab uchun bir marta olamiz (token deshifrlanadi).
  const bots = new Map<string, string | null>();
  const tokenFor = async (schoolId: string): Promise<string | null> => {
    if (!bots.has(schoolId)) {
      const bot = await botForSchool(schoolId);
      bots.set(schoolId, bot?.token ?? null);
    }
    return bots.get(schoolId) ?? null;
  };

  // SMS hisobi ham har maktab uchun bir marta (maxfiy kod deshifrlanadi).
  const smsAccounts = new Map<string, SmsAccount | null>();
  const smsFor = async (schoolId: string): Promise<SmsAccount | null> => {
    if (!smsAccounts.has(schoolId)) smsAccounts.set(schoolId, await accountFor(schoolId));
    return smsAccounts.get(schoolId) ?? null;
  };

  for (const n of rows) {
    if (n.channel === 'sms') {
      await dispatchSms(n, await smsFor(n.school_id), result);
      continue;
    }

    // Ota-ona botga ulanmagan bo'lsa qayta urinishning ma'nosi yo'q: davomat
    // xabari ertaga yuborilsa chalkashtiradi. "failed" deb belgilaymiz —
    // yozuv qoladi va nega yubormaganini ko'rish mumkin.
    if (!n.chat_id) {
      await markFailed(n.id, "mas'ul shaxsning bu raqami Telegram botga ulanmagan");
      result.skipped += 1;
      continue;
    }

    const token = await tokenFor(n.school_id);
    if (!token) {
      await markFailed(n.id, 'maktabga ham, platformaga ham bot ulanmagan');
      result.skipped += 1;
      continue;
    }

    const ok = await sendToParent(token, n.chat_id, n.body ?? '');
    if (ok) {
      await pool.query(
        `UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`,
        [n.id],
      );
      result.sent += 1;
    } else {
      // Telegram vaqtincha javob bermagan bo'lishi mumkin — oxirgi urinishgacha
      // navbatda qoladi.
      await markFailed(n.id, 'Telegram xabarni qabul qilmadi', false);
      result.failed += 1;
    }
  }

  return result;
}

// ---------------------------------------------------------------- navbatga qo'yish

export interface StudentNotification {
  schoolId: string;
  studentId: string;
  /** attendance.absent | payment.received | book.issued ... */
  kind: string;
  payload?: Record<string, unknown>;
  /**
   * Telegram matni. BERILMASA Telegramga yozilmaydi.
   *
   * Ikkala kanal ham ixtiyoriy va bir-biridan mustaqil: qarz eslatmasini
   * ma'mur "Telegramga" yoki "SMS" deb ALOHIDA yuboradi. Bitta tugma
   * ikkalasini ham jo'natganda, pul ketadigan kanal bilan bepulini
   * ajratib bo'lmasdi.
   */
  body?: string;
  /**
   * SMS matni. BERILMASA SMS yozilmaydi.
   *
   * Alohida matn: 160 belgiga sig'ishi va Eskizda tasdiqlangan shablonga
   * mos bo'lishi kerak. SMS barcha raqamlarga ketadi — Telegramga ulangan
   * ota-onaga ham.
   */
  sms?: { body: string };
}

export interface QueueResult {
  telegram: number;
  sms: number;
}

/**
 * O'quvchining ota-onalariga xabar qo'yadi va nechtasiga ketganini qaytaradi.
 *
 * Kimga yuborish mumkinligi qoidasi SHU YERDA. Telegram: ulangan, TASDIQLAGAN
 * va xabarni o'chirmagan raqam. Qoida har modulda takrorlansa, kunlardan bir
 * kun biri yangilanmay qolib, tasdiqlanmagan chatga xabar ketib qolardi.
 *
 * Har bir RAQAMGA alohida yozuv: bitta odamning ikki raqami ikki xil chat.
 *
 * SMS esa BARCHA raqamlarga — Telegramga ulanganiga ham. Sabab: to'lov
 * eslatmasi o'qilishi kerak, botdagi xabar esa yuzlab boshqa chat orasida
 * ko'rilmay qolishi mumkin.
 *
 * Qaysi kanal ishlashini CHAQIRUVCHI hal qiladi: `body` bersa Telegram,
 * `sms` bersa SMS, ikkalasini bersa ikkalasi. Shu sababli ma'mur qarz
 * eslatmasini "Telegramga" va "SMS" deb alohida yubora oladi.
 */
export async function queueForStudent(db: Db, n: StudentNotification): Promise<QueueResult> {
  const result: QueueResult = { telegram: 0, sms: 0 };

  if (n.body) result.telegram = await queueTelegram(db, n, n.body);
  if (n.sms) result.sms = await queueSms(db, n, n.sms.body);

  return result;
}

async function queueTelegram(db: Db, n: StudentNotification, body: string): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO notifications (school_id, parent_id, parent_phone_id, student_id, kind, payload, body, channel, to_phone)
     SELECT $1, p.id, pp.id, $2, $3, $4::jsonb, $5, 'telegram', pp.phone
       FROM student_parents sp
       JOIN parents p ON p.id = sp.parent_id
       JOIN parent_phones pp ON pp.parent_id = p.id
      WHERE sp.student_id = $2 AND p.school_id = $1
        AND pp.notify_enabled
        AND pp.telegram_chat_id IS NOT NULL
        AND pp.telegram_verified_at IS NOT NULL`,
    [n.schoolId, n.studentId, n.kind, JSON.stringify(n.payload ?? {}), body],
  );
  return rowCount ?? 0;
}

async function queueSms(db: Db, n: StudentNotification, body: string): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO notifications (school_id, parent_id, parent_phone_id, student_id, kind, payload, body, channel, to_phone)
     SELECT $1, p.id, pp.id, $2, $3, $4::jsonb, $5, 'sms', pp.phone
       FROM student_parents sp
       JOIN parents p ON p.id = sp.parent_id
       JOIN parent_phones pp ON pp.parent_id = p.id
      WHERE sp.student_id = $2 AND p.school_id = $1
        -- Yagona shart — raqam xabarni o'chirmagan bo'lsin. Telegram holati
        -- ahamiyatsiz: SMS unga BOG'LIQ EMAS.
        AND pp.notify_enabled`,
    [n.schoolId, n.studentId, n.kind, JSON.stringify(n.payload ?? {}), body],
  );
  return rowCount ?? 0;
}

let timer: NodeJS.Timeout | null = null;

/** Fon ishchisi. Testlarda ishga tushirilmaydi. */
export function startNotificationWorker(everyMs = 15_000): void {
  if (timer) return;
  timer = setInterval(() => {
    dispatchQueued().catch((err) => {
      console.error('notification worker:', (err as Error).message);
    });
  }, everyMs);
  // Jarayonni tirik ushlab turmasin — SIGTERM da tinch to'xtaydi.
  timer.unref();
}

export function stopNotificationWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
