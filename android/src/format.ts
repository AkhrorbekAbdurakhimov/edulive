/**
 * Format qoidalari — DESIGN_PROMPT §9: sana 09.08.2026, hafta dushanbadan,
 * ismlar jadvalda "Familiya Ism". Tilga bog'liq satrlar shu yerda to'planadi.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Mahalliy sana (YYYY-MM-DD). `toISOString()` UTC beradi — Toshkentda ertalab
 * 03:00 gacha "kechagi" sana chiqib qolardi va davomat noto'g'ri kunga tushardi.
 */
export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-08-09" → "09.08.2026" */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

/** "08:15" */
export function fmtTime(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

const DAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
export const MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
];

/** "Yakshanba, 9-avgust 2026" — bosh ekran sarlavhasi (maket 1-ekran). */
export function longDate(d: Date = new Date()): string {
  return `${DAYS[d.getDay()]}, ${d.getDate()}-${MONTHS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}

export interface MonthRange { from: string; to: string; label: string; year: number; month: number }

/** offset=0 — joriy oy; -1 — o'tgan oy. `to` bugundan oshmaydi. */
export function monthRange(offset: number): MonthRange {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  const to = last > now ? now : last;
  return {
    from: isoDate(first),
    to: isoDate(to),
    label: `${MONTHS[first.getMonth()]} ${first.getFullYear()}`,
    year: first.getFullYear(),
    month: first.getMonth(),
  };
}

/** "2 soat 58 daqiqa" · "45 daqiqa" · "1 daqiqadan kam" · null (o'tib ketgan) */
export function durationLabel(ms: number): string | null {
  if (ms <= 0) return null;
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return '1 daqiqadan kam';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} daqiqa`;
  if (m === 0) return `${h} soat`;
  return `${h} soat ${m} daqiqa`;
}

export interface PersonName { last_name: string; first_name: string }

/** Jadval/ro'yxatda "Familiya Ism" (DESIGN_PROMPT §9). */
export const rosterName = (s: PersonName) => `${s.last_name} ${s.first_name}`;

export function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();
}

/** users.full_name "Ism Familiya" tartibida saqlanadi — salomlashish uchun birinchi so'z. */
export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

/** "+998901234567" → "+998 90 123 45 67" */
export function fmtPhone(p: string | null | undefined): string {
  if (!p) return '';
  const m = p.match(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : p;
}
