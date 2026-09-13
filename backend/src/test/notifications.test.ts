/** Bildirishnoma navbati: to'lovda yoziladi, jo'natuvchi uni qayta ishlaydi. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { pool } from '../db/pool.js';
import { dispatchQueued } from '../modules/notifications/notifications.service.js';
import {
  createTestSchool,
  createTestStudent,
  dropTestSchool,
  startServer,
  type TestApi,
  type TestSchool,
} from './helpers.js';

const SLUG = 'test-notif';
const PARENT_PHONE = '+998901237788';

let server: Server;
let api: TestApi;
let school: TestSchool;
let studentId: string;
let parentId: string;

before(async () => {
  ({ server, api } = startServer());
  school = await createTestSchool(SLUG, { monthlyFee: 1_000_000 });
  studentId = (
    await createTestStudent(school, 'Xabarov', 'Ali', { parentPhone: PARENT_PHONE })
  ).studentId;

  const p = await pool.query(`SELECT parent_id AS id FROM parent_phones WHERE school_id = $1 AND phone = $2`,
    [school.schoolId, PARENT_PHONE]);
  parentId = p.rows[0].id;
});

after(async () => {
  await dropTestSchool(SLUG);
  server?.close();
  await pool.end();
});

test("botga ulanmagan ota-onaga xabar navbatga QO'YILMAYDI", async () => {
  await api('POST', '/invoices/generate', { periodMonth: '2026-09' }, school.adminToken);
  const pay = await api('POST', '/payments',
    { studentId, amount: 200_000, provider: 'cash' }, school.adminToken);
  assert.equal(pay.status, 201);

  const n = await pool.query(
    `SELECT count(*)::int AS c FROM notifications WHERE student_id = $1 AND kind = 'payment.received'`,
    [studentId],
  );
  assert.equal(n.rows[0].c, 0, "chat_id yo'q ekan, navbatga yozilmasligi kerak");
});

test("to'lovda kvitansiya xabari navbatga tushadi", async () => {
  // Ota-ona botga ulangan holat
  await pool.query(
    `UPDATE parent_phones SET telegram_chat_id = 4242, telegram_verified_at = now() WHERE parent_id = $1`,
    [parentId],
  );

  const pay = await api('POST', '/payments',
    { studentId, amount: 300_000, provider: 'cash' }, school.adminToken);
  assert.equal(pay.status, 201);

  const { rows } = await pool.query<{ body: string; status: string; payload: any }>(
    `SELECT body, status, payload FROM notifications
      WHERE student_id = $1 AND kind = 'payment.received' ORDER BY created_at DESC LIMIT 1`,
    [studentId],
  );
  assert.equal(rows[0].status, 'queued', 'yuborish alohida bosqichda bo\'lishi kerak');
  assert.match(rows[0].body, /300 000 so'm/, `summa formatlangan: ${rows[0].body}`);
  assert.match(rows[0].body, /Kvitansiya: KV-/);
  // 1 000 000 hisob, 200k + 300k to'landi -> 500 000 qoldi
  assert.match(rows[0].body, /Qolgan qarz: 500 000 so'm/, rows[0].body);
  assert.equal(Number(rows[0].payload.outstanding), 500_000);
});

test("xabarni o'chirgan ota-onaga yozilmaydi", async () => {
  await pool.query(`UPDATE parent_phones SET notify_enabled = false WHERE parent_id = $1`, [parentId]);
  const before2 = await pool.query(
    `SELECT count(*)::int AS c FROM notifications WHERE student_id = $1`, [studentId]);

  await api('POST', '/payments', { studentId, amount: 1_000, provider: 'cash' }, school.adminToken);

  const after2 = await pool.query(
    `SELECT count(*)::int AS c FROM notifications WHERE student_id = $1`, [studentId]);
  assert.equal(after2.rows[0].c, before2.rows[0].c, 'notify_enabled=false bo\'lsa yozilmaydi');
  await pool.query(`UPDATE parent_phones SET notify_enabled = true WHERE parent_id = $1`, [parentId]);
});

test("jo'natuvchi: bot ulanmagan bo'lsa xabar 'failed' bo'ladi, navbat tiqilmaydi", async () => {
  // Bu maktabda ham, platformada ham bot yo'q (test muhitida token bo'sh)
  const res = await dispatchQueued();
  assert.ok(res.sent + res.failed + res.skipped > 0, 'navbatdan olingan bo\'lishi kerak');

  const { rows } = await pool.query<{ status: string; error: string; attempts: number }>(
    `SELECT status, error, attempts FROM notifications
      WHERE student_id = $1 AND kind = 'payment.received' ORDER BY created_at DESC LIMIT 1`,
    [studentId],
  );
  assert.equal(rows[0].status, 'failed');
  assert.match(rows[0].error, /bot ulanmagan/);
  assert.equal(rows[0].attempts, 1);
});

test("jo'natuvchi ikkinchi marta o'sha xabarni qayta olmaydi", async () => {
  const res = await dispatchQueued();
  assert.equal(res.sent + res.failed + res.skipped, 0, "navbatda 'queued' qolmasligi kerak");
});

test("chat_id yo'q bo'lsa sabab yoziladi (qayta urinilmaydi)", async () => {
  // Qo'lda navbatga qo'yamiz, lekin ota-onada chat yo'q
  await pool.query(`UPDATE parent_phones SET telegram_chat_id = NULL WHERE parent_id = $1`, [parentId]);
  await pool.query(
    `INSERT INTO notifications (school_id, parent_id, student_id, kind, body)
     VALUES ($1, $2, $3, 'test.manual', 'sinov')`,
    [school.schoolId, parentId, studentId],
  );

  await dispatchQueued();
  const { rows } = await pool.query<{ status: string; error: string }>(
    `SELECT status, error FROM notifications WHERE kind = 'test.manual' AND student_id = $1`,
    [studentId],
  );
  assert.equal(rows[0].status, 'failed');
  assert.match(rows[0].error, /ulanmagan/);
});

test('qarz eslatmasi: botga ulanmagan bo\'lsa tushunarli xato qaytadi', async () => {
  const res = await api('POST', `/debtors/${studentId}/remind`, {}, school.adminToken);
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /botga ulanmagan/);
});

test('qarz eslatmasi navbatga tushadi va kuniga bir marta yuboriladi', async () => {
  await pool.query(
    `UPDATE parent_phones
        SET telegram_chat_id = 4242, telegram_verified_at = now(), notify_enabled = true
      WHERE parent_id = $1`,
    [parentId],
  );

  const first = await api('POST', `/debtors/${studentId}/remind`, {}, school.adminToken);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.queued, 1);

  const { rows } = await pool.query<{ body: string }>(
    `SELECT body FROM notifications WHERE kind = 'debt.reminder' AND student_id = $1`,
    [studentId],
  );
  assert.equal(rows.length, 1);
  // 1 000 000 hisob, 501 000 to'landi -> 499 000 qarz
  assert.match(rows[0].body, /499 000 so'm/, rows[0].body);

  // Ikkinchi bosishda takror xabar ketmaydi
  const second = await api('POST', `/debtors/${studentId}/remind`, {}, school.adminToken);
  assert.equal(second.status, 400);
  assert.match(second.body.error, /allaqachon yuborilgan/);
});

test("qarzi yo'q o'quvchiga eslatma yuborilmaydi", async () => {
  const clean = await createTestStudent(school, 'Qarzsiz', 'Vali');
  const res = await api('POST', `/debtors/${clean.studentId}/remind`, {}, school.adminToken);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /qarz yo'q/);
});

// ============================================================ botga taklif

test("taklif havolasi platforma botiga ishora qiladi (maktabda o'z boti yo'q)", async () => {
  const res = await api('GET', '/notifications/telegram', undefined, school.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ownBot, false);
  assert.match(res.body.inviteLink, /^https:\/\/t\.me\/.+\?start=/, res.body.inviteLink);
  assert.ok(res.body.inviteLink.endsWith(`${SLUG}-tg`), `tg_code havolada: ${res.body.inviteLink}`);
});

test("maktabning o'z boti bo'lsa havola o'sha botga ketadi", async () => {
  await pool.query(
    `UPDATE schools SET telegram_bot_token_enc = 'x', telegram_bot_username = 'afsona_test_bot'
      WHERE id = $1`,
    [school.schoolId],
  );
  const res = await api('GET', '/notifications/telegram', undefined, school.adminToken);
  assert.equal(res.body.ownBot, true);
  assert.match(res.body.inviteLink, /t\.me\/afsona_test_bot/, res.body.inviteLink);
  await pool.query(
    `UPDATE schools SET telegram_bot_token_enc = NULL, telegram_bot_username = NULL WHERE id = $1`,
    [school.schoolId],
  );
});

test("ulanmagan RAQAMLAR ro'yxati va sanoq to'g'ri", async () => {
  // Sanoq odam emas, RAQAM darajasida: bir odamning bir raqami ulangan,
  // ikkinchisi ulanmagan bo'lishi mumkin va ikkinchisi ham chaqirilishi kerak.
  await pool.query(
    `UPDATE parent_phones
        SET telegram_chat_id = NULL, telegram_verified_at = NULL, telegram_rejected_at = NULL
      WHERE parent_id = $1`,
    [parentId],
  );
  const before = await api('GET', '/notifications/telegram', undefined, school.adminToken);
  assert.equal(before.body.parents.connected, 0);
  assert.ok(before.body.pending.some((x: { phone: string }) => x.phone === PARENT_PHONE),
    "ulanmagan raqam ro'yxatda bo'lishi kerak");

  // Botni ochdi, lekin farzandini hali tasdiqlamadi — xabar ketmaydi.
  await pool.query(`UPDATE parent_phones SET telegram_chat_id = 555 WHERE parent_id = $1`, [parentId]);
  const waiting = await api('GET', '/notifications/telegram', undefined, school.adminToken);
  assert.equal(waiting.body.parents.connected, 0, 'tasdiqlanmagan raqam "ulangan" emas');
  assert.equal(waiting.body.parents.waiting, 1);
  assert.equal(
    waiting.body.pending.find((x: { phone: string }) => x.phone === PARENT_PHONE)?.state,
    'pending',
  );

  // "Bu mening farzandim emas" — ma'muriyat ro'yxat boshida ko'radi.
  await pool.query(
    `UPDATE parent_phones SET telegram_rejected_at = now() WHERE parent_id = $1`, [parentId]);
  const rejected = await api('GET', '/notifications/telegram', undefined, school.adminToken);
  assert.equal(rejected.body.parents.rejected, 1);
  assert.equal(rejected.body.pending[0].state, 'rejected', 'tasdiqlamaganlar tepada turadi');

  await pool.query(
    `UPDATE parent_phones
        SET telegram_verified_at = now(), telegram_rejected_at = NULL
      WHERE parent_id = $1`,
    [parentId]);
  const after2 = await api('GET', '/notifications/telegram', undefined, school.adminToken);
  assert.equal(after2.body.parents.connected, 1);
  assert.ok(!after2.body.pending.some((x: { phone: string }) => x.phone === PARENT_PHONE),
    "tasdiqlagach ro'yxatdan chiqadi");
});

test('bir odamning ikki raqami ham xabar oladi', async () => {
  // Qo'shimcha raqam qo'shamiz va ikkalasini ham botga ulangan qilamiz.
  await pool.query(
    `INSERT INTO parent_phones
       (school_id, parent_id, phone, telegram_chat_id, telegram_verified_at)
     VALUES ($1, $2, '+998901237799', 9999, now())
     ON CONFLICT (school_id, phone)
       DO UPDATE SET telegram_chat_id = 9999, telegram_verified_at = now()`,
    [school.schoolId, parentId],
  );
  await pool.query(
    `UPDATE parent_phones
        SET telegram_chat_id = 4242, telegram_verified_at = now()
      WHERE parent_id = $1 AND is_primary`,
    [parentId]);

  const before = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM notifications WHERE student_id = $1 AND kind = 'payment.received'`,
    [studentId]);
  const pay = await api('POST', '/payments', { studentId, amount: 5_000, provider: 'cash' }, school.adminToken);
  assert.equal(pay.status, 201, JSON.stringify(pay.body));

  const after2 = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM notifications WHERE student_id = $1 AND kind = 'payment.received'`,
    [studentId]);
  assert.equal(after2.rows[0].c - before.rows[0].c, 2, 'ikkala raqamga ham xabar yozilishi kerak');
});

test("boshqa maktabning ota-onasi ro'yxatga tushmaydi", async () => {
  const other = await createTestSchool('test-notif-b');
  try {
    const res = await api('GET', '/notifications/telegram', undefined, other.adminToken);
    assert.equal(res.body.parents.total, 0, 'faqat o\'z maktabi hisoblanadi');
    assert.equal(res.body.pending.length, 0);
  } finally {
    await dropTestSchool('test-notif-b');
  }
});
