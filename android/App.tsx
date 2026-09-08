import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, Text, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  api, canUseApp, clearCache, loadToken, loadUser, perms, saveToken, saveUser, setUnauthorizedHandler, type AuthedUser,
} from './src/api';
import { startSync } from './src/net';
import { queryClient, type ClassItem } from './src/queries';
import { clearLocalAttendance } from './src/store';
import { dark, light, ThemeContext, useTheme } from './src/theme';
import { Icon, Sheet, type IconName } from './src/ui';
import { useUpdateCheck } from './src/update';
import { UpdateBanner, UpdateSheet } from './src/UpdateSheet';
import { LoginScreen } from './src/screens/LoginScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ClassesScreen } from './src/screens/ClassesScreen';
import { ClassDetailScreen } from './src/screens/ClassDetailScreen';
import { AttendanceScreen } from './src/screens/AttendanceScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { StudentsScreen } from './src/screens/StudentsScreen';
import { StudentCardScreen, type StudentPick } from './src/screens/StudentCardScreen';
import { PaymentsScreen } from './src/screens/PaymentsScreen';
import { DebtorsScreen } from './src/screens/DebtorsScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { BookDetailScreen } from './src/screens/BookDetailScreen';
import { UsersScreen } from './src/screens/UsersScreen';
import type { BookRow } from './src/screens/LibraryForms';

/**
 * Maktab xodimlari ilovasi — web bilan bir xil bo'limlar (DECISIONS M11).
 *
 * Navigatsiya: pastki panelda 4 joy (3 bo'lim + "Yana"), qolgani varaqda —
 * web Layout'dagi MOBILE_ORDER bilan bir xil: kassir kun bo'yi to'lov yozadi,
 * kutubxonachi kitob beradi, shuning uchun ular bosh barmoq ostida.
 * Bo'limlar rolga qarab: o'qituvchi — davomat, sinflar, (kutubxona), profil.
 *
 * ASOSIY QOIDA: davomatda hamma sukut bo'yicha "Keldi".
 * Oflayn-first: tasdiqlangan davomat navbatda kutadi, aloqa qaytganda ketadi.
 */

type Tab = 'today' | 'dashboard' | 'classes' | 'students' | 'payments' | 'debtors' | 'notifications' | 'library' | 'users' | 'profile';
type Route =
  | { name: 'class'; cls: ClassItem }
  | { name: 'attendance'; cls: ClassItem; pending: ClassItem[] }
  | { name: 'student'; id: string }
  | { name: 'book'; book: BookRow };

type Auth = { state: 'boot' } | { state: 'out' } | { state: 'in'; user: AuthedUser };

interface NavItem { key: Tab; label: string; icon: IconName }
const NAV: Record<Tab, NavItem> = {
  dashboard: { key: 'dashboard', label: 'Boshqaruv', icon: 'grid' },
  today: { key: 'today', label: 'Davomat', icon: 'check-square' },
  classes: { key: 'classes', label: 'Sinflar', icon: 'layers' },
  students: { key: 'students', label: "O'quvchilar", icon: 'users' },
  payments: { key: 'payments', label: "To'lovlar", icon: 'credit-card' },
  debtors: { key: 'debtors', label: 'Qarzdorlar', icon: 'alert-circle' },
  notifications: { key: 'notifications', label: 'Xabarlar', icon: 'send' },
  library: { key: 'library', label: 'Kutubxona', icon: 'book-open' },
  users: { key: 'users', label: 'Xodimlar', icon: 'briefcase' },
  profile: { key: 'profile', label: 'Profil', icon: 'user' },
};
/** Pastki panelda shuncha joy; qolgani "Yana" varaqasiga. */
const SLOTS = 4;

/** Rol bo'yicha bo'limlar — tartib pastki panel uchun (eng ko'p ochiladiganlar oldinda). */
function navFor(u: AuthedUser): Tab[] {
  const p = perms(u);
  if (p.teacher) {
    return ['today', 'classes', ...(p.library ? (['library'] as Tab[]) : []), 'profile'];
  }
  return ['dashboard', 'payments', 'library', 'today', 'classes', 'students', 'debtors', 'notifications', 'users', 'profile'];
}

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
  const [moreOpen, setMoreOpen] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  /** O'quvchi kartasidan To'lovlar bo'limiga o'tganda tanlangan o'quvchi. */
  const [payStudent, setPayStudent] = useState<StudentPick | null>(null);

  // O'z-o'zini yangilash (M10): ishga tushganda bir marta tekshiriladi, kirishdan qat'i nazar.
  const upd = useUpdateCheck();
  const [updOpen, setUpdOpen] = useState(false);
  useEffect(() => { if (upd.prompt) setUpdOpen(true); }, [upd.prompt]);
  const updateLayer = upd.update && (
    <>
      {!updOpen && <UpdateBanner info={upd.update} onPress={() => setUpdOpen(true)} />}
      <UpdateSheet info={upd.update} open={updOpen} onClose={() => setUpdOpen(false)} />
    </>
  );

  const signOut = useCallback(async () => {
    await saveToken(null);
    await saveUser(null);
    await clearCache();
    await clearLocalAttendance();
    queryClient.clear();
    setStack([]);
    setAuth({ state: 'out' });
  }, []);

  const signIn = useCallback((user: AuthedUser) => {
    setAuth({ state: 'in', user });
    setTab(navFor(user)[0]);
    setStack([]);
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
        signIn(user);
      } catch (err: any) {
        if (err?.status === 0 && cached) signIn(cached);
        else await signOut();
      }
    })();
  }, [signOut, signIn]);

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

  const user = auth.state === 'in' ? auth.user : null;
  const nav = useMemo(() => (user ? navFor(user) : []), [user]);
  const homeTab = nav[0] ?? 'today';

  // Android orqaga tugmasi: varaq → ekran → bosh tab → chiqish. Qoralama saqlangan, yo'qotish yo'q.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (moreOpen) { setMoreOpen(false); return true; }
      if (stack.length > 0) { setStack((s) => s.slice(0, -1)); return true; }
      if (tab !== homeTab) { setTab(homeTab); return true; }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, tab, homeTab, moreOpen]);

  const push = (r: Route) => setStack((s) => [...s, r]);
  const pop = () => setStack((s) => s.slice(0, -1));
  const goTab = (t: Tab) => { setStack([]); setTab(t); setMoreOpen(false); };
  const openStudent = (id: string) => push({ name: 'student', id });
  const openPay = (s: StudentPick) => { setPayStudent(s); goTab('payments'); };

  if (auth.state === 'boot') {
    return <View style={{ flex: 1, backgroundColor: c.page }} />;
  }

  if (auth.state === 'out' || !user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.page }}>
        <StatusBar style="auto" />
        {updateLayer}
        <LoginScreen onLogin={signIn} />
      </SafeAreaView>
    );
  }

  const top = stack[stack.length - 1];
  const primary = nav.length > SLOTS ? nav.slice(0, SLOTS - 1) : nav;
  const overflow = nav.length > SLOTS ? nav.slice(SLOTS - 1) : [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.surface }} edges={['top', 'left', 'right']}>
      <StatusBar style="auto" />
      {updateLayer}

      {top?.name === 'attendance' && (
        <AttendanceScreen
          key={top.cls.id}
          cls={top.cls}
          nextClass={top.pending[0] ?? null}
          onBack={pop}
          onDone={() => goTab(homeTab)}
          onNext={(cls) => setStack([{ name: 'attendance', cls, pending: top.pending.filter((p) => p.id !== cls.id) }])}
        />
      )}
      {top?.name === 'class' && (
        <ClassDetailScreen cls={top.cls} user={user} onBack={pop} onTakeAttendance={() => push({ name: 'attendance', cls: top.cls, pending: [] })} />
      )}
      {top?.name === 'student' && (
        <StudentCardScreen key={top.id} id={top.id} user={user} onBack={pop} onPay={openPay} onArchived={pop} />
      )}
      {top?.name === 'book' && <BookDetailScreen key={top.book.id} book={top.book} user={user} onBack={pop} />}

      {!top && (
        <>
          <View style={{ flex: 1 }}>
            {tab === 'today' && <HomeScreen user={user} syncNote={syncNote} onOpenClass={(cls, pending) => push({ name: 'attendance', cls, pending })} />}
            {tab === 'dashboard' && <DashboardScreen go={goTab} />}
            {tab === 'classes' && <ClassesScreen user={user} onOpen={(cls) => push({ name: 'class', cls })} />}
            {tab === 'students' && <StudentsScreen user={user} onOpen={openStudent} />}
            {tab === 'payments' && <PaymentsScreen user={user} preselected={payStudent} onOpenStudent={openStudent} />}
            {tab === 'debtors' && <DebtorsScreen onOpenStudent={openStudent} />}
            {tab === 'notifications' && <NotificationsScreen />}
            {tab === 'library' && <LibraryScreen user={user} onOpenBook={(book) => push({ name: 'book', book })} />}
            {tab === 'users' && <UsersScreen user={user} />}
            {tab === 'profile' && (
              <ProfileScreen user={user} onLogout={signOut} onUserUpdate={(u) => setAuth({ state: 'in', user: u })} />
            )}
          </View>
          <BottomNav items={primary} active={tab} moreActive={overflow.some((t) => t === tab)} hasMore={overflow.length > 0} onChange={goTab} onMore={() => setMoreOpen(true)} />
        </>
      )}

      {/* Pastki panelga sig'magan bo'limlar — gorizontal scroll o'rniga varaq. */}
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Boshqa bo'limlar">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {overflow.map((t) => {
            const n = NAV[t];
            const on = t === tab;
            return (
              <Pressable
                key={t}
                onPress={() => goTab(t)}
                accessibilityRole="button"
                style={{ width: '31%', flexGrow: 1, minHeight: 72, borderRadius: 12, borderWidth: 1, borderColor: on ? c.brand : c.border, backgroundColor: on ? c.brandSoft : c.surface2, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 8 }}
              >
                <Icon name={n.icon} size={22} color={on ? c.brandInk : c.t2} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: on ? c.brandInk : c.t1, textAlign: 'center' }}>{n.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function BottomNav({ items, active, moreActive, hasMore, onChange, onMore }: {
  items: Tab[]; active: Tab; moreActive: boolean; hasMore: boolean; onChange: (t: Tab) => void; onMore: () => void;
}) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const cell = (key: string, label: string, icon: IconName, on: boolean, onPress: () => void) => {
    const color = on ? c.brandInk : c.t3;
    return (
      <Pressable
        key={key}
        onPress={onPress}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        style={{ flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4, minHeight: 48 }}
      >
        <Icon name={icon} size={20} color={color} />
        <Text style={{ fontSize: 10, fontWeight: '600', color }} numberOfLines={1}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface, paddingTop: 6, paddingBottom: 6 + insets.bottom }}>
      {items.map((t) => cell(t, NAV[t].label, NAV[t].icon, t === active, () => onChange(t)))}
      {hasMore && cell('more', 'Yana', 'more-horizontal', moreActive, onMore)}
    </View>
  );
}
