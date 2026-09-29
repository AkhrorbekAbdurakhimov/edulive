/**
 * SMS kanali va qarz eslatmasi.
 *
 * Tarmoqqa chiqilmaydi: `NODE_ENV=test` da sms.service quruq rejimda ishlaydi
 * (aks holda testlar haqiqiy Eskiz balansini yeb qo'yardi).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { pool } from '../db/pool.js';
import { smsParts, toEskizPhone } from '../modules/sms/sms.service.js';
import { DEFAULT_SMS_TEMPLATE, smsBody } from '../modules/debtors/debtors.service.js';
import {
  createTestSchool,
  createTestStudent,
  dropTestSchool,
  startServer,
  type TestApi,
  type TestSchool,
} from './helpers.js';

const SLUG = 'test-sms';
const PHONE_SMS = '+998901110001';   // Telegramga ulanmagan
const PHONE_TG = '+998901110002';    // Telegramga ulangan — u ham SMS oladi

let server: Server;
let api: TestApi;
let school: TestSchool;
let smsStudent: string;
let tgStudent: string;

before(async () => {
  ({ server, api } = startServer());
  school = await createTestSchool(SLUG, { monthlyFee: 1_000_000 });

  smsStudent = (await createTestStudent(school, 'Qarzdor', 'Ali', { parentPhone: PHONE_SMS })).studentId;
  tgStudent = (await createTestStudent(school, 'Ulangan', 'Vali', { parentPhone: PHONE_TG })).studentId;

  await pool.query(
    `UPDATE parent_phones SET telegram_chat_id = 777001, telegram_verified_at = now()
      WHERE school_id = $1 AND phone = $2`,
    [school.schoolId, PHONE_TG],
  );

  // Ikkalasida ham qarz bo'lsin.
  await api('POST', '/invoices/generate', { periodMonth: '2026-09' }, school.adminToken);
});

after(async () => {
  await dropTestSchool(SLUG);
  server?.close();
  await pool.end();
});

// ---------------------------------------------------------------- toza funksiyalar

test('raqam Eskiz ko\'rinishiga o\'giriladi', () => {
  assert.equal(toEskizPhone('+998901234567'), '998901234567');
  assert.equal(toEskizPhone('998 90 123 45 67'), '998901234567');
  assert.equal(toEskizPhone('901234567'), null, 'mamlakat kodisiz raqam qabul qilinmaydi');
});

test('lotin matn bitta SMS, kirill/oʻ belgisi Unicode ga o\'tkazadi', () => {
  const latin = smsParts("Maktab: Aliyev Vali uchun to'lanmagan 1 200 000 so'm.");
  assert.equal(latin.parts, 1);
  assert.equal(latin.unicode, false);

  // U+02BB ("oʻ") GSM-7 da yo'q — sig'im 160 dan 70 ga tushadi.
  const uni = smsParts('Toʻlov');
  assert.equal(uni.unicode, true);
});

test("sukutdagi shablon bitta SMS ga sig'adi", () => {
  const text = smsBody(DEFAULT_SMS_TEMPLATE, 'Zamonaviy Talim maktabi', {
    student_id: '',
    student_name: 'Abdurahimov Abdurashid',
    outstanding: 12_000_000,
    oldest_due: '2026-09-10',
  });
  const p = smsParts(text);
  assert.equal(p.unicode, false, 'shablonda GSM-7 dan tashqari belgi bo\'lmasligi kerak');
  assert.equal(p.parts, 1, `bitta SMS ga sig'ishi kerak, hozir ${p.units} belgi`);
});

// ---------------------------------------------------------------- eslatma

test("SMS o'chiq bo'lsa, SMS tugmasi nima qilish kerakligini aytadi", async () => {
  const r = await api('POST', `/debtors/${smsStudent}/remind`, { channel: 'sms' }, school.adminToken);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Sozlamalar > SMS/);
});

test("kanal ko'rsatilmasa so'rov rad etiladi", async () => {
  const r = await api('POST', `/debtors/${smsStudent}/remind`, {}, school.adminToken);
  assert.equal(r.status, 400, 'kanalsiz yuborish ikkilanish qoldiradi — taqiqlanadi');
});

test('botga ulanmagan ota-onaga Telegram xabari ketmaydi', async () => {
  const r = await api('POST', `/debtors/${smsStudent}/remind`, { channel: 'telegram' }, school.adminToken);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /botga ulanmagan/);
});

test('SMS yoqilgach eslatma SMS kanaliga tushadi va jo\'natiladi', async () => {
  const on = await api('PATCH', '/school/settings', { sms_debt_enabled: true }, school.adminToken);
  assert.equal(on.status, 200);

  const r = await api('POST', `/debtors/${smsStudent}/remind`, { channel: 'sms' }, school.adminToken);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sms, 1);
  assert.equal(r.body.telegram, 0);

  const { rows } = await pool.query(
    `SELECT channel, status, body, to_phone, provider_id FROM notifications
      WHERE student_id = $1 AND kind = 'debt.reminder'`,
    [smsStudent],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channel, 'sms');
  assert.equal(rows[0].status, 'sent', 'quruq rejimda jo\'natilgan deb belgilanadi');
  assert.equal(rows[0].to_phone, PHONE_SMS);
  assert.ok(rows[0].provider_id, 'DLR ni bog\'lash uchun provayder raqami saqlanishi kerak');
  assert.ok(smsParts(rows[0].body).parts === 1, 'SMS matni bitta qismga sig\'ishi kerak');
});

test('shu KANALDAN yaqinda olgan o\'quvchiga ikkinchi marta yuborilmaydi', async () => {
  const r = await api('POST', `/debtors/${smsStudent}/remind`, { channel: 'sms' }, school.adminToken);
  assert.equal(r.status, 400);
  assert.match(r.body.error, /SMS yaqinda yuborilgan/);
});

test("Har kanal ALOHIDA ketadi: biri ikkinchisini bloklamaydi", async () => {
  const tg = await api('POST', `/debtors/${tgStudent}/remind`, { channel: 'telegram' }, school.adminToken);
  assert.equal(tg.status, 200, JSON.stringify(tg.body));
  assert.equal(tg.body.telegram, 1);
  assert.equal(tg.body.sms, 0, 'Telegram tugmasi SMS yubormasligi kerak');

  // Telegram ketgani SMS ni to'smaydi: bu ikki alohida qaror.
  const sms = await api('POST', `/debtors/${tgStudent}/remind`, { channel: 'sms' }, school.adminToken);
  assert.equal(sms.status, 200, JSON.stringify(sms.body));
  assert.equal(sms.body.sms, 1, 'Telegram ketgani SMS ni bloklamasligi kerak');
  assert.equal(sms.body.telegram, 0);

  const { rows } = await pool.query(
    `SELECT channel FROM notifications WHERE student_id = $1 AND kind = 'debt.reminder'
      ORDER BY channel`,
    [tgStudent],
  );
  assert.deepEqual(rows.map((r2) => r2.channel), ['sms', 'telegram']);
});

// ---------------------------------------------------------------- ommaviy

test("ro'yxatga yuborishda yaqinda eslatma olganlar o'tkazib yuboriladi", async () => {
  const r = await api('POST', '/debtors/remind-all', { channel: 'sms', overdueOnly: false }, school.adminToken);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.students, 2);
  assert.equal(r.body.skipped, 2, 'ikkalasi ham yuqoridagi testlarda eslatma olgan');
  assert.equal(r.body.telegram + r.body.sms, 0);
});

test("ommaviy yuborish yangi qarzdorga ishlaydi", async () => {
  const fresh = (
    await createTestStudent(school, 'Yangi', 'Qarzdor', { parentPhone: '+998901110003' })
  ).studentId;
  await api('POST', '/invoices/generate', { periodMonth: '2026-10' }, school.adminToken);

  const r = await api('POST', '/debtors/remind-all', { channel: 'sms', overdueOnly: false }, school.adminToken);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sms, 1, 'faqat yangi o\'quvchiga SMS ketishi kerak');

  const { rows } = await pool.query(
    `SELECT count(*)::int AS c FROM notifications WHERE student_id = $1 AND channel = 'sms'`,
    [fresh],
  );
  assert.equal(rows[0].c, 1);
});

test("xabari o'chirilgan raqamga SMS ham ketmaydi", async () => {
  const quiet = (
    await createTestStudent(school, 'Jim', 'Bola', { parentPhone: '+998901110009' })
  ).studentId;
  await pool.query(
    `UPDATE parent_phones SET notify_enabled = false WHERE school_id = $1 AND phone = $2`,
    [school.schoolId, '+998901110009'],
  );
  await api('POST', '/invoices/generate', { periodMonth: '2026-09' }, school.adminToken);

  const r = await api('POST', `/debtors/${quiet}/remind`, { channel: 'sms' }, school.adminToken);
  assert.equal(r.status, 400, JSON.stringify(r.body));
});

// ---------------------------------------------------------------- huquqlar

test("o'qituvchi faqat O'Z sinfidagi qarzdorlarni ko'radi va ularga yuboradi", async () => {
  // Boshqa sinf — o'qituvchiga biriktirilmagan.
  const otherClass = (
    await pool.query<{ id: string }>(
      `INSERT INTO classes (school_id, academic_year_id, grade, letter, monthly_fee)
       VALUES ($1, $2, 2, 'B', 1000000) RETURNING id`,
      [school.schoolId, school.yearId],
    )
  ).rows[0].id;
  const outsider = (
    await createTestStudent(school, 'Begona', 'Bola', {
      classId: otherClass,
      parentPhone: '+998901110010',
    })
  ).studentId;
  await api('POST', '/invoices/generate', { periodMonth: '2026-09' }, school.adminToken);

  const list = await api('GET', '/debtors', undefined, school.teacherToken);
  assert.equal(list.status, 200);
  assert.ok(
    !list.body.items.some((i: { student_id: string }) => i.student_id === outsider),
    "begona sinf o'quvchisi o'qituvchi ro'yxatida ko'rinmasligi kerak",
  );

  // Begona o'quvchiga eslatma yubora olmaydi — qarzi borligi ham aytilmaydi.
  const blocked = await api('POST', `/debtors/${outsider}/remind`, { channel: 'sms' }, school.teacherToken);
  assert.equal(blocked.status, 400);

  // Ommaviy yuborishda ham begona o'quvchi qamrab olinmaydi.
  const bulk = await api(
    'POST', '/debtors/remind-all', { channel: 'sms', studentIds: [outsider] }, school.teacherToken,
  );
  assert.equal(bulk.status, 200, JSON.stringify(bulk.body));
  assert.equal(bulk.body.students, 0);

  // O'z sinfidagi yangi qarzdorga esa yuboradi.
  const mine = (
    await createTestStudent(school, 'Mening', 'Shogirdim', { parentPhone: '+998901110011' })
  ).studentId;
  await api('POST', '/invoices/generate', { periodMonth: '2026-09' }, school.adminToken);
  const ok = await api('POST', `/debtors/${mine}/remind`, { channel: 'sms' }, school.teacherToken);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.sms, 1);
});

test("tanlangan o'quvchilarga yuborish faqat o'shalarga tegadi", async () => {
  const a = (
    await createTestStudent(school, 'Tanlov', 'Bir', { parentPhone: '+998901110012' })
  ).studentId;
  const b = (
    await createTestStudent(school, 'Tanlov', 'Ikki', { parentPhone: '+998901110013' })
  ).studentId;
  await api('POST', '/invoices/generate', { periodMonth: '2026-09' }, school.adminToken);

  const r = await api('POST', '/debtors/remind-all', { channel: 'sms', studentIds: [a] }, school.adminToken);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.students, 1);
  assert.equal(r.body.sms, 1);

  const { rows } = await pool.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM notifications WHERE student_id = $1`,
    [b],
  );
  assert.equal(rows[0].c, 0, "tanlanmagan o'quvchiga xabar ketmasligi kerak");
});

test('SMS holati admin va menejerga ko\'rinadi', async () => {
  const r = await api('GET', '/sms', undefined, school.managerToken);
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.parts, 1);
  assert.ok(r.body.example.includes('Aliyev Vali'));
});
