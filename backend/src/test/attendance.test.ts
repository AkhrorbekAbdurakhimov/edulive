/** Davomat: sukut 'present' (5-qoida), tasdiqlash, tahrir oynasi, audit. */
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

const SLUG = 'test-att';
const TODAY = new Date().toISOString().slice(0, 10);

let server: Server;
let api: TestApi;
let school: TestSchool;
let students: string[] = [];
let sessionId: string;

before(async () => {
  ({ server, api } = startServer());
  school = await createTestSchool(SLUG);
  students = [];
  for (let i = 0; i < 5; i++) {
    // Birinchi ikkitasida ota-ona bor — bildirishnoma testi uchun
    const s = await createTestStudent(school, `Sinov${i}`, `Bola${i}`, {
      parentPhone: i < 2 ? `+99893666000${i}` : undefined,
    });
    students.push(s.studentId);
  }
});

after(async () => {
  await dropTestSchool(SLUG);
  server?.close();
  await pool.end();
});

test("davomat: faqat kelmaganlar yuboriladi, qolgani avtomatik 'present'", async () => {
  const { status, body } = await api(
    'POST',
    '/attendance/take',
    {
      classId: school.classId,
      date: TODAY,
      marks: [
        { studentId: students[0], status: 'absent' },
        { studentId: students[1], status: 'late', minutesLate: 15 },
      ],
    },
    school.teacherToken,
  );

  assert.equal(status, 201);
  assert.equal(body.total, 5);
  assert.equal(body.present, 3, "belgilanmaganlar avtomatik 'present' bo'lishi kerak (5-qoida)");
  assert.equal(body.absent, 1);
  assert.equal(body.late, 1);
  sessionId = body.sessionId;

  const rows = await pool.query(
    `SELECT student_id, status, minutes_late FROM attendance WHERE session_id = $1`,
    [sessionId],
  );
  assert.equal(rows.rowCount, 5);
  const byStudent = new Map(rows.rows.map((r) => [r.student_id, r]));
  assert.equal(byStudent.get(students[0]).status, 'absent');
  assert.equal(byStudent.get(students[1]).status, 'late');
  assert.equal(byStudent.get(students[1]).minutes_late, 15);
  assert.equal(byStudent.get(students[2]).status, 'present');

  const audit = await pool.query(
    `SELECT 1 FROM audit_log WHERE school_id = $1 AND action = 'attendance.take' AND entity_id = $2`,
    [school.schoolId, sessionId],
  );
  assert.ok(audit.rowCount, 'attendance.take audit yozuvi topilmadi');
});

test('tasdiqlashgacha qayta olish mumkin (xatoni tuzatish)', async () => {
  const { status, body } = await api(
    'POST',
    '/attendance/take',
    { classId: school.classId, date: TODAY, marks: [{ studentId: students[0], status: 'absent' }] },
    school.teacherToken,
  );
  assert.equal(status, 201);
  assert.equal(body.sessionId, sessionId, "sessiya qayta yaratilmaydi — o'sha o'zi yangilanadi");
  assert.equal(body.present, 4);
  assert.equal(body.absent, 1);
  assert.equal(body.late, 0);
});

test("sinfda bo'lmagan o'quvchini belgilash 400", async () => {
  const other = await createTestStudent(school, 'Chetdagi', 'Bola', { classId: undefined });
  // boshqa sinf yo'q — boshqa maktab o'rniga biriktirilmagan student ishlatamiz:
  // enrollment yaratilgani uchun alohida "chet" holat sifatida boshqa sinf ochamiz
  const cls = await pool.query<{ id: string }>(
    `INSERT INTO classes (school_id, academic_year_id, grade, letter, monthly_fee)
     VALUES ($1, $2, 9, 'Z', 0) RETURNING id`,
    [school.schoolId, school.yearId],
  );
  await pool.query(`UPDATE enrollments SET class_id = $1 WHERE student_id = $2`, [cls.rows[0].id, other.studentId]);

  const { status, body } = await api(
    'POST',
    '/attendance/take',
    { classId: school.classId, date: TODAY, marks: [{ studentId: other.studentId, status: 'absent' }] },
    school.teacherToken,
  );
  assert.equal(status, 400);
  assert.match(body.error, /sinfda emas/i);
});

test("tasdiqlash: bildirishnomalar navbatga tushadi, takror tasdiqlash 409", async () => {
  const confirmed = await api('POST', `/attendance/${sessionId}/confirm`, {}, school.teacherToken);
  assert.equal(confirmed.status, 200);
  // students[0] absent va uning ota-onasi bor → kamida 1 ta bildirishnoma
  assert.equal(confirmed.body.notificationsQueued, 1);

  const queued = await pool.query(
    `SELECT kind, status FROM notifications WHERE school_id = $1 AND student_id = $2`,
    [school.schoolId, students[0]],
  );
  assert.equal(queued.rows[0].kind, 'attendance.absent');
  assert.equal(queued.rows[0].status, 'queued');

  const again = await api('POST', `/attendance/${sessionId}/confirm`, {}, school.teacherToken);
  assert.equal(again.status, 409);

  const audit = await pool.query(
    `SELECT 1 FROM audit_log WHERE school_id = $1 AND action = 'attendance.confirm' AND entity_id = $2`,
    [school.schoolId, sessionId],
  );
  assert.ok(audit.rowCount, 'attendance.confirm audit yozuvi topilmadi');
});

test("o'qituvchi tahrir oynasi ichida tuzata oladi, tashqarisida yo'q; menejer har doim", async () => {
  // Oyna ichida (hozirgina tasdiqlangan) — ruxsat bor
  const inside = await api(
    'POST',
    '/attendance/take',
    { classId: school.classId, date: TODAY, marks: [] },
    school.teacherToken,
  );
  assert.equal(inside.status, 201);

  // Oynani sun'iy yopamiz: tasdiq 4 soat oldin bo'lgan
  await pool.query(`UPDATE attendance_sessions SET confirmed_at = now() - interval '4 hours' WHERE id = $1`, [
    sessionId,
  ]);

  const outside = await api(
    'POST',
    '/attendance/take',
    { classId: school.classId, date: TODAY, marks: [] },
    school.teacherToken,
  );
  assert.equal(outside.status, 403);
  assert.match(outside.body.error, /oynasi yopilgan/i);

  // Menejer cheklanmaydi
  const byManager = await api(
    'POST',
    '/attendance/take',
    { classId: school.classId, date: TODAY, marks: [{ studentId: students[2], status: 'absent' }] },
    school.managerToken,
  );
  assert.equal(byManager.status, 201);
});

test("davomatni ko'rish va oy bo'yicha yig'ma", async () => {
  const view = await api('GET', `/attendance?classId=${school.classId}&date=${TODAY}`, undefined, school.teacherToken);
  assert.equal(view.status, 200);
  assert.equal(view.body.items.length, 5);
  assert.ok(view.body.session.confirmed_at);

  const summary = await api(
    'GET',
    `/attendance/summary?classId=${school.classId}&from=${TODAY}&to=${TODAY}`,
    undefined,
    school.teacherToken,
  );
  assert.equal(summary.status, 200);
  assert.equal(summary.body.items.length, 5);
});
