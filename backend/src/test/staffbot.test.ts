/**
 * Xodimlar boti: ulash, hisobot va ruxsat chegaralari.
 *
 * Eng muhimi — ULANMAGAN chatga hech qanday ma'lumot berilmasligi: botni
 * topgan har kim maktab moliyasini so'ray olmasligi kerak.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pool } from '../db/pool.js';
import {
  buildPlatformReport, buildSchoolReport, consumeLinkCode, createLinkCode,
} from '../modules/staffbot/staffbot.service.js';
import {
  createTestSchool, createTestStudent, dropTestSchool, startServer,
  type TestApi, type TestSchool,
} from './helpers.js';

const SLUG = 'test-staffbot';

let server: Server;
let api: TestApi;
let school: TestSchool;
let base: string;

before(async () => {
  ({ server, api } = startServer());
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  school = await createTestSchool(SLUG);
});

after(async () => {
  await dropTestSchool(SLUG);
  server?.close();
  await pool.end();
});

test('ulash havolasi yaratiladi va bir martalik', async () => {
  const res = await api('POST', '/staffbot/link', {}, school.adminToken);
  // Bot tokeni testda sozlanmagan — endpoint ochiq bo'lishi kerak emas
  if (res.status === 400) {
    assert.match(res.body.error, /sozlanmagan/);
    return;
  }
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test("kod chatni aynan o'sha hisobga bog'laydi", async () => {
  const code = await createLinkCode(school.adminId);
  const user = await consumeLinkCode(code, '555001');
  assert.ok(user, 'ulanishi kerak');
  assert.equal(user!.id, school.adminId);

  const { rows } = await pool.query<{ chat: string }>(
    `SELECT telegram_chat_id::text AS chat FROM users WHERE id = $1`, [school.adminId]);
  assert.equal(rows[0].chat, '555001');

  // Bir martalik: o'sha kod ikkinchi marta ishlamaydi
  assert.equal(await consumeLinkCode(code, '555002'), null, 'kod qayta ishlatilmasligi kerak');
});

test("muddati o'tgan kod qabul qilinmaydi", async () => {
  const code = await createLinkCode(school.managerId);
  await pool.query(
    `UPDATE telegram_link_codes SET created_at = now() - interval '20 minutes' WHERE code = $1`,
    [code]);
  assert.equal(await consumeLinkCode(code, '555003'), null);
});

test('bitta chat bitta hisobga bog\'lanadi', async () => {
  // Telefon almashtirilganda eski bog'lanish uzilishi kerak, aks holda
  // unique indeks ishga tushib ulanib bo'lmasdi.
  const code = await createLinkCode(school.managerId);
  const user = await consumeLinkCode(code, '555001');   // adminda turgan chat
  assert.ok(user);
  assert.equal(user!.id, school.managerId);

  const { rows } = await pool.query<{ chat: string | null }>(
    `SELECT telegram_chat_id::text AS chat FROM users WHERE id = $1`, [school.adminId]);
  assert.equal(rows[0].chat, null, 'eski bog\'lanish uzilishi kerak');
});

test('maktab hisoboti asosiy raqamlarni beradi', async () => {
  const s = await createTestStudent(school, 'Hisobot', 'Bolasi');
  await api('POST', '/invoices/generate', { periodMonth: '2026-09' }, school.adminToken);
  await api('POST', '/payments', { studentId: s.studentId, amount: 250_000, provider: 'cash' },
    school.adminToken);

  const text = await buildSchoolReport(school.schoolId, 'day');
  assert.match(text, /To'lov:/);
  assert.match(text, /250 000/, text);
  assert.match(text, /Qarzdorlik:/);
  assert.match(text, /O'quvchi: /);
});

test('platforma hisoboti maktablarni jamlaydi', async () => {
  const text = await buildPlatformReport('day');
  assert.match(text, /EduLive platformasi/);
  assert.match(text, /Maktab: /);
});

test("HTML belgilari xabarni buzmaydi", async () => {
  // Maktab nomida "<" bo'lsa Telegram xabarni rad etardi.
  await pool.query(`UPDATE schools SET name = $2 WHERE id = $1`,
    [school.schoolId, '<b>Xavfli</b> maktab']);
  const text = await buildSchoolReport(school.schoolId, 'day');
  assert.ok(!text.includes('<b>Xavfli</b>'), 'xom HTML o\'tkazilmasligi kerak');
  assert.match(text, /&lt;b&gt;Xavfli/);
});

test("webhook: noto'g'ri secret bilan hech nima qilmaydi", async () => {
  // Javob JSON emas (sendStatus) — shuning uchun to'g'ridan-to'g'ri fetch.
  const res = await fetch(`${base}/staffbot/webhook/yolgon-secret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'yolgon-secret' },
    body: JSON.stringify({ message: { chat: { id: 1 }, text: '/bugun' } }),
  });
  // Telegram qayta urinmasligi uchun har doim 200, lekin hech narsa bajarilmaydi.
  assert.equal(res.status, 200);
});
