import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { AuthedUser } from '../api';
import { isOffline } from '../api';
import { firstName, fmtDate, initials, isoDate, longDate } from '../format';
import { useOnline } from '../net';
import { classesKey, useClasses, useTodaySessions, type ClassItem, type Session } from '../queries';
import { flushQueue, removeFromQueue, useQueue, type QueuedAttendance } from '../store';
import { useTheme } from '../theme';
import {
  Avatar, Banner, BigButton, Card, EmptyState, ErrorState, Icon, KpiCard, Pill, SectionLabel, Skeleton,
} from '../ui';

/**
 * Bosh ekran (maket 1 · Bugun). Maketdagi "bugungi darslar" jadvali dars
 * jadvali moduliga bog'liq (2-bosqich) — hozircha sinflar ro'yxati bugungi
 * davomat holati bilan ko'rsatiladi. Kartaning tuzilishi maketdagi bilan bir xil.
 */
export type TodayStatus = 'pending' | 'saved' | 'confirmed' | 'unknown';

export interface TodayClass extends ClassItem {
  status: TodayStatus;
  session: Session | null;
}

export function HomeScreen({
  user, onOpenClass, syncNote,
}: {
  user: AuthedUser;
  onOpenClass: (cls: ClassItem, pending: ClassItem[]) => void;
  syncNote: string | null;
}) {
  const c = useTheme();
  const qc = useQueryClient();
  const online = useOnline();
  const queue = useQueue();
  const today = isoDate();

  const classes = useClasses();
  const ids = useMemo(() => classes.data?.items.map((x) => x.id) ?? [], [classes.data]);
  const sessions = useTodaySessions(ids, today);

  const rows = useMemo<TodayClass[]>(() => {
    const items = classes.data?.items ?? [];
    return items.map((cls, i) => {
      const q = sessions[i];
      const queued = queue.some((x) => x.classId === cls.id && x.date === today);
      if (queued) return { ...cls, status: 'saved', session: null };
      if (!q || q.isPending || q.isError) return { ...cls, status: 'unknown', session: null };
      const s = q.data.session;
      return { ...cls, status: !s ? 'pending' : s.confirmed_at ? 'confirmed' : 'saved', session: s };
    });
  }, [classes.data, sessions, queue, today]);

  const pending = rows.filter((r) => r.status === 'pending' || r.status === 'unknown');
  const pendingCount = rows.filter((r) => r.status === 'pending').length;
  const absentToday = rows.reduce((n, r) => n + (r.session?.absent_count ?? 0), 0);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await flushQueue();
    await qc.invalidateQueries({ queryKey: classesKey });
    await qc.invalidateQueries({ queryKey: ['attendance'] });
    setRefreshing(false);
  };

  const failedQueue = queue.filter((q) => q.error);
  const waitingQueue = queue.filter((q) => !q.error);
  const offline = !online || (classes.isError && isOffline(classes.error)) || !!classes.data?.stale;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      {/* App bar — salomlashish + sana + avatar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 19, fontWeight: '700', color: c.t1, letterSpacing: -0.3 }}>
            Assalomu alaykum, {firstName(user.fullName)}
          </Text>
          <Text style={{ fontSize: 12, color: c.t3, marginTop: 2 }}>{longDate()}</Text>
        </View>
        <Avatar text={initials(user.fullName)} brand />
      </View>

      {offline && (
        <Banner
          kind="warn"
          icon="wifi-off"
          text={`Internet yo'q${waitingQueue.length ? ` — ${waitingQueue.length} ta davomat navbatda` : ''}`}
        />
      )}
      {!offline && waitingQueue.length > 0 && (
        <Banner kind="brand" icon="upload-cloud" text={`${waitingQueue.length} ta davomat yuborilmoqda…`} action={{ label: 'Yuborish', onPress: refresh }} />
      )}
      {syncNote && <Banner kind="good" icon="check-circle" text={syncNote} />}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24, paddingTop: 4 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          <KpiCard label="Davomat kutilmoqda" value={classes.data ? pendingCount : '—'} tone={pendingCount > 0 ? 'crit' : undefined} />
          <KpiCard label="Bugun kelmadi" value={classes.data ? absentToday : '—'} />
        </View>

        {/* Navbat — maket 6 · Oflayn holat */}
        {queue.length > 0 && (
          <View style={{ marginBottom: 14 }}>
            <SectionLabel>Yuborilishi kutilmoqda</SectionLabel>
            <View style={{ gap: 9 }}>
              {[...failedQueue, ...waitingQueue].map((q) => (
                <QueueCard key={`${q.classId}:${q.date}`} item={q} onRetry={refresh} onDiscard={() => removeFromQueue(q.classId, q.date)} />
              ))}
            </View>
          </View>
        )}

        <SectionLabel>Bugungi sinflar</SectionLabel>

        {classes.isPending ? (
          <Skeleton rows={3} height={68} />
        ) : classes.isError ? (
          isOffline(classes.error) ? (
            <EmptyState icon="wifi-off" title="Internet yo'q" text="Sinflar ro'yxati hali telefonda saqlanmagan. Aloqa tiklanganda yangilang." action={{ label: 'Qayta urinish', onPress: refresh }} />
          ) : (
            <ErrorState message={classes.error.message} onRetry={refresh} />
          )
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title="Sinf biriktirilmagan" text="Davomat olish uchun administrator sizni sinfga rahbar yoki fan o'qituvchisi sifatida biriktirishi kerak." />
        ) : (
          <View style={{ gap: 9 }}>
            {rows.map((r) => (
              <ClassCard key={r.id} row={r} mine={r.homeroom_teacher_id === user.id} onPress={() => onOpenClass(r, pending.filter((p) => p.id !== r.id))} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function ClassCard({ row, mine, onPress }: { row: TodayClass; mine: boolean; onPress: () => void }) {
  const c = useTheme();
  const s = row.session;
  const detail =
    s && (s.absent_count > 0 || s.late_count > 0)
      ? `Kelmadi ${s.absent_count} · Kech ${s.late_count}`
      : s
        ? 'Hamma keldi'
        : mine ? 'Sinf rahbari' : "Fan o'qituvchisi";

  return (
    <Card onPress={onPress}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <View style={{ width: 44, alignItems: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: c.t1, fontVariant: ['tabular-nums'] }}>{row.student_count}</Text>
          <Text style={{ fontSize: 10, color: c.t3 }}>o'quvchi</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: c.t1 }}>{row.name} sinf</Text>
          <Text style={{ fontSize: 12, color: c.t3 }} numberOfLines={1}>{detail}</Text>
        </View>
        {row.status === 'confirmed' && <Pill kind="good" icon="check" label="Olindi" />}
        {row.status === 'saved' && <Pill kind="warn" icon="clock" label="Tasdiqlanmagan" />}
        {row.status === 'pending' && <Pill kind="crit" icon="alert-circle" label="Kutilmoqda" />}
        {row.status === 'unknown' && <Pill kind="neutral" icon="wifi-off" label="Oflayn" />}
      </View>
    </Card>
  );
}

/** Navbatdagi davomat kartasi. Server rad etganini yashirmaymiz — sababi bilan ko'rsatiladi. */
function QueueCard({ item, onRetry, onDiscard }: { item: QueuedAttendance; onRetry: () => void; onDiscard: () => void }) {
  const c = useTheme();
  const absent = item.marks.filter((m) => m.status === 'absent').length;
  const late = item.marks.filter((m) => m.status === 'late').length;
  const present = item.total - absent - late;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: c.t1 }}>{item.className} sinf</Text>
          <Text style={{ fontSize: 12, color: c.t3 }}>{fmtDate(item.date)} · lokal saqlandi</Text>
        </View>
        {item.error
          ? <Pill kind="crit" icon="x" label="Rad etildi" />
          : <Pill kind="warn" icon="clock" label="Yuborilishi kutilmoqda" />}
      </View>
      <Text style={{ fontSize: 13, color: c.t1, marginTop: 10, fontVariant: ['tabular-nums'] }}>
        {present} keldi · {absent} kelmadi · {late} kech qoldi
      </Text>
      {item.error ? (
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: 6 }}>
          <Icon name="alert-circle" size={14} color={c.critInk} />
          <Text style={{ fontSize: 12, color: c.critInk, flex: 1 }}>{item.error}</Text>
        </View>
      ) : (
        <Text style={{ fontSize: 12, color: c.t2, marginTop: 6, lineHeight: 17 }}>
          Aloqa tiklanganda avtomatik yuboriladi va ota-onalarga xabar boradi. Ilovani yopsangiz ham yo'qolmaydi.
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <View style={{ flex: 1 }}>
          <BigButton title="Qayta urinish" onPress={onRetry} variant="secondary" height={44} icon="refresh-cw" />
        </View>
        {item.error && (
          <View style={{ flex: 1 }}>
            <BigButton title="O'chirish" onPress={onDiscard} variant="danger" height={44} icon="trash-2" />
          </View>
        )}
      </View>
    </Card>
  );
}
