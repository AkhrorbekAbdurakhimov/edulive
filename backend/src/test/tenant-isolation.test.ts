/**
 * MVP mezoni: "Bitta maktab boshqasining ma'lumotini ko'ra olmasligi
 * avtomatik test bilan qoplangan" (requirements.md).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { pool } from '../db/pool.js';
import {
  createSuperadmin,
  createTestSchool,
  createTestStudent,
  dropTestSchool,
  startServer,
  type TestApi,
  type TestSchool,
} from './helpers.js';

const SLUG_A = 'test-iso-a';
const SLUG_B = 'test-iso-b';
const SUPER_PHONE = '+998977100001';

let server: Server;
let api: TestApi;
let A: TestSchool;
let B: TestSchool;
let studentA: string;
let studentB: string;
let superToken: string;
let superId: string;

before(async () => {
  ({ server, api } = startServer());
  A = await createTestSchool(SLUG_A);
  B = await createTestSchool(SLUG_B);
  studentA = (await createTestStudent(A, 'Aliyev', 'Azam')).studentId;
  studentB = (await createTestStudent(B, 'Boboyev', 'Bobur')).studentId;
  const s = await createSuperadmin(SUPER_PHONE);
  superToken = s.token;
  superId = s.id;
});

after(async () => {
  await dropTestSchool(SLUG_A);
  await dropTestSchool(SLUG_B);
  await pool.query(`DELETE FROM users WHERE id = $1`, [superId]);
  server?.close();
  await pool.end();
});

test("A maktab admini faqat o'z o'quvchilarini ko'radi", async () => {
  const { status, body } = await api('GET', '/students', undefined, A.adminToken);
  assert.equal(status, 200);
  assert.equal(body.total, 1);
  assert.equal(body.items[0].id, studentA);
});

test("A admini B o'quvchisini ID orqali ham ocholmaydi", async () => {
  const direct = await api('GET', `/students/${studentB}`, undefined, A.adminToken);
  assert.equal(direct.status, 404);

  const patch = await api('PATCH', `/students/${studentB}`, { firstName: 'Buzildi' }, A.adminToken);
  assert.equal(patch.status, 404);

  const archive = await api('POST', `/students/${studentB}/archive`, {}, A.adminToken);
  assert.equal(archive.status, 409); // "topilmadi yoki arxivlangan" — B ma'lumoti o'zgarmagan

  const untouched = await pool.query(`SELECT first_name, status FROM students WHERE id = $1`, [studentB]);
  assert.equal(untouched.rows[0].first_name, 'Bobur');
  assert.equal(untouched.rows[0].status, 'active');
});

test("A admini B sinfini ko'rmaydi va tahrirlay olmaydi", async () => {
  const list = await api('GET', '/classes', undefined, A.adminToken);
  assert.equal(list.status, 200);
  assert.ok(!list.body.items.some((c: any) => c.id === B.classId));

  const detail = await api('GET', `/classes/${B.classId}`, undefined, A.adminToken);
  assert.equal(detail.status, 404);

  const patch = await api('PATCH', `/classes/${B.classId}`, { monthlyFee: 1 }, A.adminToken);
  assert.equal(patch.status, 404);
});

test("A admini B o'quvchisiga to'lov yoza olmaydi", async () => {
  const { status } = await api(
    'POST',
    '/payments',
    { studentId: studentB, amount: 100_000, provider: 'cash' },
    A.adminToken,
  );
  assert.equal(status, 404);
});

test("A admini B xodimlarini ko'rmaydi, B davomatini ololmaydi", async () => {
  const users = await api('GET', '/users', undefined, A.adminToken);
  assert.equal(users.status, 200);
  assert.ok(!users.body.items.some((u: any) => u.id === B.teacherId));

  const att = await api(
    'POST',
    '/attendance/take',
    { classId: B.classId, marks: [] },
    A.adminToken,
  );
  assert.equal(att.status, 404);
});

test("B o'qituvchisi A sinfiga davomat ololmaydi (403)", async () => {
  const { status } = await api(
    'POST',
    '/attendance/take',
    { classId: A.classId, marks: [] },
    B.teacherToken,
  );
  assert.equal(status, 403);
});

test("audit jurnalida faqat o'z maktabi ko'rinadi", async () => {
  // A da audit yozuvi hosil qilamiz
  await api('PATCH', '/school/settings', { test_marker: 'a' }, A.adminToken);
  const auditA = await api('GET', '/audit', undefined, A.adminToken);
  assert.equal(auditA.status, 200);
  assert.ok(auditA.body.items.every((r: any) => r.actor_id !== B.adminId));
});

test('superadmin tenant tanlamasa maktab yo\'llariga kira olmaydi, X-School-Id bilan kiradi', async () => {
  const without = await api('GET', '/students', undefined, superToken);
  assert.equal(without.status, 403); // requireTenant — maktab tanlanmagan

  const withA = await api('GET', '/students', undefined, superToken, { 'X-School-Id': A.schoolId });
  assert.equal(withA.status, 200);
  assert.equal(withA.body.items[0].id, studentA);

  const withB = await api('GET', '/students', undefined, superToken, { 'X-School-Id': B.schoolId });
  assert.equal(withB.status, 200);
  assert.equal(withB.body.items[0].id, studentB);
});

test('oddiy admin platforma yo\'llariga kira olmaydi', async () => {
  const { status } = await api('GET', '/schools', undefined, A.adminToken);
  assert.equal(status, 403);
});
