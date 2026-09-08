import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Emulyatorda 10.0.2.2 = host mashinadagi localhost (app.json → extra.apiUrl).
 * Haqiqiy qurilmada Expo Go bilan test qilishda kompyuterning LAN IP sini yozing.
 */
export const API_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://10.0.2.2:4000/api';

const TOKEN_KEY = 'edulive_token';
const USER_KEY = 'edulive_user';
const CACHE_PREFIX = 'edulive_cache:';

let token: string | null = null;

export async function loadToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}

export async function saveToken(t: string | null): Promise<void> {
  token = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export interface AuthedUser {
  id: string;
  fullName: string;
  phone: string | null;
  role: string;
  schoolId: string | null;
  /** Kutubxona huquqi — roldan mustaqil belgi (users.is_librarian). */
  isLibrarian?: boolean;
}

/**
 * Huquqlar — backend `requireRole` bilan bir xil chegaralar. Bu faqat
 * interfeys tomoni: ishlamaydigan tugmani ko'rsatmaslik uchun. Yakuniy
 * qaror serverda.
 */
export const perms = (u: AuthedUser) => {
  const staff = u.role === 'admin' || u.role === 'manager';
  return {
    staff,                                   // boshqaruv, o'quvchilar, to'lovlar, qarzdorlar, xabarlar
    admin: u.role === 'admin',               // sinf/xodim yaratish, o'quv yili
    library: staff || !!u.isLibrarian,       // kutubxona bo'limi
    teacher: u.role === 'teacher',
  };
};

/**
 * Foydalanuvchi kartochkasi lokal saqlanadi: oflayn ishga tushganda ham
 * salomlashish va profil to'g'ri ko'rinishi uchun (/auth/me ga yetib bo'lmaydi).
 */
export async function saveUser(u: AuthedUser | null): Promise<void> {
  if (u) await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
  else await AsyncStorage.removeItem(USER_KEY);
}

export async function loadUser(): Promise<AuthedUser | null> {
  const raw = await AsyncStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as AuthedUser) : null;
}

/**
 * Ilovaga kim kiradi: maktab xodimlari (admin, menejer, o'qituvchi).
 * Superadmin — platforma egasi, maktab ichki ishiga aralashmaydi, faqat web.
 */
export const canUseApp = (role: string): boolean => role !== 'superadmin';

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrator',
  manager: 'Menejer',
  teacher: "O'qituvchi",
};
export const roleLabel = (role: string): string => ROLE_LABELS[role] ?? role;

/** So'rov satri: bo'sh qiymatlar tashlanadi. RN'da URLSearchParams to'liq emas. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const isOffline = (err: unknown): boolean => err instanceof ApiError && err.status === 0;

let onUnauthorized: (() => void) | null = null;
/** 401 kelganda ilova login ekraniga qaytadi — har bir ekran o'zi tekshirmaydi. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/** status=0 — tarmoq xatosi (oflayn). Chaqiruvchi navbatga qo'yish uchun shuni tekshiradi. */
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Internet aloqasi yo'q");
  }

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? `Xatolik (${res.status})`);
  }
  return data as T;
}

/**
 * Oflayn-first o'qish: muvaffaqiyatli javob lokal saqlanadi; tarmoq yo'q
 * bo'lsa oxirgi saqlangan nusxa qaytadi. Sinf ro'yxati va o'quvchilar
 * shu orqali olinadi — koridorda internet bo'lmasa ham davomat olinadi.
 */
export async function cachedGet<T>(key: string, path: string): Promise<{ data: T; stale: boolean }> {
  const storageKey = CACHE_PREFIX + key;
  try {
    const data = await api<T>(path);
    await AsyncStorage.setItem(storageKey, JSON.stringify(data));
    return { data, stale: false };
  } catch (err) {
    if (!isOffline(err)) throw err;
    const raw = await AsyncStorage.getItem(storageKey);
    if (raw === null) throw err;
    return { data: JSON.parse(raw) as T, stale: true };
  }
}

/** Chiqishda boshqa o'qituvchining ma'lumoti telefonda qolmasligi kerak. */
export async function clearCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const ours = keys.filter((k) => k.startsWith(CACHE_PREFIX));
  if (ours.length) await AsyncStorage.multiRemove(ours);
}
