/**
 * Qarz eslatmasi — matn va navbatga qo'yish.
 *
 * Nega alohida fayl: bitta o'quvchiga va butun ro'yxatga yuborish BIR XIL
 * qoidada ishlashi kerak (kim oladi, qancha vaqtda bir marta, matn qanday).
 * Ikki joyda yozilsa, ular albatta bir-biridan uzilib ketadi.
 */
import { pool, type Db } from '../../db/pool.js';
import { uzSum } from '../../utils/money.js';
import { uzDate } from '../../utils/date.js';
import { queueForStudent, type QueueResult } from '../notifications/notifications.service.js';
import { smsParts } from '../sms/sms.service.js';

/** Bir o'quvchiga, HAR KANAL bo'yicha, shu soat ichida faqat bitta eslatma. */
const COOLDOWN_HOURS = 20;

/** Qarz eslatmasi qaysi kanal orqali ketadi. */
export type Channel = 'telegram' | 'sms';

/**
 * SMS matni sukut bo'yicha. Maktab `settings.sms_debt_template` orqali o'zini
 * yozishi mumkin (3-qoida: matn kodda qotib qolmaydi) — lekin u ham Eskiz
 * kabinetida MODERATSIYADAN o'tgan bo'lishi shart.
 *
 * O'rinbosarlar: {school} {student} {amount} {due}
 * Matn qasddan qisqa va oddiy apostrof bilan: 160 belgidan oshsa yoki
 * lotin bo'lmagan belgi tushsa, bitta SMS ikki-uch barobar qimmatlashadi.
 */
export const DEFAULT_SMS_TEMPLATE =
  "{school}: {student} uchun to'lanmagan {amount}. Iltimos, to'lovni amalga oshiring.";

export interface DebtRow {
  student_id: string;
  student_name: string;
  outstanding: number;
  oldest_due: string | null;
}

export interface DebtFilter {
  studentId?: string;
  /** Aynan shu o'quvchilarga cheklash — ro'yxatdan tanlab yuborish uchun. */
  studentIds?: string[] | null;
  /** O'qituvchi uchun: faqat shu sinflar. `null` — cheklov yo'q (admin). */
  classIds?: string[] | null;
  overdueOnly?: boolean;
  limit?: number;
}

/** Ochiq hisoblardan qarz. Qarzi yo'q o'quvchi ro'yxatga tushmaydi. */
export async function debtors(db: Db, schoolId: string, opts: DebtFilter = {}): Promise<DebtRow[]> {
  const { rows } = await db.query<DebtRow>(
    `SELECT i.student_id,
            s.last_name || ' ' || s.first_name AS student_name,
            SUM(i.amount - i.discount - COALESCE(pa.paid, 0)) AS outstanding,
            MIN(i.due_date) FILTER (WHERE i.due_date < CURRENT_DATE) AS oldest_due
       FROM invoices i
       JOIN students s ON s.id = i.student_id AND s.school_id = i.school_id
       LEFT JOIN LATERAL (
         SELECT SUM(amount) AS paid FROM payment_allocations
          WHERE invoice_id = i.id AND school_id = i.school_id
       ) pa ON true
      WHERE i.school_id = $1
        AND i.status IN ('open','partial')
        AND ($2::uuid IS NULL OR i.student_id = $2)
        AND ($5::uuid[] IS NULL OR i.student_id = ANY($5))
        -- O'qituvchi faqat o'z sinfini ko'radi. Joriy biriktirilish bo'yicha:
        -- sinfdan chiqib ketgan o'quvchi endi uning ishi emas.
        AND ($6::uuid[] IS NULL OR EXISTS (
              SELECT 1 FROM enrollments e
               WHERE e.student_id = i.student_id AND e.school_id = i.school_id
                 AND e.ends_on IS NULL AND e.class_id = ANY($6)
            ))
      GROUP BY i.student_id, s.last_name, s.first_name
     HAVING SUM(i.amount - i.discount - COALESCE(pa.paid, 0)) > 0
        AND (NOT $3 OR MIN(i.due_date) FILTER (WHERE i.due_date < CURRENT_DATE) IS NOT NULL)
      ORDER BY SUM(i.amount - i.discount - COALESCE(pa.paid, 0)) DESC
      LIMIT $4`,
    [
      schoolId,
      opts.studentId ?? null,
      opts.overdueOnly ?? false,
      opts.limit ?? 1000,
      opts.studentIds ?? null,
      opts.classIds ?? null,
    ],
  );
  return rows;
}

export interface SchoolMessaging {
  name: string;
  smsEnabled: boolean;
  smsTemplate: string;
}

export async function messagingFor(db: Db, schoolId: string): Promise<SchoolMessaging> {
  const { rows } = await db.query<{ name: string; settings: Record<string, unknown> }>(
    `SELECT name, settings FROM schools WHERE id = $1`,
    [schoolId],
  );
  const s = rows[0]?.settings ?? {};
  const tpl = typeof s.sms_debt_template === 'string' && s.sms_debt_template.trim()
    ? s.sms_debt_template.trim()
    : DEFAULT_SMS_TEMPLATE;
  return {
    name: rows[0]?.name ?? 'Maktab',
    // Sukut — O'CHIQ. SMS pul turadi; uni maktab ataylab yoqishi kerak.
    smsEnabled: s.sms_debt_enabled === true,
    smsTemplate: tpl,
  };
}

/** Telegram uchun to'liq matn — uzunlik cheklovi yo'q, bepul. */
export function telegramBody(d: DebtRow): string {
  return (
    `Hurmatli ota-ona!\n${d.student_name} uchun to'lanmagan summa: ${uzSum(d.outstanding)}.\n` +
    (d.oldest_due ? `Eng eski hisob muddati: ${uzDate(d.oldest_due)}.\n` : '') +
    `Iltimos, to'lovni amalga oshiring.`
  );
}

/** SMS matni — shablonga qo'yiladi va qisqartiriladi. */
export function smsBody(tpl: string, school: string, d: DebtRow): string {
  const text = tpl
    .replaceAll('{school}', school)
    .replaceAll('{student}', d.student_name)
    .replaceAll('{amount}', uzSum(d.outstanding))
    .replaceAll('{due}', d.oldest_due ? uzDate(d.oldest_due) : '');
  // Uzun matn jimgina ikki SMS bo'lib ketmasin: maktab nomi uzun bo'lsa
  // hisob ikki barobar oshadi va buni hech kim sezmaydi.
  const p = smsParts(text);
  if (p.parts === 1) return text;
  const max = p.unicode ? 70 : 160;
  return text.slice(0, max - 3).trimEnd() + '...';
}

/**
 * Shu kanaldan yaqinda eslatma olgan o'quvchilar. Tugma ikki marta bosilsa
 * yoki ro'yxat ikki marta yuborilsa, ota-ona ikkita bir xil xabar (va maktab
 * ikki baravar hisob) olmasligi kerak.
 *
 * Nega KANAL bo'yicha: Telegramga yuborib, keyin SMS yuborish — bitta ish
 * emas, ikkita alohida qaror. Umumiy hisoblansa, Telegram yuborilgandan
 * keyin SMS tugmasi ishlamay qolardi.
 */
export async function recentlyReminded(
  db: Db,
  schoolId: string,
  ids: string[],
  channel: Channel,
): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { rows } = await db.query<{ student_id: string }>(
    `SELECT DISTINCT student_id FROM notifications
      WHERE school_id = $1 AND kind = 'debt.reminder'
        AND student_id = ANY($2::uuid[])
        AND channel = $4
        AND created_at > now() - (interval '1 hour' * $3)`,
    [schoolId, ids, COOLDOWN_HOURS, channel],
  );
  return new Set(rows.map((r) => r.student_id));
}

/** Bitta o'quvchiga, BITTA kanal orqali eslatma navbatga qo'yadi. */
export async function queueReminder(
  db: Db,
  schoolId: string,
  d: DebtRow,
  m: SchoolMessaging,
  channel: Channel,
): Promise<QueueResult> {
  const payload = { outstanding: d.outstanding, oldest_due: d.oldest_due };
  return queueForStudent(db, {
    schoolId,
    studentId: d.student_id,
    kind: 'debt.reminder',
    payload,
    // Faqat so'ralgan kanal to'ldiriladi — ikkinchisi umuman yozilmaydi.
    ...(channel === 'telegram'
      ? { body: telegramBody(d) }
      : { sms: { body: smsBody(m.smsTemplate, m.name, d) } }),
  });
}

/**
 * SMS matnini oldindan ko'rsatish — necha belgi, necha SMS.
 *
 * `draft` berilsa hali saqlanmagan shablon ko'rsatiladi: admin matnni
 * o'zgartirganda nechta SMS ketishini SAQLASHDAN oldin ko'rishi kerak.
 * Hisob bitta joyda (server) qoladi — GSM-7 qoidasi ikki marta yozilmasin.
 */
export async function previewSms(schoolId: string, draft?: string): Promise<{
  enabled: boolean;
  template: string;
  example: string;
  parts: number;
  unicode: boolean;
}> {
  const m = await messagingFor(pool, schoolId);
  if (draft?.trim()) m.smsTemplate = draft.trim();
  const example = smsBody(m.smsTemplate, m.name, {
    student_id: '',
    student_name: 'Aliyev Vali',
    outstanding: 1_200_000,
    oldest_due: '2026-09-10',
  });
  const p = smsParts(example);
  return { enabled: m.smsEnabled, template: m.smsTemplate, example, parts: p.parts, unicode: p.unicode };
}
