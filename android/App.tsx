import { useEffect, useState } from 'react';
import { SafeAreaView, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { api, loadToken, saveToken } from './src/api';
import { dark, light } from './src/theme';
import { LoginScreen, type AuthedUser } from './src/screens/LoginScreen';
import { HomeScreen, type ClassItem } from './src/screens/HomeScreen';
import { AttendanceScreen } from './src/screens/AttendanceScreen';

/**
 * O'qituvchi ilovasi: Bugun → Davomat → Tasdiqlash (development/mobile-ui.dc.html).
 *
 * ASOSIY QOIDA: davomatda hamma sukut bo'yicha "Keldi".
 * O'qituvchi faqat kelmaganlarni bosadi — 28 emas, 2-3 ta teginish.
 * Oflayn-first: tasdiqlangan davomat navbatda kutadi, aloqa qaytganda ketadi.
 */

type Screen =
  | { name: 'boot' }
  | { name: 'login' }
  | { name: 'home' }
  | { name: 'attendance'; cls: ClassItem };

export default function App() {
  const c = useColorScheme() === 'dark' ? dark : light;
  const [screen, setScreen] = useState<Screen>({ name: 'boot' });
  const [user, setUser] = useState<AuthedUser | null>(null);

  useEffect(() => {
    (async () => {
      const token = await loadToken();
      if (!token) {
        setScreen({ name: 'login' });
        return;
      }
      try {
        const me = await api<{ user: { id: string; fullName: string; role: string } }>('/auth/me');
        setUser(me.user);
        setScreen({ name: 'home' });
      } catch (err: any) {
        if (err?.status === 0) {
          // Oflayn — token bor, ishlashda davom etamiz (oflayn-first)
          setUser({ id: '', fullName: "O'qituvchi", role: 'teacher' });
          setScreen({ name: 'home' });
        } else {
          await saveToken(null);
          setScreen({ name: 'login' });
        }
      }
    })();
  }, []);

  const logout = async () => {
    await saveToken(null);
    setUser(null);
    setScreen({ name: 'login' });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.page }}>
      <StatusBar style="auto" />
      {screen.name === 'boot' && <View style={{ flex: 1, backgroundColor: c.page }} />}

      {screen.name === 'login' && (
        <LoginScreen
          c={c}
          onLogin={(u) => { setUser(u); setScreen({ name: 'home' }); }}
        />
      )}

      {screen.name === 'home' && (
        <HomeScreen
          c={c}
          teacherName={user?.fullName ?? ''}
          onOpenClass={(cls) => setScreen({ name: 'attendance', cls })}
          onLogout={logout}
        />
      )}

      {screen.name === 'attendance' && (
        <AttendanceScreen
          c={c}
          cls={screen.cls}
          onDone={() => setScreen({ name: 'home' })}
          onBack={() => setScreen({ name: 'home' })}
        />
      )}
    </SafeAreaView>
  );
}
