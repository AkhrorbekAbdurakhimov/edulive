import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db/pool.js';
import { requireRole } from '../../middleware/auth.js';
import { requireTenant } from '../../middleware/tenant.js';
import { ah } from '../../utils/http.js';
import { parse } from '../../utils/validate.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { normalizePhone, PHONE_HINT } from '../../utils/phone.js';
import { seal, secretsAvailable } from '../../utils/secretbox.js';
import { env } from '../../config/env.js';
import { audit } from '../audit/audit.service.js';
import { previewSms } from '../debtors/debtors.service.js';
import { accountFor, checkAccount, forgetToken, sendSms, smsBalance } from './sms.service.js';

/**
 * Eskiz sinov matni — kabinetda barcha hisoblar uchun oldindan tasdiqlangan.
 * Shuning uchun tekshiruv SMS si moderatsiyaga bog'liq emas: ulanish
 * ishlayaptimi degan savolga toza javob beradi.
 */
const TEST_TEXT = 'Bu Eskiz dan test';

export const smsRoutes = Router();
smsRoutes.use(requireTenant, requireRole('admin', 'manager'));

/** Holat: hisob ulanganmi, balans qancha, matn qanday ko'rinadi. */
smsRoutes.get(
  '/',
  ah(async (req, res) => {
    const { rows } = await pool.query<{ eskiz_email: string | null; eskiz_from: string | null }>(
      `SELECT eskiz_email, eskiz_from FROM schools WHERE id = $1`,
      [req.schoolId],
    );
    if (!rows[0]) throw notFound('Maktab topilmadi');

    const acc = await accountFor(req.schoolId!);
    res.json({
      configured: acc !== null,
      own: acc?.own ?? false,
      email: rows[0].eskiz_email,
      from: acc?.from ?? env.eskiz.from,
      // Balans Eskizdan olinadi; u javob bermasa null — sahifa baribir ochiladi.
      balance: acc ? await smsBalance(acc) : null,
      // ?template=... — saqlanmagan qoralamani sinash uchun.
      ...(await previewSms(req.schoolId!, typeof req.query.template === 'string' ? req.query.template : undefined)),
    });
  }),
);

/**
 * Maktabning O'Z Eskiz hisobini ulash.
 *
 * Faqat admin: SMS pul turadi va hisob maktab nomidan to'lanadi.
 * Maxfiy kod shifrlab saqlanadi va hech qachon qaytarib berilmaydi.
 */
smsRoutes.put(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    if (!secretsAvailable()) {
      throw badRequest("SECRET_KEY sozlanmagan — maxfiy kodni shifrlab bo'lmaydi");
    }
    const input = parse(
      z.object({
        email: z.string().email('Elektron pochta noto\'g\'ri'),
        // Eskiz kabinetidagi "SMS API" maxfiy kodi — hisobga kirish paroli emas.
        secret: z.string().min(8, 'Maxfiy kod juda qisqa'),
        from: z.string().trim().min(3).max(11).optional(),
      }),
      req.body,
    );

    // Ulashdan oldin tekshiramiz: noto'g'ri kod saqlansa, xato faqat birinchi
    // eslatma yuborilganda — ya'ni eng noqulay paytda — bilinardi.
    await checkAccount({ email: input.email, secret: input.secret, from: input.from ?? env.eskiz.from, own: true });

    await pool.query(
      `UPDATE schools
          SET eskiz_email = $2, eskiz_secret_enc = $3, eskiz_from = COALESCE($4, eskiz_from),
              updated_at = now()
        WHERE id = $1`,
      [req.schoolId, input.email, seal(input.secret), input.from ?? null],
    );

    await audit(req, {
      action: 'sms.account.attach',
      entity: 'school',
      entityId: req.schoolId!,
      // Maxfiy kod auditga YOZILMAYDI — audit jurnali ham o'qiladigan joy.
      after: { email: input.email, from: input.from ?? null },
    });

    res.json({ ok: true });
  }),
);

/** Hisobni uzish — maktab yana platforma hisobiga qaytadi (bo'lsa). */
smsRoutes.delete(
  '/',
  requireRole('admin'),
  ah(async (req, res) => {
    const { rows } = await pool.query<{ eskiz_email: string | null }>(
      `UPDATE schools SET eskiz_email = NULL, eskiz_secret_enc = NULL, updated_at = now()
        WHERE id = $1 RETURNING eskiz_email`,
      [req.schoolId],
    );
    if (rows[0]?.eskiz_email) forgetToken(rows[0].eskiz_email);

    await audit(req, { action: 'sms.account.detach', entity: 'school', entityId: req.schoolId! });
    res.json({ ok: true });
  }),
);

/** Jo'natuvchi nomi (nik) — hisob platformaniki bo'lsa ham maktabniki bo'lishi mumkin. */
smsRoutes.patch(
  '/from',
  requireRole('admin'),
  ah(async (req, res) => {
    const input = parse(z.object({ from: z.string().trim().min(3).max(11) }), req.body);
    await pool.query(`UPDATE schools SET eskiz_from = $2, updated_at = now() WHERE id = $1`, [
      req.schoolId,
      input.from,
    ]);
    await audit(req, {
      action: 'sms.from.update',
      entity: 'school',
      entityId: req.schoolId!,
      after: { from: input.from },
    });
    res.json({ ok: true });
  }),
);

/** Tekshiruv SMS si. Navbatdan o'tmaydi — javob darhol kerak. */
smsRoutes.post(
  '/test',
  requireRole('admin'),
  ah(async (req, res) => {
    const input = parse(z.object({ phone: z.string() }), req.body);
    const phone = normalizePhone(input.phone);
    if (!phone) throw badRequest(`Telefon raqam noto'g'ri. ${PHONE_HINT}`);

    const acc = await accountFor(req.schoolId!);
    if (!acc) throw badRequest("SMS hisobi ulanmagan");

    const r = await sendSms(acc, phone, TEST_TEXT);
    if (!r.ok) throw badRequest(`SMS ketmadi: ${r.error}`);

    await audit(req, {
      action: 'sms.test',
      entity: 'school',
      entityId: req.schoolId!,
      after: { phone, providerId: r.id },
    });
    res.json({ ok: true, id: r.id });
  }),
);

// ================================================================ DLR

/**
 * Yetkazilganlik xabari (DLR). Eskiz uradi — token ham, sessiya ham yo'q.
 *
 * Nega kerak: "yuborildi" bilan "telefonga yetib bordi" bir narsa emas.
 * Raqam o'chirilgan yoki telefon o'chiq bo'lsa, maktab buni bilishi kerak —
 * aks holda "xabar berdik" degan ishonch yolg'on bo'lib chiqadi.
 *
 * Himoya manzildagi maxfiy segmentda: xabar holatini o'zgartirish
 * begonaning ishi emas.
 */
export const smsCallbackRoutes = Router();

smsCallbackRoutes.post(
  '/:secret',
  ah(async (req, res) => {
    if (!env.eskiz.callbackSecret || req.params.secret !== env.eskiz.callbackSecret) {
      throw forbidden('Ruxsat yo\'q');
    }

    const input = parse(
      z.object({
        request_id: z.string().min(1),
        status: z.string().optional(),
        status_date: z.string().optional(),
      }),
      req.body ?? {},
    );

    // DELIVRD — yagona muvaffaqiyatli holat; qolgani (REJECTD, UNDELIV,
    // EXPIRED...) muammo va sababi bilan ko'rinishi kerak.
    const delivered = (input.status ?? '').toUpperCase() === 'DELIVRD';
    await pool.query(
      `UPDATE notifications
          SET delivered_at = CASE WHEN $2 THEN now() ELSE delivered_at END,
              status = CASE WHEN $2 THEN status ELSE 'failed' END,
              error  = CASE WHEN $2 THEN error ELSE $3 END
        WHERE provider_id = $1`,
      [input.request_id, delivered, `Operator yetkazmadi: ${input.status ?? 'nomaʼlum'}`],
    );

    // Eskiz javob kodiga qaraydi: 200 bo'lmasa qayta-qayta uradi.
    res.json({ ok: true });
  }),
);
