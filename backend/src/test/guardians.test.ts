/**
 * Mas'ul shaxslar: bir o'quvchida bir nechta, har birida bir nechta raqam.
 *
 * Asosiy qoida — Telegram chati RAQAMGA bog'lanadi, odamga emas. Shuning
 * uchun raqam maktab ichida noyob va har biri alohida ulanadi.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { pool } from '../db/pool.js';
import {
  createTestSchool, createTestStudent, dropTestSchool, startServer,
  type TestApi, type TestSchool,
} from './helpers.js';

const SLUG = 'test-guard';

let server: Server;
let api: TestApi;
let school: TestSchool;
let studentId: string;

before(async () => {
  ({ server, api } = startServer());
  school = await createTestSchool(SLUG);
  studentId = (await createTestStudent(school, 'Oilaviy', 'Diyor')).studentId;
});

after(async () => {
  await dropTestSchool(SLUG);
  server?.close();
  await pool.end();
});

test("o'quvchi bir yo'la ikki mas'ul shaxs bilan yaratiladi", async () => {
  const res = await api('POST', '/students', {
    lastName: 'Koʻpchilik', firstName: 'Aziz',
    guardians: [
      { fullName: 'Otasi Karimov', phones: ['901110001', '971110001'], relation: 'father' },
      { fullName: 'Onasi Karimova', phone: '901110002', relation: 'mother' },
    ],
  }, school.adminToken);
  assert.equal(res.status, 201, JSON.stringify(res.body));

  const card = await api('GET', `/students/${res.body.student.id}`, undefined, school.adminToken);
  assert.equal(card.body.parents.length, 2);

  const father = card.body.parents.find((p: any) => p.relation === 'father');
  assert.deepEqual(
    father.phones.map((x: any) => x.phone).sort(),
    ['+998901110001', '+998971110001'],
    "ikkala raqam ham saqlanishi kerak",
  );
  assert.equal(father.phones.filter((x: any) => x.isPrimary).length, 1, 'asosiy raqam bitta');
  assert.equal(father.is_primary, true, 'birinchi mas\'ul shaxs asosiy bo\'ladi');
});

test("mavjud shaxsga qo'shimcha raqam qo'shiladi", async () => {
  const add = await api('POST', `/students/${studentId}/parents`, {
    fullName: 'Yolgʻiz Ota', phone: '901110010', relation: 'father',
  }, school.adminToken);
  assert.equal(add.status, 201, JSON.stringify(add.body));

  const more = await api('POST', `/students/parents/${add.body.parentId}/phones`,
    { phone: '971110010' }, school.adminToken);
  assert.equal(more.status, 201, JSON.stringify(more.body));

  const card = await api('GET', `/students/${studentId}`, undefined, school.adminToken);
  const g = card.body.parents.find((p: any) => p.id === add.body.parentId);
  assert.equal(g.phones.length, 2);
  assert.equal(g.phones.filter((x: any) => x.isPrimary).length, 1);
});

test("boshqa shaxsga tegishli raqam qo'shib bo'lmaydi", async () => {
  // Aks holda xabar noto'g'ri odamga ketardi.
  const other = await api('POST', `/students/${studentId}/parents`, {
    fullName: 'Ikkinchi Vasiy', phone: '901110020', relation: 'guardian',
  }, school.adminToken);
  assert.equal(other.status, 201);

  const clash = await api('POST', `/students/parents/${other.body.parentId}/phones`,
    { phone: '901110010' }, school.adminToken);
  assert.equal(clash.status, 409, JSON.stringify(clash.body));
  assert.match(clash.body.error, /boshqa mas'ul shaxsga/);
});

test('bir xil raqam bilan kiritilsa yangi odam yaratilmaydi', async () => {
  // Aka-uka: ikkalasi bitta otaga bog'lanishi kerak.
  const brother = await createTestStudent(school, 'Oilaviy', 'Sardor');
  const res = await api('POST', `/students/${brother.studentId}/parents`, {
    fullName: 'Yolgʻiz Ota', phone: '901110010', relation: 'father',
  }, school.adminToken);
  assert.equal(res.status, 201);

  const { rows } = await pool.query<{ n: number }>(
    `SELECT count(DISTINCT parent_id)::int AS n FROM parent_phones
      WHERE school_id = $1 AND phone = '+998901110010'`,
    [school.schoolId],
  );
  assert.equal(rows[0].n, 1, 'bitta odam bo\'lishi kerak');
});

test("oxirgi raqamni o'chirib bo'lmaydi", async () => {
  const card = await api('GET', `/students/${studentId}`, undefined, school.adminToken);
  const single = card.body.parents.find((p: any) => p.phones.length === 1);
  assert.ok(single, 'bitta raqamli shaxs bo\'lishi kerak');

  const res = await api('DELETE',
    `/students/parents/${single.id}/phones/${single.phones[0].id}`, undefined, school.adminToken);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Oxirgi raqamni/);
});

test("asosiy raqam o'chsa, boshqasi asosiy bo'ladi", async () => {
  const card = await api('GET', `/students/${studentId}`, undefined, school.adminToken);
  const two = card.body.parents.find((p: any) => p.phones.length === 2);
  const primary = two.phones.find((x: any) => x.isPrimary);

  const res = await api('DELETE',
    `/students/parents/${two.id}/phones/${primary.id}`, undefined, school.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const after2 = await api('GET', `/students/${studentId}`, undefined, school.adminToken);
  const g = after2.body.parents.find((p: any) => p.id === two.id);
  assert.equal(g.phones.length, 1);
  assert.equal(g.phones[0].isPrimary, true, 'asosiz qolmasligi kerak');
});

test("mas'ul shaxs o'quvchidan uziladi", async () => {
  const card = await api('GET', `/students/${studentId}`, undefined, school.adminToken);
  const before = card.body.parents.length;
  const victim = card.body.parents[card.body.parents.length - 1];

  const res = await api('DELETE', `/students/${studentId}/parents/${victim.id}`,
    undefined, school.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const after2 = await api('GET', `/students/${studentId}`, undefined, school.adminToken);
  assert.equal(after2.body.parents.length, before - 1);
});

test('xabarni raqam darajasida o\'chirish mumkin', async () => {
  const card = await api('GET', `/students/${studentId}`, undefined, school.adminToken);
  const g = card.body.parents[0];
  const phone = g.phones[0];

  const res = await api('PATCH', `/students/parents/${g.id}/phones/${phone.id}`,
    { notifyEnabled: false }, school.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const after2 = await api('GET', `/students/${studentId}`, undefined, school.adminToken);
  const same = after2.body.parents.find((p: any) => p.id === g.id)
    .phones.find((x: any) => x.id === phone.id);
  assert.equal(same.notifyEnabled, false);
});

test('boshqa maktabning mas\'ul shaxsiga tegib bo\'lmaydi', async () => {
  const other = await createTestSchool('test-guard-b');
  try {
    const card = await api('GET', `/students/${studentId}`, undefined, school.adminToken);
    const g = card.body.parents[0];
    const res = await api('POST', `/students/parents/${g.id}/phones`,
      { phone: '901119999' }, other.adminToken);
    assert.equal(res.status, 404, 'boshqa maktab ko\'rmasligi kerak');
  } finally {
    await dropTestSchool('test-guard-b');
  }
});

test("mas'ul shaxs tahrirlanadi: ism, qarindoshlik va asosiyligi", async () => {
  const st = await createTestStudent(school, 'Tahrir', 'Sinovi');
  await api('POST', `/students/${st.studentId}/parents`,
    { fullName: 'Eski Ism', phone: '+998901110051', relation: 'father', isPrimary: true },
    school.adminToken);
  await api('POST', `/students/${st.studentId}/parents`,
    { fullName: 'Onasi Ismi', phone: '+998901110052', relation: 'mother' },
    school.adminToken);

  const before = await api('GET', `/students/${st.studentId}`, undefined, school.adminToken);
  const father = before.body.parents.find((p: { full_name: string }) => p.full_name === 'Eski Ism');
  const mother = before.body.parents.find((p: { full_name: string }) => p.full_name === 'Onasi Ismi');
  assert.equal(father.is_primary, true);

  // Ism va qarindoshlik o'zgaradi
  const res = await api('PATCH', `/students/${st.studentId}/parents/${father.id}`,
    { fullName: 'Yangi Ism', relation: 'guardian' }, school.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.parent.full_name, 'Yangi Ism');
  assert.equal(res.body.parent.relation, 'guardian');
  assert.equal(res.body.children, 1, 'nechta farzandga biriktirilgani qaytadi');

  // Asosiylik boshqasiga o'tadi va eskisidan tushadi
  const swap = await api('PATCH', `/students/${st.studentId}/parents/${mother.id}`,
    { isPrimary: true }, school.adminToken);
  assert.equal(swap.status, 200, JSON.stringify(swap.body));

  const after = await api('GET', `/students/${st.studentId}`, undefined, school.adminToken);
  const byId = (id: string) => after.body.parents.find((p: { id: string }) => p.id === id);
  assert.equal(byId(mother.id).is_primary, true);
  assert.equal(byId(father.id).is_primary, false, 'asosiy bitta bo\'lishi kerak');
  assert.equal(byId(father.id).full_name, 'Yangi Ism');
  // Raqamlar tegilmaydi
  assert.equal(byId(father.id).phones.length, 1);
  assert.equal(byId(father.id).phones[0].phone, '+998901110051');

  const { rows } = await pool.query(
    `SELECT 1 FROM audit_log WHERE school_id = $1 AND action = 'guardian.update' AND entity_id = $2`,
    [school.schoolId, st.studentId]);
  assert.equal(rows.length, 2, 'har tahrir audit jurnaliga tushadi');
});

test("boshqa maktabning mas'ul shaxsi tahrirlanmaydi", async () => {
  const other = await createTestSchool('test-guardians-b');
  try {
    const st = await createTestStudent(school, 'Chegara', 'Sinovi');
    await api('POST', `/students/${st.studentId}/parents`,
      { fullName: 'Begona Ota', phone: '+998901110053', relation: 'father' }, school.adminToken);
    const card = await api('GET', `/students/${st.studentId}`, undefined, school.adminToken);
    const parentId = card.body.parents[0].id;

    const res = await api('PATCH', `/students/${st.studentId}/parents/${parentId}`,
      { fullName: 'Buzilgan Ism' }, other.adminToken);
    assert.equal(res.status, 404, JSON.stringify(res.body));
  } finally {
    await dropTestSchool('test-guardians-b');
  }
});

test("raqam o'zgarsa Telegram ulanishi darhol uziladi", async () => {
  const st = await createTestStudent(school, 'Raqam', 'Sinovi');
  await api('POST', `/students/${st.studentId}/parents`,
    { fullName: 'Ulangan Ota', phone: '+998901110061', relation: 'father' }, school.adminToken);

  const card = await api('GET', `/students/${st.studentId}`, undefined, school.adminToken);
  const parent = card.body.parents[0];
  const phone = parent.phones[0];

  // Ota-ona botga ulangan va farzandini tasdiqlagan holat.
  await pool.query(
    `UPDATE parent_phones
        SET telegram_chat_id = 82000001, telegram_verified_at = now()
      WHERE id = $1`,
    [phone.id]);

  const res = await api('PATCH', `/students/parents/${parent.id}/phones/${phone.id}`,
    { phone: '+998901110062' }, school.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.telegramUnlinked, true, 'interfeys ogohlantira olishi kerak');

  const { rows } = await pool.query<{
    phone: string; chat: string | null; verified: string | null; notify: boolean;
  }>(
    `SELECT phone, telegram_chat_id::text AS chat, telegram_verified_at::text AS verified,
            notify_enabled AS notify
       FROM parent_phones WHERE id = $1`,
    [phone.id]);
  assert.equal(rows[0].phone, '+998901110062');
  assert.equal(rows[0].chat, null, 'eski chat uzilishi kerak');
  assert.equal(rows[0].verified, null, 'tasdiq ham bekor bo\'ladi');
  assert.equal(rows[0].notify, true, 'xabar sozlamasi tegilmaydi \u2014 qayta ulansa ishlaydi');

  // Kartochkada holat "ulanmagan" bo'lib ko'rinadi.
  const after = await api('GET', `/students/${st.studentId}`, undefined, school.adminToken);
  const ph = after.body.parents[0].phones[0];
  assert.equal(ph.telegramState, 'none');
  assert.equal(ph.telegramLinked, false);

  const { rows: log } = await pool.query(
    `SELECT 1 FROM audit_log WHERE school_id = $1 AND action = 'guardian.phone.change'`,
    [school.schoolId]);
  assert.equal(log.length, 1, 'raqam o\'zgarishi audit jurnaliga tushadi');
});

test("band raqamga o'zgartirib bo'lmaydi", async () => {
  const st = await createTestStudent(school, 'Band', 'Raqam');
  await api('POST', `/students/${st.studentId}/parents`,
    { fullName: 'Birinchi Ota', phone: '+998901110071', relation: 'father' }, school.adminToken);
  await api('POST', `/students/${st.studentId}/parents`,
    { fullName: 'Ikkinchi Ona', phone: '+998901110072', relation: 'mother' }, school.adminToken);

  const card = await api('GET', `/students/${st.studentId}`, undefined, school.adminToken);
  const first = card.body.parents.find((p: { full_name: string }) => p.full_name === 'Birinchi Ota');

  const res = await api('PATCH', `/students/parents/${first.id}/phones/${first.phones[0].id}`,
    { phone: '+998901110072' }, school.adminToken);
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.match(res.body.error, /allaqachon ro'yxatda/);

  // Rad etilgan o'zgarish eski raqamni buzmaydi.
  const { rows } = await pool.query<{ phone: string }>(
    `SELECT phone FROM parent_phones WHERE id = $1`, [first.phones[0].id]);
  assert.equal(rows[0].phone, '+998901110071');
});
