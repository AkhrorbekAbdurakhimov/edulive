import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

/**
 * Emulyatorda 10.0.2.2 = host mashinadagi localhost (app.json → extra.apiUrl).
 * Haqiqiy qurilmada Expo Go bilan test qilishda kompyuterning LAN IP sini yozing.
 */
const API_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  'http://10.0.2.2:4000/api';

const TOKEN_KEY = 'edulive_token';
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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
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
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Xatolik (${res.status})`);
  return data as T;
}
