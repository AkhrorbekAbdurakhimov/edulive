/**
 * Oflayn-first saqlash (README 3- va 5-qoidalar):
 *  - qoralama: tasdiqlanmagan davomat har o'zgarishda saqlanadi, orqaga tugmasi yo'qotmaydi
 *  - navbat: internet bo'lmasa tasdiqlangan davomat shu yerda kutadi,
 *    aloqa qaytganda yuboriladi — ota-onaga xabar faqat server tasdig'idan keyin ketadi
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, isOffline } from './api';

export type Status = 'present' | 'absent' | 'late';

/** Ekrandagi bir o'quvchining holati. Kechikish daqiqasi ixtiyoriy. */
export interface MarkState {
  status: Status;
  minutesLate?: number;
}
export type Marks = Record<string, MarkState>;

/** Serverga ketadigan istisno (5-qoida: `present` yuborilmaydi). */
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
  total: number;
  /** false — sessiya allaqachon tasdiqlangan edi, faqat tahrir yuboriladi */
  confirm: boolean;
  queuedAt: string;
  /** Server rad etgan bo'lsa — sababi. O'qituvchi ko'rishi shart, jimgina yo'qolmaydi. */
  error?: string;
}

const QUEUE_KEY = 'edulive_att_queue';
const draftKey = (classId: string, date: string) => `edulive_att_draft:${classId}:${date}`;

// ---------------------------------------------------------------- qoralama
export async function saveDraft(classId: string, date: string, marks: Marks): Promise<void> {
  await AsyncStorage.setItem(draftKey(classId, date), JSON.stringify(marks));
}

export async function loadDraft(classId: string, date: string): Promise<Marks | null> {
  const raw = await AsyncStorage.getItem(draftKey(classId, date));
  return raw ? (JSON.parse(raw) as Marks) : null;
}

export async function clearDraft(classId: string, date: string): Promise<void> {
  await AsyncStorage.removeItem(draftKey(classId, date));
}

// ---------------------------------------------------------------- navbat
const listeners = new Set<(q: QueuedAttendance[]) => void>();

async function writeQueue(queue: QueuedAttendance[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  for (const fn of listeners) fn(queue);
}

export async function getQueue(): Promise<QueuedAttendance[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueuedAttendance[]) : [];
}

export async function enqueue(item: QueuedAttendance): Promise<void> {
  const queue = await getQueue();
  // Bitta sinf+sana uchun faqat oxirgi holat qoladi
  const rest = queue.filter((q) => !(q.classId === item.classId && q.date === item.date));
  await writeQueue([...rest, item]);
}

export async function removeFromQueue(classId: string, date: string): Promise<void> {
  const queue = await getQueue();
  await writeQueue(queue.filter((q) => !(q.classId === classId && q.date === date)));
  await clearDraft(classId, date);
}

/** Navbatga jonli obuna — Home banneri, Profil va KPI bir xil sonni ko'rsatadi. */
export function useQueue(): QueuedAttendance[] {
  const [queue, setQueue] = useState<QueuedAttendance[]>([]);
  useEffect(() => {
    let alive = true;
    getQueue().then((q) => alive && setQueue(q));
    const fn = (q: QueuedAttendance[]) => alive && setQueue(q);
    listeners.add(fn);
    return () => {
      alive = false;
      listeners.delete(fn);
    };
  }, []);
  return queue;
}

export interface SendResult {
  sessionId: string;
  notificationsQueued: number;
  editableUntil: string | null;
}

/** take (+confirm). 409 tasdiqlashda = allaqachon tasdiqlangan — muvaffaqiyat deb olinadi. */
export async function sendAttendance(item: Pick<QueuedAttendance, 'classId' | 'date' | 'marks' | 'confirm'>): Promise<SendResult> {
  const take = await api<{ sessionId: string }>('/attendance/take', 'POST', {
    classId: item.classId,
    date: item.date,
    marks: item.marks,
  });
  if (!item.confirm) return { sessionId: take.sessionId, notificationsQueued: 0, editableUntil: null };
  try {
    const c = await api<{ notificationsQueued: number; editableUntil: string }>(
      `/attendance/${take.sessionId}/confirm`,
      'POST',
    );
    return { sessionId: take.sessionId, notificationsQueued: c.notificationsQueued, editableUntil: c.editableUntil };
  } catch (err: any) {
    if (err?.status === 409) return { sessionId: take.sessionId, notificationsQueued: 0, editableUntil: null };
    throw err;
  }
}

let flushing: Promise<{ sent: number; left: number }> | null = null;

/**
 * Navbatni serverga yuborish. Bir vaqtda faqat bitta flush yuradi (NetInfo va
 * AppState bir paytda tetiklashi mumkin). Server rad etgan yozuv navbatda
 * `error` bilan qoladi — o'qituvchi ko'radi va qaror qiladi.
 */
export function flushQueue(): Promise<{ sent: number; left: number }> {
  if (flushing) return flushing;
  flushing = (async () => {
    const queue = await getQueue();
    if (queue.length === 0) return { sent: 0, left: 0 };
    const remaining: QueuedAttendance[] = [];
    let sent = 0;

    for (const item of queue) {
      try {
        await sendAttendance(item);
        await clearDraft(item.classId, item.date);
        sent++;
      } catch (err: any) {
        if (isOffline(err)) {
          remaining.push(item); // hali ham oflayn — keyinroq
        } else {
          remaining.push({ ...item, error: err?.message ?? 'Server rad etdi' });
        }
      }
    }

    await writeQueue(remaining);
    return { sent, left: remaining.length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Chiqishda navbat va qoralamalar tozalanadi (navbat bo'sh bo'lishi shart — Profil tekshiradi). */
export async function clearLocalAttendance(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const ours = keys.filter((k) => k === QUEUE_KEY || k.startsWith('edulive_att_draft:'));
  if (ours.length) await AsyncStorage.multiRemove(ours);
  for (const fn of listeners) fn([]);
}
