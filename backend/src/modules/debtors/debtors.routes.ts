import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { ah } from '../../utils/http.js';
import { parse } from '../../utils/validate.js';
import { badRequest } from '../../utils/errors.js';
import { audit } from '../audit/audit.service.js';
import { teacherClassIds } from '../classes/classes.service.js';
import { dispatchQueued } from '../notifications/notifications.service.js';
import {
  debtors as debtList,
  messagingFor,
  previewSms,
  queueReminder,
  recentlyReminded,
} from './debtors.service.js';

export const debtorsRoutes = Router();
// O'qituvchi ham kiradi, lekin FAQAT o'z sinfiga — `scope()` qarang.
debtorsRoutes.use(requireTenant, requireRole('admin', 'manager', 'teacher'));

/**
 * O'qituvchi ko'radigan sinflar; admin/menejer/superadmin uchun `null`
 * (cheklov yo'q). Har bir so'rovda qayta hisoblanadi: sinf biriktirilishi
 * o'quv yili o'rtasida o'zgaradi, keshlangan ro'yxat esa eskirib qolardi.
 */
async function scope(req: { user?: { id: string; role: string }; schoolId?: string }): Promise<string[] | null> {
  if (req.user?.role !== 'teacher') return null;
  return teacherClassIds(req.schoolId!, req.user.id);
}

// Qarzdorlar alohida jadval emas — ochiq hisoblardan avtomatik shakllanadi.
debtorsRoutes.get(
  '/',
  ah(async (req, res) => {
    const query = parse(
      z.object({
        // z.coerce.boolean emas: u "false" satrini ham true qiladi
        overdueOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
      req.query,
    );

    const classIds = await scope(req);

    const { rows } = await pool.query(
      `WITH debt AS (
         SELECT i.student_id,
                SUM(i.amount - i.discount - COALESCE(pa.paid, 0)) AS outstanding,
                SUM(i.amount - i.discount - COALESCE(pa.paid, 0))
                  FILTER (WHERE i.due_date < CURRENT_DATE)       AS overdue,
                MIN(i.due_date) FILTER (WHERE i.due_date < CURRENT_DATE) AS oldest_due
           FROM invoices i
           LEFT JOIN LATERAL (
             SELECT SUM(amount) AS paid FROM payment_allocations
              WHERE invoice_id = i.id AND school_id = i.school_id
           ) pa ON true
          WHERE i.school_id = $1 AND i.status IN ('open','partial')
            AND ($5::uuid[] IS NULL OR EXISTS (
                  SELECT 1 FROM enrollments te
                   WHERE te.student_id = i.student_id AND te.school_id = i.school_id
                     AND te.ends_on IS NULL AND te.class_id = ANY($5)
                ))
          GROUP BY i.student_id
         HAVING SUM(i.amount - i.discount - COALESCE(pa.paid, 0)) > 0
       )
       SELECT d.student_id, s.last_name || ' ' || s.first_name AS student_name,
              c.grade || '-' || c.letter AS class_name,
              d.outstanding, COALESCE(d.overdue, 0) AS overdue, d.oldest_due,
              p.full_name AS parent_name, p.phone AS parent_phone,
              count(*) OVER()::int AS total_count,
              SUM(d.outstanding) OVER() AS total_outstanding
         FROM debt d
         JOIN students s ON s.id = d.student_id AND s.school_id = $1
         LEFT JOIN enrollments e ON e.student_id = s.id AND e.ends_on IS NULL
         LEFT JOIN classes c ON c.id = e.class_id
         LEFT JOIN LATERAL (
           SELECT pr.full_name, pp.phone FROM student_parents sp
             JOIN parents pr ON pr.id = sp.parent_id AND pr.school_id = $1
             LEFT JOIN parent_phones pp ON pp.parent_id = pr.id AND pp.is_primary
            WHERE sp.student_id = s.id
            ORDER BY sp.is_primary DESC LIMIT 1
         ) p ON true
        WHERE NOT $2 OR COALESCE(d.overdue, 0) > 0
        ORDER BY d.outstanding DESC
        LIMIT $3 OFFSET $4`,
      [req.schoolId, query.overdueOnly, query.limit, (query.page - 1) * query.limit, classIds],
    );

    res.json({
      items: rows.map(({ total_count: _tc, total_outstanding: _to, ...r }) => r),
      total: rows[0]?.total_count ?? 0,
      totalOutstanding: rows[0]?.total_outstanding ?? 0,
      page: query.page,
    });
  }),
);

// Qarz eslatmasi. Yuborish emas — NAVBATGA qo'yish: fon ishchisi jo'natadi.
//
// Telegram botga ulanganlarga Telegramdan ketadi (bepul). SMS esa — yoqilgan
// bo'lsa — BARCHA raqamlarga, ulanganiga ham: to'lov eslatmasi ko'rilmay
// qolmasligi kerak.
debtorsRoutes.post(
  '/:studentId/remind',
  ah(async (req, res) => {
    const [d] = await debtList(pool, req.schoolId!, {
      studentId: req.params.studentId,
      classIds: await scope(req),
    });
    // Sinfi begona o'quvchi ham shu yerda tugaydi: o'qituvchiga uning qarzi
    // borligi ham aytilmaydi.
    if (!d) throw badRequest("Bu o'quvchida qarz yo'q");

    const already = await recentlyReminded(pool, req.schoolId!, [d.student_id]);
    if (already.has(d.student_id)) {
      throw badRequest("Bu o'quvchi bo'yicha eslatma yaqinda yuborilgan");
    }

    const m = await messagingFor(pool, req.schoolId!);
    const queued = await queueReminder(pool, req.schoolId!, d, m);
    if (!queued.telegram && !queued.sms) {
      throw badRequest(
        m.smsEnabled
          ? "Xabar yuborilmadi: o'quvchiga mas'ul shaxs raqami biriktirilmagan yoki raqamda xabar o'chirilgan"
          : "Xabar yuborilmadi: ota-ona Telegram botga ulanmagan. SMS ni Sozlamalardan yoqing.",
      );
    }

    await audit(req, {
      action: 'debt.remind',
      entity: 'student',
      entityId: d.student_id,
      after: { outstanding: d.outstanding, ...queued },
    });

    // Foydalanuvchi natijani darhol ko'rishi kerak — 15 soniya kutmasin.
    await dispatchQueued(10);
    res.json({ queued: queued.telegram + queued.sms, ...queued });
  }),
);

/**
 * Ro'yxatga eslatma — tanlanganlarga yoki hammaga.
 *
 * Nega alohida endpoint: 80 ta qarzdorga bittalab tugma bosish — ish emas,
 * azob. Yuborish esa SHU YERDA emas, fon ishchisida: 80 ta SMS ni kutib
 * turgan brauzer so'rovi baribir uzilib ketadi.
 *
 * Avtomatik jo'natish YO'Q — eslatma har doim odam bosgan tugmadan boshlanadi.
 */
debtorsRoutes.post(
  '/remind-all',
  ah(async (req, res) => {
    const input = parse(
      z.object({
        // Bo'sh bo'lsa — ro'yxatdagi hammaga. To'ldirilgan bo'lsa faqat
        // tanlanganlarga: ma'mur kimga yuborishini o'zi hal qiladi.
        studentIds: z.array(z.string().uuid()).max(500).optional(),
        overdueOnly: z.boolean().default(true),
        // Tasodifan butun maktabga yuborib qo'ymaslik uchun yuqori chegara.
        limit: z.number().int().min(1).max(500).default(300),
      }),
      req.body ?? {},
    );

    const list = await debtList(pool, req.schoolId!, {
      studentIds: input.studentIds?.length ? input.studentIds : null,
      classIds: await scope(req),
      // Aniq o'quvchilar tanlangan bo'lsa muddat filtri ortiqcha: ma'mur
      // kimni tanlaganini ko'rib turibdi.
      overdueOnly: input.studentIds?.length ? false : input.overdueOnly,
      // Tanlov bo'lsa chegara tanlanganlar soni: aks holda 300 dan ortig'i
      // jimgina tushib qolardi va ma'mur buni bilmasdi.
      limit: input.studentIds?.length ?? input.limit,
    });
    const skip = await recentlyReminded(pool, req.schoolId!, list.map((d) => d.student_id));
    const m = await messagingFor(pool, req.schoolId!);

    let telegram = 0;
    let sms = 0;
    let noContact = 0;
    for (const d of list) {
      if (skip.has(d.student_id)) continue;
      const q = await queueReminder(pool, req.schoolId!, d, m);
      telegram += q.telegram;
      sms += q.sms;
      if (!q.telegram && !q.sms) noContact += 1;
    }

    const result = {
      students: list.length,
      skipped: skip.size,
      noContact,
      telegram,
      sms,
    };

    await audit(req, {
      action: 'debt.remind.bulk',
      entity: 'school',
      entityId: req.schoolId!,
      after: result,
    });

    // Javobni kutib turmaymiz: fon ishchisi porsiyalab jo'natadi.
    void dispatchQueued(50).catch((err) => {
      console.error('qarz eslatmasi:', (err as Error).message);
    });

    res.json(result);
  }),
);

// SMS matnini oldindan ko'rsatish: admin nechta SMS ketishini yuborishdan
// OLDIN bilishi kerak — ikki qismli xabar ikki barobar pul.
debtorsRoutes.get(
  '/sms-preview',
  ah(async (req, res) => {
    const q = parse(z.object({ template: z.string().max(400).optional() }), req.query);
    res.json(await previewSms(req.schoolId!, q.template));
  }),
);
