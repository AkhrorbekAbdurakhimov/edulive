import type { Db } from '../../db/pool.js';
import { normalizePhone, PHONE_HINT } from '../../utils/phone.js';
import { badRequest, conflict } from '../../utils/errors.js';
import { uzSum } from '../../utils/money.js';
import { activeLoans, type ActiveLoan } from '../library/library.service.js';

/** Bitta odamga shuncha raqam biriktirish mumkin — cheksiz o'sib ketmasin. */
export const MAX_PHONES = 5;

export interface GuardianInput {
  fullName: string;
  /** Birinchisi asosiy hisoblanadi. Kamida bittasi bo'lishi shart. */
  phones: string[];
  // Importda qarindoshlik ko'rsatilmasligi mumkin — noto'g'ri taxmin qilgandan
  // ko'ra bo'sh qoldirgan ma'qul (Telegram xabarlari shunga qarab yoziladi).
  relation: string | null;
}

/**
 * Raqamlarni yagona ko'rinishga keltiradi va takrorlarini olib tashlaydi.
 *
 * Normalizatsiya SHU YERDA: mas'ul shaxs yozuvi faqat shu modul orqali
 * yaratiladi, ya'ni bironta yo'l uni chetlab o'tolmaydi. Telegram botga
 * ulanish raqamni aynan solishtirishga tayanadi.
 */
export function normalizePhones(raw: string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    if (!r?.trim()) continue;
    const p = normalizePhone(r);
    if (!p) throw badRequest(`Telefon raqam noto'g'ri: "${r}". ${PHONE_HINT}`);
    if (!out.includes(p)) out.push(p);
  }
  if (!out.length) throw badRequest('Kamida bitta telefon raqam kerak');
  if (out.length > MAX_PHONES) {
    throw badRequest(`Bitta mas'ul shaxsga ${MAX_PHONES} tagacha raqam biriktiriladi`);
  }
  return out;
}

/**
 * Mas'ul shaxsni raqami bo'yicha topadi yoki yaratadi va o'quvchiga bog'laydi.
 *
 * Raqam maktab ichida noyob: bir oilaning bir necha farzandi bo'lsa, ular
 * bitta mas'ul shaxs yozuviga bog'lanadi. Shuning uchun avval berilgan
 * raqamlarning birortasi allaqachon kimgadir tegishli emasmi — shuni qidiramiz.
 */
export async function linkGuardian(
  db: Db,
  schoolId: string,
  studentId: string,
  g: GuardianInput,
  isPrimary: boolean,
): Promise<string> {
  const phones = normalizePhones(g.phones);

  // Raqamlardan birortasi bazada bo'lsa — bu o'sha odam.
  const { rows: existing } = await db.query<{ parent_id: string }>(
    `SELECT DISTINCT parent_id FROM parent_phones
      WHERE school_id = $1 AND phone = ANY($2::text[])`,
    [schoolId, phones],
  );
  if (existing.length > 1) {
    throw conflict(
      "Bu raqamlar turli mas'ul shaxslarga tegishli. Avval eskilarini tekshiring",
    );
  }

  let parentId = existing[0]?.parent_id;
  if (parentId) {
    await db.query(
      `UPDATE parents SET full_name = $2, relation = COALESCE($3, relation)
        WHERE id = $1 AND school_id = $4`,
      [parentId, g.fullName, g.relation, schoolId],
    );
  } else {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO parents (school_id, full_name, relation) VALUES ($1,$2,$3) RETURNING id`,
      [schoolId, g.fullName, g.relation],
    );
    parentId = rows[0].id;
  }

  await addPhones(db, schoolId, parentId, phones);

  await db.query(
    `INSERT INTO student_parents (student_id, parent_id, is_primary)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [studentId, parentId, isPrimary],
  );
  return parentId;
}

/**
 * Raqamlarni qo'shadi. Boshqa odamga tegishli raqam bo'lsa xato beradi —
 * jimgina o'tkazib yuborsak, xabar noto'g'ri odamga ketardi.
 */
export async function addPhones(
  db: Db,
  schoolId: string,
  parentId: string,
  phones: string[],
): Promise<void> {
  const { rows: taken } = await db.query<{ phone: string }>(
    `SELECT phone FROM parent_phones
      WHERE school_id = $1 AND phone = ANY($2::text[]) AND parent_id <> $3`,
    [schoolId, phones, parentId],
  );
  if (taken.length) {
    throw conflict(`Bu raqam boshqa mas'ul shaxsga biriktirilgan: ${taken[0].phone}`);
  }

  const { rows: current } = await db.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM parent_phones WHERE parent_id = $1 AND school_id = $2`,
    [parentId, schoolId]);
  if (current[0].c + phones.length > MAX_PHONES) {
    throw badRequest(`Bitta mas'ul shaxsga ${MAX_PHONES} tagacha raqam biriktiriladi`);
  }

  for (const [i, phone] of phones.entries()) {
    await db.query(
      `INSERT INTO parent_phones (school_id, parent_id, phone, is_primary)
       VALUES ($1,$2,$3, $4 AND NOT EXISTS (
         SELECT 1 FROM parent_phones WHERE parent_id = $2 AND is_primary
       ))
       ON CONFLICT (school_id, phone) DO NOTHING`,
      [schoolId, parentId, phone, i === 0],
    );
  }
}

/** O'quvchining mas'ul shaxslari — raqamlari bilan birga. */
export async function guardiansOf(db: Db, schoolId: string, studentId: string) {
  const { rows } = await db.query(
    `SELECT p.id, p.full_name, p.relation, sp.is_primary,
            COALESCE(ph.phones, '[]'::json) AS phones
       FROM student_parents sp
       JOIN parents p ON p.id = sp.parent_id AND p.school_id = $1
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
                  'id', pp.id, 'phone', pp.phone, 'isPrimary', pp.is_primary,
                  -- Ulangan = tasdiqlangan: tasdiqlanmagan chatga xabar ketmaydi.
                  'telegramLinked', pp.telegram_verified_at IS NOT NULL,
                  'telegramState',
                    CASE WHEN pp.telegram_verified_at IS NOT NULL THEN 'confirmed'
                         WHEN pp.telegram_rejected_at IS NOT NULL THEN 'rejected'
                         WHEN pp.telegram_chat_id IS NOT NULL     THEN 'pending'
                         ELSE 'none' END,
                  'notifyEnabled', pp.notify_enabled
                ) ORDER BY pp.is_primary DESC, pp.created_at) AS phones
           FROM parent_phones pp WHERE pp.parent_id = p.id
       ) ph ON true
      WHERE sp.student_id = $2
      ORDER BY sp.is_primary DESC, p.full_name`,
    [schoolId, studentId],
  );
  return rows;
}

// ------------------------------------------------- ro'yxatdan chiqarish oldidan

export interface LeavingDebt {
  /** Qaytarilmagan kitoblar. */
  books: ActiveLoan[];
  /** Muddati o'tgan, to'lanmagan summa — chiqarishga to'sqinlik qiladi. */
  overdue: number;
  /** Umumiy yopilmagan summa (muddati kelmagan joriy oy ham kiradi). */
  outstanding: number;
  /** Muddati o'tgan hisoblar soni. */
  overdueInvoices: number;
  blocked: boolean;
  /** Foydalanuvchiga ko'rinadigan sabab; qarz bo'lmasa null. */
  message: string | null;
}

/**
 * O'quvchini ro'yxatdan chiqarishga to'sqinlik qiladigan qarzlar.
 *
 * Ikki xil qarz bir joyda: kutubxona (qaytarilmagan kitob) va pul (muddati
 * o'tgan hisob). Bola chiqib ketgandan keyin ikkalasini ham undirish amalda
 * imkonsiz — shuning uchun tekshiruv chiqarish daqiqasida turadi.
 *
 * Muddati KELMAGAN hisob to'sqinlik qilmaydi: ketgan sana qo'yilgach joriy oy
 * hisobi o'qilgan kunlarga qarab qayta hisoblanadi (proratsiya), ya'ni yakuniy
 * summa chiqarishdan oldin ma'lum emas. Aks holda ota-ona ortiqcha to'lardi.
 */
export async function leavingDebt(
  db: Db,
  schoolId: string,
  studentId: string,
): Promise<LeavingDebt> {
  const books = await activeLoans(db, schoolId, studentId);

  // Qarz ta'rifi "Qarzdorlar" bo'limi bilan bir xil bo'lishi shart, aks holda
  // ro'yxatda qarzdor ko'rinib turgan bola bemalol chiqib ketardi.
  const { rows } = await db.query<{
    outstanding: number; overdue: number; overdue_invoices: number;
  }>(
    `WITH open_inv AS (
       SELECT i.due_date, i.amount - i.discount - COALESCE(pa.paid, 0) AS left_to_pay
         FROM invoices i
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS paid FROM payment_allocations
            WHERE invoice_id = i.id AND school_id = i.school_id
         ) pa ON true
        WHERE i.school_id = $1 AND i.student_id = $2 AND i.status IN ('open', 'partial')
     )
     SELECT COALESCE(SUM(left_to_pay), 0) AS outstanding,
            COALESCE(SUM(left_to_pay) FILTER (WHERE due_date < CURRENT_DATE), 0) AS overdue,
            count(*) FILTER (WHERE due_date < CURRENT_DATE AND left_to_pay > 0)::int
              AS overdue_invoices
       FROM open_inv WHERE left_to_pay > 0`,
    [schoolId, studentId],
  );
  const outstanding = Number(rows[0]?.outstanding ?? 0);
  const overdue = Number(rows[0]?.overdue ?? 0);
  const overdueInvoices = rows[0]?.overdue_invoices ?? 0;

  const parts: string[] = [];
  if (books.length) {
    const names = books.map((b) => `"${b.title}" (${b.inventory_no})`).join(', ');
    parts.push(`${books.length} ta qaytarilmagan kitob — ${names}`);
  }
  if (overdue > 0) {
    parts.push(`${uzSum(overdue)} to'lanmagan hisob (${overdueInvoices} ta oy)`);
  }

  return {
    books,
    overdue,
    outstanding,
    overdueInvoices,
    blocked: parts.length > 0,
    message: parts.length
      ? `Ro'yxatdan chiqarib bo'lmaydi: ${parts.join(' va ')}. `
        + 'Avval kitob qaytarilsin va qarz yopilsin.'
      : null,
  };
}
