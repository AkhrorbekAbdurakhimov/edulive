import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { fmtDate, fmtPhone, money } from '../format';
import { useTheme } from '../theme';
import { AppBar, BigButton, Card, EmptyState, ErrorState, Pill, Skeleton, type StatusKind } from '../ui';

interface DebtorRow {
  student_id: string; student_name: string; class_name: string | null;
  outstanding: number; overdue: number; oldest_due: string | null;
  parent_name: string | null; parent_phone: string | null;
}

/** Muddati o'tgan davr — xavf darajasi. Rang HAR DOIM so'z bilan. */
function risk(oldestDue: string | null): { kind: StatusKind; label: string } {
  if (!oldestDue) return { kind: 'neutral', label: 'Muddat kelmagan' };
  const months = Math.floor((Date.now() - new Date(oldestDue).getTime()) / (30 * 24 * 3600 * 1000));
  if (months >= 3) return { kind: 'crit', label: `${months} oy o'tgan` };
  if (months >= 1) return { kind: 'warn', label: `${months} oy o'tgan` };
  return { kind: 'warn', label: '1 oydan kam' };
}

export function DebtorsScreen({ onOpenStudent }: { onOpenStudent: (id: string) => void }) {
  const c = useTheme();
  const [note, setNote] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ['debtors'],
    queryFn: () => api<{ items: DebtorRow[]; total: number; totalOutstanding: number }>('/debtors'),
  });

  const remind = useMutation({
    mutationFn: (studentId: string) => api<{ queued: number }>(`/debtors/${studentId}/remind`, 'POST'),
    onSuccess: (d, id) => setNote((n) => ({ ...n, [id]: d.queued > 0 ? `Yuborildi (${d.queued})` : "Ota-ona botga ulanmagan — xabor ketmadi" })),
    onError: (e: any, id) => setNote((n) => ({ ...n, [id]: e?.message ?? 'Yuborilmadi' })),
  });

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar title="Qarzdorlar" meta={q.data ? `${q.data.total} o'quvchi · jami ${money(q.data.totalOutstanding)}` : undefined} />
      {q.isPending ? (
        <View style={{ padding: 14 }}><Skeleton rows={4} height={110} /></View>
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <EmptyState icon="check-circle" title="Qarzdor yo'q" text="Barcha hisoblar to'langan yoki hisoblar hali chiqarilmagan." />
      ) : (
        <FlatList
          data={q.data.items}
          keyExtractor={(d) => d.student_id}
          contentContainerStyle={{ padding: 14, gap: 9 }}
          renderItem={({ item: d }) => {
            const r = risk(d.oldest_due);
            const busy = remind.isPending && remind.variables === d.student_id;
            return (
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: c.t1 }} onPress={() => onOpenStudent(d.student_id)}>{d.student_name}</Text>
                    <Text style={{ fontSize: 12, color: c.t3, marginTop: 2 }}>
                      {d.class_name ?? 'Sinfsiz'}{d.oldest_due ? ` · eng eski muddat ${fmtDate(d.oldest_due)}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: c.t1, fontVariant: ['tabular-nums'] }}>{money(d.outstanding)}</Text>
                    <Pill kind={r.kind} icon={r.kind === 'crit' ? 'alert-circle' : r.kind === 'warn' ? 'clock' : 'minus'} label={r.label} />
                  </View>
                </View>
                <Text style={{ fontSize: 12, color: c.t2, marginTop: 8 }}>
                  {d.parent_name ? `${d.parent_name} · ${fmtPhone(d.parent_phone)}` : "Ota-ona qo'shilmagan"}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <BigButton title={busy ? 'Yuborilmoqda…' : 'Eslatma yuborish'} icon="send" variant="secondary" height={44} onPress={() => remind.mutate(d.student_id)} busy={busy} disabled={!d.parent_name} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <BigButton title="Karta" icon="user" variant="secondary" height={44} onPress={() => onOpenStudent(d.student_id)} />
                  </View>
                </View>
                {note[d.student_id] && <Text style={{ fontSize: 12, color: c.t2, marginTop: 6 }}>{note[d.student_id]}</Text>}
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}
