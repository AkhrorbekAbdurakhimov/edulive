/** O'quvchilarni Excel orqali import qilish: shablon, muvaffaqiyatli import, xatolar. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';
import { COLUMNS } from '../modules/students/students.import.js';
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
/**
 * Qatorni NOM bo'yicha yasaydi.
 *
 * Pozitsion massiv ishlatilsa, shablonga ustun qo'shilishi bilan hamma
 * testni qayta yozish kerak bo'lardi — bir marta shunday bo'lgan ham.
 */
interface RowSpec {
  last?: string | null; first?: string | null; middle?: string | null;
  birth?: string | null; gender?: string | null; cls?: string | null;
  discount?: number | null;
  g1?: string | null; g1phone?: string | number | null; g1extra?: string | number | null; g1rel?: string | null;
  g2?: string | null; g2phone?: string | number | null; g2extra?: string | number | null; g2rel?: string | null;
  ext?: string | null;
}

function row(s: RowSpec): Array<string | number | null> {
  return [
    s.last ?? null, s.first ?? null, s.middle ?? null, s.birth ?? null,
    s.gender ?? null, s.cls ?? null, s.discount ?? 0,
    s.g1 ?? null, s.g1phone ?? null, s.g1extra ?? null, s.g1rel ?? null,
    s.g2 ?? null, s.g2phone ?? null, s.g2extra ?? null, s.g2rel ?? null,
    s.ext ?? null,
  ];
}

async function sheetOf(rows: Array<Array<string | number | null>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Oquvchilar');
  // Sarlavha modul ta'rifidan olinadi — test va shablon bir-biridan ajralmasin.
  ws.addRow(COLUMNS.map((c) => c.header));
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
    row({ last: 'Yusupova', first: 'Madina', middle: 'Anvar', birth: '2018-03-05', gender: 'qiz',
          cls: className, g1: 'Yusupov Anvar', g1phone: '+998901110011', g1rel: 'ota', ext: 'IMP-1' }),
    row({ last: 'Karimov', first: 'Alibek', gender: "o'g'il", cls: className, discount: 25,
          g1: 'Yusupov Anvar', g1phone: '+998901110011', g1rel: 'ota', ext: 'IMP-2' }),
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
  // Raqamlar endi ro'yxat: bitta odamda bir nechta bo'lishi mumkin.
  assert.deepEqual(
    card.body.parents[0].phones.map((x: { phone: string }) => x.phone),
    ['+998901110011'],
  );
  assert.equal(card.body.student.gender, 'f');

  // Aka-uka bitta mas'ul shaxsga bog'lanadi (parent_phones.UNIQUE(school_id, phone))
  const parents = await pool.query(
    `SELECT count(DISTINCT parent_id)::int AS n FROM parent_phones
      WHERE school_id = $1 AND phone = '+998901110011'`,
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
    row({ last: 'Toshmatov', first: 'Bobur', cls: className, ext: 'IMP-9' }),           // to'g'ri
    row({ last: 'X', first: 'Sardor', cls: className }),                                // familiya qisqa
    row({ last: 'Ergashev', first: 'Aziz', birth: '05.06.2019', cls: className }),       // sana formati
    row({ last: 'Nazarov', first: 'Umar', cls: "YO'Q-SINF" }),                           // sinf topilmaydi
    row({ last: 'Islomov', first: 'Bilol', cls: className, discount: 150 }),             // chegirma
    row({ last: 'Saidov', first: 'Imron', cls: className, g1: 'Saidov Ota', g1phone: '12-34', g1rel: 'ota' }), // telefon
  ]);
  const res = await upload(buf, school.adminToken);
  assert.equal(res.status, 400);
  assert.equal(res.body.errors.length, 5, JSON.stringify(res.body.errors));

  const cols = res.body.errors.map((e: any) => e.column);
  assert.ok(cols.includes('Familiya'));
  assert.ok(cols.includes("Tug'ilgan sana"));
  assert.ok(cols.includes('Sinf'));
  assert.ok(cols.includes('Chegirma %'));
  assert.ok(cols.includes("1-mas'ul telefoni"), JSON.stringify(cols));
  // Qator raqamlari Excel bo'yicha (sarlavha 1-qator)
  assert.equal(res.body.errors[0].row, 3);

  const after2 = await api('GET', '/students?limit=200', undefined, school.adminToken);
  assert.equal(after2.body.total, before.body.total, 'xatoli faylda hech narsa yozilmasligi kerak');
});

test('takroriy Maktab ID: fayl ichida ham, bazada ham ushlanadi', async () => {
  const inFile = await sheetOf([
    row({ last: 'Aliyev', first: 'Botir', ext: 'DUP-1' }),
    row({ last: 'Valiyev', first: 'Sanjar', ext: 'DUP-1' }),
  ]);
  const r1 = await upload(inFile, school.adminToken);
  assert.equal(r1.status, 400);
  assert.match(r1.body.errors[0].message, /qatorda ham bor/);

  // Bazadagi bilan to'qnashuv (IMP-1 avvalgi testda yaratilgan)
  const inDb = await sheetOf([
    row({ last: 'Aliyev', first: 'Botir', ext: 'IMP-1' }),
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

// ============================================ telefon raqam ko'rinishlari

test("telefon '+' siz ham qabul qilinadi va yagona ko'rinishda saqlanadi", async () => {
  // Excelda "+" bilan boshlangan katak formula deb qabul qilinadi — shuning
  // uchun maktablar raqamni "+" siz yozadi. Hamma ko'rinish bir xil saqlansin.
  const buf = await sheetOf([
    row({ last: 'Telefonov', first: 'Birinchi', cls: className, g1: 'Ota Bir', g1phone: '998901110001', g1rel: 'ota' }),
    row({ last: 'Telefonov', first: 'Ikkinchi', cls: className, g1: 'Ota Ikki', g1phone: '901110002', g1rel: 'ota' }),
    row({ last: 'Telefonov', first: 'Uchinchi', cls: className, g1: 'Ota Uch', g1phone: '+998 90 111 00 03', g1rel: 'ota' }),
    row({ last: 'Telefonov', first: "To'rtinchi", cls: className, g1: "Ota To'rt", g1phone: '(90) 111-00-04', g1rel: 'ota' }),
  ]);
  const res = await upload(buf, school.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.parents, 4);

  const { rows } = await pool.query<{ phone: string }>(
    `SELECT pp.phone FROM parent_phones pp
       JOIN parents p ON p.id = pp.parent_id
      WHERE pp.school_id = $1 AND p.full_name LIKE 'Ota %' ORDER BY pp.phone`,
    [school.schoolId],
  );
  assert.deepEqual(rows.map((r) => r.phone), [
    '+998901110001', '+998901110002', '+998901110003', '+998901110004',
  ], 'hammasi +998XXXXXXXXX ko\'rinishida bo\'lishi kerak');
});

test("yaroqsiz raqam tushunarli xato beradi", async () => {
  const buf = await sheetOf([
    row({ last: 'Telefonov', first: 'Xato', cls: className, g1: 'Ota Xato', g1phone: '12345', g1rel: 'ota' }),
  ]);
  const res = await upload(buf, school.adminToken);
  assert.equal(res.status, 400);
  assert.equal(res.body.errors[0].column, "1-mas'ul telefoni");
  assert.match(res.body.errors[0].message, /901234567/, res.body.errors[0].message);
});

test("import ikkita mas'ul shaxs va qo'shimcha raqamlarni oladi", async () => {
  const buf = await sheetOf([
    row({
      last: 'Ikkilamchi', first: 'Nodir', cls: className,
      g1: 'Nodirov Ota', g1phone: 998901112221, g1extra: 998971112221, g1rel: 'ota',
      g2: 'Nodirova Ona', g2phone: 901112222, g2rel: 'ona',
    }),
  ]);
  const res = await upload(buf, school.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.parents, 2, 'ikkala mas\'ul shaxs ham yozilishi kerak');

  const list = await api('GET', '/students?q=Ikkilamchi', undefined, school.adminToken);
  const card = await api('GET', `/students/${list.body.items[0].id}`, undefined, school.adminToken);
  assert.equal(card.body.parents.length, 2);

  const father = card.body.parents.find((p: any) => p.relation === 'father');
  assert.deepEqual(
    father.phones.map((x: any) => x.phone).sort(),
    ['+998901112221', '+998971112221'],
    "qo'shimcha raqam ham olinishi kerak",
  );
  const mother = card.body.parents.find((p: any) => p.relation === 'mother');
  assert.equal(mother.phones.length, 1);
});

test("ikkala mas'ulda bir xil raqam bo'lsa xato beriladi", async () => {
  // Jimgina birlashtirilsa "kim bo'ladi" chalkashardi.
  const buf = await sheetOf([
    row({
      last: 'Takror', first: 'Raqam', cls: className,
      g1: 'Birinchi Ota', g1phone: '901113331', g1rel: 'ota',
      g2: 'Ikkinchi Ona', g2phone: '901113331', g2rel: 'ona',
    }),
  ]);
  const res = await upload(buf, school.adminToken);
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.errors[0].message, /1-mas'ul shaxsda ham bor/);
});
