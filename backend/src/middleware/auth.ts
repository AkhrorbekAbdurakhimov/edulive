import jwt from 'jsonwebtoken';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import type { JwtPayload, Role } from '../types/auth.js';

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();

    const payload = jwt.verify(header.slice(7), env.jwtSecret) as JwtPayload;

    const { rows } = await pool.query(
      `SELECT id, school_id, role, full_name, token_version, is_active
         FROM users WHERE id = $1`,
      [payload.sub],
    );
    const u = rows[0];
    if (!u || !u.is_active) throw unauthorized('Foydalanuvchi faol emas');
    // Parol o'zgargan yoki xodim chiqarilgan bo'lsa eski token bekor.
    if (u.token_version !== payload.tv) throw unauthorized('Sessiya eskirgan');

    req.user = {
      id: u.id,
      schoolId: u.school_id,
      role: u.role as Role,
      fullName: u.full_name,
      tokenVersion: u.token_version,
    };
    next();
  } catch (err) {
    next(err instanceof Error && err.name === 'JsonWebTokenError' ? unauthorized() : err);
  }
};

/** Rolga qarab cheklash: requireRole('admin', 'manager') */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role === 'superadmin') return next();  // superadmin hamma joyga
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
