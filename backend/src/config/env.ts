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
  // Webhook manzilini yasash uchun (Telegram bizga shu manzilga uradi).
  publicUrl: process.env.PUBLIC_URL ?? '',

  databaseUrl: required('DATABASE_URL'),

  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',

  uploadDir: process.env.UPLOAD_DIR ?? './uploads',

  // Bazadagi maxfiy qiymatlarni (Telegram bot tokenlari) shifrlash kaliti.
  // openssl rand -hex 32. Bo'lmasa bot ulash endpointi ishlamaydi.
  secretKey: process.env.SECRET_KEY ?? '',

  // Bitta bot barcha maktablar uchun; maktab /start <tg_code> orqali aniqlanadi.
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN ?? '',
    username: process.env.TELEGRAM_BOT_USERNAME ?? 'edulive_bot',
    // Bo'sh bo'lsa webhook o'chiq — fail-closed.
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
  },

  /**
   * XODIMLAR boti (@eduliveuz_bot) — ota-onalar botidan alohida.
   *
   * Egasi va maktab ma'muriyati shu yerdan hisobot, zaxira nusxa va muhim
   * hodisalar haqida xabar oladi. Chat foydalanuvchiga ulash KODI orqali
   * bog'lanadi (users.telegram_chat_id) — qo'lda chat raqami yozilmaydi.
   */
  staffBot: {
    token: process.env.TELEGRAM_STAFF_TOKEN ?? '',
    username: process.env.TELEGRAM_STAFF_USERNAME ?? 'eduliveuz_bot',
    // Bo'sh bo'lsa webhook javob bermaydi — fail-closed.
    webhookSecret: process.env.TELEGRAM_STAFF_SECRET ?? '',
  },

  // Kunlik pg_dump shu papkaga tushadi (cron), bot shu yerdan oxirgisini oladi.
  backupDir: process.env.BACKUP_DIR ?? './backups',


  // O'qituvchi davomatni necha soat ichida o'zi tuzata oladi.
  attendanceEditWindowHours: Number(process.env.ATTENDANCE_EDIT_WINDOW_HOURS ?? 3),
} as const;
