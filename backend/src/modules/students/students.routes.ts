import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { audit } from '../audit/audit.service.js';
import { getCurrentYear } from '../schools/schools.service.js';
import { assertClassAccess } from '../classes/classes.service.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { linkParent } from './students.service.js';
import { parse, uuidParam } from '../../utils/validate.js';

export const studentsRoutes = Router();
studentsRoutes.use(requireTenant);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD');
const phoneStr = z.string().regex(/^\+998\d{9}$/, "Telefon raqam formati noto'g'ri (+998XXXXXXXXX)");

const parentSchema = z.object({
  fullName: z.string().min(3, "Ota-ona ismi kamida 3 belgi"),
  phone: phoneStr,
  relation: z.enum(['father', 'mother', 'guardian'], {
    errorMap: () => ({ message: "Qarindoshlik father, mother yoki guardian bo'lishi kerak" }),
  }),
});


// ---------------------------------------------------------------- ro'yxat
studentsRoutes.get(
  '/',
  requireRole('admin', 'manager', 'teacher'),
  ah(async (req, res) => {
    const query = parse(
      z.object({
        classId: z.string().uuid("classId formati noto'g'ri").optional(),
        status: z.enum(['active', 'archived', 'graduated', 'left']).default('active'),
        q: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );

    // O'qituvchi umumiy ro'yxatni emas, faqat o'z sinfini ko'radi
    if (req.user!.role === 'teacher') {
      if (!query.classId) throw forbidden("O'qituvchi faqat o'z sinfi ro'yxatini ko'ra oladi (classId talab qilinadi)");
      await assertClassAccess(req.user!, req.schoolId!, query.classId);
    }

    const offset = (query.page - 1) * query.limit;
    const { rows } = await pool.query(
      `SELECT s.id, s.last_name, s.first_name, s.middle_name, s.birth_date, s.gender,
              s.status, s.enrolled_on,
              c.id AS class_id, c.grade || '-' || c.letter AS class_name,
              count(*) OVER()::int AS total
         FROM students s
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.ends_on IS NULL
         LEFT JOIN classes c ON c.id = e.class_id
        WHERE s.school_id = $1
          AND s.status = $2
          AND ($3::uuid IS NULL OR e.class_id = $3)
          AND ($4::text IS NULL OR s.last_name || ' ' || s.first_name ILIKE '%' || $4 || '%'
                                OR s.first_name || ' ' || s.last_name ILIKE '%' || $4 || '%')
        ORDER BY s.last_name, s.first_name
        LIMIT $5 OFFSET $6`,
      [req.schoolId, query.status, query.classId ?? null, query.q ?? null, query.limit, offset],
    );

    res.json({ items: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0, page: query.page });
  }),
);

// ---------------------------------------------------------------- yaratish
const createStudentSchema = z.object({
  lastName: z.string().min(2, 'Familiya kamida 2 belgi'),
  firstName: z.string().min(2, 'Ism kamida 2 belgi'),
  middleName: z.string().optional(),
  birthDate: dateStr.optional(),
  gender: z.enum(['m', 'f']).optional(),
  externalId: z.string().optional(),
  note: z.string().optional(),
  classId: z.string().uuid("classId formati noto'g'ri").optional(),
  monthlyFee: z.number().min(0).optional(),
  discountPercent: z.number().min(0, 'Chegirma 0-100% oralig\'ida').max(100, "Chegirma 0-100% oralig'ida").default(0),
  discountReason: z.string().optional(),
  parent: parentSchema.optional(),
});

studentsRoutes.post(
  '/',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const input = parse(createStudentSchema, req.body);

    const student = await tx(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO students (school_id, last_name, first_name, middle_name, birth_date, gender, external_id, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, last_name, first_name, status`,
        [
          req.schoolId,
          input.lastName,
          input.firstName,
          input.middleName ?? null,
          input.birthDate ?? null,
          input.gender ?? null,
          input.externalId ?? null,
          input.note ?? null,
        ],
      );
      const s = rows[0];

      if (input.classId) {
        const year = await getCurrentYear(req.schoolId!, client);
        const cls = await client.query(`SELECT 1 FROM classes WHERE id = $1 AND school_id = $2`, [
          input.classId,
          req.schoolId,
        ]);
        if (!cls.rowCount) throw notFound('Sinf topilmadi');

        await client.query(
          `INSERT INTO enrollments
             (school_id, student_id, class_id, academic_year_id, monthly_fee, discount_percent, discount_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [req.schoolId, s.id, input.classId, year.id, input.monthlyFee ?? null, input.discountPercent, input.discountReason ?? null],
        );
      }

      if (input.parent) await linkParent(client, req.schoolId!, s.id, input.parent, true);

      return s;
    });

    res.status(201).json({ student });
  }),
);

// ---------------------------------------------------------------- karta
studentsRoutes.get(
  '/:id',
  requireRole('admin', 'manager', 'teacher'),
  ah(async (req, res) => {
    const id = uuidParam(req);

    const { rows } = await pool.query(
      `SELECT s.*, e.id AS enrollment_id, e.class_id, c.grade || '-' || c.letter AS class_name,
              COALESCE(e.monthly_fee, c.monthly_fee) AS monthly_fee,
              e.discount_percent, e.discount_reason
         FROM students s
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.ends_on IS NULL
         LEFT JOIN classes c ON c.id = e.class_id
        WHERE s.id = $1 AND s.school_id = $2`,
      [id, req.schoolId],
    );
    const student = rows[0];
    if (!student) throw notFound("O'quvchi topilmadi");

    if (req.user!.role === 'teacher') {
      if (!student.class_id) throw forbidden("Bu o'quvchi sizga biriktirilmagan");
      await assertClassAccess(req.user!, req.schoolId!, student.class_id);
    }

    const parents = await pool.query(
      `SELECT p.id, p.full_name, p.phone, p.relation, p.telegram_verified_at IS NOT NULL AS telegram_linked, sp.is_primary
         FROM student_parents sp
         JOIN parents p ON p.id = sp.parent_id
        WHERE sp.student_id = $1 AND p.school_id = $2
        ORDER BY sp.is_primary DESC`,
      [id, req.schoolId],
    );

    const finance = await pool.query(
      `SELECT
         COALESCE(SUM(i.amount - i.discount) FILTER (WHERE i.status <> 'void'), 0) AS invoiced,
         COALESCE((SELECT SUM(pa.amount) FROM payment_allocations pa
                    JOIN invoices i2 ON i2.id = pa.invoice_id
                   WHERE i2.student_id = $1 AND pa.school_id = $2), 0) AS allocated,
         -- Hisobga bog'lanmagan pul ham ko'rinsin: aks holda hisob chiqarilmagan
         -- paytda qabul qilingan to'lov ekranda umuman yo'qolib ketardi.
         COALESCE((SELECT SUM(p.amount) FROM payments p
                   WHERE p.student_id = $1 AND p.school_id = $2 AND p.status = 'confirmed'), 0) AS received
         FROM invoices i
        WHERE i.student_id = $1 AND i.school_id = $2`,
      [id, req.schoolId],
    );
    const { invoiced, allocated, received } = finance.rows[0];

    res.json({
      student,
      parents: parents.rows,
      finance: {
        invoiced,
        paid: allocated,
        outstanding: invoiced - allocated,
        // Hisobdan oldin to'langan yoki ortiqcha to'langan qism.
        advance: received - allocated,
      },
    });
  }),
);

// ---------------------------------------------------------------- tahrirlash
const patchStudentSchema = z.object({
  lastName: z.string().min(2).optional(),
  firstName: z.string().min(2).optional(),
  middleName: z.string().nullable().optional(),
  birthDate: dateStr.nullable().optional(),
  gender: z.enum(['m', 'f']).nullable().optional(),
  externalId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

studentsRoutes.patch(
  '/:id',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(patchStudentSchema, req.body);

    const { rows } = await pool.query(
      `UPDATE students SET
         last_name   = COALESCE($3, last_name),
         first_name  = COALESCE($4, first_name),
         middle_name = CASE WHEN $5 THEN $6 ELSE middle_name END,
         birth_date  = CASE WHEN $7 THEN $8::date ELSE birth_date END,
         gender      = CASE WHEN $9 THEN $10 ELSE gender END,
         external_id = CASE WHEN $11 THEN $12 ELSE external_id END,
         note        = CASE WHEN $13 THEN $14 ELSE note END,
         updated_at  = now()
       WHERE id = $1 AND school_id = $2
       RETURNING id, last_name, first_name, middle_name, birth_date, gender, status`,
      [
        id,
        req.schoolId,
        input.lastName ?? null,
        input.firstName ?? null,
        input.middleName !== undefined, input.middleName ?? null,
        input.birthDate !== undefined, input.birthDate ?? null,
        input.gender !== undefined, input.gender ?? null,
        input.externalId !== undefined, input.externalId ?? null,
        input.note !== undefined, input.note ?? null,
      ],
    );
    if (!rows[0]) throw notFound("O'quvchi topilmadi");
    res.json({ student: rows[0] });
  }),
);

// ---------------------------------------------------------------- biriktirish (sinf/to'lov/chegirma)
const patchEnrollmentSchema = z
  .object({
    classId: z.string().uuid().optional(),
    monthlyFee: z.number().min(0).nullable().optional(),
    discountPercent: z.number().min(0).max(100).optional(),
    discountReason: z.string().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "O'zgartirish uchun kamida bitta maydon kerak" });

studentsRoutes.patch(
  '/:id/enrollment',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(patchEnrollmentSchema, req.body);

    const enrollment = await tx(async (client) => {
      const { rows: before } = await client.query(
        `SELECT e.* FROM enrollments e
          WHERE e.student_id = $1 AND e.school_id = $2 AND e.ends_on IS NULL
          FOR UPDATE`,
        [id, req.schoolId],
      );
      if (!before[0]) throw notFound("Faol biriktirish topilmadi — o'quvchi sinfga qo'shilmagan");

      if (input.classId) {
        const cls = await client.query(`SELECT 1 FROM classes WHERE id = $1 AND school_id = $2`, [
          input.classId,
          req.schoolId,
        ]);
        if (!cls.rowCount) throw notFound('Sinf topilmadi');
      }

      const { rows } = await client.query(
        `UPDATE enrollments SET
           class_id         = COALESCE($3, class_id),
           monthly_fee      = CASE WHEN $4 THEN $5::numeric ELSE monthly_fee END,
           discount_percent = COALESCE($6, discount_percent),
           discount_reason  = CASE WHEN $7 THEN $8 ELSE discount_reason END
         WHERE id = $1 AND school_id = $2
         RETURNING *`,
        [
          before[0].id,
          req.schoolId,
          input.classId ?? null,
          input.monthlyFee !== undefined, input.monthlyFee ?? null,
          input.discountPercent ?? null,
          input.discountReason !== undefined, input.discountReason ?? null,
        ],
      );

      // To'lov/chegirma o'zgarishi — moliyaviy o'zgarish (2-qoida).
      await audit(
        req,
        {
          action: 'enrollment.update',
          entity: 'enrollment',
          entityId: before[0].id,
          before: {
            class_id: before[0].class_id,
            monthly_fee: before[0].monthly_fee,
            discount_percent: before[0].discount_percent,
          },
          after: input,
        },
        client,
      );
      return rows[0];
    });

    res.json({ enrollment });
  }),
);

// ---------------------------------------------------------------- arxivlash
studentsRoutes.post(
  '/:id/archive',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { reason } = parse(z.object({ reason: z.string().optional() }), req.body ?? {});

    await tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE students SET status = 'archived', note = COALESCE($3, note), updated_at = now()
          WHERE id = $1 AND school_id = $2 AND status = 'active'
          RETURNING id`,
        [id, req.schoolId, reason ?? null],
      );
      if (!rows[0]) throw conflict("O'quvchi topilmadi yoki allaqachon arxivlangan");

      // Faol biriktirish yopiladi — keyingi oy hisob chiqarilmaydi.
      await client.query(
        `UPDATE enrollments SET ends_on = CURRENT_DATE
          WHERE student_id = $1 AND school_id = $2 AND ends_on IS NULL`,
        [id, req.schoolId],
      );

      await audit(
        req,
        { action: 'student.archive', entity: 'student', entityId: id, after: { reason: reason ?? null } },
        client,
      );
    });

    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------- ota-ona qo'shish
studentsRoutes.post(
  '/:id/parents',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(parentSchema.extend({ isPrimary: z.boolean().default(false) }), req.body);

    const student = await pool.query(`SELECT 1 FROM students WHERE id = $1 AND school_id = $2`, [id, req.schoolId]);
    if (!student.rowCount) throw notFound("O'quvchi topilmadi");

    const parentId = await tx(async (client) => {
      const pid = await linkParent(client, req.schoolId!, id, input, input.isPrimary);
      if (!pid) throw badRequest("Ota-onani bog'lab bo'lmadi");
      return pid;
    });

    res.status(201).json({ parentId });
  }),
);
