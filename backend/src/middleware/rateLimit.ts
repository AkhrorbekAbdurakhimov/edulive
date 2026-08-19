import type { Request, RequestHandler } from 'express';
import { tooManyRequests } from '../utils/errors.js';

interface RateLimitOptions {
  /** Oyna davomiyligi (ms) */
  windowMs: number;
  /** Oyna ichida ruxsat etilgan maksimal urinishlar */
  max: number;
  /** So'rovni qaysi kalit bo'yicha hisoblash (masalan telefon+IP) */
  keyOf: (req: Request) => string;
  message?: string;
}

export interface RateLimiter {
  middleware: RequestHandler;
  keyOf: (req: Request) => string;
  /** Kalit berilsa o'sha kalitni, berilmasa hammasini tozalaydi (test va muvaffaqiyatli login uchun) */
  reset: (key?: string) => void;
}

/**
 * Xotirada ishlaydigan sirg'aluvchi oynali limiter. Bitta jarayon uchun yetarli;
 * gorizontal masshtabga chiqilsa Redis'ga ko'chiriladi — interfeys o'zgarmaydi.
 */
export function createRateLimiter(opts: RateLimitOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  const middleware: RequestHandler = (req, _res, next) => {
    const key = opts.keyOf(req);
    const now = Date.now();

    // Xotira o'sib ketmasligi uchun vaqti o'tgan kalitlarni vaqti-vaqti bilan supurish
    if (hits.size > 10_000) {
      for (const [k, times] of hits) {
        if (times.every((t) => now - t >= opts.windowMs)) hits.delete(k);
      }
    }

    const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
    if (recent.length >= opts.max) return next(tooManyRequests(opts.message));

    recent.push(now);
    hits.set(key, recent);
    next();
  };

  return {
    middleware,
    keyOf: opts.keyOf,
    reset: (key?: string) => (key === undefined ? hits.clear() : void hits.delete(key)),
  };
}

/** Login uchun: bitta telefon+IP juftligi 1 daqiqada ko'pi bilan 5 urinish. */
export const loginRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  keyOf: (req) => `${String(req.body?.phone ?? '')}:${req.ip ?? ''}`,
  message: "Urinishlar soni oshib ketdi. 1 daqiqadan keyin qayta urinib ko'ring",
});
