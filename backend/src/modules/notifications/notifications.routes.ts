import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { ah } from '../../utils/http.js';
import { notFound } from '../../utils/errors.js';
import { parse } from '../../utils/validate.js';
import { dispatchQueued } from './notifications.service.js';

export const notificationsRoutes = Router();
notificationsRoutes.use(requireTenant, requireRole('admin', 'manager'));

// Yuborilgan xabarlar tarixi. Xabar ketmasa sababi ko'rinishi shart —
// aks holda "ota-onaga xabar bordimi?" degan savolga javob yo'q.
notificationsRoutes.get(
  '/',
  ah(async (req, res) => {
    const query = parse(
      z.object({
        status: z.enum(['queued', 'sent', 'failed', 'read']).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );

    const { rows } = await pool.query(
      `SELECT n.id, n.kind, n.status, n.body, n.error, n.attempts,
              n.created_at, n.sent_at,
              p.full_name AS parent_name, p.phone AS parent_phone,
              s.last_name || ' ' || s.first_name AS student_name,
              count(*) OVER()::int AS total_count
         FROM notifications n
         LEFT JOIN parents p ON p.id = n.parent_id AND p.school_id = n.school_id
         LEFT JOIN students s ON s.id = n.student_id AND s.school_id = n.school_id
        WHERE n.school_id = $1 AND ($2::text IS NULL OR n.status = $2)
        ORDER BY n.created_at DESC
        LIMIT $3 OFFSET $4`,
      [req.schoolId, query.status ?? null, query.limit, (query.page - 1) * query.limit],
    );

    const { rows: counts } = await pool.query<{ status: string; c: number }>(
      `SELECT status, count(*)::int AS c FROM notifications
        WHERE school_id = $1 GROUP BY status`,
      [req.schoolId],
    );

    res.json({
      items: rows.map(({ total_count: _tc, ...r }) => r),
      total: rows[0]?.total_count ?? 0,
      page: query.page,
      counts: Object.fromEntries(counts.map((c) => [c.status, c.c])),
    });
  }),
);

// Xato ketgan xabarni qayta navbatga qo'yish. Ota-ona botga endi ulangan
// bo'lsa yoki bot vaqtincha ishlamagan bo'lsa kerak bo'ladi.
notificationsRoutes.post(
  '/:id/retry',
  ah(async (req, res) => {
    const { rowCount } = await pool.query(
      `UPDATE notifications SET status = 'queued', attempts = 0, error = NULL
        WHERE id = $1 AND school_id = $2 AND status = 'failed'`,
      [req.params.id, req.schoolId],
    );
    if (!rowCount) throw notFound('Xato holatidagi xabar topilmadi');

    // Fon ishchisini kutmasdan darhol urinamiz — foydalanuvchi natijani
    // shu yerda ko'rishi kerak.
    await dispatchQueued(10);
    res.json({ ok: true });
  }),
);
