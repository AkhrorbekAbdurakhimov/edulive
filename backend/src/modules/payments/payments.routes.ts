import { Router } from 'express';
import { z } from 'zod';
import type pg from 'pg';
import { pool, tx } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { audit } from '../audit/audit.service.js';
import { getCurrentYear, getSchoolSettings } from '../schools/schools.service.js';
import { badRequest, notFound } from '../../utils/errors.js';
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

      // Taqsimlanmagan puli bor HAR BIR o'quvchi bo'yicha qaytadan yuramiz —
      // faqat yangi hisob olganlar bo'yicha emas. Sabab: avans hisobdan oldin
      // kelgan bo'lsa, u eski hisobga ham bog'lanmay qolgan bo'lishi mumkin.
      // Shu tufayli bu tugma "o'zini tuzatuvchi" amal bo'ladi.
      const pending = await client.query<{ student_id: string }>(
        `SELECT p.student_id
           FROM payments p
          WHERE p.school_id = $1 AND p.status = 'confirmed'
          GROUP BY p.student_id
         HAVING SUM(p.amount) > COALESCE((
                  SELECT SUM(pa.amount) FROM payment_allocations pa
                   WHERE pa.payment_id IN (
                     SELECT p2.id FROM payments p2 WHERE p2.student_id = p.student_id
                   )), 0)`,
        [req.schoolId],
      );
      let allocated = 0;
      for (const s of pending.rows) {
        const done = await allocateStudentPayments(client, req.schoolId!, s.student_id);
        allocated += done.length;
      }

      await audit(
        req,
        {
          action: 'invoice.generate',
          entity: 'invoice',
          after: { periodMonth, created: inserted.rowCount, dueDate, allocated },
        },
        client,
      );
      return { created: inserted.rowCount, allocated };
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
  // Kassir qaysi oylar uchun pul olayotganini belgilashi mumkin.
  // Bo'sh bo'lsa eng eski qarzdan boshlab avtomatik taqsimlanadi.
  invoiceIds: z.array(z.string().uuid()).max(24).optional(),
  idempotencyKey: z.string().min(1).optional(),
  externalId: z.string().optional(),
  paidAt: z.string().datetime({ message: 'paidAt ISO formatida (2026-09-05T10:00:00Z)' }).optional(),
  note: z.string().optional(),
});

/**
 * O'quvchining TAQSIMLANMAGAN to'lovlarini ochiq hisoblarga yoyadi (FIFO:
 * eski to'lovdan eski hisobga).
 *
 * Nega butun o'quvchi bo'yicha, faqat yangi to'lov bo'yicha emas: pul ko'pincha
 * hisobdan oldin keladi — ota-ona oldindan to'laydi yoki hisob oy o'rtasida
 * chiqariladi. O'shanda to'lov "avans" bo'lib qoladi. Ilgari uni keyingi hisobga
 * hech kim bog'lamasdi va o'quvchi to'lagan bo'lsa ham to'liq qarzdor
 * ko'rinardi. Shuning uchun bu funksiya to'lov qabul qilinganda ham, hisob
 * chiqarilganda ham chaqiriladi va har safar butun qoldiqni qaytadan yoyadi.
 */
async function allocateStudentPayments(
  client: pg.PoolClient,
  schoolId: string,
  studentId: string,
): Promise<Array<{ paymentId: string; invoiceId: string; amount: number }>> {
  const payments = await client.query<{ id: string; remaining: number }>(
    `SELECT p.id,
            p.amount - COALESCE((
              SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.payment_id = p.id
            ), 0) AS remaining
       FROM payments p
      WHERE p.student_id = $1 AND p.school_id = $2 AND p.status = 'confirmed'
      ORDER BY p.paid_at, p.id
      FOR UPDATE OF p`,
    [studentId, schoolId],
  );

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

  const allocations: Array<{ paymentId: string; invoiceId: string; amount: number }> = [];
  const open = invoices.rows.filter((i) => i.outstanding > 0);
  let idx = 0;

  for (const pay of payments.rows) {
    let remaining = Number(pay.remaining);
    if (remaining <= 0) continue;

    while (remaining > 0 && idx < open.length) {
      const inv = open[idx];
      const take = Math.min(remaining, inv.outstanding);
      if (take <= 0) { idx += 1; continue; }

      await client.query(
        `INSERT INTO payment_allocations (school_id, payment_id, invoice_id, amount) VALUES ($1,$2,$3,$4)`,
        [schoolId, pay.id, inv.id, take],
      );
      allocations.push({ paymentId: pay.id, invoiceId: inv.id, amount: take });

      inv.outstanding -= take;
      remaining -= take;
      if (inv.outstanding <= 0) idx += 1;
    }
  }

  await refreshInvoiceStatuses(client, schoolId, studentId);
  return allocations;
}

/**
 * Hisob statusini taqsimlangan summadan qayta hisoblaydi. Taqsimlash siklining
 * ichida qo'yilsa, hech narsa tegmagan hisob ham "partial" bo'lib qolardi.
 */
async function refreshInvoiceStatuses(client: pg.PoolClient, schoolId: string, studentId: string) {
  await client.query(
    `UPDATE invoices i SET status = CASE
         WHEN a.total >= i.amount - i.discount THEN 'paid'
         WHEN a.total > 0                      THEN 'partial'
         ELSE 'open'
       END
       FROM (
         SELECT i2.id, COALESCE(SUM(pa.amount), 0) AS total
           FROM invoices i2
           LEFT JOIN payment_allocations pa ON pa.invoice_id = i2.id
          WHERE i2.student_id = $1 AND i2.school_id = $2 AND i2.status <> 'void'
          GROUP BY i2.id
       ) a
      WHERE i.id = a.id AND i.status <> 'void'`,
    [studentId, schoolId],
  );
}

/**
 * To'lovni KASSIR TANLAGAN oylarga yozadi (tanlangan tartibda).
 *
 * Ortgan qismi ataylab boshqa oyga o'tkazilmaydi: "noyabr uchun" deb berilgan
 * pul jimgina sentabrga ketmasligi kerak. Ortiqcha qism avans bo'lib qoladi va
 * keyingi hisob chiqarilganda hisobga olinadi.
 */
async function allocateToInvoices(
  client: pg.PoolClient,
  schoolId: string,
  studentId: string,
  paymentId: string,
  amount: number,
  invoiceIds: string[],
): Promise<Array<{ paymentId: string; invoiceId: string; amount: number }>> {
  const { rows } = await client.query<{ id: string; outstanding: number }>(
    `SELECT i.id,
            i.amount - i.discount - COALESCE((
              SELECT SUM(pa.amount) FROM payment_allocations pa WHERE pa.invoice_id = i.id
            ), 0) AS outstanding
       FROM invoices i
      WHERE i.id = ANY($1::uuid[]) AND i.student_id = $2 AND i.school_id = $3
        AND i.status <> 'void'
      FOR UPDATE OF i`,
    [invoiceIds, studentId, schoolId],
  );
  if (rows.length !== invoiceIds.length) {
    throw badRequest("Tanlangan oylardan biri bu o'quvchiga tegishli emas");
  }

  // Kassir tanlagan tartibni saqlaymiz.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const allocations: Array<{ paymentId: string; invoiceId: string; amount: number }> = [];
  let remaining = amount;

  for (const id of invoiceIds) {
    if (remaining <= 0) break;
    const inv = byId.get(id)!;
    const take = Math.min(remaining, Number(inv.outstanding));
    if (take <= 0) continue;

    await client.query(
      `INSERT INTO payment_allocations (school_id, payment_id, invoice_id, amount) VALUES ($1,$2,$3,$4)`,
      [schoolId, paymentId, id, take],
    );
    allocations.push({ paymentId, invoiceId: id, amount: take });
    remaining -= take;
  }

  await refreshInvoiceStatuses(client, schoolId, studentId);
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

      const allocations = input.invoiceIds?.length
        ? await allocateToInvoices(client, req.schoolId!, input.studentId, payment.id, input.amount, input.invoiceIds)
        : await allocateStudentPayments(client, req.schoolId!, input.studentId);

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
