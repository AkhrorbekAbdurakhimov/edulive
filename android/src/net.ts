import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { flushQueue } from './store';

/**
 * Tarmoq holati bitta manbadan: NetInfo. TanStack Query ham shu manbaga
 * ulanadi, shunda aloqa qaytganda so'rovlar o'zi qayta yuboriladi.
 */
function reachable(s: { isConnected: boolean | null; isInternetReachable: boolean | null }): boolean {
  return !!s.isConnected && s.isInternetReachable !== false;
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(reachable(s))), []);
  return online;
}

/**
 * Fon sinxronizatsiyasi: aloqa qaytganda yoki ilova oldinga chiqqanda navbat
 * yuboriladi va davomat holatlari yangilanadi. Ota-onaga xabar shu paytda —
 * server tasdiqlaganidan keyin — ketadi.
 */
export function startSync(qc: QueryClient, onFlushed: (sent: number) => void): () => void {
  let wasOnline = true;

  const flush = async () => {
    const { sent } = await flushQueue();
    if (sent > 0) {
      onFlushed(sent);
      await qc.invalidateQueries({ queryKey: ['attendance'] });
    }
  };

  const unsubNet = NetInfo.addEventListener((s) => {
    const online = reachable(s);
    onlineManager.setOnline(online);
    if (online && !wasOnline) void flush();
    wasOnline = online;
  });

  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') void flush();
  });

  void flush();

  return () => {
    unsubNet();
    appState.remove();
  };
}
