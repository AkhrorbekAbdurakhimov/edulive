/**
 * Xodimlar boti (@eduliveuz_bot) — ota-onalar botidan MUTLAQO alohida.
 *
 * Ota-onalar boti farzand haqida xabar beradi; bu esa maktab egasi va
 * ma'muriyatiga hisobot, kunlik zaxira nusxa va muhim hodisalarni yuboradi.
 *
 * Chat foydalanuvchiga ulash KODI orqali bog'lanadi: xodim ilovadan bir
 * martalik kod oladi va botga /start <kod> yuboradi. Chat raqamini qo'lda
 * kiritish yo'li yo'q — aks holda birov boshqaning hisobotini o'ziga
 * yo'naltirib olishi mumkin edi.
 */
import { randomBytes } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';

/** Ulash kodi shuncha daqiqada kuchini yo'qotadi. */
const CODE_TTL_MIN = 15;

/** Telegram hujjat chegarasi 50 MB; biroz zaxira qoldiramiz. */
const MAX_DOC_BYTES = 45 * 1024 * 1024;

const fmt = (n: string | number) =>
  Math.round(Number(n) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * HTML rejimida yuborilayotgan matnni himoyalash.
 * Maktab nomida "<" bo'lsa Telegram xabarni butunlay rad etardi.
 */
const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------------------------------------------------------------- yuborish

/** Bot sozlanmagan bo'lsa jim qaytadi — hech qayerda xato ko'tarmaydi. */
export async function sendMessage(chatId: string, text: string): Promise<boolean> {
  if (!env.staffBot.token || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.staffBot.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendDocument(chatId: string, filePath: string, caption?: string): Promise<boolean> {
  if (!env.staffBot.token || !chatId) return false;
  try {
    const buf = await readFile(filePath);
    const form = new FormData();
    form.append('chat_id', chatId);
    if (caption) form.append('caption', caption);
    form.append('document', new Blob([buf]), basename(filePath));
    const res = await fetch(`https://api.telegram.org/bot${env.staffBot.token}/sendDocument`, {
      method: 'POST', body: form,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- ulash

export async function createLinkCode(userId: string): Promise<string> {
  const code = randomBytes(6).toString('base64url');
  await pool.query(`INSERT INTO telegram_link_codes (code, user_id) VALUES ($1,$2)`, [code, userId]);
  return code;
}

interface LinkedUser {
  id: string;
  full_name: string;
  role: string;
  school_id: string | null;
  school_name: string | null;
}

/** Kodni ishlatib chatni hisobga bog'laydi. Kod bir martalik. */
export async function consumeLinkCode(code: string, chatId: string): Promise<LinkedUser | null> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM telegram_link_codes
      WHERE code = $1 AND created_at > now() - interval '${CODE_TTL_MIN} minutes'`,
    [code],
  );
  if (!rows[0]) return null;

  // Bitta chat bitta hisobga: eskisi bo'lsa uziladi (telefon almashtirilgan holat).
  await pool.query(`UPDATE users SET telegram_chat_id = NULL WHERE telegram_chat_id = $1`, [chatId]);
  const { rows: user } = await pool.query<LinkedUser>(
    `UPDATE users u SET telegram_chat_id = $1 WHERE u.id = $2
     RETURNING u.id, u.full_name, u.role, u.school_id,
               (SELECT s.name FROM schools s WHERE s.id = u.school_id) AS school_name`,
    [chatId, rows[0].user_id],
  );
  await pool.query(`DELETE FROM telegram_link_codes WHERE code = $1`, [code]);
  return user[0] ?? null;
}

async function userByChat(chatId: string): Promise<LinkedUser | null> {
  const { rows } = await pool.query<LinkedUser>(
    `SELECT u.id, u.full_name, u.role, u.school_id,
            (SELECT s.name FROM schools s WHERE s.id = u.school_id) AS school_name
       FROM users u
      WHERE u.telegram_chat_id = $1 AND u.is_active`,
    [chatId],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- hisobot

type Period = 'day' | 'week' | 'month';
const PERIOD_LABEL: Record<Period, string> = { day: 'Bugun', week: 'Hafta', month: 'Oy' };
const PERIOD_SQL: Record<Period, string> = {
  day: "CURRENT_DATE", week: "CURRENT_DATE - 6", month: "date_trunc('month', CURRENT_DATE)::date",
};

/** Bitta maktab bo'yicha hisobot. */
export async function buildSchoolReport(schoolId: string, period: Period): Promise<string> {
  const since = PERIOD_SQL[period];
  const { rows } = await pool.query<{
    school: string; students: number; classes: number;
    paid: string; payments: number; outstanding: string; debtors: number;
    unlinked: number; overdue_books: number;
  }>(
    `SELECT (SELECT name FROM schools WHERE id = $1) AS school,
            (SELECT count(*)::int FROM students WHERE school_id = $1 AND status = 'active') AS students,
            (SELECT count(*)::int FROM classes c JOIN academic_years y ON y.id = c.academic_year_id
              WHERE c.school_id = $1 AND y.is_current) AS classes,
            (SELECT COALESCE(SUM(amount), 0) FROM payments
              WHERE school_id = $1 AND status = 'confirmed' AND paid_at >= ${since}) AS paid,
            (SELECT count(*)::int FROM payments
              WHERE school_id = $1 AND status = 'confirmed' AND paid_at >= ${since}) AS payments,
            (SELECT COALESCE(SUM(i.amount - i.discount - COALESCE(pa.paid, 0)), 0)
               FROM invoices i
               LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payment_allocations
                                   WHERE invoice_id = i.id) pa ON true
              WHERE i.school_id = $1 AND i.status IN ('open','partial')) AS outstanding,
            (SELECT count(DISTINCT i.student_id)::int
               FROM invoices i
               LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payment_allocations
                                   WHERE invoice_id = i.id) pa ON true
              WHERE i.school_id = $1 AND i.status IN ('open','partial')
                AND i.amount - i.discount - COALESCE(pa.paid, 0) > 0) AS debtors,
            (SELECT count(*)::int FROM parent_phones
              WHERE school_id = $1 AND telegram_chat_id IS NULL) AS unlinked,
            (SELECT count(*)::int FROM book_loans
              WHERE school_id = $1 AND status = 'issued' AND due_on < CURRENT_DATE) AS overdue_books`,
    [schoolId],
  );
  const r = rows[0];

  const lines = [
    `📊 <b>${esc(r.school)}</b> — ${PERIOD_LABEL[period]}`,
    '',
    `💰 To'lov: <b>${fmt(r.paid)}</b> so'm (${r.payments} ta)`,
    `📕 Qarzdorlik: <b>${fmt(r.outstanding)}</b> so'm · ${r.debtors} o'quvchi`,
    '',
    `👥 O'quvchi: ${r.students} · Sinf: ${r.classes}`,
  ];
  if (r.unlinked > 0) lines.push(`✉️ Botga ulanmagan raqam: ${r.unlinked}`);
  if (r.overdue_books > 0) lines.push(`📚 Muddati o'tgan kitob: ${r.overdue_books}`);

  if (period === 'day') {
    const { rows: top } = await pool.query<{ name: string; outstanding: string }>(
      `SELECT s.last_name || ' ' || s.first_name AS name,
              SUM(i.amount - i.discount - COALESCE(pa.paid, 0)) AS outstanding
         FROM invoices i
         JOIN students s ON s.id = i.student_id
         LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payment_allocations
                             WHERE invoice_id = i.id) pa ON true
        WHERE i.school_id = $1 AND i.status IN ('open','partial') AND i.due_date < CURRENT_DATE
        GROUP BY s.id, s.last_name, s.first_name
       HAVING SUM(i.amount - i.discount - COALESCE(pa.paid, 0)) > 0
        ORDER BY 2 DESC LIMIT 5`,
      [schoolId],
    );
    if (top.length) {
      lines.push('', `⏰ <b>Muddati o'tgan qarz (${top.length}):</b>`);
      for (const d of top) lines.push(`• ${esc(d.name)} — ${fmt(d.outstanding)} so'm`);
    }
  }
  return lines.join('\n');
}

/** Platforma bo'yicha (superadmin uchun) — barcha maktablar. */
export async function buildPlatformReport(period: Period): Promise<string> {
  const since = PERIOD_SQL[period];
  const { rows } = await pool.query<{
    name: string; students: number; paid: string; outstanding: string;
  }>(
    `SELECT s.name,
            (SELECT count(*)::int FROM students WHERE school_id = s.id AND status = 'active') AS students,
            (SELECT COALESCE(SUM(amount), 0) FROM payments
              WHERE school_id = s.id AND status = 'confirmed' AND paid_at >= ${since}) AS paid,
            (SELECT COALESCE(SUM(i.amount - i.discount - COALESCE(pa.paid, 0)), 0)
               FROM invoices i
               LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payment_allocations
                                   WHERE invoice_id = i.id) pa ON true
              WHERE i.school_id = s.id AND i.status IN ('open','partial')) AS outstanding
       FROM schools s WHERE s.status = 'active' ORDER BY s.name`,
  );

  const totalPaid = rows.reduce((a, r) => a + Number(r.paid), 0);
  const totalDebt = rows.reduce((a, r) => a + Number(r.outstanding), 0);
  const totalStudents = rows.reduce((a, r) => a + r.students, 0);

  const lines = [
    `🏫 <b>EduLive platformasi</b> — ${PERIOD_LABEL[period]}`,
    '',
    `🏫 Maktab: ${rows.length} · 👥 O'quvchi: ${totalStudents}`,
    `💰 To'lov: <b>${fmt(totalPaid)}</b> so'm`,
    `📕 Qarzdorlik: <b>${fmt(totalDebt)}</b> so'm`,
  ];
  if (rows.length > 1) {
    lines.push('', '<b>Maktablar bo\'yicha:</b>');
    for (const r of rows) {
      lines.push(`• ${esc(r.name)} — ${fmt(r.paid)} so'm, qarz ${fmt(r.outstanding)}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- zaxira

/**
 * Oxirgi kunlik nusxani ulangan superadminlarga yuboradi.
 *
 * Serverdan tashqarida nusxa qoladi — disk yo'qolsa ham ma'lumot qoladi.
 */
export async function sendBackup(): Promise<{ sent: number; file: string | null; note?: string }> {
  if (!env.staffBot.token) return { sent: 0, file: null, note: 'bot sozlanmagan' };

  let files: string[] = [];
  try {
    files = (await readdir(env.backupDir)).filter((f) => f.endsWith('.sql.gz')).sort();
  } catch {
    return { sent: 0, file: null, note: 'zaxira papkasi topilmadi' };
  }
  if (!files.length) return { sent: 0, file: null, note: 'zaxira fayli yo\'q' };

  const latest = files[files.length - 1];
  const full = join(env.backupDir, latest);
  const st = await stat(full);

  const { rows } = await pool.query<{ chat: string }>(
    `SELECT telegram_chat_id::text AS chat FROM users
      WHERE role = 'superadmin' AND is_active AND telegram_chat_id IS NOT NULL`,
  );
  if (!rows.length) return { sent: 0, file: latest, note: 'ulangan superadmin yo\'q' };

  // Katta fayl yuborilmaydi — jim qolgandan ko'ra ogohlantirgan yaxshi.
  if (st.size > MAX_DOC_BYTES) {
    const warn = `⚠️ Zaxira fayli juda katta (${Math.round(st.size / 1024 / 1024)} MB) — Telegram orqali yuborilmadi.\nServerdagi nusxa: ${latest}`;
    for (const r of rows) await sendMessage(r.chat, warn);
    return { sent: 0, file: latest, note: 'fayl juda katta' };
  }

  const caption = `🗄 Kunlik zaxira nusxa\n${latest} · ${Math.max(1, Math.round(st.size / 1024))} KB`;
  let sent = 0;
  for (const r of rows) if (await sendDocument(r.chat, full, caption)) sent += 1;
  return { sent, file: latest };
}

// ---------------------------------------------------------------- hodisalar

/**
 * Muhim hodisa haqida xabar. Fire-and-forget: xabar ketmasa ham asosiy amal
 * (to'lov yozish, o'quvchi qo'shish) buzilmasligi kerak.
 *
 * `schoolId` berilsa o'sha maktab ma'muriyati va superadminlarga, aks holda
 * faqat superadminlarga ketadi.
 */
export async function notifyStaff(schoolId: string | null, text: string): Promise<void> {
  if (!env.staffBot.token) return;
  try {
    const { rows } = await pool.query<{ chat: string }>(
      `SELECT telegram_chat_id::text AS chat FROM users
        WHERE is_active AND telegram_chat_id IS NOT NULL
          AND (role = 'superadmin'
               OR ($1::uuid IS NOT NULL AND school_id = $1 AND role IN ('admin','manager')))`,
      [schoolId],
    );
    await Promise.all(rows.map((r) => sendMessage(r.chat, text)));
  } catch {
    // Xabar yuborish hech qachon asosiy amalni yiqitmaydi.
  }
}

// ---------------------------------------------------------------- buyruqlar

const COMMANDS = [
  '📋 Buyruqlar:',
  '/bugun — bugungi hisobot',
  '/hafta — haftalik hisobot',
  '/oy — oylik hisobot',
  '/zaxira — oxirgi zaxira nusxani yuborish',
  '/help — yordam',
].join('\n');

function menu(user: LinkedUser | null): string {
  if (!user) {
    return [
      '🤖 <b>EduLive xizmat boti</b>',
      '',
      'Hisobot olish uchun avval hisobingizni ulang:',
      'EduLive → <b>Sozlamalar → Telegram → «Telegramni ulash»</b>.',
    ].join('\n');
  }
  const where = user.school_name ? esc(user.school_name) : 'Platforma (superadmin)';
  return [`👋 Salom, <b>${esc(user.full_name)}</b>!`, `📍 ${where}`, '', COMMANDS].join('\n');
}

interface TgUpdate {
  message?: { chat?: { id: number | string }; text?: string };
}

/** Webhook'dan kelgan yangilanish. Hech qachon xato ko'tarmaydi. */
export async function handleUpdate(update: TgUpdate): Promise<void> {
  const chatId = update.message?.chat?.id != null ? String(update.message.chat.id) : null;
  const text = (update.message?.text ?? '').trim();
  if (!chatId || !text) return;

  const first = text.split(/\s+/)[0].toLowerCase();

  if (first === '/start') {
    const code = text.split(/\s+/)[1];
    if (code) {
      const user = await consumeLinkCode(code, chatId);
      if (!user) {
        await sendMessage(chatId, "❌ Havola yaroqsiz yoki muddati tugagan. Ilovadan qayta oling.");
        return;
      }
      await sendMessage(chatId, [`✅ Ulandi: <b>${esc(user.full_name)}</b>`, '', COMMANDS].join('\n'));
      return;
    }
    await sendMessage(chatId, menu(await userByChat(chatId)));
    return;
  }

  const user = await userByChat(chatId);
  // Ulanmagan chatga hech qanday ma'lumot berilmaydi — botni topgan
  // har kim maktab moliyasini so'ray olmasligi kerak.
  if (!user) { await sendMessage(chatId, menu(null)); return; }

  const periods: Record<string, Period> = {
    '/bugun': 'day', '/hafta': 'week', '/oy': 'month', '/report': 'day', '/hisobot': 'day',
  };
  const period = periods[first];
  if (period) {
    const text2 = user.role === 'superadmin' || !user.school_id
      ? await buildPlatformReport(period)
      : await buildSchoolReport(user.school_id, period);
    await sendMessage(chatId, text2);
    return;
  }

  if (first === '/zaxira') {
    if (user.role !== 'superadmin') {
      await sendMessage(chatId, "🔒 Zaxira nusxa faqat platforma administratoriga yuboriladi.");
      return;
    }
    const r = await sendBackup();
    if (!r.sent) await sendMessage(chatId, `⚠️ Yuborilmadi: ${r.note ?? 'sabab noma\'lum'}`);
    return;
  }

  await sendMessage(chatId, menu(user));
}
