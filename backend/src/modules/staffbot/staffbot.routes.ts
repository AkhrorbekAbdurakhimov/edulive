/**
 * Xodimlar boti: ochiq webhook + xodim uchun "Telegramni ulash".
 *
 * Webhook himoyasi ota-onalar botidagi kabi ikki qatlamli: manzildagi maxfiy
 * segment va Telegram yuboradigan X-Telegram-Bot-Api-Secret-Token sarlavhasi.
 */
import { Router } from 'express';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';
import { ah } from '../../utils/http.js';
import { badRequest } from '../../utils/errors.js';
import { createLinkCode, handleUpdate } from './staffbot.service.js';

// --------------------------------------------------- ochiq webhook
export const staffBotWebhook = Router();

staffBotWebhook.post(
  '/:secret',
  ah(async (req, res) => {
    const { secret } = req.params;
    if (!env.staffBot.webhookSecret || secret !== env.staffBot.webhookSecret
        || req.header('X-Telegram-Bot-Api-Secret-Token') !== secret) {
      res.sendStatus(200);   // Telegram qayta urinmasin
      return;
    }
    // Xatoni yutamiz: muvaffaqiyatsiz webhook Telegram tomonidan qayta
    // yuboriladi va bir xil buyruq bir necha marta bajarilardi.
    try {
      await handleUpdate(req.body);
    } catch (err) {
      console.error('staffbot:', (err as Error).message);
    }
    res.sendStatus(200);
  }),
);

// --------------------------------------------------- himoyalangan
export const staffBotRoutes = Router();

/** O'zini botga ulash uchun bir martalik havola. */
staffBotRoutes.post(
  '/link',
  ah(async (req, res) => {
    if (!env.staffBot.token) throw badRequest('Xizmat boti sozlanmagan');
    const code = await createLinkCode(req.user!.id);
    res.json({
      code,
      link: `https://t.me/${env.staffBot.username}?start=${code}`,
      username: env.staffBot.username,
    });
  }),
);

/** Ulanish holati — Sozlamalar sahifasi shuni ko'rsatadi. */
staffBotRoutes.get(
  '/link',
  ah(async (req, res) => {
    const { rows } = await pool.query<{ linked: boolean }>(
      `SELECT telegram_chat_id IS NOT NULL AS linked FROM users WHERE id = $1`,
      [req.user!.id],
    );
    res.json({
      linked: rows[0]?.linked ?? false,
      configured: !!env.staffBot.token,
      username: env.staffBot.username,
    });
  }),
);

/** Ulanishni uzish — telefon almashtirilganda kerak bo'ladi. */
staffBotRoutes.delete(
  '/link',
  ah(async (req, res) => {
    await pool.query(`UPDATE users SET telegram_chat_id = NULL WHERE id = $1`, [req.user!.id]);
    res.json({ ok: true });
  }),
);
