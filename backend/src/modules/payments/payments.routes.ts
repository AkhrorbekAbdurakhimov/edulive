import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { pool, tx } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { audit } from '../audit/audit.service.js';
import { getCurrentYear, getSchoolSettings } from '../schools/schools.service.js';
import { notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { parse } from '../../utils/validate.js';

const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Oy formati: YYYY-MM');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD');

// ================================================================ hisoblar
export const invoicesRoutes = Router();
invoicesRoutes.use(requireTenant, requireRole('admin', 'manager'));

// Oylik hisoblarni yaratish. Qayta chaqirilsa mavjudlarini o'tkazib yuboradi —
// har oy boshida scheduler ham, qo'lda ham chaqirsa bo'ladi.
invoicesRoutes.post(
  '/generate',
  ah(async (req, res) => {
    const { periodMonth } = parse(z.object({ periodMonth: monthStr }), req.body);
    const firstDay = `${periodMonth}-01`;

    const result = await tx(async (client) => {
      const year = await getCurrentYear(req.schoolId!, client);
      const settings = await getSchoolSettings(req.schoolId!, client);
      // To'lov muddati kuni — sozlamadan (3-qoida), kodda hardcode yo'q.
      const dueDay = Number(settings.payment_due_day ?? 10);
      const dueDate = `${periodMonth}-${String(dueDay).padStart(2, '0')}`;

      const inserted = await client.query(
        `INSERT INTO invoices
           (school_id, academic_year_id, student_id, enrollment_id, period_month, amount, discount, due_date)
         SELECT e.school_id, e.academic_year_id, e.student_id, e.id, $2::date,
                COALESCE(e.monthly_fee, c.monthly_fee),
                round(COALESCE(e.monthly_fee, c.monthly_fee) * e.discount_percent / 100, 2),
                $3::date
           FROM enrollments e
           JOIN classes c ON c.id = e.class_id
           JOIN students s ON s.id = e.student_id
          WHERE e.school_id = $1 AND e.academic_year_id = $4
            AND e.ends_on IS NULL AND s.status = 'active'
         ON CONFLICT (student_id, period_month) DO NOTHING
         RETURNING id`,
        [req.schoolId, firstDay, dueDate, year.id],
      );

      await audit(
        req,
        {
          action: 'invoice.generate',
          entity: 'invoice',
          after: { periodMonth, created: inserted.rowCount, dueDate },
        },
        client,
      );
      return { created: inserted.rowCount };
    });

    res.status(201).json(result);
  }),
);

invoicesRoutes.get(
  '/',
  ah(async (req, res) => {
    const query = parse(
      z.object({
        studentId: z.string().uuid().optional(),
        status: z.enum(['open', 'partial', 'paid', 'void']).optional(),
        month: monthStr.optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );

    const { rows } = await pool.query(
      `SELECT i.id, i.student_id, s.last_name || ' ' || s.first_name AS student_name,
              c.grade || '-' || c.letter AS class_name,
              i.period_month, i.amount, i.discount, i.due_date, i.status,
              COALESCE(pa.paid, 0) AS paid,
              i.amount - i.discount - COALESCE(pa.paid, 0) AS outstanding,
              count(*) OVER()::int AS total
         FROM invoices i
         JOIN students s ON s.id = i.student_id
         LEFT JOIN enrollments e ON e.id = i.enrollment_id
         LEFT JOIN classes c ON c.id = e.class_id
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS paid FROM payment_allocations
            WHERE invoice_id = i.id AND school_id = i.school_id
         ) pa ON true
        WHERE i.school_id = $1
          AND ($2::uuid IS NULL OR i.student_id = $2)
          AND ($3::text IS NULL OR i.status = $3)
          AND ($4::date IS NULL OR i.period_month = $4)
        ORDER BY i.period_month DESC, s.last_name
        LIMIT $5 OFFSET $6`,
      [
        req.schoolId,
        query.studentId ?? null,
        query.status ?? null,
        query.month ? `${query.month}-01` : null,
        query.limit,
        (query.page - 1) * query.limit,
      ],
    );

    res.json({ items: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0, page: query.page });
  }),
);

// ================================================================ to'lovlar
export const paymentsRoutes = Router();
paymentsRoutes.use(requireTenant, requireRole('admin', 'manager'));

const createPaymentSchema = z.object({
  studentId: z.string().uuid("studentId formati noto'g'ri"),
  amount: z.number().positive("Summa musbat bo'lishi kerak"),
  provider: z.enum(['cash', 'click', 'payme', 'transfer', 'manual'], {
    errorMap: () => ({ message: "Provider cash, click, payme, transfer yoki manual bo'lishi kerak" }),
  }),
  idempotencyKey: z.string().min(1).optional(),
  externalId: z.string().optional(),
  paidAt: z.string().datetime({ message: 'paidAt ISO formatida (2026-09-05T10:00:00Z)' }).optional(),
  note: z.string().optional(),
});

/** To'lovni eng eski ochiq hisoblardan boshlab taqsimlaydi (FIFO). Ortiqcha qismi avans bo'lib qoladi. */
async function allocatePayment(
  client: pg.PoolClient,
  schoolId: string,
  studentId: string,
  paymentId: string,
  amount: number,
): Promise<Array<{ invoiceId: string; amount: number }>> {
  const invoices = await client.query<{ id: string; outstanding: number }>(
    `SELECT i.id,
            i.amount - i.discount - COALESCE((
              SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id
            ), 0) AS outstanding
       FROM invoices i
      WHERE i.student_id = $1 AND i.school_id = $2 AND i.status IN ('open','partial')
      ORDER BY i.period_month
      FOR UPDATE OF i`,
    [studentId, schoolId],
  );

  const allocations: Array<{ invoiceId: string; amount: number }> = [];
  let remaining = amount;

  for (const inv of invoices.rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, inv.outstanding);
    if (take <= 0) continue;

    await client.query(
      `INSERT INTO payment_allocations (school_id, payment_id, invoice_id, amount) VALUES ($1,$2,$3,$4)`,
      [schoolId, paymentId, inv.id, take],
    );
    // ::numeric majburiy — aks holda parametrlar matn sifatida taqqoslanadi
    await client.query(
      `UPDATE invoices SET status = CASE WHEN $2::numeric >= $3::numeric THEN 'paid' ELSE 'partial' END WHERE id = $1`,
      [inv.id, take, inv.outstanding],
    );

    allocations.push({ invoiceId: inv.id, amount: take });
    remaining -= take;
  }
  return allocations;
}

paymentsRoutes.post(
  '/',
  ah(async (req, res) => {
    const input = parse(createPaymentSchema, req.body);

    const student = await pool.query(`SELECT 1 FROM students WHERE id = $1 AND school_id = $2`, [
      input.studentId,
      req.schoolId,
    ]);
    if (!student.rowCount) throw notFound("O'quvchi topilmadi");

    const result = await tx(async (client) => {
      // 4-QOIDA: webhook bitta to'lovni ikki marta yuborishi normal holat.
      // Unikal indeks ushlaydi, kod ON CONFLICT DO NOTHING bilan tinch o'tadi.
      const inserted = await client.query(
        `INSERT INTO payments
           (school_id, student_id, amount, provider, external_id, idempotency_key, paid_at, received_by, note)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, now()),$8,$9)
         ON CONFLICT (school_id, provider, idempotency_key) WHERE idempotency_key IS NOT NULL
         DO NOTHING
         RETURNING id, amount, provider, paid_at, receipt_no`,
        [
          req.schoolId,
          input.studentId,
          input.amount,
          input.provider,
          input.externalId ?? null,
          input.idempotencyKey ?? null,
          input.paidAt ?? null,
          req.user!.id,
          input.note ?? null,
        ],
      );

      if (!inserted.rowCount) {
        // Takroriy webhook — mavjud to'lovni qaytaramiz, hech narsa yozilmaydi.
        const { rows } = await client.query(
          `SELECT id, amount, provider, paid_at, receipt_no FROM payments
            WHERE school_id = $1 AND provider = $2 AND idempotency_key = $3`,
          [req.schoolId, input.provider, input.idempotencyKey],
        );
        return { payment: rows[0], allocations: [], duplicate: true };
      }

      const payment = inserted.rows[0];

      // Kvitansiya raqami — qisqa va noyob (id'dan)
      const receiptNo = `KV-${String(payment.id).slice(0, 8).toUpperCase()}`;
      await client.query(`UPDATE payments SET receipt_no = $2 WHERE id = $1`, [payment.id, receiptNo]);
      payment.receipt_no = receiptNo;

      const allocations = await allocatePayment(client, req.schoolId!, input.studentId, payment.id, input.amount);

      await audit(
        req,
        {
          action: 'payment.create',
          entity: 'payment',
          entityId: payment.id,
          after: { studentId: input.studentId, amount: input.amount, provider: input.provider, allocations },
        },
        client,
      );

      return { payment, allocations, duplicate: false };
    });

    res.status(result.duplicate ? 200 : 201).json(result);
  }),
);

paymentsRoutes.get(
  '/',
  ah(async (req, res) => {
    const query = parse(
      z.object({
        studentId: z.string().uuid().optional(),
        from: dateStr.optional(),
        to: dateStr.optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );

    const { rows } = await pool.query(
      `SELECT p.id, p.student_id, s.last_name || ' ' || s.first_name AS student_name,
              p.amount, p.provider, p.status, p.paid_at, p.receipt_no, p.note,
              u.full_name AS received_by,
              count(*) OVER()::int AS total
         FROM payments p
         JOIN students s ON s.id = p.student_id
         LEFT JOIN users u ON u.id = p.received_by
        WHERE p.school_id = $1
          AND ($2::uuid IS NULL OR p.student_id = $2)
          AND ($3::date IS NULL OR p.paid_at >= $3)
          AND ($4::date IS NULL OR p.paid_at < $4::date + 1)
        ORDER BY p.paid_at DESC
        LIMIT $5 OFFSET $6`,
      [
        req.schoolId,
        query.studentId ?? null,
        query.from ?? null,
        query.to ?? null,
        query.limit,
        (query.page - 1) * query.limit,
      ],
    );

    res.json({ items: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0, page: query.page });
  }),
);
