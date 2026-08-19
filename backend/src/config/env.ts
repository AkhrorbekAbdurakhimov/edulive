import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  databaseUrl: required('DATABASE_URL'),

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',

  uploadDir: process.env.UPLOAD_DIR ?? './uploads',

  // Bitta bot barcha maktablar uchun; maktab /start <tg_code> orqali aniqlanadi.
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? '',
    username: process.env.TELEGRAM_BOT_USERNAME ?? 'edulive_bot',
    // Bo'sh bo'lsa webhook o'chiq — fail-closed.
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  },

  // O'qituvchi davomatni necha soat ichida o'zi tuzata oladi.
  attendanceEditWindowHours: Number(process.env.ATTENDANCE_EDIT_WINDOW_HOURS ?? 3),
} as const;
