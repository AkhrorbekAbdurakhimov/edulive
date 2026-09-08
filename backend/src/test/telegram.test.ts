/** Maktabga bot biriktirish, tokenni shifrlash va webhook orqali ota-onani ulash. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pool } from '../db/pool.js';
import { seal, open } from '../utils/secretbox.js';
import {
  createSuperadmin,
  createTestSchool,
  createTestStudent,
  dropTestSchool,
  startServer,
  type TestApi,
  type TestSchool,
} from './helpers.js';

const SLUG = 'test-tg';
const SUPER_PHONE = '+998977100055';
const PARENT_PHONE = '+998901239911';

let server: Server;
let api: TestApi;
let base: string;
let school: TestSchool;
let superToken: string;
let parentId: string;
let secret: string;

before(async () => {
  ({ server, api } = startServer());
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  school = await createTestSchool(SLUG);
  superToken = (await createSuperadmin(SUPER_PHONE)).token;

  const st = await createTestStudent(school, 'Botov', 'Farzand');
  const res = await api('POST', `/students/${st.studentId}/parents`, {
    fullName: 'Botov Ota', phone: PARENT_PHONE, relation: 'father',
  }, school.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const p = await pool.query(`SELECT id FROM parents WHERE school_id = $1 AND phone = $2`,
    [school.schoolId, PARENT_PHONE]);
  parentId = p.rows[0].id;

  // Webhook oqimini tekshirish uchun maktabga "bot" biriktirilgan holatni
  // qo'lda yasaymiz — Telegram API ga chiqmaslik uchun.
  secret = 'sinov-secret-' + Date.now().toString(36);
  await pool.query(
    `UPDATE schools SET telegram_bot_token_enc = $2, telegram_bot_username = 'sinov_bot',
            telegram_webhook_secret = $3
       WHERE id = $1`,
    [school.schoolId, seal('123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), secret],
  );
});

after(async () => {
  await dropTestSchool(SLUG);
  await pool.query(`DELETE FROM users WHERE phone = $1`, [SUPER_PHONE]);
  server?.close();
  await pool.end();
});

test('token shifrlanadi va bazada ochiq matnda yotmaydi', async () => {
  const token = '987654:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const packed = seal(token);
  assert.notEqual(packed, token);
  assert.ok(!packed.includes(token), 'shifrlangan qiymat tokenni o\'z ichiga olmasligi kerak');
  assert.equal(open(packed), token, 'qaytarib ochilishi kerak');

  // Har safar boshqa natija (IV tasodifiy) — bir xil token ikki xil yozuv beradi
  assert.notEqual(seal(token), seal(token));

  const row = await pool.query(
    `SELECT telegram_bot_token_enc FROM schools WHERE id = $1`, [school.schoolId],
  );
  assert.ok(!row.rows[0].telegram_bot_token_enc.includes('123456:'), 'bazada ochiq token yo\'q');
});

test('bot holati: token qaytarilmaydi', async () => {
  const { status, body } = await api(
    'GET', `/schools/${school.schoolId}/telegram`, undefined, superToken,
  );
  assert.equal(status, 200);
  assert.equal(body.own, true);
  assert.equal(body.username, 'sinov_bot');
  assert.ok(!JSON.stringify(body).includes('123456:'), 'javobda token bo\'lmasligi kerak');
});

test('bot biriktirish faqat superadminga ochiq', async () => {
  const res = await api('GET', `/schools/${school.schoolId}/telegram`, undefined, school.adminToken);
  assert.equal(res.status, 403, 'maktab admini platforma yo\'liga kira olmaydi');
});

test("noto'g'ri formatdagi token rad etiladi", async () => {
  const res = await api(
    'PUT', `/schools/${school.schoolId}/telegram`, { token: 'salom' }, superToken,
  );
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Token formati/);
});

/** Webhook — ochiq yo'l, shuning uchun to'g'ridan-to'g'ri fetch bilan. */
async function hook(body: unknown, headerSecret: string | null, path = secret) {
  const res = await fetch(`${base}/telegram/webhook/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(headerSecret ? { 'X-Telegram-Bot-Api-Secret-Token': headerSecret } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.status;
}

test('webhook: sarlavhasiz yoki begona secret bilan hech nima qilmaydi', async () => {
  const before2 = await pool.query(`SELECT telegram_chat_id FROM parents WHERE id = $1`, [parentId]);
  assert.equal(before2.rows[0].telegram_chat_id, null);

  // Sarlavha yo'q
  assert.equal(await hook({ message: { chat: { id: 1 }, contact: { phone_number: PARENT_PHONE } } }, null), 200);
  // Sarlavha bor, lekin manzil begona
  assert.equal(await hook({ message: { chat: { id: 1 } } }, 'boshqa', 'boshqa'), 200);

  const after2 = await pool.query(`SELECT telegram_chat_id FROM parents WHERE id = $1`, [parentId]);
  assert.equal(after2.rows[0].telegram_chat_id, null, 'hech narsa bog\'lanmasligi kerak');
});

test("webhook: tasdiqlangan raqam ota-onaga bog'lanadi", async () => {
  const chatId = 555000111;
  const status = await hook(
    { message: { chat: { id: chatId }, from: { id: chatId }, contact: { phone_number: '998901239911', user_id: chatId } } },
    secret,
  );
  assert.equal(status, 200);

  const row = await pool.query(
    `SELECT telegram_chat_id, telegram_verified_at, notify_enabled FROM parents WHERE id = $1`,
    [parentId],
  );
  assert.equal(String(row.rows[0].telegram_chat_id), String(chatId));
  assert.ok(row.rows[0].telegram_verified_at, 'tasdiqlangan vaqt yozilishi kerak');
  assert.equal(row.rows[0].notify_enabled, true);
});

test("webhook: begona odamning kontakti qabul qilinmaydi", async () => {
  await pool.query(`UPDATE parents SET telegram_chat_id = NULL WHERE id = $1`, [parentId]);
  // contact.user_id != from.id — kimdir boshqaning raqamini yubordi
  await hook(
    { message: { chat: { id: 777 }, from: { id: 777 }, contact: { phone_number: PARENT_PHONE, user_id: 999 } } },
    secret,
  );
  const row = await pool.query(`SELECT telegram_chat_id FROM parents WHERE id = $1`, [parentId]);
  assert.equal(row.rows[0].telegram_chat_id, null, 'begona kontakt bog\'lanmasligi kerak');
});

test("bot import qilingan raqamni topadi ('+' siz kiritilgan bo'lsa ham)", async () => {
  // Import va Telegram bitta normalizePhone dan o'tadi. Ilgari ular ikki xil
  // qoida ishlatardi — bu jimgina uzilib qolishi mumkin bo'lgan bog'lanish.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO parents (school_id, full_name, phone, relation)
     VALUES ($1, 'Normalizatsiya Otasi', '+998901239876', 'father') RETURNING id`,
    [school.schoolId],
  );
  const chatId = 778899;

  const status = await hook(
    { message: { chat: { id: chatId }, from: { id: chatId },
                 contact: { phone_number: '998 90 123 98 76', user_id: chatId } } },
    secret,
  );
  assert.equal(status, 200);

  const linked = await pool.query<{ chat: string | null }>(
    `SELECT telegram_chat_id::text AS chat FROM parents WHERE id = $1`, [rows[0].id]);
  assert.equal(linked.rows[0].chat, String(chatId), 'raqam mos kelib, ota-ona ulanishi kerak');
});
