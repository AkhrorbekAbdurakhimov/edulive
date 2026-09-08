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
