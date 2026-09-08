import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { startNotificationWorker, stopNotificationWorker } from './modules/notifications/notifications.service.js';
import { startScheduler, stopScheduler } from './scheduler.js';

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`→ EduLive API http://localhost:${env.port} (${env.nodeEnv})`);
  // Navbatdagi bildirishnomalarni yuboruvchi fon ishchisi. app.ts da emas,
  // shu yerda: testlar createApp() ni ishlatadi va ularda ishchi kerak emas.
  startNotificationWorker();
  // Kunlik hisobot va zaxira nusxa — xodimlar botiga.
  startScheduler();
});

async function shutdown(signal: string) {
  console.log(`\n${signal} — to'xtatilmoqda...`);
  stopNotificationWorker();
  stopScheduler();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
