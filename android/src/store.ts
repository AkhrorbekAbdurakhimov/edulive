/**
 * Oflayn-first saqlash (README 3- va 5-qoidalar):
 *  - qoralama: tasdiqlanmagan davomat har o'zgarishda saqlanadi, orqaga tugmasi yo'qotmaydi
 *  - navbat: internet bo'lmasa tasdiqlangan davomat shu yerda kutadi,
 *    aloqa qaytganda yuboriladi — ota-onaga xabar faqat server tasdig'idan keyin ketadi
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

export type Status = 'present' | 'absent' | 'late';
export interface Mark {
  studentId: string;
  status: Exclude<Status, 'present'>;
  minutesLate?: number;
}

export interface QueuedAttendance {
  classId: string;
  className: string;
  date: string; // YYYY-MM-DD
  marks: Mark[];
  queuedAt: string;
}

const QUEUE_KEY = 'edulive_att_queue';
const draftKey = (classId: string, date: string) => `edulive_att_draft:${classId}:${date}`;

// ---------------------------------------------------------------- qoralama
export async function saveDraft(classId: string, date: string, marks: Record<string, Status>): Promise<void> {
  await AsyncStorage.setItem(draftKey(classId, date), JSON.stringify(marks));
}

export async function loadDraft(classId: string, date: string): Promise<Record<string, Status> | null> {
  const raw = await AsyncStorage.getItem(draftKey(classId, date));
  return raw ? (JSON.parse(raw) as Record<string, Status>) : null;
}

export async function clearDraft(classId: string, date: string): Promise<void> {
  await AsyncStorage.removeItem(draftKey(classId, date));
}

// ---------------------------------------------------------------- navbat
export async function getQueue(): Promise<QueuedAttendance[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueuedAttendance[]) : [];
}

export async function enqueue(item: QueuedAttendance): Promise<void> {
  const queue = await getQueue();
  // Bitta sinf+sana uchun faqat oxirgi holat qoladi
  const rest = queue.filter((q) => !(q.classId === item.classId && q.date === item.date));
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...rest, item]));
}

/** Serverga yuborish: take + confirm. Muvaffaqiyatlilari navbatdan chiqadi. */
export async function flushQueue(): Promise<{ sent: number; left: number }> {
  const queue = await getQueue();
  const remaining: QueuedAttendance[] = [];
  let sent = 0;

  for (const item of queue) {
    try {
      const take = await api<{ sessionId: string }>('/attendance/take', 'POST', {
        classId: item.classId,
        date: item.date,
        marks: item.marks,
      });
      try {
        await api(`/attendance/${take.sessionId}/confirm`, 'POST');
      } catch (err: any) {
        // 409 = allaqachon tasdiqlangan — navbatdan chiqarish mumkin
        if (err?.status !== 409) throw err;
      }
      await clearDraft(item.classId, item.date);
      sent++;
    } catch (err: any) {
      if (err?.status === 0) {
        remaining.push(item); // hali ham oflayn — keyinroq
      } else {
        // Server rad etdi (masalan, tahrir oynasi yopilgan) — navbatda ushlab turish foydasiz
        sent += 0;
      }
    }
  }

  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
  return { sent, left: remaining.length };
}
