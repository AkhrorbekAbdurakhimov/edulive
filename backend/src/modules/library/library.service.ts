/**
 * Kutubxona mantig'i: kitob berish, qaytarib olish, muddat hisobi.
 *
 * Asosiy qoida — bitta nusxa bir vaqtda bitta o'quvchida. Buni kod emas,
 * `book_loans_active` unique indeksi kafolatlaydi: ikki kutubxonachi bir
 * vaqtda bir donani bermoqchi bo'lsa, ikkinchisi bazadan rad javob oladi.
 */
import type { PoolClient } from 'pg';
import { pool, type Db } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';

/** Sozlamada boshqacha yozilmagan bo'lsa, kitob shuncha kunga beriladi. */
export const DEFAULT_LOAN_DAYS = 14;

/**
 * Sozlamada boshqacha yozilmagan bo'lsa, o'quvchida bir vaqtda shuncha kitob
 * bo'ladi. Sukut — 1: bolada bitta kitob, qaytarmaguncha yangisi berilmaydi.
 * Maktab boshqacha ishlasa `schools.settings` da o'zgartiradi, kodda emas.
 */
export const DEFAULT_MAX_LOANS = 1;

export async function loanDays(schoolId: string): Promise<number> {
  const { rows } = await pool.query<{ d: number | null }>(
    `SELECT (settings->>'library_loan_days')::int AS d FROM schools WHERE id = $1`,
    [schoolId],
  );
  const d = rows[0]?.d;
  return d && d > 0 ? d : DEFAULT_LOAN_DAYS;
}

/** Bir o'quvchi qo'lida bir vaqtda nechta kitob bo'lishi mumkin. */
export async function maxLoans(schoolId: string, client: Db = pool): Promise<number> {
  const { rows } = await client.query<{ n: number | null }>(
    `SELECT (settings->>'library_max_books_per_student')::int AS n
       FROM schools WHERE id = $1`,
    [schoolId],
  );
  const n = rows[0]?.n;
  return n && n > 0 ? n : DEFAULT_MAX_LOANS;
}

export interface ActiveLoan {
  id: string;
  issued_on: string;
  due_on: string;
  overdue: boolean;
  days_late: number;
  book_id: string;
  title: string;
  author: string | null;
  inventory_no: string;
  student_id: string;
  student_name: string;
}

/** O'quvchi qo'lidagi (hali qaytarilmagan) kitoblar — muddati o'tgani birinchi. */
export async function activeLoans(
  client: Db,
  schoolId: string,
  studentId: string,
): Promise<ActiveLoan[]> {
  const { rows } = await client.query<ActiveLoan>(
    `SELECT l.id, l.issued_on, l.due_on, l.book_id,
            (l.due_on < CURRENT_DATE) AS overdue,
            GREATEST(0, CURRENT_DATE - l.due_on)::int AS days_late,
            b.title, b.author, c.inventory_no,
            s.id AS student_id, s.last_name || ' ' || s.first_name AS student_name
       FROM book_loans l
       JOIN books b ON b.id = l.book_id
       JOIN book_copies c ON c.id = l.copy_id
       JOIN students s ON s.id = l.student_id AND s.school_id = l.school_id
      WHERE l.school_id = $1 AND l.student_id = $2 AND l.status = 'issued'
      ORDER BY l.due_on`,
    [schoolId, studentId],
  );
  return rows;
}

/**
 * Kutubxonachiga ko'rinadigan ogohlantirish matni: qaysi kitob kimda turibdi.
 *
 * Bitta kitob chegarasida ism-sharif emas, kitob nomi muhim — kutubxonachi
 * bolani oldida ko'rib turibdi, unga "qaysi kitobni olib kel" deyishi kerak.
 */
export function loanLimitMessage(held: ActiveLoan[], limit: number): string {
  const one = held[0];
  const late = one?.overdue ? ` — ${one.days_late} kun kechikkan` : '';
  // Chegara 1 bo'lsa ham qo'lida bir nechta kitob bo'lishi mumkin (sozlama
  // keyin pasaytirilgan bo'lsa) — shunda nomini emas, sonini aytamiz.
  return held.length === 1 && one
    ? `Bu o'quvchi hozir "${one.title}" kitobini o'qiyapti (${one.inventory_no})${late}. `
      + 'Avval shu kitobni qabul qiling, keyin yangisini bering.'
    : `Bu o'quvchida allaqachon ${held.length} ta kitob bor — chegara ${limit} ta. `
      + 'Avval birortasini qabul qiling.';
}

/** Bugundan `days` kun keyingi sana, YYYY-MM-DD. */
export function dueDateFrom(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface IssueInput {
  studentId: string;
  /** Aniq nusxa berilsa — shu, aks holda kitobning bo'sh nusxasi tanlanadi. */
  copyId?: string;
  bookId?: string;
  dueOn: string;
  note?: string;
}

/**
 * Bo'sh nusxani tanlab, o'quvchiga biriktiradi.
 *
 * `FOR UPDATE SKIP LOCKED` — bir vaqtda ikki kutubxonachi bir kitobni bersa,
 * ikkinchisiga keyingi bo'sh nusxa tegadi, kutib qolmaydi.
 */
export async function issueBook(
  client: PoolClient,
  schoolId: string,
  userId: string,
  input: IssueInput,
) {
  // FOR UPDATE — o'quvchi qatorini band qilamiz: ikki kutubxonachi bir vaqtda
  // bir bolaga kitob bermoqchi bo'lsa, chegara tekshiruvi chetlab o'tilmaydi.
  const student = await client.query(
    `SELECT 1 FROM students WHERE id = $1 AND school_id = $2 AND status = 'active'
      FOR UPDATE`,
    [input.studentId, schoolId],
  );
  if (!student.rowCount) throw notFound("O'quvchi topilmadi yoki faol emas");

  // Qo'lida kitobi borga yangisi berilmaydi — kutubxonachi ogohlantiriladi.
  const limit = await maxLoans(schoolId, client);
  const held = await activeLoans(client, schoolId, input.studentId);
  if (held.length >= limit) throw conflict(loanLimitMessage(held, limit), 'loan_limit');

  const { rows: copies } = input.copyId
    ? await client.query<{ id: string; book_id: string; status: string; condition: string }>(
        `SELECT id, book_id, status, condition FROM book_copies
          WHERE id = $1 AND school_id = $2 FOR UPDATE`,
        [input.copyId, schoolId],
      )
    : await client.query<{ id: string; book_id: string; status: string; condition: string }>(
        `SELECT id, book_id, status, condition FROM book_copies
          WHERE book_id = $1 AND school_id = $2 AND status = 'shelf'
          ORDER BY inventory_no
          LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [input.bookId, schoolId],
      );

  const copy = copies[0];
  if (!copy) {
    throw conflict(
      input.copyId ? 'Nusxa topilmadi' : "Bu kitobning bo'sh nusxasi qolmadi",
    );
  }
  if (copy.status !== 'shelf') {
    const why: Record<string, string> = {
      issued: 'allaqachon berilgan', lost: "yo'qolgan",
      repair: "ta'mirda", written_off: 'hisobdan chiqarilgan',
    };
    throw conflict(`Nusxa berib bo'lmaydi: ${why[copy.status] ?? copy.status}`);
  }

  const { rows } = await client.query(
    `INSERT INTO book_loans
       (school_id, copy_id, book_id, student_id, issued_by, due_on, condition_out, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [schoolId, copy.id, copy.book_id, input.studentId, userId, input.dueOn, copy.condition, input.note ?? null],
  );

  await client.query(
    `UPDATE book_copies SET status = 'issued' WHERE id = $1 AND school_id = $2`,
    [copy.id, schoolId],
  );

  return rows[0];
}

interface ReturnInput {
  condition: 'new' | 'good' | 'worn' | 'damaged';
  note?: string;
}

/**
 * Kitobni qaytarib olish — kutubxonachi holatini tasdiqlaydi.
 *
 * Shikastlangan kitob javonga emas, `repair` holatiga tushadi: aks holda
 * ertaga boshqa o'quvchiga shikastlangan kitob berilardi.
 */
export async function returnBook(
  client: PoolClient,
  schoolId: string,
  userId: string,
  loanId: string,
  input: ReturnInput,
) {
  const { rows } = await client.query<{ id: string; copy_id: string; status: string }>(
    `SELECT id, copy_id, status FROM book_loans
      WHERE id = $1 AND school_id = $2 FOR UPDATE`,
    [loanId, schoolId],
  );
  const loan = rows[0];
  if (!loan) throw notFound('Yozuv topilmadi');
  if (loan.status !== 'issued') {
    throw badRequest(
      loan.status === 'returned' ? 'Bu kitob allaqachon qaytarilgan' : "Kitob yo'qolgan deb belgilangan",
    );
  }

  const { rows: updated } = await client.query(
    `UPDATE book_loans
        SET status = 'returned', returned_on = CURRENT_DATE,
            received_by = $3, condition_in = $4,
            note = COALESCE(NULLIF($5, ''), note)
      WHERE id = $1 AND school_id = $2
      RETURNING *`,
    [loanId, schoolId, userId, input.condition, input.note ?? ''],
  );

  await client.query(
    `UPDATE book_copies
        SET status = CASE WHEN $3 = 'damaged' THEN 'repair' ELSE 'shelf' END,
            condition = $3
      WHERE id = $1 AND school_id = $2`,
    [loan.copy_id, schoolId, input.condition],
  );

  return updated[0];
}

/** Yo'qolgan deb belgilash — nusxa javonga qaytmaydi. */
export async function markLost(
  client: PoolClient,
  schoolId: string,
  userId: string,
  loanId: string,
  note?: string,
) {
  const { rows } = await client.query<{ copy_id: string; status: string }>(
    `SELECT copy_id, status FROM book_loans WHERE id = $1 AND school_id = $2 FOR UPDATE`,
    [loanId, schoolId],
  );
  if (!rows[0]) throw notFound('Yozuv topilmadi');
  if (rows[0].status !== 'issued') throw badRequest('Faqat berilgan kitobni yo\'qolgan deb belgilash mumkin');

  const { rows: updated } = await client.query(
    `UPDATE book_loans
        SET status = 'lost', returned_on = CURRENT_DATE, received_by = $3,
            condition_in = 'damaged', note = COALESCE(NULLIF($4, ''), note)
      WHERE id = $1 AND school_id = $2
      RETURNING *`,
    [loanId, schoolId, userId, note ?? ''],
  );
  await client.query(
    `UPDATE book_copies SET status = 'lost' WHERE id = $1 AND school_id = $2`,
    [rows[0].copy_id, schoolId],
  );
  return updated[0];
}
