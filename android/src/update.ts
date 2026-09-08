import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Ilova o'zini yangilaydi (DECISIONS M10).
 *
 * APK'lar GitHub Release'da (`android-v<version>-<versionCode>`), repo ochiq —
 * ilova ishga tushganda va oldinga chiqqanda oxirgi release'ni tekshiradi,
 * versionCode kattaroq bo'lsa yuklab olib Android o'rnatuvchisini ochadi.
 * Bir xil keystore bilan imzolangani uchun eski versiya ustiga o'rnatiladi.
 */
const RELEASES_URL = 'https://api.github.com/repos/AkhrorbekAbdurakhimov/edulive/releases?per_page=10';
const TAG_RE = /^android-v(.+)-(\d+)$/;
const DISMISSED_KEY = 'edulive_update_dismissed';
/** Oldinga chiqganda qayta tekshirish oralig'i — GitHub API limiti (60/soat) uchun. */
const RECHECK_MS = 15 * 60_000;

export interface UpdateInfo {
  versionCode: number;
  version: string;
  apkUrl: string;
  sizeBytes: number;
}

/** Tekshiruv natijasi: `info` — yangi versiya (yo'q bo'lsa null), `error` — nega tekshirib bo'lmadi. */
export interface CheckResult {
  info: UpdateInfo | null;
  latest: number | null;
  error: string | null;
  checkedAt: number;
}

/** Native build raqami = CI run_number (app.config.js). Dev'da 0 → tekshiruv o'chadi. */
export const currentVersionCode = (): number => Number(Application.nativeBuildVersion ?? 0);

export async function checkForUpdate(): Promise<CheckResult> {
  const at = Date.now();
  if (Platform.OS !== 'android') return { info: null, latest: null, error: 'Faqat Android', checkedAt: at };
  if (__DEV__) return { info: null, latest: null, error: 'Dev rejimida tekshirilmaydi', checkedAt: at };
  const current = currentVersionCode();
  if (!current) return { info: null, latest: null, error: "Build raqami aniqlanmadi", checkedAt: at };

  let res: Response;
  try {
    res = await fetch(RELEASES_URL, { headers: { accept: 'application/vnd.github+json' } });
  } catch (e: any) {
    return { info: null, latest: null, error: `GitHub'ga ulanib bo'lmadi: ${e?.message ?? 'tarmoq xatosi'}`, checkedAt: at };
  }
  if (!res.ok) return { info: null, latest: null, error: `GitHub javobi: ${res.status}`, checkedAt: at };

  const releases = (await res.json()) as Array<{
    tag_name: string; draft: boolean; prerelease: boolean;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  }>;
  const rel = releases.find((r) => !r.draft && !r.prerelease && TAG_RE.test(r.tag_name));
  if (!rel) return { info: null, latest: null, error: 'Android release topilmadi', checkedAt: at };
  const [, version, code] = rel.tag_name.match(TAG_RE)!;
  const apk = rel.assets.find((a) => a.name.endsWith('.apk'));
  if (!apk) return { info: null, latest: null, error: "Release'da APK yo'q", checkedAt: at };

  const versionCode = Number(code);
  if (versionCode <= current) return { info: null, latest: versionCode, error: null, checkedAt: at };
  return { info: { versionCode, version, apkUrl: apk.browser_download_url, sizeBytes: apk.size }, latest: versionCode, error: null, checkedAt: at };
}

/** APK'ni keshga yuklab, tizim o'rnatuvchisini ochadi. Qolgani — Android'ning "O'rnatish" tugmasi. */
export async function downloadAndInstall(info: UpdateInfo, onProgress: (ratio: number) => void): Promise<void> {
  const dest = `${FileSystem.cacheDirectory}edulive-${info.versionCode}.apk`;
  const dl = FileSystem.createDownloadResumable(info.apkUrl, dest, {}, (p) => {
    const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : info.sizeBytes;
    onProgress(Math.min(1, p.totalBytesWritten / total));
  });
  const result = await dl.downloadAsync();
  if (!result || result.status !== 200) throw new Error("APK'ni yuklab bo'lmadi. Keyinroq urinib ko'ring");

  // content:// URI FileProvider orqali — Android 7+ file:// ni boshqa ilovaga bermaydi.
  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}

export async function dismissUpdate(versionCode: number): Promise<void> {
  await AsyncStorage.setItem(DISMISSED_KEY, String(versionCode));
}

export interface UpdateState {
  update: UpdateInfo | null;
  /** Sheet'ni avtomatik ko'rsatish kerakmi ("Keyinroq" deyilgan versiya uchun faqat banner qoladi). */
  prompt: boolean;
  setPrompt: (v: boolean) => void;
  last: CheckResult | null;
  /** Qo'lda tekshirish (Profil). `force` — "Keyinroq" deyilgan bo'lsa ham sheet ochiladi. */
  check: (force?: boolean) => Promise<CheckResult>;
}

/**
 * Ishga tushganda va ilova oldinga chiqganda (15 daqiqadan keyin) tekshiradi.
 * Android jarayonni fonda tirik saqlaydi — faqat mount'da tekshirilsa, kunlab
 * yopilmagan ilova yangilanishni hech qachon ko'rmaydi.
 */
export function useUpdateCheck(): UpdateState {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [prompt, setPrompt] = useState(false);
  const [last, setLast] = useState<CheckResult | null>(null);
  const lastAt = useRef(0);

  const check = useCallback(async (force = false) => {
    const r = await checkForUpdate();
    lastAt.current = r.checkedAt;
    setLast(r);
    setUpdate(r.info);
    if (r.info) {
      const dismissed = Number((await AsyncStorage.getItem(DISMISSED_KEY)) ?? 0);
      setPrompt(force || dismissed < r.info.versionCode);
    }
    return r;
  }, []);

  useEffect(() => {
    void check();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && Date.now() - lastAt.current > RECHECK_MS) void check();
    });
    return () => sub.remove();
  }, [check]);

  return { update, prompt, setPrompt, last, check };
}

export const UpdateContext = createContext<UpdateState | null>(null);
export const useUpdate = (): UpdateState | null => useContext(UpdateContext);
