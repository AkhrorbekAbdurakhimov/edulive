/**
 * Oddiy, oldinga yo'naltirilgan migratsiya vositasi.
 *   npm run migrate          -> kutilayotgan .sql fayllarni qo'llaydi
 *   npm run migrate:down     -> oxirgisini qaytaradi (agar .down.sql bo'lsa)
 *   tsx src/db/migrate.ts reset
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

async function applied(): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>('SELECT name FROM _migrations');
  return new Set(rows.map((r) => r.name));
}

async function up() {
  await ensureTable();
  const done = await applied();
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql')).sort();

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    console.log(`  ↑ ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file} failed`);
      throw err;
    } finally {
      client.release();
    }
  }
  console.log('✓ migrations up to date');
}

async function reset() {
  console.log('  ! dropping public schema');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await up();
}

const cmd = process.argv[2] ?? 'up';
try {
  if (cmd === 'up') await up();
  else if (cmd === 'reset') await reset();
  else throw new Error(`Unknown command: ${cmd}`);
} finally {
  await pool.end();
}
