/**
 * O'quvchilarni Excel orqali kiritish.
 *
 * Oqim: shablonni yuklab olish -> to'ldirish -> qaytadan yuklash.
 *
 * Import ATOMIK: bitta qatorda ham xato bo'lsa hech narsa yozilmaydi va
 * foydalanuvchi qator raqami bilan xatolar ro'yxatini oladi. Yarim import
 * qilingan ro'yxatni qo'lda tozalash faylni tuzatishdan ancha og'ir.
 */
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { pool, tx, type Db } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { audit } from '../audit/audit.service.js';
import { getCurrentYear } from '../schools/schools.service.js';
import { badRequest } from '../../utils/errors.js';
import { normalizePhone, PHONE_HINT } from '../../utils/phone.js';
import { ah } from '../../utils/http.js';
import { linkGuardian, type GuardianInput } from './students.service.js';
import { buildTemplate, readWorkbook, MAX_ROWS } from './students.import.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const studentsImportRoutes = Router();
studentsImportRoutes.use(requireTenant, requireRole('admin', 'manager'));

const upload = multer({
  // Diskka yozilmaydi: fayl bir marta o'qiladi va tashlanadi.
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === XLSX_MIME || file.originalname.toLowerCase().endsWith('.xlsx');
    if (!ok) return cb(badRequest('Faqat .xlsx fayl yuklash mumkin'));
    cb(null, true);
  },
});

// Multer o'z xatolarini MulterError sifatida beradi — ular 500 emas, 400 bo'lsin.
const uploadSheet: RequestHandler = (req, res, next) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(badRequest(
        err.code === 'LIMIT_FILE_SIZE'
          ? "Fayl hajmi 2 MB dan oshmasligi kerak"
          : "Faylni yuklab bo'lmadi",
      ));
    }
    next(err);
  });

/** Joriy o'quv yilidagi sinflar: NOMI (katta harfda) -> id */
async function classMap(db: Db, schoolId: string): Promise<Map<string, string>> {
  const { rows } = await db.query<{ id: string; name: string }>(
    `SELECT c.id, c.grade || '-' || c.letter AS name
       FROM classes c
       JOIN academic_years y ON y.id = c.academic_year_id
      WHERE c.school_id = $1 AND y.is_current`,
    [schoolId],
  );
  return new Map(rows.map((r) => [r.name.toUpperCase(), r.id]));
}

studentsImportRoutes.get(
  '/template',
  ah(async (req, res) => {
    const classes = await classMap(pool, req.schoolId!);
    const buf = await buildTemplate([...classes.keys()].sort());
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', 'attachment; filename="edulive-oquvchilar-shablon.xlsx"');
    res.send(buf);
  }),
);

// Foydalanuvchi turlicha yozishi mumkin — hammasini qabul qilamiz.
const GENDERS: Record<string, 'm' | 'f'> = {
  "o'g'il": 'm', 'o‘g‘il': 'm', 'ogil': 'm', 'm': 'm', 'erkak': 'm',
  'qiz': 'f', 'f': 'f', 'ayol': 'f',
};
const RELATIONS: Record<string, string> = {
  ota: 'father', father: 'father',
  ona: 'mother', mother: 'mother',
  vasiy: 'guardian', guardian: 'guardian',
};

interface ParsedRow {
  row: number;
  lastName: string;
  firstName: string;
  middleName: string | null;
  birthDate: string | null;
  gender: 'm' | 'f' | null;
  classId: string | null;
  discount: number;
  externalId: string | null;
  guardians: GuardianInput[];
}

studentsImportRoutes.post(
  '/',
  uploadSheet,
  ah(async (req, res) => {
    if (!req.file) throw badRequest('Fayl yuborilmadi');

    let rows;
    try {
      rows = await readWorkbook(req.file.buffer);
    } catch {
      throw badRequest("Faylni o'qib bo'lmadi — shablonni yuklab olib, o'shani to'ldiring");
    }
    if (!rows.length) throw badRequest("Faylda ma'lumot yo'q");
    if (rows.length > MAX_ROWS) {
      throw badRequest(`Bir faylda ${MAX_ROWS} tagacha qator bo'ladi (hozir ${rows.length} ta)`);
    }

    const classes = await classMap(pool, req.schoolId!);
    const errors: Array<{ row: number; column: string; message: string }> = [];
    const add = (row: number, column: string, message: string) => errors.push({ row, column, message });

    const seenExternal = new Map<string, number>();
    const parsed: ParsedRow[] = [];

    for (const r of rows) {
      const [last, first, middle, birth, gender, cls, discount,
             g1Name, g1Phone, g1Extra, g1Rel,
             g2Name, g2Phone, g2Extra, g2Rel, ext] = r.values;

      if (!last || last.length < 2) add(r.row, 'Familiya', 'Familiya kamida 2 belgi');
      if (!first || first.length < 2) add(r.row, 'Ism', 'Ism kamida 2 belgi');

      let birthDate: string | null = null;
      if (birth) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) add(r.row, "Tug'ilgan sana", 'Sana formati: YYYY-MM-DD');
        else if (Number.isNaN(Date.parse(birth))) add(r.row, "Tug'ilgan sana", "Sana noto'g'ri");
        else birthDate = birth;
      }

      let g: 'm' | 'f' | null = null;
      if (gender) {
        g = GENDERS[gender.toLowerCase()] ?? null;
        if (!g) add(r.row, 'Jinsi', 'Jinsi "o\'g\'il" yoki "qiz" bo\'lishi kerak');
      }

      let classId: string | null = null;
      if (cls) {
        classId = classes.get(cls.toUpperCase()) ?? null;
        if (!classId) {
          add(r.row, 'Sinf', classes.size
            ? `"${cls}" sinfi topilmadi. Mavjud: ${[...classes.keys()].sort().join(', ')}`
            : "Maktabda sinf yo'q — avval Sinflar bo'limida sinf oching");
        }
      }

      let disc = 0;
      if (discount) {
        disc = Number(String(discount).replace(',', '.'));
        if (!Number.isFinite(disc) || disc < 0 || disc > 100) {
          add(r.row, 'Chegirma %', 'Chegirma 0 dan 100 gacha');
          disc = 0;
        }
      }

      // Ikkita mas'ul shaxs bir xil qoida bilan o'qiladi.
      const guardians: GuardianInput[] = [];
      const readGuardian = (
        n: number, name: string | null, main: string | null,
        extra: string | null, rel: string | null,
      ) => {
        if (!name && !main && !extra && !rel) return;   // bo'sh blok — o'tkazamiz
        const who = `${n}-mas'ul`;
        if (!name || name.length < 3) add(r.row, `${who} F.I.Sh`, 'Ism kamida 3 belgi');

        // Raqam qanday yozilgan bo'lsa ham yagona ko'rinishga keltiriladi:
        // Excelda "+" bilan boshlash noqulay, shuning uchun "+" siz ham bo'ladi.
        const phones: string[] = [];
        if (!main) add(r.row, `${who} telefoni`, 'Telefon kiritilishi shart');
        else {
          const p1 = normalizePhone(main);
          if (!p1) add(r.row, `${who} telefoni`, PHONE_HINT);
          else phones.push(p1);
        }
        if (extra) {
          const p2 = normalizePhone(extra);
          if (!p2) add(r.row, `${who} qo'shimcha telefoni`, PHONE_HINT);
          else if (!phones.includes(p2)) phones.push(p2);
        }

        let relation: string | null = null;
        if (rel) {
          relation = RELATIONS[rel.toLowerCase()] ?? null;
          if (!relation) add(r.row, `${who} kim bo'ladi`, "\"ota\", \"ona\" yoki \"vasiy\" bo'lishi kerak");
        }

        if (name && name.length >= 3 && phones.length) {
          guardians.push({ fullName: name, phones, relation });
        }
      };
      readGuardian(1, g1Name, g1Phone, g1Extra, g1Rel);
      readGuardian(2, g2Name, g2Phone, g2Extra, g2Rel);

      // Bir xil raqam ikkala blokda bo'lsa, ikkinchisi birinchisiga qo'shilib
      // ketardi va "kim bo'ladi" chalkashardi. Ochiq aytamiz.
      if (guardians.length === 2) {
        const dup = guardians[0].phones.find((x) => guardians[1].phones.includes(x));
        if (dup) add(r.row, "2-mas'ul telefoni", `"${dup}" 1-mas'ul shaxsda ham bor`);
      }

      if (ext) {
        const prev = seenExternal.get(ext);
        if (prev) add(r.row, 'Maktab ID', `"${ext}" ${prev}-qatorda ham bor — takrorlanmasligi kerak`);
        else seenExternal.set(ext, r.row);
      }

      parsed.push({
        row: r.row,
        lastName: last ?? '',
        firstName: first ?? '',
        middleName: middle,
        birthDate,
        gender: g,
        classId,
        discount: disc,
        externalId: ext,
        guardians,
      });
    }

    // Bazadagi mavjud "Maktab ID" lar bilan to'qnashuv (unique indeks bor).
    if (seenExternal.size) {
      const { rows: dup } = await pool.query<{ external_id: string }>(
        `SELECT external_id FROM students WHERE school_id = $1 AND external_id = ANY($2::text[])`,
        [req.schoolId, [...seenExternal.keys()]],
      );
      for (const d of dup) {
        add(seenExternal.get(d.external_id)!, 'Maktab ID', `"${d.external_id}" allaqachon bazada bor`);
      }
    }

    if (errors.length) {
      // Hech narsa yozilmadi — foydalanuvchi faylni tuzatib qayta yuboradi.
      res.status(400).json({
        error: `${errors.length} ta xato topildi — hech narsa saqlanmadi`,
        rows: rows.length,
        errors: errors.slice(0, 50),
      });
      return;
    }

    const needsYear = parsed.some((p) => p.classId);
    const result = await tx(async (client) => {
      const year = needsYear ? await getCurrentYear(req.schoolId!, client) : null;
      let students = 0;
      let parents = 0;

      for (const p of parsed) {
        const { rows: ins } = await client.query<{ id: string }>(
          `INSERT INTO students (school_id, last_name, first_name, middle_name, birth_date, gender, external_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [req.schoolId, p.lastName, p.firstName, p.middleName, p.birthDate, p.gender, p.externalId],
        );
        const id = ins[0].id;
        students += 1;

        if (p.classId && year) {
          await client.query(
            `INSERT INTO enrollments (school_id, student_id, class_id, academic_year_id, discount_percent)
             VALUES ($1,$2,$3,$4,$5)`,
            [req.schoolId, id, p.classId, year.id, p.discount],
          );
        }
        // Birinchi mas'ul shaxs asosiy: ro'yxatlarda va xabarlarda u ko'rsatiladi.
        for (const [gi, g] of p.guardians.entries()) {
          await linkGuardian(client, req.schoolId!, id, g, gi === 0);
          parents += 1;
        }
      }

      await audit(req, {
        action: 'student.import',
        entity: 'student',
        after: { students, parents, rows: rows.length },
      }, client);

      return { students, parents };
    });

    res.status(201).json(result);
  }),
);
