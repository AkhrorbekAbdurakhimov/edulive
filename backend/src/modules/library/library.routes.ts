import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../../db/pool.js';
import { requireLibrary } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { ah } from '../../utils/http.js';
import { parse, uuidParam } from '../../utils/validate.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { audit } from '../audit/audit.service.js';
import { dueDateFrom, issueBook, loanDays, markLost, returnBook } from './library.service.js';

export const libraryRoutes = Router();
libraryRoutes.use(requireTenant, requireLibrary);

const CATEGORY = ['darslik', 'badiiy', 'qollanma', 'ilmiy', 'boshqa'] as const;
const LANGUAGE = ['uz', 'ru', 'en', 'other'] as const;
const CONDITION = ['new', 'good', 'worn', 'damaged'] as const;

const bookBody = z.object({
  title: z.string().trim().min(1, 'Kitob nomi kerak').max(300),
  author: z.string().trim().max(200).optional().nullable(),
  category: z.enum(CATEGORY).default('boshqa'),
  grade: z.coerce.number().int().min(1).max(11).optional().nullable(),
  language: z.enum(LANGUAGE).default('uz'),
  publisher: z.string().trim().max(200).optional().nullable(),
  publishedYear: z.coerce.number().int().min(1800).max(2100).optional().nullable(),
  isbn: z.string().trim().max(32).optional().nullable(),
  shelf: z.string().trim().max(50).optional().nullable(),
  price: z.coerce.number().min(0).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
});

// ================================================================ kitoblar

libraryRoutes.get(
  '/books',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        search: z.string().trim().max(100).optional(),
        category: z.enum(CATEGORY).optional(),
        grade: z.coerce.number().int().min(1).max(11).optional(),
        language: z.enum(LANGUAGE).optional(),
        // Faqat javonda bo'sh nusxasi borlari — kitob berishda kerak
        availableOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );

    const { rows } = await pool.query(
      `SELECT b.id, b.title, b.author, b.category, b.grade, b.language,
              b.publisher, b.published_year, b.isbn, b.shelf, b.price, b.note, b.status,
              COALESCE(c.total, 0)::int     AS total_copies,
              COALESCE(c.available, 0)::int AS available_copies,
              COALESCE(c.issued, 0)::int    AS issued_copies,
              count(*) OVER()::int AS total_count
         FROM books b
         LEFT JOIN LATERAL (
           SELECT count(*) AS total,
                  count(*) FILTER (WHERE status = 'shelf')  AS available,
                  count(*) FILTER (WHERE status = 'issued') AS issued
             FROM book_copies WHERE book_id = b.id AND school_id = b.school_id
         ) c ON true
        WHERE b.school_id = $1 AND b.status = 'active'
          AND ($2::text IS NULL OR b.title ILIKE '%' || $2 || '%' OR b.author ILIKE '%' || $2 || '%'
               OR b.isbn = $2)
          AND ($3::text IS NULL OR b.category = $3)
          AND ($4::int  IS NULL OR b.grade = $4)
          AND ($5::text IS NULL OR b.language = $5)
          AND (NOT $6 OR COALESCE(c.available, 0) > 0)
        ORDER BY b.title
        LIMIT $7 OFFSET $8`,
      [req.schoolId, q.search ?? null, q.category ?? null, q.grade ?? null,
       q.language ?? null, q.availableOnly, q.limit, (q.page - 1) * q.limit],
    );

    res.json({
      items: rows.map(({ total_count: _t, ...r }) => r),
      total: rows[0]?.total_count ?? 0,
      page: q.page,
    });
  }),
);

libraryRoutes.get(
  '/books/:id',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { rows } = await pool.query(
      `SELECT * FROM books WHERE id = $1 AND school_id = $2`, [id, req.schoolId]);
    if (!rows[0]) throw notFound('Kitob topilmadi');

    const { rows: copies } = await pool.query(
      `SELECT c.id, c.inventory_no, c.condition, c.status, c.note,
              s.last_name || ' ' || s.first_name AS holder_name,
              l.id AS loan_id, l.due_on
         FROM book_copies c
         LEFT JOIN book_loans l ON l.copy_id = c.id AND l.status = 'issued'
         LEFT JOIN students s ON s.id = l.student_id
        WHERE c.book_id = $1 AND c.school_id = $2
        ORDER BY c.inventory_no`,
      [id, req.schoolId],
    );
    res.json({ book: rows[0], copies });
  }),
);

libraryRoutes.post(
  '/books',
  ah(async (req, res) => {
    const input = parse(
      bookBody.extend({
        // Nusxalar bir yo'la yaratiladi: raqamlar berilsa o'shalar,
        // aks holda `copies` dona avtomatik raqamlanadi.
        copies: z.coerce.number().int().min(0).max(500).default(1),
        inventoryNos: z.array(z.string().trim().min(1).max(50)).max(500).optional(),
      }),
      req.body,
    );

    const book = await tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO books (school_id, title, author, category, grade, language,
                            publisher, published_year, isbn, shelf, price, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.schoolId, input.title, input.author ?? null, input.category, input.grade ?? null,
         input.language, input.publisher ?? null, input.publishedYear ?? null,
         input.isbn ?? null, input.shelf ?? null, input.price ?? null, input.note ?? null],
      );
      const created = rows[0];

      const nos = input.inventoryNos?.length
        ? input.inventoryNos
        : await autoNumbers(client, req.schoolId!, input.copies);

      for (const no of nos) {
        try {
          await client.query(
            `INSERT INTO book_copies (school_id, book_id, inventory_no) VALUES ($1,$2,$3)`,
            [req.schoolId, created.id, no],
          );
        } catch (err) {
          if ((err as { code?: string }).code === '23505') {
            throw conflict(`Inventar raqami band: ${no}`);
          }
          throw err;
        }
      }

      await audit(req, { action: 'book.create', entity: 'book', entityId: created.id,
                         after: { title: created.title, copies: nos.length } }, client);
      return { ...created, copies: nos.length };
    });

    res.status(201).json({ book });
  }),
);

libraryRoutes.patch(
  '/books/:id',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(bookBody.partial(), req.body);

    const before = await pool.query(`SELECT * FROM books WHERE id = $1 AND school_id = $2`,
      [id, req.schoolId]);
    if (!before.rows[0]) throw notFound('Kitob topilmadi');

    const { rows } = await pool.query(
      `UPDATE books SET
         title = COALESCE($3, title), author = COALESCE($4, author),
         category = COALESCE($5, category), grade = COALESCE($6, grade),
         language = COALESCE($7, language), publisher = COALESCE($8, publisher),
         published_year = COALESCE($9, published_year), isbn = COALESCE($10, isbn),
         shelf = COALESCE($11, shelf), price = COALESCE($12, price),
         note = COALESCE($13, note), updated_at = now()
       WHERE id = $1 AND school_id = $2 RETURNING *`,
      [id, req.schoolId, input.title ?? null, input.author ?? null, input.category ?? null,
       input.grade ?? null, input.language ?? null, input.publisher ?? null,
       input.publishedYear ?? null, input.isbn ?? null, input.shelf ?? null,
       input.price ?? null, input.note ?? null],
    );

    await audit(req, { action: 'book.update', entity: 'book', entityId: id,
                       before: before.rows[0], after: rows[0] });
    res.json({ book: rows[0] });
  }),
);

// O'chirish emas, arxivlash: tarix (kim o'qigan) saqlanib qolishi kerak.
libraryRoutes.delete(
  '/books/:id',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const active = await pool.query(
      `SELECT count(*)::int AS c FROM book_loans
        WHERE book_id = $1 AND school_id = $2 AND status = 'issued'`,
      [id, req.schoolId],
    );
    if (active.rows[0].c > 0) {
      throw conflict(`Bu kitobning ${active.rows[0].c} ta nusxasi o'quvchilarda. Avval qaytarib oling`);
    }

    const { rowCount } = await pool.query(
      `UPDATE books SET status = 'archived', updated_at = now()
        WHERE id = $1 AND school_id = $2 AND status = 'active'`,
      [id, req.schoolId],
    );
    if (!rowCount) throw notFound('Kitob topilmadi');

    await audit(req, { action: 'book.archive', entity: 'book', entityId: id });
    res.json({ ok: true });
  }),
);

// ================================================================ nusxalar

libraryRoutes.post(
  '/books/:id/copies',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(
      z.object({
        count: z.coerce.number().int().min(1).max(500).default(1),
        inventoryNos: z.array(z.string().trim().min(1).max(50)).max(500).optional(),
        condition: z.enum(CONDITION).default('good'),
      }),
      req.body,
    );

    const book = await pool.query(`SELECT 1 FROM books WHERE id = $1 AND school_id = $2`,
      [id, req.schoolId]);
    if (!book.rowCount) throw notFound('Kitob topilmadi');

    const added = await tx(async (client) => {
      const nos = input.inventoryNos?.length
        ? input.inventoryNos
        : await autoNumbers(client, req.schoolId!, input.count);
      for (const no of nos) {
        try {
          await client.query(
            `INSERT INTO book_copies (school_id, book_id, inventory_no, condition)
             VALUES ($1,$2,$3,$4)`,
            [req.schoolId, id, no, input.condition],
          );
        } catch (err) {
          if ((err as { code?: string }).code === '23505') throw conflict(`Inventar raqami band: ${no}`);
          throw err;
        }
      }
      await audit(req, { action: 'book.copies.add', entity: 'book', entityId: id,
                         after: { count: nos.length } }, client);
      return nos.length;
    });

    res.status(201).json({ added });
  }),
);

libraryRoutes.delete(
  '/copies/:id',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { rows } = await pool.query<{ status: string }>(
      `SELECT status FROM book_copies WHERE id = $1 AND school_id = $2`, [id, req.schoolId]);
    if (!rows[0]) throw notFound('Nusxa topilmadi');
    if (rows[0].status === 'issued') throw conflict("Bu nusxa o'quvchida — avval qaytarib oling");

    // Tarixi bor nusxa o'chmaydi (FK RESTRICT) — hisobdan chiqaramiz.
    const used = await pool.query(
      `SELECT 1 FROM book_loans WHERE copy_id = $1 AND school_id = $2 LIMIT 1`, [id, req.schoolId]);
    if (used.rowCount) {
      await pool.query(
        `UPDATE book_copies SET status = 'written_off' WHERE id = $1 AND school_id = $2`,
        [id, req.schoolId]);
    } else {
      await pool.query(`DELETE FROM book_copies WHERE id = $1 AND school_id = $2`, [id, req.schoolId]);
    }
    await audit(req, { action: 'book.copy.remove', entity: 'book_copy', entityId: id });
    res.json({ ok: true });
  }),
);

// ================================================================ berish / qaytarish

libraryRoutes.get(
  '/loans',
  ah(async (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(['issued', 'returned', 'lost', 'overdue']).optional(),
        studentId: z.string().uuid().optional(),
        search: z.string().trim().max(100).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );

    const { rows } = await pool.query(
      `SELECT l.id, l.issued_on, l.due_on, l.returned_on, l.status,
              l.condition_out, l.condition_in, l.note,
              (l.status = 'issued' AND l.due_on < CURRENT_DATE) AS overdue,
              GREATEST(0, CURRENT_DATE - l.due_on)::int AS days_late,
              b.id AS book_id, b.title, b.author,
              c.inventory_no,
              s.id AS student_id, s.last_name || ' ' || s.first_name AS student_name,
              cl.grade || '-' || cl.letter AS class_name,
              u.full_name AS issued_by_name,
              count(*) OVER()::int AS total_count
         FROM book_loans l
         JOIN books b ON b.id = l.book_id
         JOIN book_copies c ON c.id = l.copy_id
         JOIN students s ON s.id = l.student_id AND s.school_id = l.school_id
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.ends_on IS NULL
         LEFT JOIN classes cl ON cl.id = e.class_id
         LEFT JOIN users u ON u.id = l.issued_by
        WHERE l.school_id = $1
          AND ($2::text IS NULL
               OR ($2 = 'overdue' AND l.status = 'issued' AND l.due_on < CURRENT_DATE)
               OR ($2 <> 'overdue' AND l.status = $2))
          AND ($3::uuid IS NULL OR l.student_id = $3)
          AND ($4::text IS NULL OR b.title ILIKE '%' || $4 || '%'
               OR s.last_name ILIKE '%' || $4 || '%' OR s.first_name ILIKE '%' || $4 || '%'
               OR c.inventory_no = $4)
        -- Muddati o'tganlar eng tepada, eng ko'p kechikkani birinchi
        ORDER BY (l.status = 'issued' AND l.due_on < CURRENT_DATE) DESC,
                 CASE WHEN l.status = 'issued' THEN l.due_on END ASC NULLS LAST,
                 l.issued_on DESC
        LIMIT $5 OFFSET $6`,
      [req.schoolId, q.status ?? null, q.studentId ?? null, q.search ?? null,
       q.limit, (q.page - 1) * q.limit],
    );

    const { rows: counts } = await pool.query<{ issued: number; overdue: number; returned: number; lost: number }>(
      `SELECT count(*) FILTER (WHERE status = 'issued')::int AS issued,
              count(*) FILTER (WHERE status = 'issued' AND due_on < CURRENT_DATE)::int AS overdue,
              count(*) FILTER (WHERE status = 'returned')::int AS returned,
              count(*) FILTER (WHERE status = 'lost')::int AS lost
         FROM book_loans WHERE school_id = $1`,
      [req.schoolId],
    );

    res.json({
      items: rows.map(({ total_count: _t, ...r }) => r),
      total: rows[0]?.total_count ?? 0,
      page: q.page,
      counts: counts[0],
    });
  }),
);

libraryRoutes.get(
  '/settings',
  ah(async (req, res) => {
    const days = await loanDays(req.schoolId!);
    res.json({ loanDays: days, defaultDueOn: dueDateFrom(days) });
  }),
);

libraryRoutes.post(
  '/loans',
  ah(async (req, res) => {
    const input = parse(
      z.object({
        studentId: z.string().uuid("O'quvchi tanlanmagan"),
        bookId: z.string().uuid().optional(),
        copyId: z.string().uuid().optional(),
        dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Qaytarish sanasi noto'g'ri").optional(),
        note: z.string().trim().max(1000).optional(),
      }).refine((v) => v.bookId || v.copyId, { message: 'Kitob tanlanmagan' }),
      req.body,
    );

    const dueOn = input.dueOn ?? dueDateFrom(await loanDays(req.schoolId!));
    if (dueOn < new Date().toISOString().slice(0, 10)) {
      throw badRequest("Qaytarish sanasi o'tmishda bo'lishi mumkin emas");
    }

    const loan = await tx(async (client) => {
      const created = await issueBook(client, req.schoolId!, req.user!.id, { ...input, dueOn });
      await audit(req, {
        action: 'book.issue', entity: 'book_loan', entityId: created.id,
        after: { studentId: input.studentId, bookId: created.book_id, dueOn },
      }, client);
      return created;
    });

    res.status(201).json({ loan });
  }),
);

libraryRoutes.post(
  '/loans/:id/return',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(
      z.object({
        condition: z.enum(CONDITION).default('good'),
        note: z.string().trim().max(1000).optional(),
      }),
      req.body,
    );

    const loan = await tx(async (client) => {
      const updated = await returnBook(client, req.schoolId!, req.user!.id, id, input);
      await audit(req, {
        action: 'book.return', entity: 'book_loan', entityId: id,
        after: { condition: input.condition },
      }, client);
      return updated;
    });

    res.json({ loan });
  }),
);

libraryRoutes.post(
  '/loans/:id/lost',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { note } = parse(z.object({ note: z.string().trim().max(1000).optional() }), req.body);

    const loan = await tx(async (client) => {
      const updated = await markLost(client, req.schoolId!, req.user!.id, id, note);
      await audit(req, { action: 'book.lost', entity: 'book_loan', entityId: id }, client);
      return updated;
    });

    res.json({ loan });
  }),
);

// O'quvchining o'qigan kitoblari tarixi
libraryRoutes.get(
  '/students/:id/history',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { rows } = await pool.query(
      `SELECT l.id, l.issued_on, l.due_on, l.returned_on, l.status, l.condition_in,
              (l.status = 'issued' AND l.due_on < CURRENT_DATE) AS overdue,
              b.title, b.author, c.inventory_no
         FROM book_loans l
         JOIN books b ON b.id = l.book_id
         JOIN book_copies c ON c.id = l.copy_id
        WHERE l.school_id = $1 AND l.student_id = $2
        ORDER BY l.issued_on DESC, l.created_at DESC`,
      [req.schoolId, id],
    );
    res.json({
      items: rows,
      active: rows.filter((r) => r.status === 'issued').length,
      total: rows.length,
    });
  }),
);

/**
 * Inventar raqamini avtomatik beradi: KT-000001, KT-000002...
 *
 * Maktab o'z raqamlash tizimini ishlatsa, raqamlarni qo'lda kiritadi;
 * bu faqat "12 dona qo'sh" degan holat uchun.
 */
async function autoNumbers(
  client: { query: (q: string, v?: unknown[]) => Promise<{ rows: Array<{ n: number | null }> }> },
  schoolId: string,
  count: number,
): Promise<string[]> {
  const { rows } = await client.query(
    `SELECT MAX(NULLIF(regexp_replace(inventory_no, '^KT-', ''), '')::bigint) AS n
       FROM book_copies
      WHERE school_id = $1 AND inventory_no ~ '^KT-[0-9]+$'`,
    [schoolId],
  );
  let next = Number(rows[0]?.n ?? 0) + 1;
  const out: string[] = [];
  for (let i = 0; i < count; i += 1, next += 1) {
    out.push(`KT-${String(next).padStart(6, '0')}`);
  }
  return out;
}
