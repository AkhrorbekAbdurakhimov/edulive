/**
 * Auth moduli testlari. Ishlashi uchun Postgres (docker compose up -d) va
 * qo'llangan migratsiyalar kerak. Fixture'lar alohida test-maktabda yaratiladi
 * va oxirida o'chiriladi — seed ma'lumotlariga tegilmaydi.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { loginRateLimiter } from '../middleware/rateLimit.js';

const TEST_SLUG = 'test-auth';
const TEACHER_PHONE = '+998977000001';
const INACTIVE_PHONE = '+998977000002';
const UNKNOWN_PHONE = '+998977000003';
const SUPERADMIN_PHONE = '+998977000004';
const PASSWORD = 'test_parol_123';

let server: Server;
let base: string;
let schoolId: string;
let teacherId: string;
let superadminId: string;

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

before(async () => {
  // Oldingi muvaffaqiyatsiz ishga tushishdan qolgan fixture bo'lsa tozalaymiz.
  await pool.query(`DELETE FROM schools WHERE slug = $1`, [TEST_SLUG]);

  schoolId = (
    await pool.query<{ id: string }>(
      `INSERT INTO schools (name, slug, tg_code) VALUES ('Test maktab', $1, $2) RETURNING id`,
      [TEST_SLUG, `${TEST_SLUG}-tg`],
    )
  ).rows[0].id;

  const hash = await bcrypt.hash(PASSWORD, 4); // testda tez bo'lishi uchun past rounds
  teacherId = (
    await pool.query<{ id: string }>(
      `INSERT INTO users (school_id, full_name, phone, password_hash, role)
       VALUES ($1, 'Test O''qituvchi', $2, $3, 'teacher') RETURNING id`,
      [schoolId, TEACHER_PHONE, hash],
    )
  ).rows[0].id;

  await pool.query(
    `INSERT INTO users (school_id, full_name, phone, password_hash, role, is_active)
     VALUES ($1, 'Faol Emas', $2, $3, 'teacher', false)`,
    [schoolId, INACTIVE_PHONE, hash],
  );

  // Superadmin maktabga bog'lanmagan — school_id NULL
  await pool.query(`DELETE FROM users WHERE school_id IS NULL AND phone = $1`, [SUPERADMIN_PHONE]);
  superadminId = (
    await pool.query<{ id: string }>(
      `INSERT INTO users (school_id, full_name, phone, password_hash, role)
       VALUES (NULL, 'Test Superadmin', $1, $2, 'superadmin') RETURNING id`,
      [SUPERADMIN_PHONE, hash],
    )
  ).rows[0].id;

  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  await pool.query(`DELETE FROM schools WHERE slug = $1`, [TEST_SLUG]);
  // superadmin maktabga bog'lanmagani uchun cascade bilan o'chmaydi
  await pool.query(`DELETE FROM users WHERE id = $1`, [superadminId]);
  server?.close();
  await pool.end();
});

beforeEach(() => {
  // Testlar bir-biriga limit qoldirmasligi uchun.
  loginRateLimiter.reset();
});

test('muvaffaqiyatli login token va foydalanuvchini qaytaradi, auditga yozadi', async () => {
  const { status, body } = await api('POST', '/auth/login', {
    phone: TEACHER_PHONE,
    password: PASSWORD,
  });

  assert.equal(status, 200);
  assert.equal(typeof body.token, 'string');
  assert.equal(body.user.id, teacherId);
  assert.equal(body.user.role, 'teacher');
  assert.equal(body.user.schoolId, schoolId);

  const audit = await pool.query(
    `SELECT 1 FROM audit_log WHERE action = 'auth.login' AND entity_id = $1 AND school_id = $2`,
    [teacherId, schoolId],
  );
  assert.ok(audit.rowCount, 'auth.login audit yozuvi topilmadi');

  // Token amalda ishlaydi
  const me = await api('GET', '/auth/me', undefined, body.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, teacherId);
});

test("noto'g'ri parol 401 qaytaradi va muvaffaqiyatsiz urinish auditga tushadi", async () => {
  const { status, body } = await api('POST', '/auth/login', {
    phone: TEACHER_PHONE,
    password: 'notogri_parol',
  });

  assert.equal(status, 401);
  assert.match(body.error, /noto'g'ri/);

  const audit = await pool.query(
    `SELECT after FROM audit_log
      WHERE action = 'auth.login_failed' AND after->>'phone' = $1
      ORDER BY id DESC LIMIT 1`,
    [TEACHER_PHONE],
  );
  assert.ok(audit.rowCount, 'auth.login_failed audit yozuvi topilmadi');
});

test("faol bo'lmagan foydalanuvchi kira olmaydi", async () => {
  const { status, body } = await api('POST', '/auth/login', {
    phone: INACTIVE_PHONE,
    password: PASSWORD,
  });

  assert.equal(status, 401);
  assert.match(body.error, /faol emas/i);
});

test('token_version oshgach eski token bekor bo\'ladi', async () => {
  const login = await api('POST', '/auth/login', { phone: TEACHER_PHONE, password: PASSWORD });
  assert.equal(login.status, 200);

  // Boshqa qurilmadan logout / parol o'zgargani imitatsiyasi
  await pool.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [teacherId]);

  const me = await api('GET', '/auth/me', undefined, login.body.token);
  assert.equal(me.status, 401);
  assert.match(me.body.error, /eskirgan/i);

  // Qayta login yangi token_version bilan ishlaydi
  const relogin = await api('POST', '/auth/login', { phone: TEACHER_PHONE, password: PASSWORD });
  assert.equal(relogin.status, 200);
  const me2 = await api('GET', '/auth/me', undefined, relogin.body.token);
  assert.equal(me2.status, 200);
});

test('login telefon+IP bo\'yicha cheklanadi (5 urinishdan keyin 429)', async () => {
  for (let i = 0; i < 5; i++) {
    const { status } = await api('POST', '/auth/login', {
      phone: UNKNOWN_PHONE,
      password: 'har_safar_xato',
    });
    assert.equal(status, 401, `${i + 1}-urinish hali limitga tegmasligi kerak`);
  }

  const blocked = await api('POST', '/auth/login', {
    phone: UNKNOWN_PHONE,
    password: 'har_safar_xato',
  });
  assert.equal(blocked.status, 429);
  assert.match(blocked.body.error, /urinish/i);

  // Boshqa telefon raqam limitga tushmaydi — kalit telefon+IP
  const other = await api('POST', '/auth/login', { phone: TEACHER_PHONE, password: PASSWORD });
  assert.equal(other.status, 200);
});

test('superadmin (school_id NULL) kira oladi', async () => {
  const { status, body } = await api('POST', '/auth/login', {
    phone: SUPERADMIN_PHONE,
    password: PASSWORD,
  });

  assert.equal(status, 200);
  assert.equal(body.user.id, superadminId);
  assert.equal(body.user.role, 'superadmin');
  assert.equal(body.user.schoolId, null);

  const me = await api('GET', '/auth/me', undefined, body.token);
  assert.equal(me.status, 200);
  assert.equal(me.body.user.schoolId, null);
});

test('refresh, parol almashtirish va logout oqimi', async () => {
  const login = await api('POST', '/auth/login', { phone: TEACHER_PHONE, password: PASSWORD });
  assert.equal(login.status, 200);

  // refresh — yangi token beradi va u ishlaydi
  const refresh = await api('POST', '/auth/refresh', undefined, login.body.token);
  assert.equal(refresh.status, 200);
  const meAfterRefresh = await api('GET', '/auth/me', undefined, refresh.body.token);
  assert.equal(meAfterRefresh.status, 200);

  // change-password — eski token bekor, yangisi ishlaydi
  const newPassword = 'yangi_parol_456';
  const change = await api(
    'POST',
    '/auth/change-password',
    { currentPassword: PASSWORD, newPassword },
    refresh.body.token,
  );
  assert.equal(change.status, 200);
  const oldToken = await api('GET', '/auth/me', undefined, refresh.body.token);
  assert.equal(oldToken.status, 401);
  const newToken = change.body.token;
  assert.equal((await api('GET', '/auth/me', undefined, newToken)).status, 200);

  // eski parol endi ishlamaydi
  const oldLogin = await api('POST', '/auth/login', { phone: TEACHER_PHONE, password: PASSWORD });
  assert.equal(oldLogin.status, 401);

  // logout — token_version oshadi, token bekor bo'ladi
  const logout = await api('POST', '/auth/logout', undefined, newToken);
  assert.equal(logout.status, 200);
  assert.equal((await api('GET', '/auth/me', undefined, newToken)).status, 401);

  // logout'dan keyin yangi parol bilan qayta kirish mumkin
  const relogin = await api('POST', '/auth/login', { phone: TEACHER_PHONE, password: newPassword });
  assert.equal(relogin.status, 200);
});
