import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Ilova o'zini yangilaydi (DECISIONS M10).
 *
 * APK'lar GitHub Release'da (`android-v<version>-<versionCode>`), repo ochiq —
 * ilova ishga tushganda oxirgi release'ni tekshiradi, versionCode kattaroq
 * bo'lsa yuklab olib Android o'rnatuvchisini ochadi. Foydalanuvchi APK'ni
 * qidirib, qo'lda yuklab o'rnatishi shart emas. Bir xil keystore bilan
 * imzolangani uchun eski versiya ustiga o'rnatiladi, ma'lumot yo'qolmaydi.
 */
const RELEASES_URL = 'https://api.github.com/repos/AkhrorbekAbdurakhimov/edulive/releases?per_page=10';
const TAG_RE = /^android-v(.+)-(\d+)$/;
const DISMISSED_KEY = 'edulive_update_dismissed';

export interface UpdateInfo {
  versionCode: number;
  version: string;
  apkUrl: string;
  sizeBytes: number;
}

/** Native build raqami = CI run_number (app.config.js). Dev'da 0 → tekshiruv o'chadi. */
export const currentVersionCode = (): number => Number(Application.nativeBuildVersion ?? 0);

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (Platform.OS !== 'android' || __DEV__) return null;
  const current = currentVersionCode();
  if (!current) return null;

  let res: Response;
  try {
    res = await fetch(RELEASES_URL, { headers: { accept: 'application/vnd.github+json' } });
  } catch {
    return null; // oflayn — jim
  }
  if (!res.ok) return null;

  const releases = (await res.json()) as Array<{
    tag_name: string; draft: boolean; prerelease: boolean;
    assets: Array<{ name: string; browser_download_url: string; size: number }>;
  }>;
  const rel = releases.find((r) => !r.draft && !r.prerelease && TAG_RE.test(r.tag_name));
  if (!rel) return null;
  const [, version, code] = rel.tag_name.match(TAG_RE)!;
  const apk = rel.assets.find((a) => a.name.endsWith('.apk'));
  if (!apk) return null;

  const versionCode = Number(code);
  if (versionCode <= current) return null;
  return { versionCode, version, apkUrl: apk.browser_download_url, sizeBytes: apk.size };
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

/**
 * Ishga tushganda bir marta tekshiradi. `prompt` — sheet ko'rsatish kerakmi
 * ("Keyinroq" deyilgan versiya uchun faqat banner qoladi).
 */
export function useUpdateCheck(): { update: UpdateInfo | null; prompt: boolean; setPrompt: (v: boolean) => void } {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [prompt, setPrompt] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const info = await checkForUpdate();
      if (!info || !alive) return;
      const dismissed = Number((await AsyncStorage.getItem(DISMISSED_KEY)) ?? 0);
      setUpdate(info);
      setPrompt(dismissed < info.versionCode);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { update, prompt, setPrompt };
}
