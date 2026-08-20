/** O'quvchilarni Excel orqali import qilish: shablon, muvaffaqiyatli import, xatolar. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';
import { pool } from '../db/pool.js';
import {
  createTestSchool,
  dropTestSchool,
  startServer,
  type TestApi,
  type TestSchool,
} from './helpers.js';

const SLUG = 'test-imp';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

let server: Server;
let api: TestApi;
let base: string;
let school: TestSchool;
let className: string;

before(async () => {
  ({ server, api } = startServer());
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  school = await createTestSchool(SLUG);
  const cls = await api('GET', '/classes', undefined, school.adminToken);
  className = cls.body.items[0].name;
});

after(async () => {
  await dropTestSchool(SLUG);
  server?.close();
  await pool.end();
});

/** Multipart yuborish — api() helperi faqat JSON bilan ishlaydi. */
async function upload(buf: Buffer, token: string, filename = 'oquvchilar.xlsx') {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buf)], { type: XLSX }), filename);
  const res = await fetch(`${base}/students/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** Berilgan qatorlardan xlsx yasaydi (sarlavha qatori bilan). */
async function sheetOf(rows: Array<Array<string | number | null>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Oquvchilar');
  ws.addRow([
    'Familiya', 'Ism', 'Otasining ismi', "Tug'ilgan sana", 'Jinsi', 'Sinf',
    'Chegirma %', 'Ota-ona F.I.Sh', 'Ota-ona telefoni', "Kim bo'ladi", 'Maktab ID',
  ]);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('shablon yuklab olinadi va sinflar ro\'yxati ichida bo\'ladi', async () => {
  const res = await fetch(`${base}/students/import/template`, {
    headers: { authorization: `Bearer ${school.adminToken}` },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), XLSX);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment/);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  const ws = wb.getWorksheet('Oquvchilar');
  assert.ok(ws, 'Oquvchilar varag\'i bo\'lishi kerak');
  assert.equal(ws!.getCell('A1').value, 'Familiya');
  assert.equal(ws!.getCell('F1').value, 'Sinf');

  // Sinflar tanlov ro'yxati uchun yashirin varaqda turadi
  const lookup = wb.getWorksheet('Royxat');
  assert.ok(lookup, 'Royxat varag\'i bo\'lishi kerak');
  assert.equal(lookup!.getCell('A2').value, className);
});

test('to\'g\'ri fayl: o\'quvchi, sinf va ota-ona yoziladi', async () => {
  const buf = await sheetOf([
    ['Yusupova', 'Madina', 'Anvar', '2018-03-05', 'qiz', className, 0, 'Yusupov Anvar', '+998901110011', 'ota', 'IMP-1'],
    ['Karimov', 'Alibek', null, null, "o'g'il", className, 25, 'Yusupov Anvar', '+998901110011', 'ota', 'IMP-2'],
  ]);
  const res = await upload(buf, school.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.students, 2);

  const list = await api('GET', '/students?limit=100', undefined, school.adminToken);
  const madina = list.body.items.find((s: any) => s.first_name === 'Madina');
  assert.ok(madina, 'import qilingan o\'quvchi ro\'yxatda bo\'lishi kerak');
  assert.equal(madina.class_name, className, 'sinf biriktirilishi kerak');

  const card = await api('GET', `/students/${madina.id}`, undefined, school.adminToken);
  assert.equal(card.body.parents.length, 1);
  assert.equal(card.body.parents[0].phone, '+998901110011');
  assert.equal(card.body.student.gender, 'f');

  // Aka-uka bitta ota-onaga bog'lanadi (parents.UNIQUE(school_id, phone))
  const parents = await pool.query(
    `SELECT count(*)::int AS n FROM parents WHERE school_id = $1 AND phone = '+998901110011'`,
    [school.schoolId],
  );
  assert.equal(parents.rows[0].n, 1, 'bir xil telefonli ota-ona ikki marta yaratilmasligi kerak');

  // Chegirma enrollmentga tushdi
  const alibek = list.body.items.find((s: any) => s.first_name === 'Alibek');
  const enr = await pool.query(
    `SELECT discount_percent FROM enrollments WHERE student_id = $1`, [alibek.id],
  );
  assert.equal(Number(enr.rows[0].discount_percent), 25);
});

test('xato bo\'lsa HECH NARSA yozilmaydi va qator raqami ko\'rsatiladi', async () => {
  const before = await api('GET', '/students?limit=200', undefined, school.adminToken);

  const buf = await sheetOf([
    ['Toshmatov', 'Bobur', null, null, null, className, 0, null, null, null, 'IMP-9'],  // to'g'ri
    ['X', 'Sardor', null, null, null, className, 0, null, null, null, null],            // familiya qisqa
    ['Ergashev', 'Aziz', null, '05.06.2019', null, className, 0, null, null, null, null], // sana formati
    ['Nazarov', 'Umar', null, null, null, 'YO\'Q-SINF', 0, null, null, null, null],      // sinf topilmaydi
    ['Islomov', 'Bilol', null, null, null, className, 150, null, null, null, null],      // chegirma
    ['Saidov', 'Imron', null, null, null, className, 0, 'Saidov Ota', '901234567', 'ota', null], // telefon
  ]);
  const res = await upload(buf, school.adminToken);
  assert.equal(res.status, 400);
  assert.equal(res.body.errors.length, 5, JSON.stringify(res.body.errors));

  const cols = res.body.errors.map((e: any) => e.column);
  assert.ok(cols.includes('Familiya'));
  assert.ok(cols.includes("Tug'ilgan sana"));
  assert.ok(cols.includes('Sinf'));
  assert.ok(cols.includes('Chegirma %'));
  assert.ok(cols.includes('Ota-ona telefoni'));
  // Qator raqamlari Excel bo'yicha (sarlavha 1-qator)
  assert.equal(res.body.errors[0].row, 3);

  const after2 = await api('GET', '/students?limit=200', undefined, school.adminToken);
  assert.equal(after2.body.total, before.body.total, 'xatoli faylda hech narsa yozilmasligi kerak');
});

test('takroriy Maktab ID: fayl ichida ham, bazada ham ushlanadi', async () => {
  const inFile = await sheetOf([
    ['Aliyev', 'Botir', null, null, null, null, 0, null, null, null, 'DUP-1'],
    ['Valiyev', 'Sanjar', null, null, null, null, 0, null, null, null, 'DUP-1'],
  ]);
  const r1 = await upload(inFile, school.adminToken);
  assert.equal(r1.status, 400);
  assert.match(r1.body.errors[0].message, /qatorda ham bor/);

  // Bazadagi bilan to'qnashuv (IMP-1 avvalgi testda yaratilgan)
  const inDb = await sheetOf([
    ['Aliyev', 'Botir', null, null, null, null, 0, null, null, null, 'IMP-1'],
  ]);
  const r2 = await upload(inDb, school.adminToken);
  assert.equal(r2.status, 400);
  assert.match(r2.body.errors[0].message, /allaqachon bazada bor/);
});

test('bo\'sh fayl va noto\'g\'ri format rad etiladi', async () => {
  const empty = await sheetOf([]);
  const r1 = await upload(empty, school.adminToken);
  assert.equal(r1.status, 400);
  assert.match(r1.body.error, /ma'lumot yo'q/);

  const notXlsx = Buffer.from('salom');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(notXlsx)], { type: 'text/plain' }), 'a.txt');
  const res = await fetch(`${base}/students/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${school.adminToken}` },
    body: form,
  });
  assert.equal(res.status, 400);
});

test("o'qituvchi import qila olmaydi", async () => {
  const buf = await sheetOf([['Aliyev', 'Botir', null, null, null, null, 0, null, null, null, null]]);
  const res = await upload(buf, school.teacherToken);
  assert.equal(res.status, 403);
});
