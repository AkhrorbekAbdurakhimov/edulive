import { useEffect, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { api } from '../api';
import {
  clearDraft, enqueue, loadDraft, saveDraft, type Mark, type Status,
} from '../store';
import { HIT, light, radius } from '../theme';
import { BigButton, Card, StatusChip, initials } from '../ui';
import type { ClassItem } from './HomeScreen';

type Palette = typeof light;

interface Student { id: string; last_name: string; first_name: string }

const today = () => new Date().toISOString().slice(0, 10);
const NEXT: Record<Status, Status> = { present: 'absent', absent: 'late', late: 'present' };

/**
 * MAHSULOTDAGI ENG MUHIM EKRAN (DESIGN_PROMPT 4.7).
 * Hamma sukut bo'yicha "Keldi" — o'qituvchi faqat kelmaganlarni bosadi.
 * Tasdiqlash tugmasi bosh barmoq zonasida. Oflayn bo'lsa navbatga tushadi.
 */
export function AttendanceScreen({
  c, cls, onDone, onBack,
}: {
  c: Palette;
  cls: ClassItem;
  onDone: () => void;
  onBack: () => void;
}) {
  const date = today();
  const [students, setStudents] = useState<Student[] | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'sent' | 'queued' | null>(null);

  useEffect(() => {
    (async () => {
      // Qoralama birinchi — orqaga tugmasi hech narsani yo'qotmagan bo'ladi
      const draft = await loadDraft(cls.id, date);
      if (draft) setMarks(draft);
      try {
        const data = await api<{ students: Student[] }>(`/classes/${cls.id}`);
        setStudents(data.students);
      } catch (err: any) {
        setError(err?.message ?? 'Xatolik');
      }
    })();
  }, [cls.id, date]);

  const counts = useMemo(() => {
    const total = students?.length ?? 0;
    let absent = 0, late = 0;
    for (const s of students ?? []) {
      const st = marks[s.id] ?? 'present';
      if (st === 'absent') absent++;
      else if (st === 'late') late++;
    }
    return { total, absent, late, present: total - absent - late };
  }, [students, marks]);

  const cycle = (id: string) => {
    setMarks((m) => {
      const next = { ...m, [id]: NEXT[m[id] ?? 'present'] };
      saveDraft(cls.id, date, next); // har o'zgarishda qoralama
      return next;
    });
  };

  const markList = (): Mark[] =>
    (students ?? [])
      .map((s) => ({ studentId: s.id, status: marks[s.id] ?? 'present' }))
      .filter((m): m is { studentId: string; status: 'absent' | 'late' } => m.status !== 'present')
      .map((m) => (m.status === 'late' ? { ...m, minutesLate: 0 } : m));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const take = await api<{ sessionId: string }>('/attendance/take', 'POST', {
        classId: cls.id, date, marks: markList(),
      });
      await api(`/attendance/${take.sessionId}/confirm`, 'POST');
      await clearDraft(cls.id, date);
      setResult('sent');
    } catch (err: any) {
      if (err?.status === 0) {
        // Oflayn: navbatga — internet qaytganda Home ekrani yuboradi
        await enqueue({ classId: cls.id, className: cls.name, date, marks: markList(), queuedAt: new Date().toISOString() });
        setResult('queued');
      } else if (err?.status === 409) {
        setError('Bu sinf uchun davomat allaqachon tasdiqlangan');
        setSheetOpen(false);
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
      <View style={{ flex: 1, backgroundColor: c.page, padding: 24, justifyContent: 'center', gap: 12 }}>
        <Text style={{ fontSize: 44, textAlign: 'center' }}>{result === 'sent' ? '✅' : '📡'}</Text>
        <Text style={{ fontSize: 20, fontWeight: '700', color: c.t1, textAlign: 'center' }}>
          {result === 'sent' ? 'Davomat tasdiqlandi' : 'Navbatga qo\'yildi'}
        </Text>
        <Text style={{ fontSize: 14, color: c.t2, textAlign: 'center' }}>
          {result === 'sent'
            ? "Kelmaganlarning ota-onalariga xabar yuborildi. 3 soat ichida tahrirlash mumkin."
            : "Internet qaytganda avtomatik yuboriladi. Ota-onaga xabar server tasdig'idan keyin ketadi."}
        </Text>
        <View style={{ marginTop: 16 }}>
          <BigButton title="Bosh sahifa" onPress={onDone} c={c} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.page }}>
      {/* Sarlavha */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 }}>
        <Pressable
          onPress={onBack}
          style={{ minWidth: HIT, minHeight: HIT, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 22, color: c.t2 }}>‹</Text>
        </Pressable>
        <View>
          <Text style={{ fontSize: 17, fontWeight: '700', color: c.t1 }}>{cls.name} sinf</Text>
          <Text style={{ fontSize: 12, color: c.t2 }}>
            {date.split('-').reverse().join('.')} · {counts.total} o'quvchi
          </Text>
        </View>
      </View>

      {/* Yopishqoq xulosa */}
      <View style={{
        flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10,
        backgroundColor: c.surface, borderBottomWidth: 1, borderColor: c.border,
      }}>
        <StatusChip kind="good" label={`Kelgan ${counts.present}`} c={c} />
        <StatusChip kind="crit" label={`Kelmagan ${counts.absent}`} c={c} />
        <StatusChip kind="warn" label={`Kech ${counts.late}`} c={c} />
      </View>

      {error && (
        <View style={{ padding: 12, paddingHorizontal: 16 }}>
          <Text style={{ color: c.critInk, fontSize: 13, fontWeight: '600' }}>{error}</Text>
        </View>
      )}

      {students === null ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={{ height: 56, borderRadius: 12, backgroundColor: c.surface3, opacity: 0.6 }} />
          ))}
        </View>
      ) : (
        <FlatList
          data={students}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingBottom: 120 }}
          renderItem={({ item }) => {
            const st = marks[item.id] ?? 'present';
            const name = `${item.last_name} ${item.first_name}`;
            return (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                paddingHorizontal: 16, paddingVertical: 8,
                borderBottomWidth: 1, borderColor: c.border, backgroundColor: c.surface,
              }}>
                <View style={{
                  width: 36, height: 36, borderRadius: 999, backgroundColor: c.brandSoft,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: c.brandInk, fontWeight: '600', fontSize: 12 }}>{initials(name)}</Text>
                </View>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '500', color: c.t1 }}>{name}</Text>
                <Pressable
                  onPress={() => cycle(item.id)}
                  style={{ minHeight: HIT, minWidth: 110, justifyContent: 'center', alignItems: 'flex-end' }}
                >
                  <StatusChip
                    kind={st === 'present' ? 'good' : st === 'absent' ? 'crit' : 'warn'}
                    label={st === 'present' ? 'Keldi' : st === 'absent' ? 'Kelmadi' : 'Kech qoldi'}
                    c={c}
                  />
                </Pressable>
              </View>
            );
          }}
        />
      )}

      {/* Bosh barmoq zonasi — TASDIQLASH */}
      {students !== null && students.length > 0 && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 24 }}>
          <BigButton title="TASDIQLASH" onPress={() => setSheetOpen(true)} c={c} />
        </View>
      )}

      {/* Tasdiqlash sheet'i */}
      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,17,21,.45)' }} onPress={() => setSheetOpen(false)} />
        <View style={{
          backgroundColor: c.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          padding: 20, paddingBottom: 32, gap: 8,
        }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.border, alignSelf: 'center', marginBottom: 8 }} />
          <Text style={{ fontSize: 18, fontWeight: '700', color: c.t1 }}>Davomatni tasdiqlash</Text>
          <Card c={c} style={{ backgroundColor: c.surface2 }}>
            <Text style={{ fontSize: 15, color: c.t1, fontVariant: ['tabular-nums'] }}>
              Jami {counts.total} · Kelgan {counts.present} · Kelmagan {counts.absent} · Kech {counts.late}
            </Text>
          </Card>
          <Text style={{ fontSize: 13, color: c.t2 }}>
            Bu kelmagan va kech qolgan o'quvchilarning ota-onalariga xabar yuboradi.
          </Text>
          <View style={{ gap: 10, marginTop: 8 }}>
            <BigButton title={busy ? 'Yuborilmoqda…' : 'Tasdiqlash va yuborish'} onPress={submit} c={c} busy={busy} />
            <BigButton title="Bekor qilish" onPress={() => setSheetOpen(false)} c={c} variant="secondary" />
          </View>
        </View>
      </Modal>
    </View>
  );
}
