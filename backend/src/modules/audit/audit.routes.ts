import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { ah } from '../../utils/http.js';
import { parse } from '../../utils/validate.js';

// Faqat o'qish — audit_log ga API orqali yozish/o'chirish yo'li YO'Q (6-qoida A6).
export const auditRoutes = Router();
auditRoutes.use(requireTenant, requireRole('admin'));

auditRoutes.get(
  '/',
  ah(async (req, res) => {
    const query = parse(
      z.object({
        entity: z.string().optional(),
        action: z.string().optional(),
        actorId: z.string().uuid().optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD').optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD').optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );

    const { rows } = await pool.query(
      `SELECT a.id, a.actor_id, u.full_name AS actor_name, a.actor_role,
              a.action, a.entity, a.entity_id, a.before, a.after, a.ip, a.created_at,
              count(*) OVER()::int AS total
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.school_id = $1
          AND ($2::text IS NULL OR a.entity = $2)
          AND ($3::text IS NULL OR a.action = $3)
          AND ($4::uuid IS NULL OR a.actor_id = $4)
          AND ($5::date IS NULL OR a.created_at >= $5)
          AND ($6::date IS NULL OR a.created_at < $6::date + 1)
        ORDER BY a.id DESC
        LIMIT $7 OFFSET $8`,
      [
        req.schoolId,
        query.entity ?? null,
        query.action ?? null,
        query.actorId ?? null,
        query.from ?? null,
        query.to ?? null,
        query.limit,
        (query.page - 1) * query.limit,
      ],
    );

    res.json({ items: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0, page: query.page });
  }),
);
