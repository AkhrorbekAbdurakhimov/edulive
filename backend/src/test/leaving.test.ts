/**
 * O'quvchining o'rtada kelishi va ketishi.
 *
 * Oy ulushi SOZLAMA bilan boshqariladi (3-qoida): o'chirilganda eski
 * xatti-harakat saqlanadi — mavjud maktablarning hisobi o'z-o'zidan
 * o'zgarib ketmasligi kerak.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { pool } from '../db/pool.js';
import {
  createTestSchool, createTestStudent, dropTestSchool, startServer,
  type TestApi, type TestSchool,
} from './helpers.js';

const SLUG = 'test-leave';
const FEE = 3_100_000;   // 31 kunli oyda kuniga 100 000 — hisob qo'lda tekshiriladi

let server: Server;
let api: TestApi;
let school: TestSchool;

before(async () => {
  ({ server, api } = startServer());
  school = await createTestSchool(SLUG, { monthlyFee: FEE });
});

after(async () => {
  await dropTestSchool(SLUG);
  server?.close();
  await pool.end();
});

const setProrate = (on: boolean) => pool.query(
  `UPDATE schools SET settings = settings || $2::jsonb WHERE id = $1`,
  [school.schoolId, JSON.stringify({ prorate_partial_months: on })],
);

const amountOf = async (studentId: string, month: string) => {
  const { rows } = await pool.query<{ amount: string }>(
    `SELECT amount::text FROM invoices WHERE student_id = $1 AND period_month = $2::date`,
    [studentId, `${month}-01`]);
  return rows[0] ? Number(rows[0].amount) : null;
};

test("sozlama o'chirilgan: o'rtada kelganga to'liq oy yoziladi (eski xatti-harakat)", async () => {
  await setProrate(false);
  const s = await createTestStudent(school, 'Kelgan', 'Toliq');
  await pool.query(`UPDATE enrollments SET starts_on = '2026-10-21' WHERE student_id = $1`, [s.studentId]);

  const res = await api('POST', '/invoices/generate', { periodMonth: '2026-10' }, school.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(await amountOf(s.studentId, '2026-10'), FEE, 'proratsiyasiz to\'liq summa');
});

test("sozlama yoqilgan: 21-oktabrda kelganga 11 kunlik hisob", async () => {
  await setProrate(true);
  const s = await createTestStudent(school, 'Kelgan', 'Ulush');
  await pool.query(`UPDATE enrollments SET starts_on = '2026-11-21' WHERE student_id = $1`, [s.studentId]);

  await api('POST', '/invoices/generate', { periodMonth: '2026-11' }, school.adminToken);
  // Noyabr 30 kun: 21-noyabrdan 30-noyabrgacha = 10 kun
  const expected = Math.round(FEE * 10 / 30 * 100) / 100;
  assert.equal(await amountOf(s.studentId, '2026-11'), expected,
    `10/30 ulush kutilgan (${expected})`);
});

test("to'liq oy o'qiganga aynan to'liq summa (yaxlitlash surilib ketmasin)", async () => {
  await setProrate(true);
  const s = await createTestStudent(school, 'Toliq', 'Oy');
  await pool.query(`UPDATE enrollments SET starts_on = '2026-09-01' WHERE student_id = $1`, [s.studentId]);

  await api('POST', '/invoices/generate', { periodMonth: '2026-12' }, school.adminToken);
  assert.equal(await amountOf(s.studentId, '2026-12'), FEE);
});

test("ketganda joriy oy hisobi qayta hisoblanadi", async () => {
  await setProrate(true);
  const s = await createTestStudent(school, 'Ketgan', 'Bola');
  await pool.query(`UPDATE enrollments SET starts_on = '2027-01-01' WHERE student_id = $1`, [s.studentId]);
  await api('POST', '/invoices/generate', { periodMonth: '2027-01' }, school.adminToken);
  assert.equal(await amountOf(s.studentId, '2027-01'), FEE, 'avval to\'liq oy');

  const res = await api('POST', `/students/${s.studentId}/archive`,
    { status: 'left', endsOn: '2027-01-10', reason: 'boshqa maktabga o\'tdi' }, school.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.recalculated, 1, 'bitta hisob qayta hisoblanishi kerak');

  // Yanvar 31 kun, 1-10 = 10 kun
  const expected = Math.round(FEE * 10 / 31 * 100) / 100;
  assert.equal(await amountOf(s.studentId, '2027-01'), expected, `10/31 ulush (${expected})`);

  const { rows } = await pool.query<{ status: string; ends_on: string }>(
    `SELECT s.status, e.ends_on::text FROM students s
       JOIN enrollments e ON e.student_id = s.id WHERE s.id = $1`, [s.studentId]);
  assert.equal(rows[0].status, 'left', '"ketdi" holati yozilishi kerak');
  assert.equal(rows[0].ends_on, '2027-01-10');
});

test("ketgan o'quvchiga keyingi oy hisobi chiqmaydi", async () => {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT s.id FROM students s WHERE s.school_id = $1 AND s.last_name = 'Ketgan'`,
    [school.schoolId]);
  await api('POST', '/invoices/generate', { periodMonth: '2027-02' }, school.adminToken);
  assert.equal(await amountOf(rows[0].id, '2027-02'), null, 'keyingi oyga hisob yo\'q');
});

test("moliyaviy tarixi bor o'quvchini o'chirib bo'lmaydi", async () => {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM students WHERE school_id = $1 AND last_name = 'Ketgan'`, [school.schoolId]);
  const res = await api('DELETE', `/students/${rows[0].id}`, undefined, school.adminToken);
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(res.body.error, /hisob|to'lov/);
  assert.match(res.body.error, /Ketdi/, 'nima qilish kerakligini aytishi kerak');
});

test("tarixi yo'q o'quvchi o'chiriladi va audit yoziladi", async () => {
  const s = await createTestStudent(school, 'Xato', 'Kiritilgan');
  const res = await api('DELETE', `/students/${s.studentId}`, undefined, school.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const { rows } = await pool.query(`SELECT 1 FROM students WHERE id = $1`, [s.studentId]);
  assert.equal(rows.length, 0);

  const audit = await pool.query(
    `SELECT 1 FROM audit_log WHERE school_id = $1 AND action = 'student.delete' AND entity_id = $2`,
    [school.schoolId, s.studentId]);
  assert.equal(audit.rows.length, 1, 'o\'chirish audit jurnaliga tushishi kerak');
});

test("menejer o'chira olmaydi (faqat admin)", async () => {
  const s = await createTestStudent(school, 'Menejer', 'Sinovi');
  const res = await api('DELETE', `/students/${s.studentId}`, undefined, school.managerToken);
  assert.equal(res.status, 403);
});
