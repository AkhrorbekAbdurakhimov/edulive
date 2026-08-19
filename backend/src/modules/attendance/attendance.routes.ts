import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { audit } from '../audit/audit.service.js';
import { getCurrentYear } from '../schools/schools.service.js';
import { assertClassAccess } from '../classes/classes.service.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { parse, uuidParam } from '../../utils/validate.js';

export const attendanceRoutes = Router();
attendanceRoutes.use(requireTenant, requireRole('admin', 'manager', 'teacher'));

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD');

// ---------------------------------------------------------------- olish
// 5-QOIDA: sukut holati 'present'. API faqat kelmagan/kechikkanlar ro'yxatini
// qabul qiladi — qolgan hamma avtomatik "keldi" bo'ladi.
const takeSchema = z.object({
  classId: z.string().uuid("classId formati noto'g'ri"),
  date: dateStr.optional(),
  marks: z
    .array(
      z.object({
        studentId: z.string().uuid("studentId formati noto'g'ri"),
        status: z.enum(['absent', 'late'], {
          errorMap: () => ({ message: "Holat absent yoki late bo'lishi kerak (present yuborilmaydi)" }),
        }),
        minutesLate: z.number().int().min(0).optional(),
        reason: z.string().optional(),
      }),
    )
    .default([]),
});

attendanceRoutes.post(
  '/take',
  ah(async (req, res) => {
    const input = parse(takeSchema, req.body);
    const onDate = input.date ?? new Date().toISOString().slice(0, 10);
    await assertClassAccess(req.user!, req.schoolId!, input.classId);

    const result = await tx(async (client) => {
      const year = await getCurrentYear(req.schoolId!, client);

      const cls = await client.query(
        `SELECT 1 FROM classes WHERE id = $1 AND school_id = $2 AND academic_year_id = $3`,
        [input.classId, req.schoolId, year.id],
      );
      if (!cls.rowCount) throw notFound('Sinf topilmadi');

      const students = await client.query<{ id: string }>(
        `SELECT s.id
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
          WHERE e.class_id = $1 AND e.school_id = $2 AND e.ends_on IS NULL AND s.status = 'active'`,
        [input.classId, req.schoolId],
      );
      if (!students.rowCount) throw badRequest("Sinfda faol o'quvchi yo'q");

      const studentIds = new Set(students.rows.map((r) => r.id));
      for (const m of input.marks) {
        if (!studentIds.has(m.studentId)) throw badRequest("Belgilangan o'quvchi bu sinfda emas");
      }

      // Mavjud sessiya — qayta olish (tahrir); yo'q bo'lsa yangi.
      const existing = await client.query(
        `SELECT id, confirmed_at, created_at FROM attendance_sessions
          WHERE class_id = $1 AND on_date = $2 AND lesson_id IS NULL AND school_id = $3
          FOR UPDATE`,
        [input.classId, onDate, req.schoolId],
      );

      let sessionId: string;
      const isUpdate = !!existing.rowCount;

      if (isUpdate) {
        const s = existing.rows[0];
        // O'qituvchi tasdiqlangan davomatni faqat tahrir oynasi ichida o'zgartira oladi;
        // admin/menejer cheklanmaydi.
        if (s.confirmed_at && req.user!.role === 'teacher') {
          const deadline = new Date(s.confirmed_at).getTime() + env.attendanceEditWindowHours * 3_600_000;
          if (Date.now() > deadline) {
            throw forbidden(`Tahrir oynasi yopilgan (${env.attendanceEditWindowHours} soat). Menejerga murojaat qiling`);
          }
        }
        sessionId = s.id;
        await client.query(`DELETE FROM attendance WHERE session_id = $1 AND school_id = $2`, [
          sessionId,
          req.schoolId,
        ]);
      } else {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO attendance_sessions (school_id, class_id, on_date, taken_by)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [req.schoolId, input.classId, onDate, req.user!.id],
        );
        sessionId = rows[0].id;
      }

      const markByStudent = new Map(input.marks.map((m) => [m.studentId, m]));
      for (const { id: studentId } of students.rows) {
        const mark = markByStudent.get(studentId);
        await client.query(
          `INSERT INTO attendance
             (school_id, session_id, student_id, class_id, on_date, status, minutes_late, reason, reason_status, taken_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            req.schoolId,
            sessionId,
            studentId,
            input.classId,
            onDate,
            mark?.status ?? 'present',
            mark?.status === 'late' ? mark.minutesLate ?? null : null,
            mark?.reason ?? null,
            mark?.reason ? 'pending' : 'none',
            req.user!.id,
          ],
        );
      }

      const total = students.rowCount!;
      const absent = input.marks.filter((m) => m.status === 'absent').length;
      const late = input.marks.filter((m) => m.status === 'late').length;
      const present = total - absent - late;

      await client.query(
        `UPDATE attendance_sessions
            SET total_count = $2, present_count = $3, absent_count = $4, late_count = $5, taken_by = $6
          WHERE id = $1`,
        [sessionId, total, present, absent, late, req.user!.id],
      );

      await audit(
        req,
        {
          action: isUpdate ? 'attendance.update' : 'attendance.take',
          entity: 'attendance_session',
          entityId: sessionId,
          after: { classId: input.classId, date: onDate, total, present, absent, late },
        },
        client,
      );

      return { sessionId, total, present, absent, late };
    });

    res.status(201).json(result);
  }),
);

// ---------------------------------------------------------------- tasdiqlash
// Tasdiqlanmaguncha ota-onaga hech narsa ketmaydi (android oflayn-first bilan mos).
attendanceRoutes.post(
  '/:id/confirm',
  ah(async (req, res) => {
    const sessionId = uuidParam(req);

    const result = await tx(async (client) => {
      const { rows } = await client.query(
        `SELECT id, class_id, on_date, confirmed_at FROM attendance_sessions
          WHERE id = $1 AND school_id = $2 FOR UPDATE`,
        [sessionId, req.schoolId],
      );
      const session = rows[0];
      if (!session) throw notFound('Davomat sessiyasi topilmadi');
      if (session.confirmed_at) throw conflict('Davomat allaqachon tasdiqlangan');

      await assertClassAccess(req.user!, req.schoolId!, session.class_id);

      await client.query(`UPDATE attendance_sessions SET confirmed_at = now() WHERE id = $1`, [sessionId]);

      // Kelmagan/kechikkanlarning ota-onalariga bildirishnoma navbatga qo'yiladi.
      // Yagona engine (A4): kanal — parametr, yuborishni worker bajaradi.
      const queued = await client.query(
        `INSERT INTO notifications (school_id, parent_id, student_id, kind, payload, body)
         SELECT $1, p.id, a.student_id,
                'attendance.' || a.status,
                jsonb_build_object('date', a.on_date, 'status', a.status, 'minutesLate', a.minutes_late),
                s.first_name || CASE a.status
                  WHEN 'absent' THEN ' bugun darsga kelmadi'
                  ELSE ' bugun darsga ' || COALESCE(a.minutes_late::text || ' daqiqa ', '') || 'kechikdi'
                END
           FROM attendance a
           JOIN students s ON s.id = a.student_id
           JOIN student_parents sp ON sp.student_id = a.student_id
           JOIN parents p ON p.id = sp.parent_id AND p.notify_enabled AND p.school_id = $1
          WHERE a.session_id = $2 AND a.school_id = $1 AND a.status <> 'present'
         RETURNING id`,
        [req.schoolId, sessionId],
      );

      await audit(
        req,
        {
          action: 'attendance.confirm',
          entity: 'attendance_session',
          entityId: sessionId,
          after: { date: session.on_date, notificationsQueued: queued.rowCount },
        },
        client,
      );

      return { ok: true, notificationsQueued: queued.rowCount };
    });

    res.json(result);
  }),
);

// ---------------------------------------------------------------- ko'rish
attendanceRoutes.get(
  '/',
  ah(async (req, res) => {
    const query = parse(
      z.object({ classId: z.string().uuid("classId formati noto'g'ri"), date: dateStr }),
      req.query,
    );
    await assertClassAccess(req.user!, req.schoolId!, query.classId);

    const session = await pool.query(
      `SELECT id, on_date, confirmed_at, total_count, present_count, absent_count, late_count, taken_by
         FROM attendance_sessions
        WHERE class_id = $1 AND on_date = $2 AND lesson_id IS NULL AND school_id = $3`,
      [query.classId, query.date, req.schoolId],
    );
    if (!session.rows[0]) {
      res.json({ session: null, items: [] });
      return;
    }

    const items = await pool.query(
      `SELECT a.student_id, s.last_name, s.first_name, a.status, a.minutes_late, a.reason, a.reason_status
         FROM attendance a
         JOIN students s ON s.id = a.student_id
        WHERE a.session_id = $1 AND a.school_id = $2
        ORDER BY s.last_name, s.first_name`,
      [session.rows[0].id, req.schoolId],
    );

    res.json({ session: session.rows[0], items: items.rows });
  }),
);

// Oy bo'yicha o'quvchi kesimida yig'ma (jurnal ko'rinishi uchun)
attendanceRoutes.get(
  '/summary',
  ah(async (req, res) => {
    const query = parse(
      z.object({ classId: z.string().uuid("classId formati noto'g'ri"), from: dateStr, to: dateStr }),
      req.query,
    );
    await assertClassAccess(req.user!, req.schoolId!, query.classId);

    const { rows } = await pool.query(
      `SELECT a.student_id, s.last_name, s.first_name,
              count(*) FILTER (WHERE a.status = 'present')::int AS present,
              count(*) FILTER (WHERE a.status = 'absent')::int  AS absent,
              count(*) FILTER (WHERE a.status = 'late')::int    AS late
         FROM attendance a
         JOIN students s ON s.id = a.student_id
        WHERE a.class_id = $1 AND a.school_id = $2 AND a.on_date BETWEEN $3 AND $4
        GROUP BY a.student_id, s.last_name, s.first_name
        ORDER BY s.last_name, s.first_name`,
      [query.classId, req.schoolId, query.from, query.to],
    );
    res.json({ items: rows });
  }),
);
