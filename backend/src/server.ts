import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';

const app = createApp();
const server = app.listen(env.port, () => {
  console.log(`→ EduLive API http://localhost:${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal: string) {
  console.log(`\n${signal} — to'xtatilmoqda...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
