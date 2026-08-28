/**
 * Maktabga Telegram bot biriktirish — platforma ishi (superadmin).
 *
 * Token AES-256-GCM bilan shifrlab saqlanadi: ochiq matnda yotsa, baza
 * nusxasi (kunlik zaxira fayli ham) sizib ketganda barcha maktablarning
 * botlari begonaga o'tardi.
 *
 * Token to'ldirilmagan maktab platforma botidan foydalanadi — ya'ni bot
 * ulash MAJBURIY emas, maktab shusiz ham ishlaydi.
 */
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { audit } from '../audit/audit.service.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { parse, uuidParam } from '../../utils/validate.js';
import { seal, secretsAvailable } from '../../utils/secretbox.js';
import { env } from '../../config/env.js';
import {
  dropWebhook, getMe, newWebhookSecret, setWebhook, webhookUrl,
} from '../telegram/telegram.service.js';

export const schoolsTelegramRoutes = Router();
schoolsTelegramRoutes.use(requireRole()); // bo'sh ro'yxat = faqat superadmin

schoolsTelegramRoutes.get(
  '/:id/telegram',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { rows } = await pool.query<{
      telegram_bot_username: string | null;
      telegram_webhook_secret: string | null;
      has_token: boolean;
    }>(
      `SELECT telegram_bot_username, telegram_webhook_secret,
              telegram_bot_token_enc IS NOT NULL AS has_token
         FROM schools WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw notFound('Maktab topilmadi');

    res.json({
      // Token HECH QACHON qaytarilmaydi — faqat ulangan-ulanmagani.
      own: rows[0].has_token,
      username: rows[0].telegram_bot_username,
      webhookSet: !!(rows[0].telegram_webhook_secret && webhookUrl(rows[0].telegram_webhook_secret)),
      platformBot: env.telegram.username || null,
      canEncrypt: secretsAvailable(),
    });
  }),
);

schoolsTelegramRoutes.put(
  '/:id/telegram',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { token } = parse(
      z.object({
        // BotFather formati: <raqam>:<harf-raqam>
        token: z.string().regex(/^\d{6,}:[A-Za-z0-9_-]{30,}$/, "Token formati noto'g'ri (BotFather bergan qatorni to'liq qo'ying)"),
      }),
      req.body,
    );
    if (!secretsAvailable()) {
      throw badRequest('SECRET_KEY sozlanmagan — token shifrlab saqlanmaydi, shuning uchun qabul qilinmadi');
    }

    const exists = await pool.query(`SELECT 1 FROM schools WHERE id = $1`, [id]);
    if (!exists.rowCount) throw notFound('Maktab topilmadi');

    // Token haqiqiyligini Telegramning o'zidan tekshiramiz — noto'g'ri token
    // bazaga tushib, keyin xabarlar jimgina ketmay qolishidan ko'ra shu yaxshi.
    const me = await getMe(token);

    const secret = newWebhookSecret();
    const webhookSet = await setWebhook(token, secret);

    await pool.query(
      `UPDATE schools
          SET telegram_bot_token_enc = $2, telegram_bot_username = $3, telegram_webhook_secret = $4
        WHERE id = $1`,
      [id, seal(token), me.username, secret],
    );
    // Tokenning o'zi auditga YOZILMAYDI.
    await audit(req, {
      action: 'school.telegram.connect',
      entity: 'school',
      entityId: id,
      after: { username: me.username, webhookSet },
    });

    res.json({ own: true, username: me.username, webhookSet });
  }),
);

schoolsTelegramRoutes.delete(
  '/:id/telegram',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { rows } = await pool.query<{ telegram_bot_username: string | null }>(
      `UPDATE schools
          SET telegram_bot_token_enc = NULL, telegram_bot_username = NULL, telegram_webhook_secret = NULL
        WHERE id = $1
        RETURNING telegram_bot_username`,
      [id],
    );
    if (!rows[0]) throw notFound('Maktab topilmadi');

    await audit(req, {
      action: 'school.telegram.disconnect',
      entity: 'school',
      entityId: id,
      before: { username: rows[0].telegram_bot_username },
    });

    res.json({ own: false });
  }),
);

/** Ulangan botning webhookini qayta o'rnatish — manzil o'zgarganda kerak. */
schoolsTelegramRoutes.post(
  '/:id/telegram/refresh',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { rows } = await pool.query<{ enc: string | null; secret: string | null }>(
      `SELECT telegram_bot_token_enc AS enc, telegram_webhook_secret AS secret
         FROM schools WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw notFound('Maktab topilmadi');
    if (!rows[0].enc || !rows[0].secret) throw badRequest('Maktabga bot ulanmagan');

    const { open } = await import('../../utils/secretbox.js');
    const token = open(rows[0].enc);
    const webhookSet = await setWebhook(token, rows[0].secret);
    if (!webhookSet) await dropWebhook(token);

    res.json({ webhookSet });
  }),
);
