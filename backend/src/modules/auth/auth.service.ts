import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { pool, type Db } from '../../db/pool.js';
import type { JwtPayload, Role } from '../../types/auth.js';

const BCRYPT_ROUNDS = 10;

export interface UserRow {
  id: string;
  school_id: string | null;
  full_name: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  token_version: number;
}

export function signToken(u: Pick<UserRow, 'id' | 'school_id' | 'role' | 'token_version'>): string {
  const payload: JwtPayload = { sub: u.id, sid: u.school_id, role: u.role, tv: u.token_version };
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Telefon+parol bo'yicha foydalanuvchini topadi.
 *
 * DIQQAT: bu tizimdagi school_id filtrisiz yagona so'rov — login paytida
 * tenant hali noma'lum (u aynan shu yerdan aniqlanadi). Telefon global
 * identifikator: superadmin'da school_id NULL, oddiy foydalanuvchida
 * (school_id, phone) unikal. Bir telefon bir nechta maktabda uchrasa,
 * parol qaysi hisobga mos kelsa — o'sha kiradi (superadmin birinchi tekshiriladi).
 *
 * Natija: mos hisob, 'inactive' (hisob topildi lekin faol emas) yoki null.
 */
export async function verifyLogin(
  phone: string,
  password: string,
): Promise<UserRow | 'inactive' | null> {
  const { rows } = await pool.query<UserRow & { password_hash: string }>(
    `SELECT id, school_id, full_name, phone, role, is_active, token_version, password_hash
       FROM users
      WHERE phone = $1
      ORDER BY school_id NULLS FIRST, created_at`,
    [phone],
  );

  let inactiveMatch = false;
  for (const row of rows) {
    if (!(await bcrypt.compare(password, row.password_hash))) continue;
    if (!row.is_active) {
      inactiveMatch = true;
      continue;
    }
    const { password_hash: _ph, ...user } = row;
    return user;
  }
  return inactiveMatch ? 'inactive' : null;
}

export async function touchLastLogin(userId: string, db: Db = pool): Promise<void> {
  await db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [userId]);
}

/** token_version oshadi → shu foydalanuvchining BARCHA eski tokenlari bekor bo'ladi. */
export async function bumpTokenVersion(userId: string, db: Db = pool): Promise<number> {
  const { rows } = await db.query<{ token_version: number }>(
    `UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING token_version`,
    [userId],
  );
  return rows[0].token_version;
}

export async function getPasswordHash(userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.password_hash ?? null;
}

export async function setPassword(userId: string, newHash: string, db: Db = pool): Promise<number> {
  const { rows } = await db.query<{ token_version: number }>(
    `UPDATE users
        SET password_hash = $2, token_version = token_version + 1
      WHERE id = $1
      RETURNING token_version`,
    [userId, newHash],
  );
  return rows[0].token_version;
}

export function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
