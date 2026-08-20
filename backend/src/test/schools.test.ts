/** Maktablar (platforma), sozlamalar, o'quv yillari va xodimlar moduli. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { pool } from '../db/pool.js';
import {
  createSuperadmin,
  createTestSchool,
  dropTestSchool,
  startServer,
  type TestApi,
  type TestSchool,
} from './helpers.js';

const SLUG = 'test-sch';
const NEW_SLUG = 'test-sch-new';
const SUPER_PHONE = '+998977100002';

let server: Server;
let api: TestApi;
let school: TestSchool;
let superToken: string;
let superId: string;

before(async () => {
  ({ server, api } = startServer());
  school = await createTestSchool(SLUG);
  await dropTestSchool(NEW_SLUG);
  const s = await createSuperadmin(SUPER_PHONE);
  superToken = s.token;
  superId = s.id;
});

after(async () => {
  await dropTestSchool(SLUG);
  await dropTestSchool(NEW_SLUG);
  await pool.query(`DELETE FROM users WHERE id = $1`, [superId]);
  server?.close();
  await pool.end();
});

test('superadmin maktab yaratadi (birinchi admin bilan), takror slug 409', async () => {
  const created = await api(
    'POST',
    '/schools',
    {
      name: 'Yangi maktab',
      slug: NEW_SLUG,
      admin: { fullName: 'Yangi Admin', phone: '+998971230001', password: 'parol12345' },
    },
    superToken,
  );
  assert.equal(created.status, 201);

  // Yangi admin darhol tizimga kira oladi
  const login = await api('POST', '/auth/login', { phone: '+998971230001', password: 'parol12345' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'admin');

  const dup = await api('POST', '/schools', { name: 'Takror maktab', slug: NEW_SLUG }, superToken);
  assert.equal(dup.status, 409);
});

test("sozlamalar jsonb MERGE bo'ladi — eski kalitlar yo'qolmaydi", async () => {
  const first = await api('PATCH', '/school/settings', { payment_due_day: 15 }, school.adminToken);
  assert.equal(first.status, 200);
  assert.equal(first.body.settings.payment_due_day, 15);

  const second = await api('PATCH', '/school/settings', { grading: { max_score: 100 } }, school.adminToken);
  assert.equal(second.status, 200);
  assert.equal(second.body.settings.payment_due_day, 15, "oldingi kalit yo'qolmasligi kerak");
  assert.equal(second.body.settings.grading.max_score, 100);

  // Sozlama o'zgarishi auditga tushgan
  const audit = await api('GET', '/audit?action=school.settings.update', undefined, school.adminToken);
  assert.ok(audit.body.items.length >= 2);
});

test("o'quv yili: yangisi joriy bo'lsa eskisi joriylikdan chiqadi", async () => {
  const created = await api(
    'POST',
    '/years',
    { name: '2027-2028', startsOn: '2027-09-01', endsOn: '2028-05-31', isCurrent: true },
    school.adminToken,
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.year.is_current, true);

  const list = await api('GET', '/years', undefined, school.adminToken);
  const current = list.body.items.filter((y: any) => y.is_current);
  assert.equal(current.length, 1, "faqat bitta joriy o'quv yili bo'ladi");
  assert.equal(current[0].name, '2027-2028');

  // Eskisini qaytaramiz (boshqa testlar joriy 2026-2027 ga tayanadi)
  const old = list.body.items.find((y: any) => y.name === '2026-2027');
  const set = await api('PATCH', `/years/${old.id}/set-current`, {}, school.adminToken);
  assert.equal(set.status, 200);
  assert.equal(set.body.year.is_current, true);
});

test("xodim yaratish: takror telefon 409, o'qituvchi yarata olmaydi", async () => {
  const created = await api(
    'POST',
    '/users',
    { fullName: 'Yangi Menejer', phone: '+998971230002', password: 'parol12345', role: 'manager' },
    school.adminToken,
  );
  assert.equal(created.status, 201);

  const dup = await api(
    'POST',
    '/users',
    { fullName: 'Takror', phone: '+998971230002', password: 'parol12345', role: 'teacher' },
    school.adminToken,
  );
  assert.equal(dup.status, 409);

  const byTeacher = await api(
    'POST',
    '/users',
    { fullName: 'X Y Z', phone: '+998971230003', password: 'parol12345', role: 'teacher' },
    school.teacherToken,
  );
  assert.equal(byTeacher.status, 403);
});

test("xodim o'chirilsa sessiyalari darhol bekor bo'ladi", async () => {
  // Yangi o'qituvchi + haqiqiy login
  await api(
    'POST',
    '/users',
    { fullName: 'Vaqtinchalik Ustoz', phone: '+998971230004', password: 'parol12345', role: 'teacher' },
    school.adminToken,
  );
  const login = await api('POST', '/auth/login', { phone: '+998971230004', password: 'parol12345' });
  assert.equal(login.status, 200);
  const token = login.body.token;
  const userId = login.body.user.id;

  assert.equal((await api('GET', '/auth/me', undefined, token)).status, 200);

  const off = await api('PATCH', `/users/${userId}`, { isActive: false }, school.adminToken);
  assert.equal(off.status, 200);

  // token_version oshgani uchun eski token ishlamaydi
  assert.equal((await api('GET', '/auth/me', undefined, token)).status, 401);
});

test("admin o'zini o'chira olmaydi", async () => {
  const { status, body } = await api(
    'PATCH',
    `/users/${school.adminId}`,
    { isActive: false },
    school.adminToken,
  );
  assert.equal(status, 400);
  assert.match(body.error, /o'zingizni/i);
});

test("sinf o'chirish: bo'sh sinf o'chadi, o'quvchisi bori o'chmaydi", async () => {
  // 1) Bo'sh sinf — o'chadi
  const empty = await api('POST', '/classes', { grade: 11, letter: 'X', monthlyFee: 500000 }, school.adminToken);
  assert.equal(empty.status, 201);
  const del = await api('DELETE', `/classes/${empty.body.class.id}`, undefined, school.adminToken);
  assert.equal(del.status, 200);
  const gone = await api('GET', `/classes/${empty.body.class.id}`, undefined, school.adminToken);
  assert.equal(gone.status, 404);

  // 2) O'quvchisi bor sinf — o'chmaydi va ma'lumot joyida qoladi
  const busyCls = await api('POST', '/classes', { grade: 11, letter: 'B', monthlyFee: 500000 }, school.adminToken);
  const busyId = busyCls.body.class.id;
  const st = await api(
    'POST', '/students',
    { lastName: 'Sinfda', firstName: 'Bor', classId: busyId },
    school.adminToken,
  );
  assert.equal(st.status, 201);

  const busy = await api('DELETE', `/classes/${busyId}`, undefined, school.adminToken);
  assert.equal(busy.status, 409);
  assert.match(busy.body.error, /o'quvchi/);
  const still = await pool.query(`SELECT 1 FROM classes WHERE id = $1`, [busyId]);
  assert.equal(still.rowCount, 1, "sinf o'chmagan bo'lishi kerak");
});

test("sinf o'chirish: tarixi bor sinf o'chmaydi (davomat kaskad bilan ketmasin)", async () => {
  const cls = await api('POST', '/classes', { grade: 10, letter: 'Y', monthlyFee: 400000 }, school.adminToken);
  const classId = cls.body.class.id;

  // O'quvchini biriktirib, keyin chiqaramiz: hozir o'quvchi yo'q, lekin tarix bor.
  const st = await api('POST', '/students', { lastName: 'Tarixiy', firstName: 'Talaba', classId }, school.adminToken);
  assert.equal(st.status, 201);
  await pool.query(`UPDATE enrollments SET ends_on = CURRENT_DATE WHERE class_id = $1`, [classId]);

  const active = await api('GET', '/classes', undefined, school.adminToken);
  const row = active.body.items.find((c: any) => c.id === classId);
  assert.equal(row.student_count, 0, 'joriy o\'quvchi qolmagan bo\'lishi kerak');

  const del = await api('DELETE', `/classes/${classId}`, undefined, school.adminToken);
  assert.equal(del.status, 409, 'tarixi bor sinf o\'chirilmasligi kerak');
  assert.match(del.body.error, /tarix/);
});
