import type { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  console.error(err);
  res.status(500).json({
    error: 'Ichki xatolik',
    ...(env.isProd ? {} : { detail: String(err?.message ?? err) }),
  });
};
