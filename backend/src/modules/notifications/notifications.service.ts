/**
 * Navbatdagi bildirishnomalarni yuborish.
 *
 * Xabar hodisa sodir bo'lgan joyda NAVBATGA qo'yiladi (attendance.confirm,
 * payment.create...), yuborish esa shu yerda — alohida. Sabab: to'lov qabul
 * qilish Telegram javob berishini kutib turmasligi kerak. Telegram sekin
 * ishlasa yoki javob bermasa, kassir baribir ishlayveradi.
 */
import { pool } from '../../db/pool.js';
import { botForSchool, sendToParent } from '../telegram/telegram.service.js';

/** Shuncha urinishdan keyin xabar "failed" bo'ladi va qayta urinilmaydi. */
const MAX_ATTEMPTS = 5;

interface QueuedRow {
  id: string;
  school_id: string;
  body: string | null;
  kind: string;
  chat_id: string | null;
  attempts: number;
}

export interface DispatchResult {
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Navbatdan bir porsiya oladi va yuboradi.
 *
 * `FOR UPDATE SKIP LOCKED` — bir nechta nusxa (yoki qo'lda chaqiruv) bir vaqtda
 * ishlasa ham bitta xabar ikki marta ketmaydi.
 */
export async function dispatchQueued(limit = 50): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, failed: 0, skipped: 0 };

  const { rows } = await pool.query<QueuedRow>(
    `SELECT n.id, n.school_id, n.body, n.kind, n.attempts,
            p.telegram_chat_id::text AS chat_id
       FROM notifications n
       LEFT JOIN parents p ON p.id = n.parent_id
      WHERE n.status = 'queued' AND n.channel = 'telegram' AND n.attempts < $1
      ORDER BY n.created_at
      LIMIT $2
      FOR UPDATE OF n SKIP LOCKED`,
    [MAX_ATTEMPTS, limit],
  );
  if (!rows.length) return result;

  // Bot ma'lumotini har maktab uchun bir marta olamiz (token deshifrlanadi).
  const bots = new Map<string, string | null>();
  const tokenFor = async (schoolId: string): Promise<string | null> => {
    if (!bots.has(schoolId)) {
      const bot = await botForSchool(schoolId);
      bots.set(schoolId, bot?.token ?? null);
    }
    return bots.get(schoolId) ?? null;
  };

  for (const n of rows) {
    // Ota-ona botga ulanmagan bo'lsa qayta urinishning ma'nosi yo'q: davomat
    // xabari ertaga yuborilsa chalkashtiradi. "failed" deb belgilaymiz —
    // yozuv qoladi va nega yubormaganini ko'rish mumkin.
    if (!n.chat_id) {
      await pool.query(
        `UPDATE notifications SET status = 'failed', error = $2, attempts = attempts + 1 WHERE id = $1`,
        [n.id, "ota-ona Telegram botga ulanmagan"],
      );
      result.skipped += 1;
      continue;
    }

    const token = await tokenFor(n.school_id);
    if (!token) {
      await pool.query(
        `UPDATE notifications SET status = 'failed', error = $2, attempts = attempts + 1 WHERE id = $1`,
        [n.id, 'maktabga ham, platformaga ham bot ulanmagan'],
      );
      result.skipped += 1;
      continue;
    }

    const ok = await sendToParent(token, n.chat_id, n.body ?? '');
    if (ok) {
      await pool.query(
        `UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1 WHERE id = $1`,
        [n.id],
      );
      result.sent += 1;
    } else {
      // Oxirgi urinish bo'lsa — failed, aks holda navbatda qoladi.
      await pool.query(
        `UPDATE notifications
            SET attempts = attempts + 1,
                error = $2,
                status = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'queued' END
          WHERE id = $1`,
        [n.id, 'Telegram xabarni qabul qilmadi', MAX_ATTEMPTS],
      );
      result.failed += 1;
    }
  }

  return result;
}

let timer: NodeJS.Timeout | null = null;

/** Fon ishchisi. Testlarda ishga tushirilmaydi. */
export function startNotificationWorker(everyMs = 15_000): void {
  if (timer) return;
  timer = setInterval(() => {
    dispatchQueued().catch((err) => {
      console.error('notification worker:', (err as Error).message);
    });
  }, everyMs);
  // Jarayonni tirik ushlab turmasin — SIGTERM da tinch to'xtaydi.
  timer.unref();
}

export function stopNotificationWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
