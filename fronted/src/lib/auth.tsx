import { createContext, useContext, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from './api';

export interface User {
  id: string;
  schoolId: string | null;
  fullName: string;
  role: 'superadmin' | 'admin' | 'manager' | 'teacher';
  phone?: string | null;
}

interface AuthCtx {
  user: User | null;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  /**
   * Parol o'zgartirilganda backend yangi token qaytaradi (token_version oshgan,
   * eski token endi yaroqsiz). Uni saqlamasak joriy sessiya darhol uzilib qoladi.
   */
  setToken: (token: string) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('edulive_user');
    return raw ? (JSON.parse(raw) as User) : null;
  });

  const login = async (phone: string, password: string) => {
    const { data } = await api.post('/auth/login', { phone, password });
    localStorage.setItem('edulive_token', data.token);
    localStorage.setItem('edulive_user', JSON.stringify(data.user));
    setUser(data.user);
  };

  const logout = () => {
    api.post('/auth/logout').catch(() => {});
    localStorage.removeItem('edulive_token');
    localStorage.removeItem('edulive_user');
    localStorage.removeItem('edulive_school_id');
    setUser(null);
  };

  const setToken = (token: string) => localStorage.setItem('edulive_token', token);

  return <Ctx.Provider value={{ user, login, logout, setToken }}>{children}</Ctx.Provider>;
}

/** Rol nomi foydalanuvchiga ko'rinadigan holda — bir necha ekranda kerak. */
export function roleLabel(role: User['role'] | undefined): string {
  switch (role) {
    case 'admin': return 'Administrator';
    case 'manager': return 'Menejer';
    case 'teacher': return "O'qituvchi";
    case 'superadmin': return 'Superadmin';
    default: return '';
  }
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('AuthProvider ichida ishlatilishi kerak');
  return ctx;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}
