import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Superadmin qaysi maktab ichida ishlayotgani. Qiymat `api.ts` da
 * `X-School-Id` sarlavhasiga aylanadi (backend'dagi resolveTenant shuni kutadi).
 *
 * Maktab almashganda butun so'rov keshi tozalanadi: keshdagi har bir yozuv
 * oldingi maktabga tegishli va uni yangi kontekstda ko'rsatish tenant
 * chegarasini buzgan bo'lardi.
 */
const KEY = 'edulive_school_id';

interface SchoolCtx {
  /** null — platforma darajasi (hech qaysi maktab tanlanmagan). */
  schoolId: string | null;
  enter: (id: string) => void;
  leave: () => void;
}

const Ctx = createContext<SchoolCtx | null>(null);

export function SchoolProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [schoolId, setSchoolId] = useState<string | null>(() => localStorage.getItem(KEY));

  const enter = useCallback((id: string) => {
    localStorage.setItem(KEY, id);
    setSchoolId(id);
    qc.clear();
  }, [qc]);

  const leave = useCallback(() => {
    localStorage.removeItem(KEY);
    setSchoolId(null);
    qc.clear();
  }, [qc]);

  return <Ctx.Provider value={{ schoolId, enter, leave }}>{children}</Ctx.Provider>;
}

export function useSchool(): SchoolCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('SchoolProvider ichida ishlatilishi kerak');
  return ctx;
}
