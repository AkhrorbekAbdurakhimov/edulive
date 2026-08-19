import pg from 'pg';
import { env } from '../config/env.js';

// numeric (DECIMAL) ni string emas, number qilib o'qish — pul ustunlari uchun.
// DIQQAT: juda katta summalarda aniqlik yo'qolmasligi uchun 14,2 chegarasida
// qoldiramiz (maksimal ~999 999 999 999.99 so'm — yetarli).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // bigint

// date ustunlari Date obyekti emas, 'YYYY-MM-DD' satr bo'lib qoladi —
// aks holda JSON'da mahalliy vaqt mintaqasi (+05) tufayli bir kun surilib ketadi.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export type Db = pg.Pool | pg.PoolClient;

/** Tranzaksiya. Xato bo'lsa avtomatik ROLLBACK. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
