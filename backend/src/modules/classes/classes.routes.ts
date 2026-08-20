import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { audit } from '../audit/audit.service.js';
import { getCurrentYear } from '../schools/schools.service.js';
import { assertClassAccess, teacherClassIds } from './classes.service.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { parse, uuidParam } from '../../utils/validate.js';

export const classesRoutes = Router();
classesRoutes.use(requireTenant);

classesRoutes.get(
  '/',
  requireRole('admin', 'manager', 'teacher'),
  ah(async (req, res) => {
    const yearId = req.query.yearId
      ? parse(z.string().uuid("yearId formati noto'g'ri"), req.query.yearId)
      : (await getCurrentYear(req.schoolId!)).id;

    // O'qituvchi faqat o'ziga biriktirilgan sinflarni ko'radi
    const onlyIds = req.user!.role === 'teacher' ? await teacherClassIds(req.schoolId!, req.user!.id) : null;

    const { rows } = await pool.query(
      `SELECT c.id, c.grade, c.letter, c.grade || '-' || c.letter AS name,
              c.monthly_fee, c.homeroom_teacher_id, u.full_name AS homeroom_teacher,
              (SELECT count(*)::int FROM enrollments e
                WHERE e.class_id = c.id AND e.ends_on IS NULL) AS student_count
         FROM classes c
         LEFT JOIN users u ON u.id = c.homeroom_teacher_id
        WHERE c.school_id = $1 AND c.academic_year_id = $2
          AND ($3::uuid[] IS NULL OR c.id = ANY($3))
        ORDER BY c.grade, c.letter`,
      [req.schoolId, yearId, onlyIds],
    );
    res.json({ items: rows });
  }),
);

const createClassSchema = z.object({
  grade: z.number().int().min(0, "Sinf 0 dan 12 gacha").max(12, "Sinf 0 dan 12 gacha"),
  letter: z.string().min(1, "Sinf harfi kiritilishi shart").max(4),
  monthlyFee: z.number().min(0, "Oylik to'lov manfiy bo'lmaydi"),
  homeroomTeacherId: z.string().uuid("O'qituvchi ID formati noto'g'ri").optional(),
  yearId: z.string().uuid().optional(),
});

classesRoutes.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const input = parse(createClassSchema, req.body);
    const yearId = input.yearId ?? (await getCurrentYear(req.schoolId!)).id;

    if (input.homeroomTeacherId) {
      const t = await pool.query(
        `SELECT 1 FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND is_active`,
        [input.homeroomTeacherId, req.schoolId],
      );
      if (!t.rowCount) throw badRequest("Sinf rahbari topilmadi yoki o'qituvchi emas");
    }

    const dup = await pool.query(
      `SELECT 1 FROM classes WHERE school_id = $1 AND academic_year_id = $2 AND grade = $3 AND letter = $4`,
      [req.schoolId, yearId, input.grade, input.letter],
    );
    if (dup.rowCount) throw conflict('Bu sinf allaqachon mavjud');

    const { rows } = await pool.query(
      `INSERT INTO classes (school_id, academic_year_id, grade, letter, homeroom_teacher_id, monthly_fee)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, grade, letter, monthly_fee, homeroom_teacher_id`,
      [req.schoolId, yearId, input.grade, input.letter, input.homeroomTeacherId ?? null, input.monthlyFee],
    );
    res.status(201).json({ class: rows[0] });
  }),
);

classesRoutes.get(
  '/:id',
  requireRole('admin', 'manager', 'teacher'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    await assertClassAccess(req.user!, req.schoolId!, id);

    const { rows } = await pool.query(
      `SELECT c.id, c.grade, c.letter, c.grade || '-' || c.letter AS name,
              c.monthly_fee, c.homeroom_teacher_id, u.full_name AS homeroom_teacher
         FROM classes c
         LEFT JOIN users u ON u.id = c.homeroom_teacher_id
        WHERE c.id = $1 AND c.school_id = $2`,
      [id, req.schoolId],
    );
    if (!rows[0]) throw notFound('Sinf topilmadi');

    const students = await pool.query(
      `SELECT s.id, s.last_name, s.first_name, s.status,
              e.discount_percent, COALESCE(e.monthly_fee, c.monthly_fee) AS monthly_fee
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         JOIN classes c ON c.id = e.class_id
        WHERE e.class_id = $1 AND e.school_id = $2 AND e.ends_on IS NULL
        ORDER BY s.last_name, s.first_name`,
      [id, req.schoolId],
    );

    res.json({ class: rows[0], students: students.rows });
  }),
);

const patchClassSchema = z.object({
  letter: z.string().min(1).max(4).optional(),
  monthlyFee: z.number().min(0).optional(),
  homeroomTeacherId: z.string().uuid().nullable().optional(),
});

classesRoutes.patch(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(patchClassSchema, req.body);

    const { rows: before } = await pool.query(
      `SELECT id, letter, monthly_fee, homeroom_teacher_id FROM classes WHERE id = $1 AND school_id = $2`,
      [id, req.schoolId],
    );
    if (!before[0]) throw notFound('Sinf topilmadi');

    const { rows } = await pool.query(
      `UPDATE classes SET
         letter = COALESCE($3, letter),
         monthly_fee = COALESCE($4, monthly_fee),
         homeroom_teacher_id = CASE WHEN $5 THEN $6::uuid ELSE homeroom_teacher_id END
       WHERE id = $1 AND school_id = $2
       RETURNING id, grade, letter, monthly_fee, homeroom_teacher_id`,
      [
        id,
        req.schoolId,
        input.letter ?? null,
        input.monthlyFee ?? null,
        input.homeroomTeacherId !== undefined,
        input.homeroomTeacherId ?? null,
      ],
    );

    // Oylik to'lov o'zgarishi — moliyaviy o'zgarish, auditga yoziladi (2-qoida).
    if (input.monthlyFee !== undefined && input.monthlyFee !== before[0].monthly_fee) {
      await audit(req, {
        action: 'class.fee.update',
        entity: 'class',
        entityId: id,
        before: { monthly_fee: before[0].monthly_fee },
        after: { monthly_fee: input.monthlyFee },
      });
    }

    res.json({ class: rows[0] });
  }),
);

/**
 * Sinfni o'chirish — faqat xato bilan ochilgan bo'sh sinf uchun.
 *
 * `classes` ga oltita jadval ON DELETE CASCADE bilan bog'langan
 * (enrollments, attendance_sessions, attendance, grades, lessons,
 * class_subject_teachers). Ya'ni tarixi bor sinfni o'chirish davomat va
 * baholarni ham jimgina olib ketardi — shuning uchun tekshiruv "hozir
 * o'quvchi bormi" dan kengroq: umuman tegilganmi.
 *
 * O'quv yili tugaganda sinf o'chirilmaydi — sinf academic_year_id ga
 * bog'langan, keyingi yil uchun yangisi ochiladi va eskisi tarix bo'lib qoladi.
 */
classesRoutes.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { rows } = await pool.query(
      `SELECT c.grade || '-' || c.letter AS name,
              (SELECT count(*)::int FROM enrollments e
                WHERE e.class_id = c.id AND e.ends_on IS NULL)            AS active,
              (SELECT count(*)::int FROM enrollments e WHERE e.class_id = c.id)          AS ever,
              (SELECT count(*)::int FROM attendance_sessions s WHERE s.class_id = c.id)  AS sessions,
              (SELECT count(*)::int FROM grades g WHERE g.class_id = c.id)               AS grades
         FROM classes c
        WHERE c.id = $1 AND c.school_id = $2`,
      [id, req.schoolId],
    );
    const c = rows[0];
    if (!c) throw notFound('Sinf topilmadi');

    if (c.active > 0) {
      throw conflict(
        `Sinfda ${c.active} ta o'quvchi bor — avval ularni boshqa sinfga o'tkazing`,
      );
    }
    if (c.ever > 0 || c.sessions > 0 || c.grades > 0) {
      throw conflict(
        "Bu sinfda tarix bor (o'quvchilar, davomat yoki baholar) — o'chirib bo'lmaydi. " +
        "Sinf o'quv yiliga bog'langan: keyingi yil uchun yangi sinf oching.",
      );
    }

    await pool.query(`DELETE FROM classes WHERE id = $1 AND school_id = $2`, [id, req.schoolId]);
    await audit(req, { action: 'class.delete', entity: 'class', entityId: id, before: { name: c.name } });

    res.json({ ok: true });
  }),
);
