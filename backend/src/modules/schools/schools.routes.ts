import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import multer from 'multer';
import { env } from '../../config/env.js';
import { pool, tx } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { audit } from '../audit/audit.service.js';
import { hashPassword } from '../auth/auth.service.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { parse, uuidParam } from '../../utils/validate.js';

// ================================================================ platforma
// Faqat superadmin — maktablarni boshqarish. Tenant filtri YO'Q, chunki bu
// yagona tenant'lar USTIDAN ishlaydigan modul.
export const schoolsPlatformRoutes = Router();
schoolsPlatformRoutes.use(requireRole()); // faqat superadmin o'tadi (bo'sh ro'yxat)

const createSchoolSchema = z.object({
  name: z.string().min(2, "Maktab nomi kamida 2 belgidan iborat bo'lishi kerak"),
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/, "Slug faqat kichik lotin harf, raqam va '-' dan iborat bo'ladi"),
  region: z.string().optional(),
  district: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  tgCode: z.string().min(3, "Telegram kodi kamida 3 belgi").optional(),
  plan: z.enum(['trial', 'standart', 'pro']).default('standart'),
  settings: z.record(z.unknown()).default({}),
  // Maktabni 1 kunda ishga tushirish uchun birinchi admin shu yerda yaratiladi
  admin: z
    .object({
      fullName: z.string().min(3, "Admin ismi kamida 3 belgi"),
      phone: z.string().regex(/^\+998\d{9}$/, "Telefon raqam formati noto'g'ri (+998XXXXXXXXX)"),
      password: z.string().min(8, "Parol kamida 8 belgidan iborat bo'lishi kerak"),
    })
    .optional(),
});

schoolsPlatformRoutes.get(
  '/',
  ah(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.slug, s.region, s.district, s.address, s.phone, s.logo_url, s.plan, s.status, s.created_at,
              (SELECT count(*)::int FROM students st WHERE st.school_id = s.id AND st.status = 'active') AS student_count,
              (SELECT count(*)::int FROM users u WHERE u.school_id = s.id AND u.is_active) AS user_count
         FROM schools s
        ORDER BY s.created_at DESC`,
    );
    res.json({ items: rows });
  }),
);

schoolsPlatformRoutes.post(
  '/',
  ah(async (req, res) => {
    const input = parse(createSchoolSchema, req.body);

    const dup = await pool.query(`SELECT 1 FROM schools WHERE slug = $1`, [input.slug]);
    if (dup.rowCount) throw conflict('Bu slug allaqachon band');

    const school = await tx(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO schools (name, slug, region, district, phone, address, tg_code, plan, settings)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, name, slug, plan, status`,
        [
          input.name,
          input.slug,
          input.region ?? null,
          input.district ?? null,
          input.phone ?? null,
          input.address ?? null,
          input.tgCode ?? input.slug,
          input.plan,
          JSON.stringify(input.settings),
        ],
      );
      const s = rows[0];

      if (input.admin) {
        await client.query(
          `INSERT INTO users (school_id, full_name, phone, password_hash, role)
           VALUES ($1, $2, $3, $4, 'admin')`,
          [s.id, input.admin.fullName, input.admin.phone, await hashPassword(input.admin.password)],
        );
      }

      await audit(
        req,
        { action: 'school.create', entity: 'school', entityId: s.id, after: { name: input.name, slug: input.slug } },
        client,
      );
      return s;
    });

    res.status(201).json({ school });
  }),
);

schoolsPlatformRoutes.get(
  '/:id',
  ah(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, slug, region, district, phone, address, logo_url, tg_code, plan, status, settings, created_at
         FROM schools WHERE id = $1`,
      [uuidParam(req)],
    );
    if (!rows[0]) throw notFound('Maktab topilmadi');
    res.json({ school: rows[0] });
  }),
);

const patchSchoolSchema = z.object({
  name: z.string().min(2).optional(),
  region: z.string().optional(),
  district: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  plan: z.enum(['trial', 'standart', 'pro']).optional(),
  status: z.enum(['active', 'suspended', 'trial']).optional(),
  settings: z.record(z.unknown()).optional(),
});

schoolsPlatformRoutes.patch(
  '/:id',
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(patchSchoolSchema, req.body);
    const { rows: before } = await pool.query(`SELECT * FROM schools WHERE id = $1`, [id]);
    if (!before[0]) throw notFound('Maktab topilmadi');

    const { rows } = await pool.query(
      `UPDATE schools SET
         name     = COALESCE($2, name),
         region   = COALESCE($3, region),
         district = COALESCE($4, district),
         phone    = COALESCE($5, phone),
         address  = COALESCE($6, address),
         plan     = COALESCE($7, plan),
         status   = COALESCE($8, status),
         settings = COALESCE($9, settings),
         updated_at = now()
       WHERE id = $1
       RETURNING id, name, slug, plan, status, settings`,
      [
        id,
        input.name ?? null,
        input.region ?? null,
        input.district ?? null,
        input.phone ?? null,
        input.address ?? null,
        input.plan ?? null,
        input.status ?? null,
        input.settings ? JSON.stringify(input.settings) : null,
      ],
    );

    await audit(req, {
      action: 'school.update',
      entity: 'school',
      entityId: id,
      before: { plan: before[0].plan, status: before[0].status },
      after: input,
    });
    res.json({ school: rows[0] });
  }),
);


// ---------------------------------------------------------------- logotip
// Rasm diskda saqlanadi, bazada faqat yo'l turadi.
// SVG ataylab qabul qilinmaydi: u ichida skript tashiy oladi, biz esa faylni
// o'z domenimizdan beramiz — ya'ni bu saqlangan XSS bo'lardi.
const LOGO_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};
const LOGO_DIR = join(env.uploadDir, "schools");
const LOGO_URL_PREFIX = "/uploads/schools/";

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdir(LOGO_DIR, { recursive: true }).then(() => cb(null, LOGO_DIR), (err) => cb(err, LOGO_DIR));
    },
    // Fayl nomi butunlay tasodifiy: URL parametrini nomga qo'shish yo'l
    // traversali xavfini tug'diradi, tasodifiy nom esa keshni ham yangilaydi.
    filename: (_req, file, cb) => cb(null, randomBytes(16).toString("hex") + LOGO_TYPES[file.mimetype]),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!LOGO_TYPES[file.mimetype]) return cb(badRequest("Faqat PNG, JPEG yoki WEBP rasm yuklash mumkin"));
    cb(null, true);
  },
});

// Multer o'z xatolarini MulterError sifatida beradi — ular 500 emas, 400 bo'lsin.
const uploadLogo: RequestHandler = (req, res, next) =>
  logoUpload.single("logo")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(badRequest(
        err.code === "LIMIT_FILE_SIZE"
          ? "Rasm hajmi 2 MB dan oshmasligi kerak"
          : "Faylni yuklab bo'lmadi",
      ));
    }
    next(err);
  });

/** Eski faylni o'chirish — best-effort: xatosi so'rovni yiqitmaydi. */
async function removeLogoFile(url: string | null | undefined) {
  if (!url?.startsWith(LOGO_URL_PREFIX)) return;
  await unlink(join(LOGO_DIR, url.slice(LOGO_URL_PREFIX.length))).catch(() => {});
}

schoolsPlatformRoutes.post(
  "/:id/logo",
  uploadLogo,
  ah(async (req, res) => {
    if (!req.file) throw badRequest("Rasm biriktirilmagan");
    const url = LOGO_URL_PREFIX + req.file.filename;

    let id: string;
    try {
      id = uuidParam(req);
    } catch (err) {
      await removeLogoFile(url);   // fayl allaqachon yozilgan — yetim qoldirmaymiz
      throw err;
    }

    const { rows: before } = await pool.query(`SELECT logo_url FROM schools WHERE id = $1`, [id]);
    if (!before[0]) {
      await removeLogoFile(url);
      throw notFound("Maktab topilmadi");
    }

    await pool.query(`UPDATE schools SET logo_url = $2, updated_at = now() WHERE id = $1`, [id, url]);
    await removeLogoFile(before[0].logo_url);
    await audit(req, {
      action: "school.logo.update",
      entity: "school",
      entityId: id,
      before: { logo_url: before[0].logo_url },
      after: { logo_url: url },
    });

    res.json({ logoUrl: url });
  }),
);

schoolsPlatformRoutes.delete(
  "/:id/logo",
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { rows } = await pool.query(`SELECT logo_url FROM schools WHERE id = $1`, [id]);
    if (!rows[0]) throw notFound("Maktab topilmadi");

    await pool.query(`UPDATE schools SET logo_url = NULL, updated_at = now() WHERE id = $1`, [id]);
    await removeLogoFile(rows[0].logo_url);
    await audit(req, {
      action: "school.logo.delete",
      entity: "school",
      entityId: id,
      before: { logo_url: rows[0].logo_url },
      after: { logo_url: null },
    });

    res.json({ logoUrl: null });
  }),
);

// ================================================================ o'z maktabi
export const schoolRoutes = Router();
schoolRoutes.use(requireTenant);

schoolRoutes.get(
  '/',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, slug, region, district, phone, address, logo_url, tg_code, plan, status, settings
         FROM schools WHERE id = $1`,
      [req.schoolId],
    );
    if (!rows[0]) throw notFound('Maktab topilmadi');
    res.json({ school: rows[0] });
  }),
);

// Sozlamalar QISMAN yangilanadi (jsonb merge) — boshqa kalitlar yo'qolmaydi.
schoolRoutes.patch(
  '/settings',
  requireRole('admin'),
  ah(async (req, res) => {
    const input = parse(z.record(z.unknown()), req.body);
    const { rows: before } = await pool.query(`SELECT settings FROM schools WHERE id = $1`, [req.schoolId]);

    const { rows } = await pool.query(
      `UPDATE schools SET settings = settings || $2::jsonb, updated_at = now()
        WHERE id = $1
        RETURNING settings`,
      [req.schoolId, JSON.stringify(input)],
    );

    // To'lov muddati kabi moliyaviy sozlamalar shu yerdan o'tadi — auditga yoziladi.
    await audit(req, {
      action: 'school.settings.update',
      entity: 'school',
      entityId: req.schoolId,
      before: before[0]?.settings,
      after: rows[0].settings,
    });
    res.json({ settings: rows[0].settings });
  }),
);

// ================================================================ o'quv yillari
export const yearsRoutes = Router();
yearsRoutes.use(requireTenant);

yearsRoutes.get(
  '/',
  ah(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, name, starts_on, ends_on, is_current
         FROM academic_years
        WHERE school_id = $1
        ORDER BY starts_on DESC`,
      [req.schoolId],
    );
    res.json({ items: rows });
  }),
);

const yearSchema = z.object({
  name: z.string().min(4, "O'quv yili nomi kamida 4 belgi (masalan: 2026-2027)"),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana formati: YYYY-MM-DD"),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Sana formati: YYYY-MM-DD"),
  isCurrent: z.boolean().default(false),
});

yearsRoutes.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const input = parse(yearSchema, req.body);
    if (input.endsOn <= input.startsOn) throw conflict("Tugash sanasi boshlanish sanasidan keyin bo'lishi kerak");

    const year = await tx(async (client) => {
      if (input.isCurrent) {
        await client.query(`UPDATE academic_years SET is_current = false WHERE school_id = $1`, [req.schoolId]);
      }
      const dup = await client.query(
        `SELECT 1 FROM academic_years WHERE school_id = $1 AND name = $2`,
        [req.schoolId, input.name],
      );
      if (dup.rowCount) throw conflict("Bu nomdagi o'quv yili allaqachon mavjud");

      const { rows } = await client.query(
        `INSERT INTO academic_years (school_id, name, starts_on, ends_on, is_current)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, name, starts_on, ends_on, is_current`,
        [req.schoolId, input.name, input.startsOn, input.endsOn, input.isCurrent],
      );
      return rows[0];
    });

    res.status(201).json({ year });
  }),
);

yearsRoutes.patch(
  '/:id/set-current',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const year = await tx(async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM academic_years WHERE id = $1 AND school_id = $2`,
        [id, req.schoolId],
      );
      if (!rows[0]) throw notFound("O'quv yili topilmadi");

      await client.query(`UPDATE academic_years SET is_current = false WHERE school_id = $1`, [req.schoolId]);
      const updated = await client.query(
        `UPDATE academic_years SET is_current = true WHERE id = $1 AND school_id = $2
         RETURNING id, name, starts_on, ends_on, is_current`,
        [id, req.schoolId],
      );
      return updated.rows[0];
    });
    res.json({ year });
  }),
);
