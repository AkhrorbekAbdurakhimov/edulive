/**
 * Telegram bot bilan ishlash.
 *
 * Ikki rejim: maktabning O'Z boti (schools.telegram_bot_token_enc) yoki
 * platforma boti (.env). Maktab tokeni to'ldirilmagan bo'lsa platformaniki
 * ishlatiladi — shunda maktab hech narsa qilmasdan ishlay boshlaydi.
 */
import { randomBytes } from 'node:crypto';
import { pool, type Db } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { open } from '../../utils/secretbox.js';
import { badRequest } from '../../utils/errors.js';

const API = 'https://api.telegram.org';

export interface BotInfo {
  id: number;
  username: string;
  first_name: string;
}

/** Telegram API chaqiruvi. Xatoni o'zbekcha xabarga aylantiradi. */
export async function tg<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) {
    throw badRequest(`Telegram rad etdi: ${json.description ?? 'nomaʼlum xato'}`);
  }
  return json.result as T;
}

/** Token haqiqiyligini tekshiradi va bot ma'lumotini qaytaradi. */
export function getMe(token: string): Promise<BotInfo> {
  return tg<BotInfo>(token, 'getMe');
}

export function newWebhookSecret(): string {
  return randomBytes(24).toString('hex');
}

/**
 * Webhook manzili. Telegram faqat HTTPS qabul qiladi, shuning uchun lokal
 * ishlab chiqishda webhook o'rnatilmaydi — bu ataylab jim o'tkaziladi.
 */
export function webhookUrl(secret: string): string | null {
  const base = env.publicUrl.replace(/\/+$/, '');
  if (!base.startsWith('https://')) return null;
  return `${base}/api/telegram/webhook/${secret}`;
}

export async function setWebhook(token: string, secret: string): Promise<boolean> {
  const url = webhookUrl(secret);
  if (!url) return false;
  await tg(token, 'setWebhook', {
    url,
    // Telegram har so'rovda shu sarlavhani yuboradi — begona so'rovlar kesiladi.
    secret_token: secret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });
  return true;
}

export async function dropWebhook(token: string): Promise<void> {
  await tg(token, 'deleteWebhook', { drop_pending_updates: true });
}

export interface SchoolBot {
  schoolId: string;
  token: string;
  username: string | null;
  /** false — maktabning o'z boti yo'q, platformaniki ishlatilyapti. */
  own: boolean;
}

/** Maktabga xabar yuborish uchun qaysi bot ishlatilishini aniqlaydi. */
export async function botForSchool(schoolId: string, db: Db = pool): Promise<SchoolBot | null> {
  const { rows } = await db.query<{
    telegram_bot_token_enc: string | null;
    telegram_bot_username: string | null;
  }>(
    `SELECT telegram_bot_token_enc, telegram_bot_username FROM schools WHERE id = $1`,
    [schoolId],
  );
  const s = rows[0];
  if (!s) return null;

  if (s.telegram_bot_token_enc) {
    return {
      schoolId,
      token: open(s.telegram_bot_token_enc),
      username: s.telegram_bot_username,
      own: true,
    };
  }
  if (!env.telegram.token) return null;
  return { schoolId, token: env.telegram.token, username: env.telegram.username, own: false };
}

/** Ota-onaga xabar. Bloklagan bo'lsa jim o'tkazamiz — xabar yuborish yiqilmasin. */
export async function sendToParent(
  token: string,
  chatId: string | number,
  text: string,
): Promise<boolean> {
  try {
    await tg(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
    return true;
  } catch {
    return false;
  }
}
