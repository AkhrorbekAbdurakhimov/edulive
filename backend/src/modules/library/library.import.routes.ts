/**
 * Kitoblarni Excel orqali kiritish: shablonni yuklab olish -> to'ldirish -> yuklash.
 *
 * O'quvchilar importi bilan bir xil qoida: ATOMIK. Bitta qatorda xato bo'lsa
 * hech narsa yozilmaydi, foydalanuvchi qator raqami bilan ro'yxat oladi.
 */
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { pool, tx } from '../../db/pool.js';
import { requireLibrary } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { audit } from '../audit/audit.service.js';
import { badRequest } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import {
  buildTemplate, readWorkbook, CATEGORY_MAP, LANGUAGE_MAP, MAX_ROWS,
} from './library.import.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const libraryImportRoutes = Router();
libraryImportRoutes.use(requireTenant, requireLibrary);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === XLSX_MIME || file.originalname.toLowerCase().endsWith('.xlsx');
    if (!ok) return cb(badRequest('Faqat .xlsx fayl yuklash mumkin'));
    cb(null, true);
  },
});

const uploadSheet: RequestHandler = (req, res, next) =>
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      return next(badRequest(
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Fayl hajmi 2 MB dan oshmasligi kerak'
          : "Faylni yuklab bo'lmadi",
      ));
    }
    next(err);
  });

libraryImportRoutes.get(
  '/template',
  ah(async (_req, res) => {
    const buf = await buildTemplate();
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', 'attachment; filename="edulive-kitoblar-shablon.xlsx"');
    res.send(buf);
  }),
);

interface ParsedBook {
  row: number;
  title: string;
  author: string | null;
  category: string;
  grade: number | null;
  language: string;
  publisher: string | null;
  publishedYear: number | null;
  isbn: string | null;
  shelf: string | null;
  price: number | null;
  copies: number;
  inventoryNos: string[];
}

libraryImportRoutes.post(
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

    const errors: Array<{ row: number; column: string; message: string }> = [];
    const add = (row: number, column: string, message: string) => errors.push({ row, column, message });

    // Fayl ichidagi takror inventar raqamlarini ham ushlaymiz — bazaga
    // urilgandan keyin emas, oldin aytish tushunarliroq.
    const seenInv = new Map<string, number>();
    const parsed: ParsedBook[] = [];

    for (const r of rows) {
      const [title, author, category, grade, lang, publisher, year, isbn, shelf, price, copies, invs] = r.values;

      if (!title || title.length < 2) add(r.row, 'Nomi', 'Kitob nomi kamida 2 belgi');

      let cat = 'boshqa';
      if (category) {
        cat = CATEGORY_MAP[category.toLowerCase()] ?? '';
        if (!cat) add(r.row, "Bo'lim", 'darslik / badiiy / qollanma / ilmiy / boshqa dan birini yozing');
      }

      let g: number | null = null;
      if (grade) {
        g = Number(grade);
        if (!Number.isInteger(g) || g < 1 || g > 11) {
          add(r.row, 'Sinf', 'Sinf 1 dan 11 gacha butun son');
          g = null;
        }
      }

      let language = 'uz';
      if (lang) {
        language = LANGUAGE_MAP[lang.toLowerCase()] ?? '';
        if (!language) add(r.row, 'Til', "o'zbek / rus / ingliz / boshqa dan birini yozing");
      }

      let py: number | null = null;
      if (year) {
        py = Number(year);
        if (!Number.isInteger(py) || py < 1800 || py > 2100) {
          add(r.row, 'Nashr yili', 'Yil 1800 dan 2100 gacha');
          py = null;
        }
      }

      let p: number | null = null;
      if (price) {
        p = Number(String(price).replace(/[\s,]/g, ''));
        if (!Number.isFinite(p) || p < 0) {
          add(r.row, 'Narxi', "Narx musbat son bo'lishi kerak");
          p = null;
        }
      }

      let count = 1;
      if (copies) {
        count = Number(copies);
        if (!Number.isInteger(count) || count < 1 || count > 500) {
          add(r.row, 'Nusxalar soni', '1 dan 500 gacha butun son');
          count = 1;
        }
      }

      const nos = (invs ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      for (const no of nos) {
        const prev = seenInv.get(no);
        if (prev) add(r.row, 'Inventar raqamlari', `"${no}" ${prev}-qatorda ham bor`);
        else seenInv.set(no, r.row);
      }
      if (nos.length && nos.length !== count && copies) {
        add(r.row, 'Inventar raqamlari',
          `${count} ta nusxa yozilgan, lekin ${nos.length} ta raqam berilgan`);
      }

      parsed.push({
        row: r.row,
        title: title ?? '',
        author, category: cat || 'boshqa', grade: g, language: language || 'uz',
        publisher, publishedYear: py, isbn, shelf, price: p,
        copies: nos.length || count,
        inventoryNos: nos,
      });
    }

    // Bazada band bo'lgan inventar raqamlari
    if (seenInv.size) {
      const { rows: dup } = await pool.query<{ inventory_no: string }>(
        `SELECT inventory_no FROM book_copies
          WHERE school_id = $1 AND inventory_no = ANY($2::text[])`,
        [req.schoolId, [...seenInv.keys()]],
      );
      for (const d of dup) {
        add(seenInv.get(d.inventory_no)!, 'Inventar raqamlari',
          `"${d.inventory_no}" allaqachon bazada bor`);
      }
    }

    if (errors.length) {
      res.status(400).json({
        error: `${errors.length} ta xato topildi — hech narsa saqlanmadi`,
        rows: rows.length,
        errors: errors.slice(0, 50),
      });
      return;
    }

    const result = await tx(async (client) => {
      // Avtomatik raqamlash uchun boshlang'ich nuqta — bir marta o'qiymiz.
      const { rows: maxRows } = await client.query<{ n: string | null }>(
        `SELECT MAX(NULLIF(regexp_replace(inventory_no, '^KT-', ''), '')::bigint)::text AS n
           FROM book_copies
          WHERE school_id = $1 AND inventory_no ~ '^KT-[0-9]+$'`,
        [req.schoolId],
      );
      let next = Number(maxRows[0]?.n ?? 0) + 1;

      // Faylda qo'lda yozilgan raqamlar avtomatik raqamlar bilan to'qnashmasin:
      // bo'sh bazada 1-qator "KT-000001" desa, avtomatik hisob ham 1 dan
      // boshlanib, unique indeks ishga tushib ketardi.
      const taken = new Set(parsed.flatMap((b) => b.inventoryNos));
      const nextFree = (): string => {
        let no = `KT-${String(next).padStart(6, '0')}`;
        while (taken.has(no)) {
          next += 1;
          no = `KT-${String(next).padStart(6, '0')}`;
        }
        next += 1;
        return no;
      };

      let books = 0;
      let copies = 0;

      for (const b of parsed) {
        const { rows: ins } = await client.query<{ id: string }>(
          `INSERT INTO books (school_id, title, author, category, grade, language,
                              publisher, published_year, isbn, shelf, price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
          [req.schoolId, b.title, b.author, b.category, b.grade, b.language,
           b.publisher, b.publishedYear, b.isbn, b.shelf, b.price],
        );
        books += 1;

        const nos = b.inventoryNos.length
          ? b.inventoryNos
          : Array.from({ length: b.copies }, nextFree);

        for (const no of nos) {
          await client.query(
            `INSERT INTO book_copies (school_id, book_id, inventory_no) VALUES ($1,$2,$3)`,
            [req.schoolId, ins[0].id, no],
          );
          copies += 1;
        }
      }

      await audit(req, {
        action: 'book.import', entity: 'book',
        after: { books, copies, rows: rows.length },
      }, client);

      return { books, copies };
    });

    res.status(201).json(result);
  }),
);
