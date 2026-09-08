/**
 * Telefon raqam normalizatsiyasi.
 *
 * Bu qoida import va Telegram uchun UMUMIY: ikkalasi bir xil natija bermasa,
 * ota-ona botga ulanolmaydi va buni sezish qiyin bo'ladi.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../utils/phone.js';

test('turli ko\'rinishlar bitta natijaga keladi', () => {
  const same = [
    '+998901234567',
    '998901234567',      // Excelda "+" formula deb qabul qilinadi — shusiz yoziladi
    '901234567',         // mamlakat kodisiz
    '+998 90 123 45 67',
    '998 90 123 45 67',
    '(90) 123-45-67',
    ' 90 123 45 67 ',
  ];
  for (const raw of same) {
    assert.equal(normalizePhone(raw), '+998901234567', `"${raw}" noto'g'ri o'girildi`);
  }
});

test('yaroqsiz raqamlar rad etiladi', () => {
  for (const raw of ['', '12345', '9012345', '99890123456789', 'telefon yo\'q', '00000']) {
    assert.equal(normalizePhone(raw), null, `"${raw}" qabul qilinmasligi kerak`);
  }
});

test("bir marta o'tkazilgan raqam o'zgarmaydi (idempotent)", () => {
  const once = normalizePhone('901234567')!;
  assert.equal(normalizePhone(once), once);
});
