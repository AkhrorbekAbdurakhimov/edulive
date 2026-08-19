import type { RequestHandler } from 'express';

/** async route handler'larni try/catch'siz yozish uchun. */
export const ah =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
