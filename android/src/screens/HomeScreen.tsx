import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { api } from '../api';
import { flushQueue, getQueue } from '../store';
import { light } from '../theme';
import { BigButton, Card, StatusChip } from '../ui';

type Palette = typeof light;

export interface ClassItem {
  id: string;
  name: string;
  student_count: number;
}

interface ClassWithSession extends ClassItem {
  taken: boolean;
  confirmed: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export function HomeScreen({
  c, teacherName, onOpenClass, onLogout,
}: {
  c: Palette;
  teacherName: string;
  onOpenClass: (cls: ClassItem) => void;
  onLogout: () => void;
}) {
  const [classes, setClasses] = useState<ClassWithSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Avval navbatni yuborishga urinamiz — aloqa qaytgan bo'lishi mumkin
      const flushed = await flushQueue();
      if (flushed.sent > 0) {
        setSyncNote(`${flushed.sent} ta davomat yuborildi ✓`);
        setTimeout(() => setSyncNote(null), 3000);
      }
      setQueueCount(flushed.left);

      const list = await api<{ items: ClassItem[] }>('/classes');
      const withSessions = await Promise.all(
        list.items.map(async (cls) => {
          try {
            const view = await api<{ session: { confirmed_at: string | null } | null }>(
              `/attendance?classId=${cls.id}&date=${today()}`,
            );
            return { ...cls, taken: !!view.session, confirmed: !!view.session?.confirmed_at };
          } catch {
            return { ...cls, taken: false, confirmed: false };
          }
        }),
      );
      setClasses(withSessions);
      setOffline(false);
    } catch (err: any) {
      if (err?.status === 0) {
        setOffline(true);
        setQueueCount((await getQueue()).length);
        setClasses((prev) => prev ?? []); // eski ro'yxat qolsin
      } else if (err?.status === 401) {
        onLogout();
      } else {
        setError(err?.message ?? 'Xatolik');
      }
    }
  }, [onLogout]);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: c.t1, letterSpacing: -0.4 }}>Bugun</Text>
        <Text style={{ fontSize: 13, color: c.t2, marginTop: 2 }}>{teacherName}</Text>
      </View>

      {offline && (
        <View style={{ backgroundColor: c.warn, paddingVertical: 8, paddingHorizontal: 16 }}>
          <Text style={{ fontWeight: '600', fontSize: 13, color: '#1F2937' }}>
            ⚠ Internet yo'q{queueCount > 0 ? ` — ${queueCount} ta davomat yuborilishni kutmoqda` : ''}
          </Text>
        </View>
      )}
      {!offline && queueCount > 0 && (
        <View style={{ backgroundColor: c.brandSoft, paddingVertical: 8, paddingHorizontal: 16 }}>
          <Text style={{ fontWeight: '600', fontSize: 13, color: c.brandInk }}>
            {queueCount} ta davomat navbatda — yangilang
          </Text>
        </View>
      )}
      {syncNote && (
        <View style={{ paddingVertical: 8, paddingHorizontal: 16 }}>
          <Text style={{ fontWeight: '600', fontSize: 13, color: c.goodInk }}>{syncNote}</Text>
        </View>
      )}

      {error ? (
        <View style={{ padding: 24, alignItems: 'center', gap: 12 }}>
          <Text style={{ color: c.t1, fontWeight: '600' }}>Yuklab bo'lmadi</Text>
          <Text style={{ color: c.t2, fontSize: 13 }}>{error}</Text>
          <BigButton title="Qayta urinish" onPress={load} c={c} variant="secondary" />
        </View>
      ) : classes === null ? (
        // Skeleton — to'liq ekran spinneri emas
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ height: 76, borderRadius: 12, backgroundColor: c.surface3, opacity: 0.6 }} />
          ))}
        </View>
      ) : classes.length === 0 ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={{ fontSize: 32, color: c.t3 }}>▤</Text>
          <Text style={{ color: c.t1, fontWeight: '600', marginTop: 8 }}>Sinf biriktirilmagan</Text>
          <Text style={{ color: c.t2, fontSize: 13, textAlign: 'center', marginTop: 4 }}>
            Administrator sizni sinfga biriktirishi kerak.
          </Text>
        </View>
      ) : (
        <FlatList
          data={classes}
          keyExtractor={(x) => x.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          renderItem={({ item }) => (
            <Pressable onPress={() => onOpenClass(item)}>
              {({ pressed }) => (
                <Card c={c} style={{ opacity: pressed ? 0.85 : 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 17, fontWeight: '600', color: c.t1 }}>{item.name}</Text>
                      <Text style={{ fontSize: 13, color: c.t2, marginTop: 2 }}>
                        {item.student_count} o'quvchi
                      </Text>
                    </View>
                    {item.confirmed ? (
                      <StatusChip kind="good" label="Tasdiqlangan" c={c} />
                    ) : item.taken ? (
                      <StatusChip kind="warn" label="Tasdiqlanmagan" c={c} />
                    ) : (
                      <StatusChip kind="crit" label="Davomat olinmagan" c={c} />
                    )}
                  </View>
                </Card>
              )}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
