import type { RequestHandler } from 'express';
import { forbidden, unauthorized } from '../utils/errors.js';

/**
 * MULTI-TENANT XAVFSIZLIGI.
 *
 * Bu middleware'dan keyin har bir SQL so'rovda `req.schoolId` MAJBURIY filtr
 * bo'lishi kerak. Bitta maktab boshqasining ma'lumotini ko'rsa — biznes tugaydi.
 *
 * Superadmin boshqa maktabga `X-School-Id` sarlavhasi orqali kira oladi;
 * bu har safar audit logga yoziladi (audit.service.ts).
 */
export const resolveTenant: RequestHandler = (req, _res, next) => {
  const user = req.user;
  if (!user) return next(unauthorized());

  if (user.role === 'superadmin') {
    const impersonated = req.header('X-School-Id');
    if (!impersonated) return next();          // platforma darajasidagi so'rov
    req.schoolId = impersonated;
    return next();
  }

  if (!user.schoolId) return next(forbidden('Maktab biriktirilmagan'));
  req.schoolId = user.schoolId;
  next();
};

/** Maktab konteksti majburiy bo'lgan yo'llar uchun. */
export const requireTenant: RequestHandler = (req, _res, next) => {
  if (!req.schoolId) return next(forbidden('Maktab tanlanmagan'));
  next();
};
