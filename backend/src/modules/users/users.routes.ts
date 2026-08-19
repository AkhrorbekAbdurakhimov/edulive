import { Router } from 'express';
import { z } from 'zod';
import { pool, tx } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { audit } from '../audit/audit.service.js';
import { bumpTokenVersion, hashPassword } from '../auth/auth.service.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { parse, uuidParam } from '../../utils/validate.js';

// Maktab xodimlari (admin/menejer/o'qituvchi). Superadmin bu yerda yaratilmaydi.
export const usersRoutes = Router();
usersRoutes.use(requireTenant);

const staffRole = z.enum(['admin', 'manager', 'teacher'], {
  errorMap: () => ({ message: "Rol admin, manager yoki teacher bo'lishi kerak" }),
});

usersRoutes.get(
  '/',
  requireRole('admin', 'manager'),
  ah(async (req, res) => {
    const role = req.query.role ? parse(staffRole, req.query.role) : null;
    const { rows } = await pool.query(
      `SELECT id, full_name, phone, email, role, is_active, last_login_at, created_at
         FROM users
        WHERE school_id = $1 AND ($2::text IS NULL OR role = $2)
        ORDER BY role, full_name`,
      [req.schoolId, role],
    );
    res.json({ items: rows });
  }),
);

const createUserSchema = z.object({
  fullName: z.string().min(3, "Ism-familiya kamida 3 belgidan iborat bo'lishi kerak"),
  phone: z.string().regex(/^\+998\d{9}$/, "Telefon raqam formati noto'g'ri (+998XXXXXXXXX)"),
  email: z.string().email("Email formati noto'g'ri").optional(),
  password: z.string().min(8, "Parol kamida 8 belgidan iborat bo'lishi kerak"),
  role: staffRole,
});

usersRoutes.post(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const input = parse(createUserSchema, req.body);

    const dup = await pool.query(`SELECT 1 FROM users WHERE school_id = $1 AND phone = $2`, [
      req.schoolId,
      input.phone,
    ]);
    if (dup.rowCount) throw conflict("Bu telefon raqamli xodim allaqachon mavjud");

    const { rows } = await pool.query(
      `INSERT INTO users (school_id, full_name, phone, email, password_hash, role)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, full_name, phone, email, role, is_active, created_at`,
      [req.schoolId, input.fullName, input.phone, input.email ?? null, await hashPassword(input.password), input.role],
    );

    await audit(req, {
      action: 'user.create',
      entity: 'user',
      entityId: rows[0].id,
      after: { fullName: input.fullName, phone: input.phone, role: input.role },
    });
    res.status(201).json({ user: rows[0] });
  }),
);

const patchUserSchema = z.object({
  fullName: z.string().min(3).optional(),
  phone: z.string().regex(/^\+998\d{9}$/, "Telefon raqam formati noto'g'ri").optional(),
  email: z.string().email().optional(),
  role: staffRole.optional(),
  isActive: z.boolean().optional(),
});

usersRoutes.patch(
  '/:id',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const input = parse(patchUserSchema, req.body);

    if (id === req.user!.id && input.isActive === false) {
      throw badRequest("O'zingizni o'chira olmaysiz");
    }

    const user = await tx(async (client) => {
      const { rows: before } = await client.query(
        `SELECT id, full_name, phone, role, is_active FROM users
          WHERE id = $1 AND school_id = $2 AND role <> 'superadmin'`,
        [id, req.schoolId],
      );
      if (!before[0]) throw notFound('Xodim topilmadi');

      const { rows } = await client.query(
        `UPDATE users SET
           full_name = COALESCE($3, full_name),
           phone     = COALESCE($4, phone),
           email     = COALESCE($5, email),
           role      = COALESCE($6, role),
           is_active = COALESCE($7, is_active)
         WHERE id = $1 AND school_id = $2
         RETURNING id, full_name, phone, email, role, is_active`,
        [id, req.schoolId, input.fullName ?? null, input.phone ?? null, input.email ?? null, input.role ?? null, input.isActive ?? null],
      );

      // Chiqarilgan xodimning barcha sessiyalari darhol bekor bo'ladi.
      if (input.isActive === false) await bumpTokenVersion(id, client);

      await audit(
        req,
        { action: 'user.update', entity: 'user', entityId: id, before: before[0], after: input },
        client,
      );
      return rows[0];
    });

    res.json({ user });
  }),
);

usersRoutes.post(
  '/:id/reset-password',
  requireRole('admin'),
  ah(async (req, res) => {
    const id = uuidParam(req);
    const { newPassword } = parse(
      z.object({ newPassword: z.string().min(8, "Parol kamida 8 belgidan iborat bo'lishi kerak") }),
      req.body,
    );

    await tx(async (client) => {
      const { rows } = await client.query(
        `UPDATE users SET password_hash = $3, token_version = token_version + 1
          WHERE id = $1 AND school_id = $2 AND role <> 'superadmin'
          RETURNING id`,
        [id, req.schoolId, await hashPassword(newPassword)],
      );
      if (!rows[0]) throw notFound('Xodim topilmadi');
      await audit(req, { action: 'user.reset_password', entity: 'user', entityId: id }, client);
    });

    res.json({ ok: true });
  }),
);
