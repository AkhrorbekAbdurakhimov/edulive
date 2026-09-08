import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { longDate, money } from '../format';
import { Tile } from '../forms';
import { useTheme } from '../theme';
import { AppBar, ErrorState, Skeleton } from '../ui';

interface DashboardData {
  students: { active: number };
  attendanceToday: {
    sessions: number; confirmed: number; total: number;
    present: number; absent: number; late: number; rate: number | null;
  };
  payments: { thisMonth: number };
  debtors: { count: number; outstanding: number };
}

export type DashTarget = 'today' | 'students' | 'payments' | 'debtors';

/**
 * Boshqaruv paneli (web Dashboard). Web'da davomat plitkalari vaqtincha
 * yashirilgan — telefonda davomat bor, shuning uchun ular ko'rsatiladi.
 */
export function DashboardScreen({ go }: { go: (t: DashTarget) => void }) {
  const c = useTheme();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/dashboard') });
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => { setRefreshing(true); await q.refetch(); setRefreshing(false); };
  const d = q.data;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar title="Boshqaruv" meta={longDate()} />
      <ScrollView
        contentContainerStyle={{ padding: 14, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {q.isPending ? (
          <Skeleton rows={3} height={84} />
        ) : q.isError ? (
          <ErrorState message={q.error.message} onRetry={refresh} />
        ) : d && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            <Tile
              label="Bugungi davomat"
              value={d.attendanceToday.rate === null ? '—' : `${d.attendanceToday.rate}%`}
              sub={d.attendanceToday.sessions === 0
                ? 'Bugun davomat hali olinmagan'
                : `${d.attendanceToday.sessions} sinf, ${d.attendanceToday.confirmed} tasdiqlangan`}
              onPress={() => go('today')}
            />
            <Tile
              label="Kelmaganlar"
              value={d.attendanceToday.absent}
              sub={`kech qolganlar: ${d.attendanceToday.late}`}
              tone={d.attendanceToday.absent > 0 ? 'crit' : undefined}
              onPress={() => go('today')}
            />
            <Tile label="Faol o'quvchilar" value={d.students.active} sub="ro'yxatdagi o'quvchilar" onPress={() => go('students')} />
            <Tile label="Shu oy tushumi" value={money(d.payments.thisMonth)} sub="tasdiqlangan to'lovlar" onPress={() => go('payments')} />
            {/* Qarz — neytral rangda, lekin eng ko'zga tashlanadigan raqam (DESIGN_PROMPT 4.1) */}
            <Tile label="Umumiy qarzdorlik" value={money(d.debtors.outstanding)} sub={`${d.debtors.count} o'quvchi qarzdor`} onPress={() => go('debtors')} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
