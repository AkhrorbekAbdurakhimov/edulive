/**
 * Test fixture'lari. Har bir test fayli o'z maktab(lar)ini alohida slug bilan
 * yaratadi va oxirida o'chiradi — seed va boshqa testlarga tegilmaydi.
 * Token to'g'ridan-to'g'ri imzolanadi (HTTP login shart emas) — tez va
 * rate limiter'ga tegmaydi.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { pool } from '../db/pool.js';
import { signToken } from '../modules/auth/auth.service.js';
import type { Role } from '../types/auth.js';

export const TEST_PASSWORD = 'test_parol_123';

let cachedHash: string | null = null;
async function passwordHash(): Promise<string> {
  if (!cachedHash) cachedHash = await bcrypt.hash(TEST_PASSWORD, 4);
  return cachedHash;
}

export interface TestApi {
  (method: string, path: string, body?: unknown, token?: string, headers?: Record<string, string>): Promise<{
    status: number;
    body: Record<string, any>;
  }>;
}

export function startServer(): { server: Server; api: TestApi } {
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const api: TestApi = async (method, path, body, token, headers) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  return { server, api };
}

export interface TestSchool {
  schoolId: string;
  yearId: string;
  classId: string;
  adminId: string;
  adminToken: string;
  managerId: string;
  managerToken: string;
  teacherId: string;
  teacherToken: string;
}

async function createUser(schoolId: string | null, fullName: string, phone: string, role: Role): Promise<{ id: string; token: string }> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (school_id, full_name, phone, password_hash, role)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [schoolId, fullName, phone, await passwordHash(), role],
  );
  const id = rows[0].id;
  return { id, token: signToken({ id, school_id: schoolId, role, token_version: 0 }) };
}

/** Maktab + joriy yil + admin/menejer/o'qituvchi + bitta sinf (o'qituvchi rahbar). */
export async function createTestSchool(slug: string, opts?: { monthlyFee?: number }): Promise<TestSchool> {
  await pool.query(`DELETE FROM schools WHERE slug = $1`, [slug]);

  const schoolId = (
    await pool.query<{ id: string }>(
      `INSERT INTO schools (name, slug, tg_code, settings)
       VALUES ($1, $2, $3, '{"payment_due_day": 10}') RETURNING id`,
      [`Test ${slug}`, slug, `${slug}-tg`],
    )
  ).rows[0].id;

  const yearId = (
    await pool.query<{ id: string }>(
      `INSERT INTO academic_years (school_id, name, starts_on, ends_on, is_current)
       VALUES ($1, '2026-2027', '2026-09-01', '2027-05-31', true) RETURNING id`,
      [schoolId],
    )
  ).rows[0].id;

  const admin = await createUser(schoolId, 'Test Admin', '+998970000001', 'admin');
  const manager = await createUser(schoolId, 'Test Menejer', '+998970000002', 'manager');
  const teacher = await createUser(schoolId, "Test O'qituvchi", '+998970000003', 'teacher');

  const classId = (
    await pool.query<{ id: string }>(
      `INSERT INTO classes (school_id, academic_year_id, grade, letter, homeroom_teacher_id, monthly_fee)
       VALUES ($1, $2, 1, 'A', $3, $4) RETURNING id`,
      [schoolId, yearId, teacher.id, opts?.monthlyFee ?? 1_000_000],
    )
  ).rows[0].id;

  return {
    schoolId,
    yearId,
    classId,
    adminId: admin.id,
    adminToken: admin.token,
    managerId: manager.id,
    managerToken: manager.token,
    teacherId: teacher.id,
    teacherToken: teacher.token,
  };
}

export async function createSuperadmin(phone: string): Promise<{ id: string; token: string }> {
  await pool.query(`DELETE FROM users WHERE school_id IS NULL AND phone = $1`, [phone]);
  return createUser(null, 'Test Superadmin', phone, 'superadmin');
}

export interface TestStudent {
  studentId: string;
  enrollmentId: string;
}

export async function createTestStudent(
  school: Pick<TestSchool, 'schoolId' | 'yearId' | 'classId'>,
  lastName: string,
  firstName: string,
  opts?: { discountPercent?: number; classId?: string; parentPhone?: string },
): Promise<TestStudent> {
  const studentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO students (school_id, last_name, first_name) VALUES ($1,$2,$3) RETURNING id`,
      [school.schoolId, lastName, firstName],
    )
  ).rows[0].id;

  const enrollmentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, discount_percent)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [school.schoolId, studentId, opts?.classId ?? school.classId, school.yearId, opts?.discountPercent ?? 0],
    )
  ).rows[0].id;

  if (opts?.parentPhone) {
    const parentId = (
      await pool.query<{ id: string }>(
        `INSERT INTO parents (school_id, full_name, phone, relation)
         VALUES ($1, $2, $3, 'father')
         ON CONFLICT (school_id, phone) DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [school.schoolId, `Ota ${lastName}`, opts.parentPhone],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO student_parents (student_id, parent_id, is_primary) VALUES ($1,$2,true) ON CONFLICT DO NOTHING`,
      [studentId, parentId],
    );
  }

  return { studentId, enrollmentId };
}

export async function dropTestSchool(slug: string): Promise<void> {
  await pool.query(`DELETE FROM schools WHERE slug = $1`, [slug]);
}
