import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { isOffline, perms, type AuthedUser } from '../api';
import { initials, monthRange, rosterName } from '../format';
import { useRoster, useSummary, type ClassItem } from '../queries';
import { HIT, useTheme } from '../theme';
import { AppBar, Avatar, BigButton, EmptyState, ErrorState, Icon, Pill, Skeleton, ThumbZone } from '../ui';
import { IconButton } from '../forms';
import { ClassSheet } from './ClassForms';

/**
 * Sinf kartasi: o'quvchilar ro'yxati + tanlangan oy bo'yicha davomat yig'masi.
 * Bosh barmoq zonasida — bugungi davomatga o'tish.
 */
export function ClassDetailScreen({ cls, user, onBack, onTakeAttendance }: { cls: ClassItem; user: AuthedUser; onBack: () => void; onTakeAttendance: () => void }) {
  const c = useTheme();
  const canEdit = perms(user).admin;
  const [editOpen, setEditOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const range = monthRange(offset);

  const roster = useRoster(cls.id);
  const summary = useSummary(cls.id, range.from, range.to);
  const byStudent = new Map((summary.data ?? []).map((r) => [r.student_id, r]));

  const students = roster.data?.students ?? [];
  const totals = (summary.data ?? []).reduce(
    (a, r) => ({ absent: a.absent + r.absent, late: a.late + r.late, days: Math.max(a.days, r.present + r.absent + r.late) }),
    { absent: 0, late: 0, days: 0 },
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar
        title={`${cls.name} sinf`}
        meta={`${cls.student_count} o'quvchi${cls.homeroom_teacher ? ` · Rahbar: ${cls.homeroom_teacher}` : ''}`}
        onBack={onBack}
        right={canEdit ? <IconButton name="edit-2" label="Sinfni tahrirlash" onPress={() => setEditOpen(true)} /> : undefined}
      />

      {/* Oy tanlash + yig'ma */}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: c.surface2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border, paddingHorizontal: 6 }}>
        <Pressable onPress={() => setOffset((o) => o - 1)} accessibilityLabel="Oldingi oy" style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevron-left" size={20} />
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: c.t1 }}>{range.label}</Text>
          <Text style={{ fontSize: 11, color: c.t3, fontVariant: ['tabular-nums'] }}>
            {summary.data ? `${totals.days} kun · ${totals.absent} kelmadi · ${totals.late} kech` : ' '}
          </Text>
        </View>
        <Pressable onPress={() => setOffset((o) => Math.min(0, o + 1))} disabled={offset === 0} accessibilityLabel="Keyingi oy" style={{ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center', opacity: offset === 0 ? 0.3 : 1 }}>
          <Icon name="chevron-right" size={20} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 16 }}>
        {roster.isPending ? (
          <View style={{ paddingTop: 10 }}><Skeleton rows={6} height={52} /></View>
        ) : roster.isError ? (
          isOffline(roster.error)
            ? <EmptyState icon="wifi-off" title="Internet yo'q" text="Bu sinf ro'yxati hali telefonda saqlanmagan." action={{ label: 'Qayta urinish', onPress: () => roster.refetch() }} />
            : <ErrorState message={roster.error.message} onRetry={() => roster.refetch()} />
        ) : students.length === 0 ? (
          <EmptyState icon="user-x" title="Sinfda faol o'quvchi yo'q" text="O'quvchilarni administrator web orqali biriktiradi." />
        ) : (
          students.map((s, i) => {
            const r = byStudent.get(s.id);
            const name = rosterName(s);
            return (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: i === students.length - 1 ? 0 : 1, borderColor: c.border }}>
                <Avatar text={initials(name)} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: c.t1 }} numberOfLines={1}>{name}</Text>
                  {r && <Text style={{ fontSize: 11, color: c.t3, fontVariant: ['tabular-nums'] }}>{r.present + r.absent + r.late} kun belgilangan</Text>}
                </View>
                {summary.isPending ? (
                  <View style={{ width: 70, height: 22, borderRadius: 999, backgroundColor: c.surface3 }} />
                ) : summary.isError ? (
                  <Pill kind="neutral" icon="wifi-off" label="—" />
                ) : !r ? (
                  <Pill kind="neutral" label="Belgilanmagan" />
                ) : r.absent === 0 && r.late === 0 ? (
                  <Pill kind="good" icon="check" label="Hamma kun" />
                ) : (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {r.absent > 0 && <Pill kind="crit" icon="x" label={String(r.absent)} />}
                    {r.late > 0 && <Pill kind="warn" icon="clock" label={String(r.late)} />}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <ThumbZone>
        <BigButton title="Bugungi davomat" icon="check-square" onPress={onTakeAttendance} />
      </ThumbZone>
      {canEdit && <ClassSheet key={cls.id} cls={cls} open={editOpen} onClose={() => setEditOpen(false)} onDeleted={onBack} />}
    </View>
  );
}
