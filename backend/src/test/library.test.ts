/** Kutubxona: huquq, nusxa hisobi, berish/qaytarish, muddat. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';
import { pool } from '../db/pool.js';
import {
  createTestSchool, createTestStudent, dropTestSchool, startServer,
  type TestApi, type TestSchool,
} from './helpers.js';

const SLUG = 'test-library';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let server: Server;
let api: TestApi;
let school: TestSchool;
let base: string;
let studentId: string;
let student2Id: string;
let bookId: string;

before(async () => {
  ({ server, api } = startServer());
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  school = await createTestSchool(SLUG);
  studentId = (await createTestStudent(school, 'Kitobxon', 'Aziz')).studentId;
  student2Id = (await createTestStudent(school, 'Kitobxon', 'Zuhra')).studentId;
});

after(async () => {
  await dropTestSchool(SLUG);
  server?.close();
  await pool.end();
});

test("kutubxona huquqi yo'q o'qituvchi kira olmaydi", async () => {
  const res = await api('GET', '/library/books', undefined, school.teacherToken);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Kutubxona huquqi/);
});

test('kutubxonachi belgisi qo\'yilgan o\'qituvchi kiradi', async () => {
  await pool.query(`UPDATE users SET is_librarian = true WHERE id = $1`, [school.teacherId]);
  const res = await api('GET', '/library/books', undefined, school.teacherToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

test('kitob qo\'shilganda nusxalar avtomatik raqamlanadi', async () => {
  const res = await api('POST', '/library/books', {
    title: 'Alpomish', author: 'Xalq dostoni', category: 'badiiy',
    language: 'uz', price: 45000, copies: 3,
  }, school.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  bookId = res.body.book.id;
  assert.equal(res.body.book.copies, 3);

  const one = await api('GET', `/library/books/${bookId}`, undefined, school.adminToken);
  assert.equal(one.body.copies.length, 3);
  assert.deepEqual(
    one.body.copies.map((c: { inventory_no: string }) => c.inventory_no),
    ['KT-000001', 'KT-000002', 'KT-000003'],
  );
  assert.ok(one.body.copies.every((c: { status: string }) => c.status === 'shelf'));
});

test("ro'yxatda bo'sh va berilgan nusxalar sanog'i ko'rinadi", async () => {
  const res = await api('GET', '/library/books', undefined, school.adminToken);
  const b = res.body.items.find((x: { id: string }) => x.id === bookId);
  assert.equal(b.total_copies, 3);
  assert.equal(b.available_copies, 3);
  assert.equal(b.issued_copies, 0);
});

test('inventar raqami takrorlanmaydi', async () => {
  const res = await api('POST', `/library/books/${bookId}/copies`,
    { inventoryNos: ['KT-000001'] }, school.adminToken);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Inventar raqami band/);
});

test('kitob berilganda nusxa javondan chiqadi', async () => {
  const res = await api('POST', '/library/loans',
    { studentId, bookId, dueOn: '2027-05-20' }, school.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.loan.status, 'issued');

  const list = await api('GET', '/library/books', undefined, school.adminToken);
  const b = list.body.items.find((x: { id: string }) => x.id === bookId);
  assert.equal(b.available_copies, 2);
  assert.equal(b.issued_copies, 1);
});

test('bitta nusxa ikki marta berilmaydi', async () => {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT copy_id AS id FROM book_loans WHERE book_id = $1 AND status = 'issued'`, [bookId]);
  const res = await api('POST', '/library/loans',
    { studentId: student2Id, copyId: rows[0].id }, school.adminToken);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /allaqachon berilgan/);
});

test("bo'sh nusxa qolmasa tushunarli xato", async () => {
  // Qolgan 2 donani ham beramiz
  for (let i = 0; i < 2; i += 1) {
    const r = await api('POST', '/library/loans', { studentId: student2Id, bookId }, school.adminToken);
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const res = await api('POST', '/library/loans', { studentId, bookId }, school.adminToken);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /bo'sh nusxasi qolmadi/);
});

test("o'tmishdagi sana rad etiladi", async () => {
  const res = await api('POST', '/library/loans',
    { studentId, bookId, dueOn: '2020-01-01' }, school.adminToken);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /o'tmishda/);
});

test('qaytarilganda nusxa javonga tushadi', async () => {
  const loans = await api('GET', '/library/loans?status=issued', undefined, school.adminToken);
  const loan = loans.body.items[0];

  const res = await api('POST', `/library/loans/${loan.id}/return`,
    { condition: 'good' }, school.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.loan.status, 'returned');
  assert.ok(res.body.loan.returned_on);

  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM book_copies WHERE id = $1`, [loan_copy(res.body.loan)]);
  assert.equal(rows[0].status, 'shelf');
});

function loan_copy(l: { copy_id: string }): string { return l.copy_id; }

test('shikastlangan kitob javonga emas, ta\'mirga tushadi', async () => {
  const loans = await api('GET', '/library/loans?status=issued', undefined, school.adminToken);
  const loan = loans.body.items[0];

  const res = await api('POST', `/library/loans/${loan.id}/return`,
    { condition: 'damaged', note: 'muqovasi yirtilgan' }, school.adminToken);
  assert.equal(res.status, 200);

  const { rows } = await pool.query<{ status: string; condition: string }>(
    `SELECT status, condition FROM book_copies WHERE id = $1`, [res.body.loan.copy_id]);
  assert.equal(rows[0].status, 'repair', 'shikastlangan kitob boshqa bolaga berilmasligi kerak');
  assert.equal(rows[0].condition, 'damaged');
});

test('ikki marta qaytarib bo\'lmaydi', async () => {
  const returned = await api('GET', '/library/loans?status=returned', undefined, school.adminToken);
  const res = await api('POST', `/library/loans/${returned.body.items[0].id}/return`,
    { condition: 'good' }, school.adminToken);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /allaqachon qaytarilgan/);
});

test("muddati o'tganlar ro'yxat boshida turadi", async () => {
  // Qolgan berilgan yozuvni o'tmishga suramiz. issued_on ni ham surish shart:
  // baza due_on >= issued_on ni talab qiladi (muddat berishdan oldin bo'lmaydi).
  await pool.query(
    `UPDATE book_loans SET issued_on = CURRENT_DATE - 20, due_on = CURRENT_DATE - 5
      WHERE school_id = $1 AND status = 'issued'`,
    [school.schoolId]);

  const res = await api('GET', '/library/loans', undefined, school.adminToken);
  assert.equal(res.body.items[0].overdue, true, 'birinchi qator muddati o\'tgan bo\'lishi kerak');
  assert.equal(res.body.items[0].days_late, 5);
  assert.equal(res.body.counts.overdue, 1);

  const only = await api('GET', '/library/loans?status=overdue', undefined, school.adminToken);
  assert.equal(only.body.items.length, 1);
});

test("yo'qolgan kitob javonga qaytmaydi", async () => {
  const loans = await api('GET', '/library/loans?status=issued', undefined, school.adminToken);
  const loan = loans.body.items[0];
  const res = await api('POST', `/library/loans/${loan.id}/lost`,
    { note: "o'quvchi yo'qotdi" }, school.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM book_copies WHERE id = $1`, [res.body.loan.copy_id]);
  assert.equal(rows[0].status, 'lost');
});

test("o'quvchi tarixi to'liq ko'rinadi", async () => {
  const res = await api('GET', `/library/students/${student2Id}/history`, undefined, school.adminToken);
  assert.equal(res.status, 200);
  assert.ok(res.body.total >= 2, `tarix: ${res.body.total}`);
  assert.ok(res.body.items[0].title);
});

test("o'quvchida kitob bor kitobni arxivlab bo'lmaydi", async () => {
  // Yangi kitob + berish
  const b = await api('POST', '/library/books', { title: 'Sinov kitobi', copies: 1 }, school.adminToken);
  await api('POST', '/library/loans', { studentId, bookId: b.body.book.id }, school.adminToken);

  const res = await api('DELETE', `/library/books/${b.body.book.id}`, undefined, school.adminToken);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /nusxasi o'quvchilarda/);
});

test('kutubxona sozlamasi: sukut muddat', async () => {
  const res = await api('GET', '/library/settings', undefined, school.adminToken);
  assert.equal(res.body.loanDays, 14);

  await pool.query(
    `UPDATE schools SET settings = settings || '{"library_loan_days": 21}' WHERE id = $1`,
    [school.schoolId]);
  const res2 = await api('GET', '/library/settings', undefined, school.adminToken);
  assert.equal(res2.body.loanDays, 21, 'muddat kodda emas, sozlamada');
});

test('boshqa maktabning kitobi ko\'rinmaydi', async () => {
  const other = await createTestSchool('test-library-b');
  try {
    const res = await api('GET', `/library/books/${bookId}`, undefined, other.adminToken);
    assert.equal(res.status, 404, 'boshqa maktab kitobini ID bilan ham ocholmaydi');

    const list = await api('GET', '/library/books', undefined, other.adminToken);
    assert.equal(list.body.items.length, 0);
  } finally {
    await dropTestSchool('test-library-b');
  }
});

// ================================================================ Excel import

/** Shablon ustunlari tartibida qator yasaydi. */
async function bookSheet(rows: Array<Array<string | number | null>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Kitoblar');
  ws.addRow(['Nomi', 'Muallif', "Bo'lim", 'Sinf', 'Til', 'Nashriyot', 'Nashr yili',
             'ISBN', 'Javon', 'Narxi', 'Nusxalar soni', 'Inventar raqamlari']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function uploadBooks(buf: Buffer, token: string) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)], { type: XLSX }), 'kitoblar.xlsx');
  const res = await fetch(`${base}/library/books/import`, {
    method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
  });
  return { status: res.status, body: (await res.json()) as any };
}

test('kitob shabloni yuklab olinadi', async () => {
  const res = await fetch(`${base}/library/books/import/template`, {
    headers: { authorization: `Bearer ${school.adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), XLSX);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  const ws = wb.getWorksheet('Kitoblar');
  assert.ok(ws, 'Kitoblar varag\'i bo\'lishi kerak');
  assert.equal(ws!.getRow(1).getCell(1).value, 'Nomi');
  assert.equal(ws!.getRow(1).getCell(12).value, 'Inventar raqamlari');
});

test('import kitob va nusxalarni yaratadi', async () => {
  const buf = await bookSheet([
    ["O'tkan kunlar", 'Abdulla Qodiriy', 'badiiy', null, "o'zbek", 'Sharq', 2020, null, 'B-1', 52000, 2, null],
    ['Matematika 5', 'Alixonov', 'darslik', 5, "o'zbek", "O'qituvchi", 2021, null, 'C-2', 30000, 1, 'MAT-5-01'],
  ]);
  const res = await uploadBooks(buf, school.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.books, 2);
  assert.equal(res.body.copies, 3);

  const list = await api('GET', '/library/books?search=Matematika', undefined, school.adminToken);
  const m = list.body.items[0];
  assert.equal(m.grade, 5);
  assert.equal(m.category, 'darslik');
  assert.equal(m.available_copies, 1);

  const one = await api('GET', `/library/books/${m.id}`, undefined, school.adminToken);
  assert.equal(one.body.copies[0].inventory_no, 'MAT-5-01', 'berilgan raqam saqlanishi kerak');
});

test("importda bitta xato bo'lsa hech narsa yozilmaydi", async () => {
  const before = await api('GET', '/library/books', undefined, school.adminToken);

  const buf = await bookSheet([
    ['Yaxshi kitob', 'Muallif', 'badiiy', null, "o'zbek", null, null, null, null, null, 1, null],
    ['Yomon kitob', 'Muallif', 'yoq-bunday-bolim', 99, 'klingon', null, null, null, null, null, 1, null],
  ]);
  const res = await uploadBooks(buf, school.adminToken);
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /hech narsa saqlanmadi/);
  const cols = res.body.errors.map((e: { column: string }) => e.column);
  assert.ok(cols.includes("Bo'lim") && cols.includes('Sinf') && cols.includes('Til'), JSON.stringify(cols));

  const after2 = await api('GET', '/library/books', undefined, school.adminToken);
  assert.equal(after2.body.total, before.body.total, "xatoli faylda 1-qator ham yozilmasligi kerak");
});

test('band inventar raqami import bosqichida ushlanadi', async () => {
  const buf = await bookSheet([
    ['Takror raqamli', null, 'boshqa', null, null, null, null, null, null, null, 1, 'MAT-5-01'],
  ]);
  const res = await uploadBooks(buf, school.adminToken);
  assert.equal(res.status, 400);
  assert.match(res.body.errors[0].message, /allaqachon bazada bor/);
});

test("qo'lda yozilgan raqam avtomatik raqam bilan to'qnashmaydi", async () => {
  // Bo'sh maktabda: 1-qator qo'lda KT-000001, 2-qator avtomatik.
  // Avtomatik hisob bazadagi eng katta raqamdan boshlanadi — ya'ni 1 dan.
  // Himoyasiz bo'lsa ikkalasi ham KT-000001 bo'lib, unique indeks 500 beradi.
  const fresh = await createTestSchool('test-lib-num');
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Kitoblar');
    ws.addRow(['Nomi', 'Muallif', "Bo'lim", 'Sinf', 'Til', 'Nashriyot', 'Nashr yili',
               'ISBN', 'Javon', 'Narxi', 'Nusxalar soni', 'Inventar raqamlari']);
    ws.addRow(["Qo'lda raqamli", null, 'boshqa', null, null, null, null, null, null, null, 1, 'KT-000001']);
    ws.addRow(['Avtomatik', null, 'boshqa', null, null, null, null, null, null, null, 1, null]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const res = await uploadBooks(buf, fresh.adminToken);
    assert.equal(res.status, 201, `500 emas, muvaffaqiyat kutilgan: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.copies, 2);

    const { rows } = await pool.query<{ inventory_no: string }>(
      `SELECT inventory_no FROM book_copies WHERE school_id = $1 ORDER BY inventory_no`,
      [fresh.schoolId],
    );
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].inventory_no, rows[1].inventory_no, 'raqamlar takrorlanmasligi kerak');
  } finally {
    await dropTestSchool('test-lib-num');
  }
});
