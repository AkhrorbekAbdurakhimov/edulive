/** O'quvchilar va sinflar moduli. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { pool } from '../db/pool.js';
import { createTestSchool, dropTestSchool, startServer, type TestApi, type TestSchool } from './helpers.js';

const SLUG = 'test-stu';

let server: Server;
let api: TestApi;
let school: TestSchool;

before(async () => {
  ({ server, api } = startServer());
  school = await createTestSchool(SLUG);
});

after(async () => {
  await dropTestSchool(SLUG);
  server?.close();
  await pool.end();
});

test('sinf yaratish, takrori 409', async () => {
  const created = await api(
    'POST',
    '/classes',
    { grade: 2, letter: 'B', monthlyFee: 1_200_000, homeroomTeacherId: school.teacherId },
    school.adminToken,
  );
  assert.equal(created.status, 201);

  const dup = await api('POST', '/classes', { grade: 2, letter: 'B', monthlyFee: 1 }, school.adminToken);
  assert.equal(dup.status, 409);

  const list = await api('GET', '/classes', undefined, school.adminToken);
  assert.equal(list.body.items.length, 2); // helper'dagi 1-A + yangi 2-B
});

test("o'quvchi sinf va ota-ona bilan yaratiladi, kartada hammasi ko'rinadi", async () => {
  const created = await api(
    'POST',
    '/students',
    {
      lastName: 'Karimov',
      firstName: 'Alibek',
      birthDate: '2019-03-15',
      gender: 'm',
      classId: school.classId,
      discountPercent: 25,
      discountReason: 'Grant',
      parent: { fullName: 'Baxtiyor Karimov', phone: '+998935551234', relation: 'father' },
    },
    school.adminToken,
  );
  assert.equal(created.status, 201);
  const id = created.body.student.id;

  const card = await api('GET', `/students/${id}`, undefined, school.adminToken);
  assert.equal(card.status, 200);
  assert.equal(card.body.student.class_id, school.classId);
  assert.equal(card.body.student.discount_percent, 25);
  assert.equal(card.body.parents.length, 1);
  assert.equal(card.body.parents[0].phone, '+998935551234');
  assert.equal(card.body.finance.outstanding, 0);

  // Qidiruv ishlaydi
  const found = await api('GET', '/students?q=karimov', undefined, school.adminToken);
  assert.ok(found.body.items.some((s: any) => s.id === id));
});

test("chegirma o'zgarishi auditga yoziladi (moliyaviy o'zgarish)", async () => {
  const created = await api(
    'POST',
    '/students',
    { lastName: 'Rahimov', firstName: 'Yusuf', classId: school.classId },
    school.adminToken,
  );
  const id = created.body.student.id;

  const patched = await api(
    'PATCH',
    `/students/${id}/enrollment`,
    { discountPercent: 50, discountReason: 'Grant' },
    school.adminToken,
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.body.enrollment.discount_percent, 50);

  const audit = await pool.query(
    `SELECT 1 FROM audit_log
      WHERE school_id = $1 AND action = 'enrollment.update' AND entity_id = $2`,
    [school.schoolId, patched.body.enrollment.id],
  );
  assert.ok(audit.rowCount, 'enrollment.update audit yozuvi topilmadi');
});

test("arxivlash: status o'zgaradi, biriktirish yopiladi, ro'yxatdan chiqadi", async () => {
  const created = await api(
    'POST',
    '/students',
    { lastName: 'Toshmatov', firstName: 'Umar', classId: school.classId },
    school.adminToken,
  );
  const id = created.body.student.id;

  const archived = await api('POST', `/students/${id}/archive`, { reason: "Ko'chib ketdi" }, school.adminToken);
  assert.equal(archived.status, 200);

  const enrollment = await pool.query(
    `SELECT ends_on FROM enrollments WHERE student_id = $1 AND school_id = $2`,
    [id, school.schoolId],
  );
  assert.ok(enrollment.rows[0].ends_on, "biriktirish yopilishi kerak (ends_on)");

  const activeList = await api('GET', '/students', undefined, school.adminToken);
  assert.ok(!activeList.body.items.some((s: any) => s.id === id));

  const archivedList = await api('GET', '/students?status=archived', undefined, school.adminToken);
  assert.ok(archivedList.body.items.some((s: any) => s.id === id));

  // Takror arxivlash 409
  const again = await api('POST', `/students/${id}/archive`, {}, school.adminToken);
  assert.equal(again.status, 409);
});

test("o'qituvchi umumiy ro'yxatni ololmaydi, o'z sinfini oladi", async () => {
  const all = await api('GET', '/students', undefined, school.teacherToken);
  assert.equal(all.status, 403);

  const own = await api('GET', `/students?classId=${school.classId}`, undefined, school.teacherToken);
  assert.equal(own.status, 200);
});

test("noto'g'ri UUID 500 emas, 400 qaytaradi", async () => {
  const { status } = await api('GET', '/students/emas-uuid', undefined, school.adminToken);
  assert.equal(status, 400);
});
