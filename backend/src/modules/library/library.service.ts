/**
 * Kutubxona mantig'i: kitob berish, qaytarib olish, muddat hisobi.
 *
 * Asosiy qoida — bitta nusxa bir vaqtda bitta o'quvchida. Buni kod emas,
 * `book_loans_active` unique indeksi kafolatlaydi: ikki kutubxonachi bir
 * vaqtda bir donani bermoqchi bo'lsa, ikkinchisi bazadan rad javob oladi.
 */
import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';

/** Sozlamada boshqacha yozilmagan bo'lsa, kitob shuncha kunga beriladi. */
export const DEFAULT_LOAN_DAYS = 14;

export async function loanDays(schoolId: string): Promise<number> {
  const { rows } = await pool.query<{ d: number | null }>(
    `SELECT (settings->>'library_loan_days')::int AS d FROM schools WHERE id = $1`,
    [schoolId],
  );
  const d = rows[0]?.d;
  return d && d > 0 ? d : DEFAULT_LOAN_DAYS;
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
  const student = await client.query(
    `SELECT 1 FROM students WHERE id = $1 AND school_id = $2 AND status = 'active'`,
    [input.studentId, schoolId],
  );
  if (!student.rowCount) throw notFound("O'quvchi topilmadi yoki faol emas");

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
