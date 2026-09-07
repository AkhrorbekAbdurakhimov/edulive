import { QueryClient, useQueries, useQuery } from '@tanstack/react-query';
import { api, cachedGet } from './api';
import type { Status } from './store';

/**
 * Server tiplari — backend javoblari bilan bir xil nomlar (snake_case), chunki
 * ular SQL ustunlaridan to'g'ridan-to'g'ri keladi.
 */
export interface ClassItem {
  id: string;
  grade: number;
  letter: string;
  name: string;
  student_count: number;
  homeroom_teacher_id: string | null;
  homeroom_teacher: string | null;
}

export interface Student {
  id: string;
  last_name: string;
  first_name: string;
}

export interface Session {
  id: string;
  on_date: string;
  confirmed_at: string | null;
  total_count: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  /** Server hisoblaydi (tahrir oynasi — server sozlamasi). */
  editableUntil: string | null;
}

export interface SessionItem {
  student_id: string;
  last_name: string;
  first_name: string;
  status: Status;
  minutes_late: number | null;
}

export interface SessionView {
  session: Session | null;
  items: SessionItem[];
}

export interface SummaryRow {
  student_id: string;
  last_name: string;
  first_name: string;
  present: number;
  absent: number;
  late: number;
}

/**
 * networkMode 'always': oflayn bo'lsa so'rov to'xtab qolmaydi, status=0 bilan
 * xato beradi — ekran skeleton o'rniga oflayn holatini ko'rsatadi.
 * gcTime uzun: sinf ro'yxati tab almashganda qayta yuklanmasin.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'always',
      retry: false,
      staleTime: 30_000,
      gcTime: 24 * 3_600_000,
    },
    mutations: { networkMode: 'always', retry: false },
  },
});

export const classesKey = ['classes'] as const;
export const attendanceKey = (classId: string, date: string) => ['attendance', classId, date] as const;

/** O'qituvchining sinflari — oflayn kesh bilan. */
export function useClasses() {
  return useQuery({
    queryKey: classesKey,
    queryFn: () => cachedGet<{ items: ClassItem[] }>('classes', '/classes'),
    select: (r) => ({ items: r.data.items, stale: r.stale }),
  });
}

/** Sinf o'quvchilari — oflayn kesh bilan (davomat internet bo'lmasa ham olinadi). */
export function useRoster(classId: string) {
  return useQuery({
    queryKey: ['roster', classId],
    queryFn: () => cachedGet<{ class: ClassItem; students: Student[] }>(`roster:${classId}`, `/classes/${classId}`),
    select: (r) => ({ students: r.data.students, stale: r.stale }),
  });
}

export function useSession(classId: string, date: string) {
  return useQuery({
    queryKey: attendanceKey(classId, date),
    queryFn: () => api<SessionView>(`/attendance?classId=${classId}&date=${date}`),
  });
}

/** Bosh ekran: har sinf uchun bugungi sessiya. Sinflar ko'p emas (≤ 6–8), N+1 yetarli. */
export function useTodaySessions(classIds: string[], date: string) {
  return useQueries({
    queries: classIds.map((id) => ({
      queryKey: attendanceKey(id, date),
      queryFn: () => api<SessionView>(`/attendance?classId=${id}&date=${date}`),
    })),
  });
}

export function useSummary(classId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['summary', classId, from, to],
    queryFn: () => api<{ items: SummaryRow[] }>(`/attendance/summary?classId=${classId}&from=${from}&to=${to}`),
    select: (r) => r.items,
  });
}
