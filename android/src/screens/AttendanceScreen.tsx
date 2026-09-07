import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { isOffline } from '../api';
import { durationLabel, fmtDate, fmtTime, initials, isoDate, rosterName } from '../format';
import { attendanceKey, useRoster, useSession, type ClassItem, type Student } from '../queries';
import {
  clearDraft, enqueue, loadDraft, saveDraft, sendAttendance,
  type Mark, type Marks, type MarkState, type Status,
} from '../store';
import { radius, tint, useTheme } from '../theme';
import {
  AppBar, Avatar, Banner, BigButton, EmptyState, ErrorState, Icon, Pill, Sheet, Skeleton, StatusButton, Tally, ThumbZone,
} from '../ui';

const NEXT: Record<Status, Status> = { present: 'absent', absent: 'late', late: 'present' };
const LATE_QUICK = [5, 10, 15, 20, 30];

type Result =
  | { kind: 'sent'; notified: number; editableUntil: string | null; updated: boolean }
  | { kind: 'queued' };

/**
 * MAHSULOTDAGI ENG MUHIM EKRAN (DESIGN_PROMPT 4.7, maket 2–4).
 * Hamma sukut bo'yicha "Keldi" — o'qituvchi faqat kelmaganlarni bosadi.
 * Tasdiqlash tugmasi bosh barmoq zonasida. Oflayn bo'lsa navbatga tushadi.
 * Mavjud sessiya bo'lsa — tahrir rejimi (server tahrir oynasini o'zi tekshiradi).
 */
export function AttendanceScreen({
  cls, nextClass, onDone, onNext, onBack,
}: {
  cls: ClassItem;
  nextClass: ClassItem | null;
  onDone: () => void;
  onNext: (cls: ClassItem) => void;
  onBack: () => void;
}) {
  const c = useTheme();
  const qc = useQueryClient();
  const date = isoDate();

  const roster = useRoster(cls.id);
  const view = useSession(cls.id, date);

  const [marks, setMarks] = useState<Marks | null>(null); // null — hali yuklanmagan
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [lateFor, setLateFor] = useState<Student | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const students = roster.data?.students ?? [];
  const session = view.data?.session ?? null;
  const confirmed = !!session?.confirmed_at;

  // Boshlang'ich holat: qoralama birinchi (orqaga tugmasi hech narsani yo'qotmagan),
  // keyin serverdagi sessiya (tahrir), bo'lmasa hamma "keldi".
  useEffect(() => {
    if (marks !== null || !roster.data || (view.isPending && !view.isError)) return;
    (async () => {
      const draft = await loadDraft(cls.id, date);
      if (draft) return setMarks(draft);
      const initial: Marks = {};
      for (const it of view.data?.items ?? []) {
        if (it.status !== 'present') initial[it.student_id] = { status: it.status, minutesLate: it.minutes_late ?? undefined };
      }
      setMarks(initial);
    })();
  }, [marks, roster.data, view.isPending, view.isError, view.data, cls.id, date]);

  const stateOf = (id: string): MarkState => marks?.[id] ?? { status: 'present' };

  const counts = useMemo(() => {
    let absent = 0, late = 0;
    for (const s of students) {
      const st = stateOf(s.id).status;
      if (st === 'absent') absent++;
      else if (st === 'late') late++;
    }
    return { total: students.length, absent, late, present: students.length - absent - late };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, marks]);

  const update = (fn: (m: Marks) => Marks) => {
    setMarks((m) => {
      const next = fn(m ?? {});
      void saveDraft(cls.id, date, next); // har o'zgarishda qoralama
      return next;
    });
  };

  const cycle = (id: string) =>
    update((m) => {
      const next = NEXT[m[id]?.status ?? 'present'];
      if (next === 'present') {
        const { [id]: _drop, ...rest } = m;
        return rest;
      }
      return { ...m, [id]: { status: next } };
    });

  const setLate = (id: string, minutesLate: number | undefined) =>
    update((m) => ({ ...m, [id]: { status: 'late', minutesLate } }));

  const markList = (): Mark[] =>
    students.flatMap((s) => {
      const st = stateOf(s.id);
      if (st.status === 'present') return [];
      return [{ studentId: s.id, status: st.status, ...(st.status === 'late' && st.minutesLate ? { minutesLate: st.minutesLate } : {}) }];
    });

  const submit = async () => {
    setBusy(true);
    setError(null);
    const payload = { classId: cls.id, date, marks: markList(), confirm: !confirmed };
    try {
      const r = await sendAttendance(payload);
      await clearDraft(cls.id, date);
      await qc.invalidateQueries({ queryKey: attendanceKey(cls.id, date) });
      setSheetOpen(false);
      setResult({
        kind: 'sent',
        notified: r.notificationsQueued,
        editableUntil: r.editableUntil ?? session?.editableUntil ?? null,
        updated: confirmed,
      });
    } catch (err: any) {
      if (isOffline(err)) {
        // Oflayn: navbatga — aloqa qaytganda net.ts yuboradi
        await enqueue({ ...payload, className: cls.name, total: students.length, queuedAt: new Date().toISOString() });
        setSheetOpen(false);
        setResult({ kind: 'queued' });
      } else {
        setError(err?.message ?? 'Xatolik');
        setSheetOpen(false);
      }
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------ natija ekrani
  if (result) {
    return (
      <ResultScreen
        result={result}
        cls={cls}
        total={students.length}
        nextClass={nextClass}
        onDone={onDone}
        onNext={onNext}
      />
    );
  }

  const loading = roster.isPending || marks === null && !roster.isError;
  const rosterOffline = roster.isError && isOffline(roster.error);
  const editUntilLabel = session?.editableUntil ? fmtTime(session.editableUntil) : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar
        title={`${cls.name} sinf`}
        meta={`${fmtDate(date)} · ${students.length || cls.student_count} o'quvchi`}
        onBack={onBack}
        right={confirmed ? <Pill kind="good" icon="check" label="Tasdiqlangan" /> : session ? <Pill kind="warn" icon="clock" label="Saqlangan" /> : null}
      />

      {/* Yopishqoq xulosa (maket .sumbar) */}
      <View style={{ flexDirection: 'row', backgroundColor: c.surface2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border, paddingVertical: 10, paddingHorizontal: 14 }}>
        <SumCell value={counts.present} label="Keldi" color={c.goodInk} />
        <SumCell value={counts.absent} label="Kelmadi" color={c.critInk} />
        <SumCell value={counts.late} label="Kech qoldi" color={c.warnInk} />
      </View>

      {roster.data?.stale && <Banner kind="warn" icon="wifi-off" text="Internet yo'q — davomat navbatga qo'yiladi" />}
      {confirmed && editUntilLabel && (
        <Banner kind="neutral" icon="clock" text={`Tasdiqlangan. ${editUntilLabel} gacha tahrirlash mumkin`} />
      )}
      {error && <Banner kind="crit" icon="alert-circle" text={error} />}

      {loading ? (
        <View style={{ padding: 14 }}><Skeleton rows={7} height={52} /></View>
      ) : roster.isError ? (
        rosterOffline
          ? <EmptyState icon="wifi-off" title="Internet yo'q" text="Bu sinf ro'yxati hali telefonda saqlanmagan — birinchi marta internet bilan oching." action={{ label: 'Qayta urinish', onPress: () => roster.refetch() }} />
          : <ErrorState message={roster.error.message} onRetry={() => roster.refetch()} />
      ) : students.length === 0 ? (
        <EmptyState icon="user-x" title="Sinfda faol o'quvchi yo'q" text="O'quvchilarni administrator web orqali biriktiradi." />
      ) : (
        <FlatList
          data={students}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 4, paddingBottom: 8 }}
          initialNumToRender={16}
          renderItem={({ item, index }) => {
            const st = stateOf(item.id);
            const name = rosterName(item);
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: index === students.length - 1 ? 0 : 1, borderColor: c.border }}>
                <Avatar text={initials(name)} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: c.t1 }} numberOfLines={1}>{name}</Text>
                  {st.status === 'late' && (
                    <Text style={{ fontSize: 11, color: c.t3 }}>
                      {st.minutesLate ? `${st.minutesLate} daqiqa` : 'Daqiqa: bosib turing'}
                    </Text>
                  )}
                </View>
                {st.status === 'present' && <StatusButton kind="good" icon="check" label="Keldi" onPress={() => cycle(item.id)} />}
                {st.status === 'absent' && <StatusButton kind="crit" icon="x" label="Kelmadi" onPress={() => cycle(item.id)} />}
                {st.status === 'late' && (
                  <StatusButton kind="warn" icon="clock" label="Kech qoldi" onPress={() => cycle(item.id)} onLongPress={() => setLateFor(item)} />
                )}
              </View>
            );
          }}
        />
      )}

      {/* Bosh barmoq zonasi */}
      {students.length > 0 && (
        <ThumbZone hint={confirmed ? "O'zgarishlar saqlanadi, ota-onaga qayta xabar ketmaydi" : 'Tasdiqlangandan keyin ota-onalarga xabar yuboriladi'}>
          <BigButton title={confirmed ? "O'zgarishlarni saqlash" : 'Davomatni tasdiqlash'} icon="check" onPress={() => setSheetOpen(true)} />
        </ThumbZone>
      )}

      {/* Tasdiqlash oynasi (maket 3) */}
      <Sheet
        open={sheetOpen}
        onClose={() => !busy && setSheetOpen(false)}
        title={confirmed ? "O'zgarishlarni saqlaysizmi?" : 'Davomatni tasdiqlaysizmi?'}
        sub={`${cls.name} sinf · ${fmtDate(date)}, ${fmtTime(new Date())}`}
      >
        <Tally items={[
          { value: counts.total, label: "Jami o'quvchi" },
          { value: counts.present, label: 'Keldi', tone: 'good' },
          { value: counts.absent, label: 'Kelmadi', tone: 'crit' },
          { value: counts.late, label: 'Kech qoldi', tone: 'warn' },
        ]} />
        {!confirmed && (
          <View style={{ flexDirection: 'row', gap: 8, padding: 11, borderRadius: radius.tile, backgroundColor: tint(c.warn, 0.15), marginTop: 12 }}>
            <Icon name="alert-triangle" size={15} color={c.warnInk} />
            <Text style={{ flex: 1, fontSize: 12, color: c.warnInk, fontWeight: '500', lineHeight: 17 }}>
              {counts.absent + counts.late > 0
                ? <><Text style={{ fontWeight: '700' }}>{counts.absent + counts.late} ta o'quvchining</Text> ota-onasiga Telegram orqali darhol xabar yuboriladi.</>
                : 'Hamma keldi — ota-onalarga xabar yuborilmaydi.'}
            </Text>
          </View>
        )}
        <View style={{ marginTop: 12, gap: 8 }}>
          <BigButton title={busy ? 'Yuborilmoqda…' : confirmed ? 'Saqlash' : 'Tasdiqlash va yuborish'} onPress={submit} busy={busy} />
          <BigButton title="Orqaga qaytish" onPress={() => setSheetOpen(false)} variant="secondary" height={44} disabled={busy} />
        </View>
      </Sheet>

      {/* Kechikish daqiqasi — ota-onaga "18 daqiqa kechikdi" deb boradi */}
      <Sheet open={!!lateFor} onClose={() => setLateFor(null)} title="Necha daqiqa kechikdi?" sub={lateFor ? rosterName(lateFor) : undefined}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {LATE_QUICK.map((m) => {
            const on = lateFor && stateOf(lateFor.id).minutesLate === m;
            return (
              <Pressable
                key={m}
                onPress={() => { if (lateFor) setLate(lateFor.id, m); setLateFor(null); }}
                style={{ flex: 1, height: 44, borderRadius: radius.tile, borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderColor: on ? c.brand : c.border, backgroundColor: on ? c.brandSoft : c.surface }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: on ? c.brandInk : c.t2, fontVariant: ['tabular-nums'] }}>{m}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ marginTop: 10 }}>
          <BigButton title="Daqiqasiz qoldirish" variant="secondary" height={44} onPress={() => { if (lateFor) setLate(lateFor.id, undefined); setLateFor(null); }} />
        </View>
      </Sheet>
    </View>
  );
}

function SumCell({ value, label, color }: { value: number; label: string; color: string }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 19, fontWeight: '700', color, fontVariant: ['tabular-nums'], lineHeight: 23 }}>{value}</Text>
      <Text style={{ fontSize: 11, color: c.t3, fontWeight: '500' }}>{label}</Text>
    </View>
  );
}

/** Maket 4 · Muvaffaqiyat va 6 · Oflayn (navbatga qo'yildi). */
function ResultScreen({
  result, cls, total, nextClass, onDone, onNext,
}: {
  result: Result; cls: ClassItem; total: number; nextClass: ClassItem | null;
  onDone: () => void; onNext: (cls: ClassItem) => void;
}) {
  const c = useTheme();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const sent = result.kind === 'sent';
  const remaining = sent && result.editableUntil ? durationLabel(new Date(result.editableUntil).getTime() - now) : null;
  const tone = sent ? c.good : c.warn;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ width: 66, height: 66, borderRadius: 99, backgroundColor: tint(tone, 0.14), alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Icon name={sent ? 'check' : 'wifi-off'} size={32} color={sent ? c.good : c.warnInk} />
        </View>
        <Text style={{ fontSize: 19, fontWeight: '700', color: c.t1, letterSpacing: -0.3 }}>
          {sent ? (result.updated ? 'Davomat yangilandi' : 'Davomat saqlandi') : 'Navbatga qo\'yildi'}
        </Text>
        <Text style={{ fontSize: 13, color: c.t2, textAlign: 'center', marginTop: 6, lineHeight: 19, maxWidth: 260 }}>
          {cls.name} sinf · {total} o'quvchi{'\n'}
          {sent
            ? result.updated
              ? "O'zgarishlar saqlandi, ota-onaga qayta xabar ketmadi"
              : result.notified > 0
                ? `${result.notified} ta ota-onaga xabar yuborildi`
                : 'Kelmagan yo\'q — xabar yuborilmadi'
            : "Internet qaytganda avtomatik yuboriladi. Ota-onaga xabar server tasdig'idan keyin ketadi."}
        </Text>
        {sent && remaining && (
          <View style={{ marginTop: 16, paddingVertical: 9, paddingHorizontal: 13, borderWidth: 1, borderColor: c.border, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name="clock" size={15} color={c.t2} />
            <Text style={{ fontSize: 12, color: c.t2 }}>
              <Text style={{ fontWeight: '700', color: c.t1, fontVariant: ['tabular-nums'] }}>{remaining}</Text> ichida tahrirlash mumkin
            </Text>
          </View>
        )}
        {!sent && (
          <Text style={{ fontSize: 12, color: c.t3, textAlign: 'center', marginTop: 14, maxWidth: 260 }}>
            Ma'lumot telefoningizda xavfsiz saqlangan. Ilovani yopsangiz ham yo'qolmaydi.
          </Text>
        )}
      </View>
      <ThumbZone>
        {nextClass ? (
          <View style={{ gap: 8 }}>
            <BigButton title={`Keyingi sinf — ${nextClass.name}`} icon="arrow-right" onPress={() => onNext(nextClass)} />
            <BigButton title="Bosh sahifaga" variant="secondary" height={44} onPress={onDone} />
          </View>
        ) : (
          <BigButton title="Bosh sahifaga" onPress={onDone} />
        )}
      </ThumbZone>
    </View>
  );
}
