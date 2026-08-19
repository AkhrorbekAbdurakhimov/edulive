import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { ah } from '../../utils/http.js';
import { parse } from '../../utils/validate.js';

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
           SELECT pr.full_name, pr.phone FROM student_parents sp
             JOIN parents pr ON pr.id = sp.parent_id AND pr.school_id = $1
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
