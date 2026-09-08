import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { ah } from '../../utils/http.js';
import { notFound } from '../../utils/errors.js';
import { env } from '../../config/env.js';
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
              p.full_name AS parent_name, pp.phone AS parent_phone,
              s.last_name || ' ' || s.first_name AS student_name,
              count(*) OVER()::int AS total_count
         FROM notifications n
         LEFT JOIN parents p ON p.id = n.parent_id AND p.school_id = n.school_id
         LEFT JOIN parent_phones pp ON pp.id = n.parent_phone_id
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

/**
 * Ota-onalarni botga taklif qilish uchun kerak bo'lgan hamma narsa.
 *
 * Bu maktabning o'z ishi (superadminniki emas): havolani ota-onalarga
 * maktab tarqatadi. Kim ulanmagani ham shu yerda — busiz "nega xabar
 * bormadi?" degan savolga javob topib bo'lmaydi.
 */
notificationsRoutes.get(
  '/telegram',
  ah(async (req, res) => {
    const { rows } = await pool.query<{
      tg_code: string | null; own_bot: string | null; has_token: boolean;
    }>(
      `SELECT tg_code, telegram_bot_username AS own_bot,
              telegram_bot_token_enc IS NOT NULL AS has_token
         FROM schools WHERE id = $1`,
      [req.schoolId],
    );
    if (!rows[0]) throw notFound('Maktab topilmadi');

    // Maktabning o'z boti bo'lmasa platforma botidan foydalaniladi; u holda
    // qaysi maktab ekani havoladagi tg_code orqali aniqlanadi.
    const bot = rows[0].has_token ? rows[0].own_bot : (env.telegram.username || null);
    const inviteLink = bot
      ? `https://t.me/${bot}${rows[0].tg_code ? `?start=${rows[0].tg_code}` : ''}`
      : null;

    const { rows: stat } = await pool.query<{ total: number; connected: number }>(
      `SELECT count(*)::int AS total,
              count(telegram_chat_id)::int AS connected
         FROM parent_phones WHERE school_id = $1`,
      [req.schoolId],
    );

    // Ulanmaganlar — maktab qo'ng'iroq qilib aytishi uchun
    const { rows: pending } = await pool.query(
      `SELECT pp.id, p.full_name, pp.phone,
              string_agg(DISTINCT s.last_name || ' ' || s.first_name, ', ') AS students
         FROM parent_phones pp
         JOIN parents p ON p.id = pp.parent_id
         LEFT JOIN student_parents sp ON sp.parent_id = p.id
         LEFT JOIN students s ON s.id = sp.student_id AND s.status = 'active'
        WHERE pp.school_id = $1 AND pp.telegram_chat_id IS NULL
        GROUP BY pp.id, p.full_name, pp.phone
        ORDER BY p.full_name, pp.phone
        LIMIT 200`,
      [req.schoolId],
    );

    res.json({
      bot,
      ownBot: rows[0].has_token,
      inviteLink,
      parents: stat[0],
      pending,
    });
  }),
);
