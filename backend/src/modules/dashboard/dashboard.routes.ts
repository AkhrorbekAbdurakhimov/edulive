import { Router } from 'express';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { ah } from '../../utils/http.js';

export const dashboardRoutes = Router();
dashboardRoutes.use(requireTenant, requireRole('admin', 'manager'));

dashboardRoutes.get(
  '/',
  ah(async (req, res) => {
    const [students, attendance, payments, debtors] = await Promise.all([
      pool.query(
        `SELECT count(*)::int AS active FROM students WHERE school_id = $1 AND status = 'active'`,
        [req.schoolId],
      ),
      pool.query(
        `SELECT COALESCE(SUM(total_count), 0)::int AS total,
                COALESCE(SUM(present_count), 0)::int AS present,
                COALESCE(SUM(absent_count), 0)::int AS absent,
                COALESCE(SUM(late_count), 0)::int AS late,
                count(*)::int AS sessions,
                count(*) FILTER (WHERE confirmed_at IS NOT NULL)::int AS confirmed
           FROM attendance_sessions
          WHERE school_id = $1 AND on_date = CURRENT_DATE`,
        [req.schoolId],
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS this_month
           FROM payments
          WHERE school_id = $1 AND status = 'confirmed'
            AND paid_at >= date_trunc('month', now())`,
        [req.schoolId],
      ),
      pool.query(
        `SELECT count(DISTINCT i.student_id)::int AS count,
                COALESCE(SUM(i.amount - i.discount - COALESCE(pa.paid, 0)), 0) AS outstanding
           FROM invoices i
           LEFT JOIN LATERAL (
             SELECT SUM(amount) AS paid FROM payment_allocations
              WHERE invoice_id = i.id AND school_id = i.school_id
           ) pa ON true
          WHERE i.school_id = $1 AND i.status IN ('open','partial')
            AND i.amount - i.discount - COALESCE(pa.paid, 0) > 0`,
        [req.schoolId],
      ),
    ]);

    const a = attendance.rows[0];
    res.json({
      students: { active: students.rows[0].active },
      attendanceToday: {
        sessions: a.sessions,
        confirmed: a.confirmed,
        total: a.total,
        present: a.present,
        absent: a.absent,
        late: a.late,
        rate: a.total > 0 ? Math.round((a.present / a.total) * 1000) / 10 : null,
      },
      payments: { thisMonth: payments.rows[0].this_month },
      debtors: { count: debtors.rows[0].count, outstanding: debtors.rows[0].outstanding },
    });
  }),
);
