/**
 * SMS jo'natish — Eskiz.uz (notify.eskiz.uz).
 *
 * Nega Telegramdan tashqari SMS ham kerak: to'lov eslatmasi HAMMAGA yetishi
 * shart. Telegram botiga ulanmaganlar uni umuman olmaydi, ulanganlar esa
 * yuzlab chat orasida ko'rmay qolishi mumkin. SMS pullik, shuning uchun u
 * faqat qarz eslatmasida va faqat maktab yoqqanda ishlatiladi.
 *
 * Telegram boti bilan bir xil naqsh: maktabning o'z hisobi bo'lsa o'shaniki,
 * bo'lmasa platformaniki (.env). Maktab hech narsa qilmasdan ishlay boshlaydi.
 *
 * Eskiz haqida bilish shart bo'lgan uch narsa:
 *  1. Token 30 kun amal qiladi — har jo'natishda login QILINMAYDI, aks holda
 *     Eskiz so'rovlarni cheklaydi. Xotirada saqlanadi, 401 da yangilanadi.
 *  2. Matn kabinetda MODERATSIYADAN o'tgan shablonga mos bo'lishi shart.
 *     Tasdiqlanmagan matnni Eskiz rad etadi — bu nosozlik emas, qoida.
 *  3. Nik (`from`) ham tasdiqlanadi. 4546 — faqat sinov niki.
 */
import { randomUUID } from 'node:crypto';
import { pool, type Db } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { open } from '../../utils/secretbox.js';

const API = 'https://notify.eskiz.uz/api';

/**
 * Quruq rejim — tarmoqqa umuman chiqilmaydi.
 *
 * Testda MAJBURIY: `.env` da haqiqiy Eskiz kaliti turadi, `npm test` esa
 * uydirma raqamlarga xabar yuborib, balansni yeb qo'yardi (yoki eng yomoni —
 * begona odamga SMS ketardi). `SMS_DRY_RUN=1` bilan qo'lda ham yoqiladi:
 * matn va kanal tanlovini pul sarflamasdan tekshirish uchun.
 */
const DRY_RUN = env.nodeEnv === 'test' || process.env.SMS_DRY_RUN === '1';

/** Token 30 kun yashaydi; muddatidan ancha oldin yangilaymiz. */
const TOKEN_TTL_MS = 20 * 24 * 3600 * 1000;

export interface SmsAccount {
  email: string;
  secret: string;
  /** Jo'natuvchi nomi (nik). */
  from: string;
  /** false — maktabning o'z hisobi yo'q, platformaniki ishlatilyapti. */
  own: boolean;
}

export interface SmsResult {
  ok: boolean;
  /** Eskizdagi so'rov UUID si — yetkazilganlik xabari (DLR) shu bilan keladi. */
  id?: string;
  error?: string;
}

// ---------------------------------------------------------------- hisob

/**
 * Maktab uchun SMS hisobi. Hech qayerda sozlanmagan bo'lsa `null` —
 * chaqiruvchi SMS ni jimgina o'tkazib yuboradi (SMS ixtiyoriy kanal).
 */
export async function accountFor(schoolId: string, db: Db = pool): Promise<SmsAccount | null> {
  const { rows } = await db.query<{
    eskiz_email: string | null;
    eskiz_secret_enc: string | null;
    eskiz_from: string | null;
  }>(`SELECT eskiz_email, eskiz_secret_enc, eskiz_from FROM schools WHERE id = $1`, [schoolId]);
  const s = rows[0];
  if (!s) return null;

  if (s.eskiz_email && s.eskiz_secret_enc) {
    return {
      email: s.eskiz_email,
      secret: open(s.eskiz_secret_enc),
      from: s.eskiz_from || env.eskiz.from,
      own: true,
    };
  }
  if (!env.eskiz.email || !env.eskiz.secret) return null;
  // Nik maktabniki bo'lishi mumkin: hisob platformaniki bo'lsa ham xabar
  // maktab nomidan ketsin.
  return {
    email: env.eskiz.email,
    secret: env.eskiz.secret,
    from: s.eskiz_from || env.eskiz.from,
    own: false,
  };
}

// ---------------------------------------------------------------- token

const tokens = new Map<string, { token: string; at: number }>();

async function login(acc: SmsAccount): Promise<string> {
  if (DRY_RUN) return 'dry-run-token';
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: acc.email, password: acc.secret }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { token?: string }; message?: string };
  const token = json.data?.token;
  if (!res.ok || !token) {
    throw new Error(`Eskizga kirib bo'lmadi: ${json.message ?? `HTTP ${res.status}`}`);
  }
  tokens.set(acc.email, { token, at: Date.now() });
  return token;
}

async function tokenFor(acc: SmsAccount): Promise<string> {
  const hit = tokens.get(acc.email);
  if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token;
  return login(acc);
}

/** Hisob almashtirilganda eski token yaroqsiz — keshdan olib tashlanadi. */
export function forgetToken(email: string): void {
  tokens.delete(email);
}

/**
 * Eskiz API chaqiruvi. 401 da bir marta qayta kirib uriniladi: 20 kunda bir
 * marta bo'ladigan holat uchun xabarni yo'qotish ma'nosiz.
 */
async function call<T>(
  acc: SmsAccount,
  method: 'GET' | 'POST',
  path: string,
  body?: URLSearchParams,
  retry = true,
): Promise<T> {
  const token = await tokenFor(acc);
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });

  if (res.status === 401 && retry) {
    tokens.delete(acc.email);
    return call<T>(acc, method, path, body, false);
  }

  const json = (await res.json().catch(() => ({}))) as T & { message?: unknown };
  if (!res.ok) {
    const m = typeof json.message === 'string' ? json.message : `HTTP ${res.status}`;
    throw new Error(m);
  }
  return json;
}

// ---------------------------------------------------------------- matn

/**
 * Raqamni Eskiz kutgan ko'rinishga keltiradi: 998901234567 ("+" siz).
 * Bazada raqam har doim +998... ko'rinishida (utils/phone.ts).
 */
export function toEskizPhone(phone: string): string | null {
  const d = phone.replace(/\D/g, '');
  return d.length === 12 && d.startsWith('998') ? d : null;
}

/**
 * GSM-7 alifbosi. Undan tashqaridagi BITTA belgi butun xabarni Unicode ga
 * o'tkazadi va sig'im 160 dan 70 ga tushadi — ya'ni narx ikki barobar.
 * Aynan shuning uchun matnlarda "oʻ" (U+02BB) emas, oddiy apostrof (') va
 * "№" o'rniga "N" ishlatiladi.
 */
const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** Bu belgilar GSM-7 da ikki o'rin egallaydi. */
const GSM7_EXT = '^{}\\[~]|€';

/** Xabar necha qismga bo'linadi — ya'ni necha barobar pul ketadi. */
export function smsParts(text: string): { parts: number; unicode: boolean; units: number } {
  let units = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM7.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else { unicode = true; break; }
  }
  if (unicode) {
    // Unicode da hisob UTF-16 kod birliklarida.
    units = text.length;
    return { parts: units <= 70 ? 1 : Math.ceil(units / 67), unicode, units };
  }
  return { parts: units <= 160 ? 1 : Math.ceil(units / 153), unicode, units };
}

// ---------------------------------------------------------------- amallar

function callbackUrl(): string | undefined {
  const base = env.publicUrl.replace(/\/+$/, '');
  // Fail-closed: maxfiy segment yo'q bo'lsa DLR so'ralmaydi, aks holda
  // manzilni topgan har kim xabar holatini o'zgartira olardi.
  if (!env.eskiz.callbackSecret || !base.startsWith('https://')) return undefined;
  return `${base}/api/sms/dlr/${env.eskiz.callbackSecret}`;
}

/**
 * Bitta SMS. Xato TASHLAMAYDI — sababni qaytaradi: navbatdagi bitta xabar
 * yiqilsa qolganlari ketaverishi kerak.
 */
export async function sendSms(acc: SmsAccount, phone: string, text: string): Promise<SmsResult> {
  const to = toEskizPhone(phone);
  if (!to) return { ok: false, error: `Raqam noto'g'ri: ${phone}` };

  if (DRY_RUN) {
    console.log(`[SMS quruq rejim] ${to} <- ${text}`);
    return { ok: true, id: `dry-${randomUUID()}` };
  }

  const form = new URLSearchParams({ mobile_phone: to, message: text, from: acc.from });
  const cb = callbackUrl();
  if (cb) form.set('callback_url', cb);

  try {
    const r = await call<{ id?: string; status?: string; message?: string }>(
      acc,
      'POST',
      '/message/sms/send',
      form,
    );
    // Eskiz "waiting" deb javob beradi: xabar provayder navbatida. Haqiqiy
    // yetkazilganlik keyin DLR bilan keladi.
    if (!r.id) return { ok: false, error: r.message ?? "Eskiz javobida xabar raqami yo'q" };
    return { ok: true, id: String(r.id) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Balans (so'm). Kabinetga kirmasdan "SMS tugab qolibdi" ni ko'rish uchun. */
export async function smsBalance(acc: SmsAccount): Promise<number | null> {
  if (DRY_RUN) return null;
  try {
    const r = await call<{ data?: { balance?: number } }>(acc, 'GET', '/user/get-limit');
    return typeof r.data?.balance === 'number' ? r.data.balance : null;
  } catch {
    return null;
  }
}

/** Hisob haqiqiyligini tekshiradi — ulashdan oldin. */
export async function checkAccount(acc: SmsAccount): Promise<void> {
  forgetToken(acc.email);
  await login(acc);
}
