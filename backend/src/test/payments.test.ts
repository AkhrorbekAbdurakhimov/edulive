/** To'lovlar: hisob generatsiyasi, FIFO taqsimot, idempotentlik (4-qoida), qarzdorlar, dashboard. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { pool } from '../db/pool.js';
import {
  createTestSchool,
  createTestStudent,
  dropTestSchool,
  startServer,
  type TestApi,
  type TestSchool,
} from './helpers.js';

const SLUG = 'test-pay';
const FEE = 1_000_000;

let server: Server;
let api: TestApi;
let school: TestSchool;
let s1: string; // chegirmasiz
let s2: string; // 50% chegirma

before(async () => {
  ({ server, api } = startServer());
  school = await createTestSchool(SLUG, { monthlyFee: FEE });
  s1 = (await createTestStudent(school, 'Qodirov', 'Imron', { parentPhone: '+998936670001' })).studentId;
  s2 = (await createTestStudent(school, 'Azimova', 'Madina', { discountPercent: 50 })).studentId;
});

after(async () => {
  await dropTestSchool(SLUG);
  server?.close();
  await pool.end();
});

test('hisob generatsiyasi: chegirma hisoblanadi, qayta chaqirish takror yozmaydi', async () => {
  const first = await api('POST', '/invoices/generate', { periodMonth: '2026-09' }, school.adminToken);
  assert.equal(first.status, 201);
  assert.equal(first.body.created, 2);

  // 4-qoida ruhi: qayta chaqirish xato emas, shunchaki 0 ta yangi yozuv
  const again = await api('POST', '/invoices/generate', { periodMonth: '2026-09' }, school.adminToken);
  assert.equal(again.status, 201);
  assert.equal(again.body.created, 0);

  const list = await api('GET', '/invoices?month=2026-09', undefined, school.adminToken);
  assert.equal(list.body.total, 2);
  const byStudent = new Map(list.body.items.map((i: any) => [i.student_id, i]));
  assert.equal((byStudent.get(s1) as any).outstanding, FEE);
  assert.equal((byStudent.get(s2) as any).outstanding, FEE / 2, 'chegirma 50% qo\'llanishi kerak');
  // To'lov muddati sozlamadagi kun (10) bo'yicha
  assert.match((byStudent.get(s1) as any).due_date, /^2026-09-10/);
});

test("qisman to'lov: hisob 'partial', to'liq to'lov: 'paid'", async () => {
  const partial = await api(
    'POST',
    '/payments',
    { studentId: s1, amount: 400_000, provider: 'cash' },
    school.adminToken,
  );
  assert.equal(partial.status, 201);
  assert.equal(partial.body.allocations.length, 1);
  assert.equal(partial.body.allocations[0].amount, 400_000);
  assert.ok(partial.body.payment.receipt_no.startsWith('KV-'));

  let inv = await api('GET', `/invoices?studentId=${s1}`, undefined, school.adminToken);
  assert.equal(inv.body.items[0].status, 'partial');
  assert.equal(inv.body.items[0].outstanding, 600_000);

  const full = await api(
    'POST',
    '/payments',
    { studentId: s1, amount: 600_000, provider: 'cash' },
    school.adminToken,
  );
  assert.equal(full.status, 201);

  inv = await api('GET', `/invoices?studentId=${s1}`, undefined, school.adminToken);
  assert.equal(inv.body.items[0].status, 'paid');
  assert.equal(inv.body.items[0].outstanding, 0);
});

test("bitta to'lov bir nechta oyni FIFO yopadi", async () => {
  const gen = await api('POST', '/invoices/generate', { periodMonth: '2026-10' }, school.adminToken);
  assert.equal(gen.body.created, 2);

  // s2: sentyabr 500k (ochiq) + oktyabr 500k → 700k to'lov: sentyabr to'liq, oktyabr 200k
  const paid = await api(
    'POST',
    '/payments',
    { studentId: s2, amount: 700_000, provider: 'transfer' },
    school.adminToken,
  );
  assert.equal(paid.status, 201);
  assert.equal(paid.body.allocations.length, 2);
  assert.equal(paid.body.allocations[0].amount, 500_000, 'avval eng eski oy yopiladi');
  assert.equal(paid.body.allocations[1].amount, 200_000);

  const inv = await api('GET', `/invoices?studentId=${s2}`, undefined, school.adminToken);
  const byMonth = new Map(inv.body.items.map((i: any) => [String(i.period_month).slice(0, 7), i]));
  assert.equal((byMonth.get('2026-09') as any).status, 'paid');
  assert.equal((byMonth.get('2026-10') as any).status, 'partial');
  assert.equal((byMonth.get('2026-10') as any).outstanding, 300_000);
});

test("idempotency_key: webhook takrori tinch o'tadi, ikkinchi yozuv yaratilmaydi (4-qoida)", async () => {
  const key = 'click-tx-777';
  const first = await api(
    'POST',
    '/payments',
    { studentId: s1, amount: 100_000, provider: 'click', idempotencyKey: key },
    school.adminToken,
  );
  assert.equal(first.status, 201);
  assert.equal(first.body.duplicate, false);

  const second = await api(
    'POST',
    '/payments',
    { studentId: s1, amount: 100_000, provider: 'click', idempotencyKey: key },
    school.adminToken,
  );
  assert.equal(second.status, 200, 'takror webhook xato emas — tinch o\'tadi');
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.payment.id, first.body.payment.id);

  const count = await pool.query(
    `SELECT count(*)::int AS n FROM payments WHERE school_id = $1 AND idempotency_key = $2`,
    [school.schoolId, key],
  );
  assert.equal(count.rows[0].n, 1, "bazada bitta to'lov qolishi kerak");

  // Audit ham faqat bitta marta yozilgan
  const audits = await pool.query(
    `SELECT count(*)::int AS n FROM audit_log
      WHERE school_id = $1 AND action = 'payment.create' AND entity_id = $2`,
    [school.schoolId, first.body.payment.id],
  );
  assert.equal(audits.rows[0].n, 1);
});

test("qarzdorlar ochiq hisoblardan avtomatik shakllanadi", async () => {
  const { status, body } = await api('GET', '/debtors', undefined, school.adminToken);
  assert.equal(status, 200);

  // s1: oktyabr 1000k ochiq (100k click to'lovi oktyabrga tushgan) → 900k qarz
  // s2: oktyabr 300k qarz
  const byStudent = new Map(body.items.map((d: any) => [d.student_id, d]));
  assert.equal((byStudent.get(s1) as any).outstanding, 900_000);
  assert.equal((byStudent.get(s2) as any).outstanding, 300_000);
  assert.equal(body.totalOutstanding, 1_200_000);
  assert.equal((byStudent.get(s1) as any).parent_phone, '+998936670001', 'eslatma uchun ota-ona telefoni kerak');
});

test("o'qituvchi to'lov yoza olmaydi", async () => {
  const { status } = await api(
    'POST',
    '/payments',
    { studentId: s1, amount: 1, provider: 'cash' },
    school.teacherToken,
  );
  assert.equal(status, 403);
});

test('dashboard KPI: to\'lovlar va qarzdorlar jamlanadi', async () => {
  const { status, body } = await api('GET', '/dashboard', undefined, school.adminToken);
  assert.equal(status, 200);
  assert.equal(body.students.active, 2);
  assert.equal(body.debtors.count, 2);
  assert.equal(body.debtors.outstanding, 1_200_000);
  // paid_at = now() bilan yozilgan to'lovlar shu oyga tushadi
  assert.equal(body.payments.thisMonth, 400_000 + 600_000 + 700_000 + 100_000);
});

test('hisobdan oldin to\'langan pul yo\'qolmaydi va hisob chiqqach o\'zi yopiladi', async () => {
  const student = await createTestStudent(school, 'Avans', 'Sinov');

  // 1) Hisob yo'q — to'lov avans bo'lib turadi, lekin ko'rinadi
  const pay = await api('POST', '/payments',
    { studentId: student.studentId, amount: 1_000_000, provider: 'cash' }, school.adminToken);
  assert.equal(pay.status, 201);
  assert.equal(pay.body.allocations.length, 0, 'yopadigan hisob yo\'q');

  let card = await api('GET', `/students/${student.studentId}`, undefined, school.adminToken);
  assert.equal(card.body.finance.advance, 1_000_000, 'to\'langan pul avans sifatida ko\'rinishi kerak');
  assert.equal(card.body.finance.outstanding, 0);

  // 2) Hisob chiqarilgach avans unga bog'lanadi
  const gen = await api('POST', '/invoices/generate', { periodMonth: '2027-03' }, school.adminToken);
  assert.equal(gen.status, 201);
  assert.ok(gen.body.allocated >= 1, 'hisob chiqarilganda avans taqsimlanishi kerak');

  card = await api('GET', `/students/${student.studentId}`, undefined, school.adminToken);
  const fee = card.body.finance.invoiced;
  assert.ok(fee > 0, 'hisob chiqqan bo\'lishi kerak');
  assert.equal(card.body.finance.paid, 1_000_000, 'avans to\'langan sifatida hisoblanadi');
  assert.equal(card.body.finance.outstanding, fee - 1_000_000, 'qarz to\'lov miqdoricha kamayishi kerak');
  assert.equal(card.body.finance.advance, 0, 'bog\'langach avans qolmaydi');

  // 3) Qolganini to'lasa hisob yopiladi
  await api('POST', '/payments',
    { studentId: student.studentId, amount: fee - 1_000_000, provider: 'cash' }, school.adminToken);
  card = await api('GET', `/students/${student.studentId}`, undefined, school.adminToken);
  assert.equal(card.body.finance.outstanding, 0, 'to\'liq to\'langach qarz qolmaydi');

  const inv = await api('GET', `/invoices?studentId=${student.studentId}`, undefined, school.adminToken);
  assert.equal(inv.body.items[0].status, 'paid');
});

test("mavjud hisob va bog'lanmagan to'lov: hisob chiqarish tugmasi o'zi tuzatadi", async () => {
  const student = await createTestStudent(school, 'Eski', 'Qoldiq');

  // Hisob avval chiqarilgan
  await api('POST', '/invoices/generate', { periodMonth: '2027-04' }, school.adminToken);
  let card = await api('GET', `/students/${student.studentId}`, undefined, school.adminToken);
  const fee = card.body.finance.invoiced;
  assert.ok(fee > 0);

  // Bog'lanmagan to'lovni qo'lda yasaymiz — xatolik yuz bergan holatni takrorlaydi
  await pool.query(
    `INSERT INTO payments (school_id, student_id, amount, provider, received_by)
     VALUES ($1, $2, $3, 'cash', NULL)`,
    [school.schoolId, student.studentId, fee],
  );
  card = await api('GET', `/students/${student.studentId}`, undefined, school.adminToken);
  assert.equal(card.body.finance.outstanding, fee, "tuzatishdan oldin qarz to'liq turadi");
  assert.equal(card.body.finance.advance, fee, "pul avans bo'lib osilib qolgan");

  // O'sha oy uchun qayta chaqiramiz — yangi hisob yaratilmaydi, lekin bog'lanadi
  const gen = await api('POST', '/invoices/generate', { periodMonth: '2027-04' }, school.adminToken);
  assert.equal(gen.body.created, 0, 'yangi hisob yaratilmasligi kerak');
  assert.ok(gen.body.allocated >= 1, "eski to'lov bog'lanishi kerak");

  card = await api('GET', `/students/${student.studentId}`, undefined, school.adminToken);
  assert.equal(card.body.finance.outstanding, 0, 'qarz yopilishi kerak');
  assert.equal(card.body.finance.advance, 0);
});

test("kassir tanlagan oy yopiladi, eng eskisi tegilmaydi", async () => {
  const student = await createTestStudent(school, 'Oylik', 'Tanlov');
  await api('POST', '/invoices/generate', { periodMonth: '2027-09' }, school.adminToken);
  await api('POST', '/invoices/generate', { periodMonth: '2027-10' }, school.adminToken);

  const list = await api('GET', `/invoices?studentId=${student.studentId}`, undefined, school.adminToken);
  const months = list.body.items
    .filter((i: any) => i.outstanding > 0)
    .sort((a: any, b: any) => a.period_month.localeCompare(b.period_month));
  assert.equal(months.length, 2, 'ikki oylik hisob bo\'lishi kerak');
  const [sep, oct] = months;

  // Ataylab KEYINGI oyni to'laymiz
  const pay = await api('POST', '/payments', {
    studentId: student.studentId, amount: oct.outstanding, provider: 'cash', invoiceIds: [oct.id],
  }, school.adminToken);
  assert.equal(pay.status, 201);
  assert.equal(pay.body.allocations.length, 1);
  assert.equal(pay.body.allocations[0].invoiceId, oct.id);

  const after = await api('GET', `/invoices?studentId=${student.studentId}`, undefined, school.adminToken);
  const byId = new Map(after.body.items.map((i: any) => [i.id, i]));
  assert.equal((byId.get(oct.id) as any).status, 'paid', 'tanlangan oy yopilishi kerak');
  assert.equal((byId.get(sep.id) as any).status, 'open', 'eski oyga tegilmasligi kerak');
});

test("begona oy tanlansa 400 qaytadi", async () => {
  const a = await createTestStudent(school, 'Bir', 'Talaba');
  const b = await createTestStudent(school, 'Ikki', 'Talaba');
  await api('POST', '/invoices/generate', { periodMonth: '2027-11' }, school.adminToken);

  const bInv = await api('GET', `/invoices?studentId=${b.studentId}`, undefined, school.adminToken);
  const foreign = bInv.body.items[0].id;

  const res = await api('POST', '/payments', {
    studentId: a.studentId, amount: 100000, provider: 'cash', invoiceIds: [foreign],
  }, school.adminToken);
  assert.equal(res.status, 400, "boshqa o'quvchining oyiga yozib bo'lmaydi");
});
