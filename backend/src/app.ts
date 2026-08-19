import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { api } from './routes.js';
import { errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);           // Caddy orqasida to'g'ri IP olish uchun
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin.split(','), credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  // Konteyner healthcheck'i shu yo'lni tekshiradi (Dockerfile'ga qarang).
  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api', api);
  app.use('/uploads', express.static(env.uploadDir));

  app.use((_req, res) => res.status(404).json({ error: 'Topilmadi' }));
  app.use(errorHandler);

  return app;
}
