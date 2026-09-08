/**
 * Ichki rejalashtiruvchi: har daqiqada bir marta tekshiradi.
 *
 * Alohida cron xizmati emas — bitta nusxada ishlaydigan o'rnatma uchun shu
 * yetarli. Bir necha nusxa ishga tushirilsa, bu ish alohida worker'ga
 * ko'chirilishi kerak (aks holda hisobot bir necha marta ketadi).
 *
 * Vaqt konteyner mintaqasida (UTC). Toshkent = UTC+5, shuning uchun
 * hisobot 16:00 UTC = 21:00 mahalliy, zaxira 23:00 UTC = 04:00 mahalliy
 * (kunlik pg_dump cron 03:15 mahalliyda ishlaydi, ya'ni undan keyin).
 */
import { buildPlatformReport, buildSchoolReport, sendBackup, sendMessage } from './modules/staffbot/staffbot.service.js';
import { pool } from './db/pool.js';
import { env } from './config/env.js';

const REPORT_HOUR_UTC = 16;   // 21:00 Toshkent
const BACKUP_HOUR_UTC = 23;   // 04:00 Toshkent (ertasi kun)

let lastReportDay = -1;
let lastBackupDay = -1;
let timer: NodeJS.Timeout | null = null;

/** Ulangan har bir xodimga o'z darajasidagi kunlik hisobot. */
async function sendDailyReports(): Promise<number> {
  const { rows } = await pool.query<{ chat: string; role: string; school_id: string | null }>(
    `SELECT telegram_chat_id::text AS chat, role, school_id FROM users
      WHERE is_active AND telegram_chat_id IS NOT NULL
        AND role IN ('superadmin','admin','manager')`,
  );
  let sent = 0;
  for (const u of rows) {
    const text = u.role === 'superadmin' || !u.school_id
      ? await buildPlatformReport('day')
      : await buildSchoolReport(u.school_id, 'day');
    if (await sendMessage(u.chat, text)) sent += 1;
  }
  return sent;
}

export function startScheduler(): void {
  if (timer || !env.staffBot.token) return;

  timer = setInterval(() => {
    void (async () => {
      const now = new Date();
      const day = now.getUTCDate();

      if (now.getUTCHours() === REPORT_HOUR_UTC && day !== lastReportDay) {
        lastReportDay = day;
        try {
          console.log(`kunlik hisobot: ${await sendDailyReports()} ta yuborildi`);
        } catch (err) {
          console.error('kunlik hisobot:', (err as Error).message);
        }
      }

      if (now.getUTCHours() === BACKUP_HOUR_UTC && day !== lastBackupDay) {
        lastBackupDay = day;
        try {
          const r = await sendBackup();
          console.log(`zaxira → Telegram: ${r.file ?? 'fayl yo\'q'}, ${r.sent} ta yuborildi`);
        } catch (err) {
          console.error('zaxira yuborish:', (err as Error).message);
        }
      }
    })();
  }, 60_000);

  timer.unref();
}

export function stopScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
