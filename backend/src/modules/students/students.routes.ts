import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { audit } from '../audit/audit.service.js';
import { getCurrentYear, getSchoolSettings } from '../schools/schools.service.js';
import { assertClassAccess } from '../classes/classes.service.js';
import { conflict, forbidden, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { guardiansOf, linkGuardian, addPhones, normalizePhones, MAX_PHONES } from './students.service.js';
import { parse, uuidParam } from '../../utils/validate.js';
import { normalizePhone, PHONE_HINT } from '../../utils/phone.js';

export const studentsRoutes = Router();
studentsRoutes.use(requireTenant);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Sana formati: YYYY-MM-DD');
// Import bilan bir xil qoida. Yozuvning o'zi linkGuardian ichida yagona
// ko'rinishga keltiriladi — bu yerda faqat tushunarli xato beriladi.
const phoneStr = z.string().refine((v) => normalizePhone(v) !== null,
  `Telefon raqam noto'g'ri. ${PHONE_HINT}`);

/**
 * Mas'ul shaxs: bitta odam, bir nechta raqam.
 *
 * `phone` (bitta) ham qabul qilinadi — eski mijozlar va oddiy holat uchun.
 * Ikkalasi ham berilsa birlashtiriladi; birinchisi asosiy raqam bo'ladi.
 */
const guardianSchema = z.object({
  fullName: z.string().min(3, "Mas'ul shaxs ismi kamida 3 belgi"),
  phone: phoneStr.optional(),
  phones: z.array(phoneStr).max(MAX_PHONES).optional(),
  relation: z.enum(['father', 'mother', 'guardian'], {
    errorMap: () => ({ message: "Qarindoshlik father, mother yoki guardian bo'lishi kerak" }),
  }),
}).transform((g) => ({
  fullName: g.fullName,
  relation: g.relation,
  phones: [...(g.phone ? [g.phone] : []), ...(g.phones ?? [])],
})).refine((g) => g.phones.length > 0, { message: 'Kamida bitta telefon raqam kerak' });


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
        gender: z.enum(['m', 'f']).optional(),
        // Tug'ilgan YIL bo'yicha: sinf bir yoshdagi bolalardan tuziladi,
        // shuning uchun aniq sana emas, yil kerak bo'ladi.
        birthYear: z.coerce.number().int().min(1900).max(2100).optional(),
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
          AND ($5::text IS NULL OR s.gender = $5)
          AND ($6::int  IS NULL OR EXTRACT(YEAR FROM s.birth_date) = $6)
        ORDER BY s.last_name, s.first_name
        LIMIT $7 OFFSET $8`,
      [
        req.schoolId, query.status, query.classId ?? null, query.q ?? null,
        query.gender ?? null, query.birthYear ?? null,
        query.limit, offset,
      ],
    );

    res.json({ items: rows.map(({ total: _t, ...r }) => r), total: rows[0]?.total ?? 0, page: query.page });
  }),
);

/**
 * Filtr uchun mavjud tug'ilgan yillar. Taxminiy diapazon (masalan 2005-2025)
 * o'rniga aynan bazadagi yillar — bo'sh variantlar ko'rsatilmasin.
 *
 * DIQQAT: bu yo'l `/:id` dan OLDIN turishi shart, aks holda "birth-years"
 * id sifatida talqin qilinadi.
 */
studentsRoutes.get(
  '/birth-years',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const { rows } = await pool.query<{ year: number; count: number }>(
      `SELECT EXTRACT(YEAR FROM birth_date)::int AS year, count(*)::int AS count
         FROM students
        WHERE school_id = $1 AND birth_date IS NOT NULL AND status = 'active'
        GROUP BY 1
        ORDER BY 1 DESC`,
      [req.schoolId],
    );
    res.json({ items: rows });
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
  parent: guardianSchema.optional(),
  // Bir nechta mas'ul shaxs bir yo'la kiritilishi mumkin.
  guardians: z.array(guardianSchema).max(6).optional(),
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

      // Birinchi mas'ul shaxs asosiy: xabarlarda va ro'yxatlarda u ko'rsatiladi.
      const guardians = [...(input.parent ? [input.parent] : []), ...(input.guardians ?? [])];
      for (const [i, g] of guardians.entries()) {
        await linkGuardian(client, req.schoolId!, s.id, g, i === 0);
      }

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

    const guardians = await guardiansOf(pool, req.schoolId!, id);

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
      parents: guardians,
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
      // Sinfsiz o'quvchini sinfga qo'shish ham shu yerdan bo'ladi. Aks holda
      // yakka yaratilgan yoki Excel'dan sinfsiz kelgan o'quvchi hech qachon
      // sinfga biriktirilmasdi — endpoint faqat mavjud yozuvni yangilardi.
      if (!before[0]) {
        if (!input.classId) {
          throw notFound("O'quvchi sinfga qo'shilmagan — avval sinfni tanlang");
        }
        const student = await client.query(
          `SELECT 1 FROM students WHERE id = $1 AND school_id = $2`,
          [id, req.schoolId],
        );
        if (!student.rowCount) throw notFound("O'quvchi topilmadi");

        const cls = await client.query(
          `SELECT 1 FROM classes WHERE id = $1 AND school_id = $2`,
          [input.classId, req.schoolId],
        );
        if (!cls.rowCount) throw notFound('Sinf topilmadi');

        const year = await getCurrentYear(req.schoolId!, client);
        const { rows: created } = await client.query(
          `INSERT INTO enrollments
             (school_id, student_id, class_id, academic_year_id, monthly_fee, discount_percent, discount_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING *`,
          [
            req.schoolId, id, input.classId, year.id,
            input.monthlyFee ?? null,
            input.discountPercent ?? 0,
            input.discountReason ?? null,
          ],
        );
        await audit(req, {
          action: 'enrollment.create',
          entity: 'enrollment',
          entityId: created[0].id,
          after: { class_id: input.classId, discount_percent: input.discountPercent ?? 0 },
        }, client);
        return created[0];
      }

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

// ------------------------------------------------- maktabdan chiqarish
/**
 * O'quvchini ro'yxatdan chiqarish: arxiv, "ketdi" yoki "bitirdi".
 *
 * Biriktirish yopiladi (`ends_on`), shundan keyin yangi oylik hisob
 * chiqarilmaydi. Proratsiya yoqilgan bo'lsa, joriy oyning chiqarilgan hisobi
 * o'qilgan kunlarga qarab qayta hisoblanadi — aks holda 5-noyabrda ketgan
 * bolaga to'liq noyabr qarz bo'lib qolardi.
 */
studentsRoutes.post(
  '/:id/archive',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(
      z.object({
        status: z.enum(['archived', 'left', 'graduated']).default('archived'),
        // Ketgan sana — o'tmishda bo'lishi mumkin (hujjat keyinroq rasmiylashadi).
        endsOn: dateStr.optional(),
        reason: z.string().max(1000).optional(),
      }),
      req.body ?? {},
    );

    const result = await tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE students SET status = $4, note = COALESCE($3, note), updated_at = now()
          WHERE id = $1 AND school_id = $2 AND status = 'active'
          RETURNING id`,
        [id, req.schoolId, input.reason ?? null, input.status],
      );
      if (!rows[0]) throw conflict("O'quvchi topilmadi yoki allaqachon ro'yxatdan chiqarilgan");

      const endsOn = input.endsOn ?? null;
      await client.query(
        `UPDATE enrollments SET ends_on = COALESCE($3::date, CURRENT_DATE)
          WHERE student_id = $1 AND school_id = $2 AND ends_on IS NULL`,
        [id, req.schoolId, endsOn],
      );

      // Joriy oy hisobini qayta hisoblash — faqat proratsiya yoqilgan bo'lsa.
      const settings = await getSchoolSettings(req.schoolId!, client);
      let recalculated = 0;
      if (settings.prorate_partial_months === true) {
        const { rows: adj } = await client.query<{ id: string; amount: string }>(
          `WITH target AS (
             SELECT i.id,
                    round(COALESCE(e.monthly_fee, c.monthly_fee) * GREATEST(0, (
                      LEAST(e.ends_on, (i.period_month + interval '1 month - 1 day')::date)
                      - GREATEST(e.starts_on, i.period_month) + 1
                    ))::numeric
                    / EXTRACT(DAY FROM (i.period_month + interval '1 month - 1 day')), 2) AS amount,
                    e.discount_percent
               FROM invoices i
               JOIN enrollments e ON e.id = i.enrollment_id
               JOIN classes c ON c.id = e.class_id
              WHERE i.school_id = $2 AND i.student_id = $1 AND i.status <> 'void'
                -- Faqat ketgan sana tushgan oy: o'tgan oylar to'liq o'qilgan.
                AND e.ends_on BETWEEN i.period_month
                    AND (i.period_month + interval '1 month - 1 day')::date
           )
           UPDATE invoices i
              SET amount = t.amount,
                  discount = round(t.amount * t.discount_percent / 100, 2)
             FROM target t
            WHERE i.id = t.id AND i.amount <> t.amount
          RETURNING i.id, i.amount::text`,
          [id, req.schoolId],
        );
        recalculated = adj.length;
      }

      await audit(
        req,
        {
          action: 'student.archive',
          entity: 'student',
          entityId: id,
          after: { status: input.status, endsOn, reason: input.reason ?? null, recalculated },
        },
        client,
      );
      return { recalculated };
    });

    res.json({ ok: true, ...result });
  }),
);

/**
 * O'quvchini butunlay o'chirish.
 *
 * Faqat MOLIYAVIY TARIXI YO'Q o'quvchi o'chiriladi. Sabab: students ga 8 ta
 * jadval ON DELETE CASCADE bilan bog'langan — to'lov va hisoblar ham. Xato
 * kiritilgan yozuvni tozalash uchun kerak, ketgan o'quvchi uchun emas:
 * unga "ketdi" deb belgilash ishlatiladi, tarixi saqlanib qoladi.
 */
studentsRoutes.delete(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);

    const { rows } = await client_counts(id, req.schoolId!);
    if (!rows.length) throw notFound("O'quvchi topilmadi");
    const c = rows[0];
    const blockers: string[] = [];
    if (c.payments > 0) blockers.push(`${c.payments} ta to'lov`);
    if (c.invoices > 0) blockers.push(`${c.invoices} ta hisob`);
    if (c.attendance > 0) blockers.push(`${c.attendance} ta davomat yozuvi`);
    if (blockers.length) {
      throw conflict(
        `O'chirib bo'lmaydi — ${blockers.join(', ')} bor. ` +
        `Buning o'rniga "Ketdi" deb belgilang, shunda tarixi saqlanib qoladi`,
      );
    }

    await tx(async (client) => {
      // Audit avval: o'quvchi o'chgach entity_id bo'yicha nom topilmaydi.
      await audit(req, {
        action: 'student.delete', entity: 'student', entityId: id,
        before: { name: `${c.last_name} ${c.first_name}` },
      }, client);
      await client.query(`DELETE FROM students WHERE id = $1 AND school_id = $2`, [id, req.schoolId]);
    });

    res.json({ ok: true });
  }),
);

/** O'chirishga to'sqinlik qiladigan yozuvlar soni. */
function client_counts(id: string, schoolId: string) {
  return pool.query<{
    last_name: string; first_name: string;
    payments: number; invoices: number; attendance: number;
  }>(
    `SELECT s.last_name, s.first_name,
            (SELECT count(*)::int FROM payments WHERE student_id = s.id) AS payments,
            (SELECT count(*)::int FROM invoices WHERE student_id = s.id) AS invoices,
            (SELECT count(*)::int FROM attendance WHERE student_id = s.id) AS attendance
       FROM students s WHERE s.id = $1 AND s.school_id = $2`,
    [id, schoolId],
  );
}

// ---------------------------------------------------------------- ota-ona qo'shish
studentsRoutes.post(
  '/:id/parents',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(
      z.object({ isPrimary: z.boolean().default(false) }).passthrough(),
      req.body,
    );
    const g = parse(guardianSchema, req.body);

    const student = await pool.query(`SELECT 1 FROM students WHERE id = $1 AND school_id = $2`, [id, req.schoolId]);
    if (!student.rowCount) throw notFound("O'quvchi topilmadi");

    const parentId = await tx(async (client) => {
      const pid = await linkGuardian(client, req.schoolId!, id, g, input.isPrimary);
      await audit(req, { action: 'guardian.add', entity: 'student', entityId: id,
                         after: { fullName: g.fullName, phones: g.phones.length } }, client);
      return pid;
    });

    res.status(201).json({ parentId });
  }),
);

// ------------------------------------------------- mas'ul shaxs va raqamlari

/** Mas'ul shaxsni o'quvchidan uzish. Odam o'chirilmaydi — boshqa farzandi bo'lishi mumkin. */
studentsRoutes.delete(
  '/:id/parents/:parentId',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const studentId = uuidParam(req);
    const parentId = uuidParam(req, 'parentId');

    const { rowCount } = await pool.query(
      `DELETE FROM student_parents sp
        USING parents p
        WHERE sp.student_id = $1 AND sp.parent_id = $2
          AND p.id = sp.parent_id AND p.school_id = $3`,
      [studentId, parentId, req.schoolId],
    );
    if (!rowCount) throw notFound("Mas'ul shaxs topilmadi");

    // Hech bir o'quvchiga bog'lanmay qolgan odam ortiqcha — yozuvi bilan
    // birga raqamlari va Telegram ulanishi ham ketadi (CASCADE).
    await pool.query(
      `DELETE FROM parents p
        WHERE p.id = $1 AND p.school_id = $2
          AND NOT EXISTS (SELECT 1 FROM student_parents WHERE parent_id = p.id)`,
      [parentId, req.schoolId],
    );

    await audit(req, { action: 'guardian.remove', entity: 'student', entityId: studentId,
                       before: { parentId } });
    res.json({ ok: true });
  }),
);

/** Mavjud mas'ul shaxsga qo'shimcha raqam. */
studentsRoutes.post(
  '/parents/:parentId/phones',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const parentId = uuidParam(req, 'parentId');
    const { phone } = parse(z.object({ phone: phoneStr }), req.body);

    const owner = await pool.query(`SELECT 1 FROM parents WHERE id = $1 AND school_id = $2`,
      [parentId, req.schoolId]);
    if (!owner.rowCount) throw notFound("Mas'ul shaxs topilmadi");

    await addPhones(pool, req.schoolId!, parentId, normalizePhones([phone]));
    await audit(req, { action: 'guardian.phone.add', entity: 'parent', entityId: parentId });
    res.status(201).json({ ok: true });
  }),
);

/** Raqamni o'chirish. Oxirgi raqam o'chirilmaydi — aks holda odamga xabar yo'li qolmaydi. */
studentsRoutes.delete(
  '/parents/:parentId/phones/:phoneId',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const parentId = uuidParam(req, 'parentId');
    const phoneId = uuidParam(req, 'phoneId');

    const { rows } = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM parent_phones WHERE parent_id = $1 AND school_id = $2`,
      [parentId, req.schoolId]);
    if (rows[0].c <= 1) throw conflict("Oxirgi raqamni o'chirib bo'lmaydi");

    const { rows: gone } = await pool.query<{ is_primary: boolean }>(
      `DELETE FROM parent_phones WHERE id = $1 AND parent_id = $2 AND school_id = $3
       RETURNING is_primary`,
      [phoneId, parentId, req.schoolId]);
    if (!gone[0]) throw notFound('Raqam topilmadi');

    // Asosiy raqam o'chgan bo'lsa, eng eskisi asosiy bo'ladi — bittasi bo'lishi shart.
    if (gone[0].is_primary) {
      await pool.query(
        `UPDATE parent_phones SET is_primary = true
          WHERE id = (SELECT id FROM parent_phones
                       WHERE parent_id = $1 AND school_id = $2
                       ORDER BY created_at LIMIT 1)`,
        [parentId, req.schoolId]);
    }

    await audit(req, { action: 'guardian.phone.remove', entity: 'parent', entityId: parentId });
    res.json({ ok: true });
  }),
);

/** Asosiy raqamni almashtirish yoki xabarni yoqish/o'chirish. */
studentsRoutes.patch(
  '/parents/:parentId/phones/:phoneId',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const parentId = uuidParam(req, 'parentId');
    const phoneId = uuidParam(req, 'phoneId');
    const input = parse(
      z.object({ isPrimary: z.boolean().optional(), notifyEnabled: z.boolean().optional() }),
      req.body,
    );

    await tx(async (client) => {
      if (input.isPrimary) {
        await client.query(
          `UPDATE parent_phones SET is_primary = (id = $1)
            WHERE parent_id = $2 AND school_id = $3`,
          [phoneId, parentId, req.schoolId]);
      }
      if (input.notifyEnabled !== undefined) {
        const { rowCount } = await client.query(
          `UPDATE parent_phones SET notify_enabled = $4
            WHERE id = $1 AND parent_id = $2 AND school_id = $3`,
          [phoneId, parentId, req.schoolId, input.notifyEnabled]);
        if (!rowCount) throw notFound('Raqam topilmadi');
      }
    });

    res.json({ ok: true });
  }),
);
