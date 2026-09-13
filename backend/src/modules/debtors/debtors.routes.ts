import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { ah } from '../../utils/http.js';
import { uzSum } from '../../utils/money.js';
import { parse } from '../../utils/validate.js';
import { badRequest } from '../../utils/errors.js';
import { audit } from '../audit/audit.service.js';
import { dispatchQueued } from '../notifications/notifications.service.js';

/** 2026-09-10 -> 10.09.2026 */
function fmtDate(d: string): string {
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.${x.getFullYear()}`;
}

export const debtorsRoutes = Router();
debtorsRoutes.use(requireTenant, requireRole('admin', 'manager'));

// Qarzdorlar alohida jadval emas — ochiq hisoblardan avtomatik shakllanadi.
debtorsRoutes.get(
  '/',
  ah(async (req, res) => {
    const query = parse(
      z.object({
        // z.coerce.boolean emas: u "false" satrini ham true qiladi
        overdueOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );

    const { rows } = await pool.query(
      `WITH debt AS (
         SELECT i.student_id,
                SUM(i.amount - i.discount - COALESCE(pa.paid, 0)) AS outstanding,
                SUM(i.amount - i.discount - COALESCE(pa.paid, 0))
                  FILTER (WHERE i.due_date < CURRENT_DATE)       AS overdue,
                MIN(i.due_date) FILTER (WHERE i.due_date < CURRENT_DATE) AS oldest_due
           FROM invoices i
           LEFT JOIN LATERAL (
             SELECT SUM(amount) AS paid FROM payment_allocations
              WHERE invoice_id = i.id AND school_id = i.school_id
           ) pa ON true
          WHERE i.school_id = $1 AND i.status IN ('open','partial')
          GROUP BY i.student_id
         HAVING SUM(i.amount - i.discount - COALESCE(pa.paid, 0)) > 0
       )
       SELECT d.student_id, s.last_name || ' ' || s.first_name AS student_name,
              c.grade || '-' || c.letter AS class_name,
              d.outstanding, COALESCE(d.overdue, 0) AS overdue, d.oldest_due,
              p.full_name AS parent_name, p.phone AS parent_phone,
              count(*) OVER()::int AS total_count,
              SUM(d.outstanding) OVER() AS total_outstanding
         FROM debt d
         JOIN students s ON s.id = d.student_id AND s.school_id = $1
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.ends_on IS NULL
         LEFT JOIN classes c ON c.id = e.class_id
         LEFT JOIN LATERAL (
           SELECT pr.full_name, pp.phone FROM student_parents sp
             JOIN parents pr ON pr.id = sp.parent_id AND pr.school_id = $1
             LEFT JOIN parent_phones pp ON pp.parent_id = pr.id AND pp.is_primary
            WHERE sp.student_id = s.id
            ORDER BY sp.is_primary DESC LIMIT 1
         ) p ON true
        WHERE NOT $2 OR COALESCE(d.overdue, 0) > 0
        ORDER BY d.outstanding DESC
        LIMIT $3 OFFSET $4`,
      [req.schoolId, query.overdueOnly, query.limit, (query.page - 1) * query.limit],
    );

    res.json({
      items: rows.map(({ total_count: _tc, total_outstanding: _to, ...r }) => r),
      total: rows[0]?.total_count ?? 0,
      totalOutstanding: rows[0]?.total_outstanding ?? 0,
      page: query.page,
    });
  }),
);

// Qarz eslatmasi. Yuborish emas — NAVBATGA qo'yish: fon ishchisi jo'natadi.
// Bir kunda bitta o'quvchi uchun bitta eslatma; tugma ikki marta bosilsa
// ota-ona ikkita bir xil xabar olmasligi kerak.
debtorsRoutes.post(
  '/:studentId/remind',
  ah(async (req, res) => {
    const { rows } = await pool.query<{
      student_name: string; outstanding: number; oldest_due: string | null;
    }>(
      `SELECT s.last_name || ' ' || s.first_name AS student_name,
              SUM(i.amount - i.discount - COALESCE(pa.paid, 0)) AS outstanding,
              MIN(i.due_date) FILTER (WHERE i.due_date < CURRENT_DATE) AS oldest_due
         FROM invoices i
         JOIN students s ON s.id = i.student_id AND s.school_id = i.school_id
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS paid FROM payment_allocations
            WHERE invoice_id = i.id AND school_id = i.school_id
         ) pa ON true
        WHERE i.school_id = $1 AND i.student_id = $2 AND i.status IN ('open','partial')
        GROUP BY s.last_name, s.first_name`,
      [req.schoolId, req.params.studentId],
    );

    const debt = Number(rows[0]?.outstanding ?? 0);
    if (!rows.length || debt <= 0) throw badRequest("Bu o'quvchida qarz yo'q");

    const body =
      `Hurmatli ota-ona!\n${rows[0].student_name} uchun to'lanmagan summa: ` +
      `${uzSum(debt)}.\n` +
      (rows[0].oldest_due ? `Eng eski hisob muddati: ${fmtDate(rows[0].oldest_due)}.\n` : '') +
      `Iltimos, to'lovni amalga oshiring.`;

    const { rowCount } = await pool.query(
      `INSERT INTO notifications (school_id, parent_id, parent_phone_id, student_id, kind, payload, body)
       SELECT $1, p.id, pp.id, $2, 'debt.reminder',
              jsonb_build_object('outstanding', $3::numeric), $4
         FROM student_parents sp
         JOIN parents p ON p.id = sp.parent_id
         JOIN parent_phones pp ON pp.parent_id = p.id
        WHERE sp.student_id = $2 AND p.school_id = $1
          AND pp.notify_enabled AND pp.telegram_chat_id IS NOT NULL
          AND pp.telegram_verified_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM notifications n
             WHERE n.parent_phone_id = pp.id AND n.student_id = $2
               AND n.kind = 'debt.reminder'
               AND n.created_at > now() - interval '1 day'
          )`,
      [req.schoolId, req.params.studentId, debt, body],
    );

    if (!rowCount) {
      throw badRequest(
        "Xabar yuborilmadi: ota-ona Telegram botga ulanmagan yoki bugun eslatma allaqachon yuborilgan",
      );
    }

    await audit(req, {
      action: 'debt.remind',
      entity: 'student',
      entityId: req.params.studentId,
      after: { outstanding: debt, sent: rowCount },
    });

    // Foydalanuvchi natijani darhol ko'rishi kerak — 15 soniya kutmasin.
    await dispatchQueued(10);
    res.json({ queued: rowCount });
  }),
);
