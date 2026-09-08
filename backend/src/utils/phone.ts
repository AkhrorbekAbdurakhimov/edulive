/**
 * Telefon raqamni yagona ko'rinishga keltiradi: +998XXXXXXXXX.
 *
 * Nega bitta joyda: raqam bazada bitta ko'rinishda yotishi SHART. Ota-ona
 * Telegram botga ulanganda uning raqami `parents.phone` bilan solishtiriladi —
 * import "998901234567" deb, Telegram "+998901234567" deb yozsa, ular hech
 * qachon mos kelmaydi va ota-ona ulanolmaydi. Shuning uchun ikkala joy ham
 * shu funksiyadan o'tadi.
 *
 * Qabul qilinadigan yozuvlar:
 *   +998 90 123 45 67 · 998901234567 · 901234567 · (90) 123-45-67
 *
 * Excelda "+" bilan boshlangan katak formula deb qabul qilinadi va uni
 * kiritish noqulay — shuning uchun "+" siz yozilgani ham to'g'ri hisoblanadi.
 */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  // 998 + 9 xonali abonent raqami
  if (d.length === 12 && d.startsWith('998')) return `+${d}`;
  // Mamlakat kodisiz yozilgan: 90 123 45 67
  if (d.length === 9) return `+998${d}`;
  return null;
}

/** Foydalanuvchiga ko'rsatiladigan qoida — xato matnlari bir xil bo'lsin. */
export const PHONE_HINT = "Format: +998901234567, 998901234567 yoki 901234567";
