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
import { uzSum } from '../../utils/money.js';

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

// ---------------------------------------------------------------- farzand kartochkasi

export interface ChildInfo {
  id: string;
  name: string;
  class_name: string | null;
  birth_date: string | null;
  monthly_fee: number | null;
  discount_percent: number | null;
}

/** Ota-onaga biriktirilgan faol o'quvchilar — tasdiqlash kartochkasi uchun. */
export async function childrenOf(parentId: string, db: Db = pool): Promise<ChildInfo[]> {
  const { rows } = await db.query<ChildInfo>(
    `SELECT s.id,
            s.last_name || ' ' || s.first_name
              || COALESCE(' ' || s.middle_name, '') AS name,
            c.grade || '-' || c.letter AS class_name,
            s.birth_date::text AS birth_date,
            COALESCE(e.monthly_fee, c.monthly_fee) AS monthly_fee,
            e.discount_percent
       FROM student_parents sp
       JOIN students s ON s.id = sp.student_id
       LEFT JOIN enrollments e ON e.student_id = s.id AND e.ends_on IS NULL
       LEFT JOIN classes c ON c.id = e.class_id
      WHERE sp.parent_id = $1 AND s.status = 'active'
      ORDER BY s.last_name, s.first_name`,
    [parentId],
  );
  return rows;
}

/** 2010-07-17 -> 17.07.2010 */
function uzDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/**
 * Farzand haqidagi ma'lumot — ota-ona shuni o'qib tasdiqlaydi.
 *
 * Chegirmadan keyingi summa ko'rsatiladi: ota-ona haqiqatda to'laydigan pul
 * shu. To'lanmagan hisob yoki qarz bu yerda ATAYLAB ko'rsatilmaydi — raqam
 * hali tasdiqlanmagan, ya'ni bu odam begona bo'lishi mumkin.
 */
export function childCard(c: ChildInfo): string {
  const lines = [`👤 <b>${c.name}</b>`];
  lines.push(c.class_name ? `🏫 ${c.class_name} sinf o'quvchisi` : '🏫 Sinfga biriktirilmagan');
  if (c.birth_date) lines.push(`🎂 ${uzDate(c.birth_date)} da tug'ilgan`);
  if (c.monthly_fee != null) {
    const fee = Number(c.monthly_fee);
    const disc = Number(c.discount_percent ?? 0);
    const net = Math.round(fee - (fee * disc) / 100);
    lines.push(
      `💰 Oylik to'lov: ${uzSum(net)}` + (disc > 0 ? ` (${disc}% chegirma bilan)` : ''),
    );
  }
  return lines.join('\n');
}
