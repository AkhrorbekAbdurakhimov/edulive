/**
 * Bazada saqlanadigan maxfiy qiymatlarni shifrlash (hozircha Telegram bot
 * tokenlari).
 *
 * Nega kerak: token ochiq matnda yotsa, baza nusxasi sizib ketganda —
 * kunlik zaxira fayli ham shunga kiradi — barcha maktablarning botlari
 * begonaga o'tadi. Shifrlangan bo'lsa, zaxira fayli o'z-o'zidan foydasiz:
 * kalit `.env` da, bazadan tashqarida turadi.
 *
 * AES-256-GCM: shifrlash ham, buzilmaganlik tekshiruvi ham bitta amalda.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;   // GCM uchun tavsiya etilgan uzunlik
const TAG_LEN = 16;

function key(): Buffer {
  const hex = env.secretKey;
  if (!hex) {
    // Fail-closed: kalitsiz shifrlangan qiymatni o'qib ham, yozib ham bo'lmaydi.
    throw new Error('SECRET_KEY sozlanmagan — maxfiy qiymatlarni shifrlab bo\'lmaydi');
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== 32) {
    throw new Error('SECRET_KEY 32 baytlik hex bo\'lishi kerak (openssl rand -hex 32)');
  }
  return buf;
}

/** Natija: base64(iv | tag | ciphertext) */
export function seal(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function open(packed: string): string {
  const raw = Buffer.from(packed, 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Kalit sozlanganmi — endpoint darhol tushunarli xato bersin. */
export function secretsAvailable(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
