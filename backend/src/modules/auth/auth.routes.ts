import { Router } from 'express';
import { z } from 'zod';
import { tx } from '../../db/pool.js';
import { authenticate } from '../../middleware/auth.js';
import { loginRateLimiter } from '../../middleware/rateLimit.js';
import { audit } from '../audit/audit.service.js';
import { badRequest, unauthorized } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { parse } from '../../utils/validate.js';
import {
  bumpTokenVersion,
  comparePassword,
  getPasswordHash,
  hashPassword,
  setPassword,
  signToken,
  touchLastLogin,
  verifyLogin,
} from './auth.service.js';

export const authRoutes = Router();

const phoneSchema = z
  .string({ required_error: 'Telefon raqam kiritilishi shart' })
  .regex(/^\+998\d{9}$/, "Telefon raqam formati noto'g'ri (+998XXXXXXXXX)");

const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string({ required_error: 'Parol kiritilishi shart' }).min(1, 'Parol kiritilishi shart'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string({ required_error: 'Joriy parol kiritilishi shart' }).min(1, 'Joriy parol kiritilishi shart'),
  newPassword: z
    .string({ required_error: 'Yangi parol kiritilishi shart' })
    .min(8, "Yangi parol kamida 8 belgidan iborat bo'lishi kerak"),
});

function publicUser(u: { id: string; school_id: string | null; full_name: string; phone: string | null; role: string }) {
  return { id: u.id, schoolId: u.school_id, fullName: u.full_name, phone: u.phone, role: u.role };
}

// ---------------------------------------------------------------- login
authRoutes.post(
  '/login',
  loginRateLimiter.middleware,
  ah(async (req, res) => {
    const { phone, password } = parse(loginSchema, req.body);

    const result = await verifyLogin(phone, password);

    if (result === null || result === 'inactive') {
      // Muvaffaqiyatsiz urinish ham auditga yoziladi — hujumni keyin tekshirish uchun.
      await audit(req, {
        action: 'auth.login_failed',
        entity: 'user',
        after: { phone, reason: result === 'inactive' ? 'inactive' : 'bad_credentials' },
      });
      throw result === 'inactive'
        ? unauthorized('Hisob faol emas. Administratorga murojaat qiling')
        : unauthorized("Telefon raqam yoki parol noto'g'ri");
    }

    // Audit yozuvi to'g'ri maktabga tushishi uchun — tenant middleware hali ishlamagan.
    req.schoolId = result.school_id ?? undefined;
    await touchLastLogin(result.id);
    await audit(req, {
      action: 'auth.login',
      entity: 'user',
      entityId: result.id,
      after: { phone, role: result.role },
    });

    // Muvaffaqiyatli kirish limiter hisobini tozalaydi.
    loginRateLimiter.reset(loginRateLimiter.keyOf(req));

    res.json({ token: signToken(result), user: publicUser(result) });
  }),
);

// Quyidagilar faqat amaldagi token bilan ishlaydi.
authRoutes.use(authenticate);

// ---------------------------------------------------------------- refresh
authRoutes.post(
  '/refresh',
  ah(async (req, res) => {
    const u = req.user!;
    // authenticate token_version va is_active ni allaqachon tekshirgan —
    // shunchaki muddati yangilangan token beramiz.
    res.json({
      token: signToken({ id: u.id, school_id: u.schoolId, role: u.role, token_version: u.tokenVersion }),
    });
  }),
);

// ---------------------------------------------------------------- logout
authRoutes.post(
  '/logout',
  ah(async (req, res) => {
    const u = req.user!;
    req.schoolId = u.schoolId ?? undefined;
    await tx(async (client) => {
      const newVersion = await bumpTokenVersion(u.id, client);
      await audit(
        req,
        {
          action: 'auth.logout',
          entity: 'user',
          entityId: u.id,
          before: { token_version: u.tokenVersion },
          after: { token_version: newVersion },
        },
        client,
      );
    });
    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- change-password
authRoutes.post(
  '/change-password',
  ah(async (req, res) => {
    const u = req.user!;
    const { currentPassword, newPassword } = parse(changePasswordSchema, req.body);

    const hash = await getPasswordHash(u.id);
    if (!hash || !(await comparePassword(currentPassword, hash))) {
      throw badRequest("Joriy parol noto'g'ri");
    }
    if (currentPassword === newPassword) {
      throw badRequest("Yangi parol joriy paroldan farq qilishi kerak");
    }

    const newHash = await hashPassword(newPassword);
    req.schoolId = u.schoolId ?? undefined;
    const newVersion = await tx(async (client) => {
      const version = await setPassword(u.id, newHash, client);
      await audit(
        req,
        {
          action: 'auth.change_password',
          entity: 'user',
          entityId: u.id,
          before: { token_version: u.tokenVersion },
          after: { token_version: version },
        },
        client,
      );
      return version;
    });

    // token_version oshdi — barcha eski sessiyalar bekor; joriy sessiya uzilmasligi
    // uchun yangi token qaytaramiz.
    res.json({
      token: signToken({ id: u.id, school_id: u.schoolId, role: u.role, token_version: newVersion }),
    });
  }),
);

// ---------------------------------------------------------------- me
authRoutes.get(
  '/me',
  ah(async (req, res) => {
    const u = req.user!;
    res.json({
      user: { id: u.id, schoolId: u.schoolId, fullName: u.fullName, role: u.role },
    });
  }),
);
