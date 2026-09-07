import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Pressable, Text, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  api, canUseApp, clearCache, loadToken, loadUser, saveToken, saveUser, setUnauthorizedHandler, type AuthedUser,
} from './src/api';
import { startSync } from './src/net';
import { queryClient, type ClassItem } from './src/queries';
import { clearLocalAttendance } from './src/store';
import { dark, light, ThemeContext, useTheme } from './src/theme';
import { Icon, type IconName } from './src/ui';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ClassesScreen } from './src/screens/ClassesScreen';
import { ClassDetailScreen } from './src/screens/ClassDetailScreen';
import { AttendanceScreen } from './src/screens/AttendanceScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';

/**
 * Maktab xodimlari ilovasi — o'qituvchi, menejer, admin (development/mobile-ui.dc.html).
 * Superadmin faqat web orqali kiradi (DECISIONS M9).
 *
 * Navigatsiya: 3 tab (Bugun · Sinflar · Profil) + tab ustida ochiladigan
 * ekranlar (sinf kartasi, davomat). Maketdagi "Baholar" tabi 2-bosqich —
 * backend'da baho moduli yo'q, o'lik tugma qo'yilmaydi.
 *
 * ASOSIY QOIDA: davomatda hamma sukut bo'yicha "Keldi".
 * Oflayn-first: tasdiqlangan davomat navbatda kutadi, aloqa qaytganda ketadi.
 */

type Tab = 'today' | 'classes' | 'profile';
type Route =
  | { name: 'class'; cls: ClassItem }
  | { name: 'attendance'; cls: ClassItem; pending: ClassItem[] };

type Auth = { state: 'boot' } | { state: 'out' } | { state: 'in'; user: AuthedUser };

export default function App() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={scheme === 'dark' ? dark : light}>
        <QueryClientProvider client={queryClient}>
          <Root />
        </QueryClientProvider>
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

function Root() {
  const c = useTheme();
  const [auth, setAuth] = useState<Auth>({ state: 'boot' });
  const [tab, setTab] = useState<Tab>('today');
  const [stack, setStack] = useState<Route[]>([]);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    await saveToken(null);
    await saveUser(null);
    await clearCache();
    await clearLocalAttendance();
    queryClient.clear();
    setStack([]);
    setTab('today');
    setAuth({ state: 'out' });
  }, []);

  // Ishga tushish: token bor → /auth/me; oflayn bo'lsa saqlangan foydalanuvchi bilan davom etamiz.
  useEffect(() => {
    (async () => {
      const token = await loadToken();
      if (!token) return setAuth({ state: 'out' });
      const cached = await loadUser();
      try {
        const me = await api<{ user: AuthedUser }>('/auth/me');
        if (!canUseApp(me.user.role)) return await signOut();
        const user = { ...me.user, phone: me.user.phone ?? cached?.phone ?? null };
        await saveUser(user);
        setAuth({ state: 'in', user });
      } catch (err: any) {
        if (err?.status === 0 && cached) setAuth({ state: 'in', user: cached });
        else await signOut();
      }
    })();
  }, [signOut]);

  // 401 — sessiya eskirgan (parol o'zgargan, xodim chiqarilgan): login ekraniga.
  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // Fon sinxronizatsiyasi faqat kirgan holatda
  useEffect(() => {
    if (auth.state !== 'in') return;
    return startSync(queryClient, (sent) => {
      setSyncNote(`${sent} ta davomat yuborildi`);
      setTimeout(() => setSyncNote(null), 3000);
    });
  }, [auth.state]);

  // Android orqaga tugmasi: ekran → tab → chiqish. Qoralama saqlangan, yo'qotish yo'q.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 0) { setStack((s) => s.slice(0, -1)); return true; }
      if (tab !== 'today') { setTab('today'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab]);

  const push = (r: Route) => setStack((s) => [...s, r]);
  const pop = () => setStack((s) => s.slice(0, -1));
  const home = () => { setStack([]); setTab('today'); };

  if (auth.state === 'boot') {
    return <View style={{ flex: 1, backgroundColor: c.page }} />;
  }

  if (auth.state === 'out') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.page }}>
        <StatusBar style="auto" />
        <LoginScreen onLogin={(user) => setAuth({ state: 'in', user })} />
      </SafeAreaView>
    );
  }

  const { user } = auth;
  const top = stack[stack.length - 1];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }} edges={['top', 'left', 'right']}>
      <StatusBar style="auto" />

      {top?.name === 'attendance' && (
        <AttendanceScreen
          key={top.cls.id}
          cls={top.cls}
          nextClass={top.pending[0] ?? null}
          onBack={pop}
          onDone={home}
          onNext={(cls) => setStack([{ name: 'attendance', cls, pending: top.pending.filter((p) => p.id !== cls.id) }])}
        />
      )}

      {top?.name === 'class' && (
        <ClassDetailScreen
          cls={top.cls}
          onBack={pop}
          onTakeAttendance={() => push({ name: 'attendance', cls: top.cls, pending: [] })}
        />
      )}

      {!top && (
        <>
          <View style={{ flex: 1 }}>
            {tab === 'today' && (
              <HomeScreen user={user} syncNote={syncNote} onOpenClass={(cls, pending) => push({ name: 'attendance', cls, pending })} />
            )}
            {tab === 'classes' && <ClassesScreen user={user} onOpen={(cls) => push({ name: 'class', cls })} />}
            {tab === 'profile' && <ProfileScreen user={user} onLogout={signOut} />}
          </View>
          <BottomNav tab={tab} onChange={setTab} />
        </>
      )}
    </SafeAreaView>
  );
}

const TABS: Array<{ key: Tab; label: string; icon: IconName }> = [
  { key: 'today', label: 'Bugun', icon: 'calendar' },
  { key: 'classes', label: 'Sinflar', icon: 'users' },
  { key: 'profile', label: 'Profil', icon: 'user' },
];

function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingTop: 6, paddingBottom: 6 + insets.bottom }}>
      {TABS.map((t) => {
        const on = t.key === tab;
        const color = on ? c.brandInk : c.t3;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4, minHeight: 48 }}
          >
            <Icon name={t.icon} size={20} color={color} />
            <Text style={{ fontSize: 10, fontWeight: '600', color }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
