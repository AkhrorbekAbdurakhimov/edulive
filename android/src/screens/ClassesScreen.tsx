import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { isOffline, perms, type AuthedUser } from '../api';
import { fmtDate, money } from '../format';
import { Fab, IconButton } from '../forms';
import { useClasses, type ClassItem } from '../queries';
import { useTheme } from '../theme';
import { AppBar, Banner, Card, EmptyState, ErrorState, Icon, Pill, Skeleton } from '../ui';
import { ClassSheet, YearsSheet, useYears } from './ClassForms';

/**
 * Sinflar tabi: o'qituvchiga — biriktirilgan sinflar; admin/menejerga — hamma
 * sinf, oylik to'lov va o'quv yili. Admin sinf yaratadi va o'quv yilini boshqaradi
 * (web Classes bilan bir xil chegaralar).
 */
export function ClassesScreen({ user, onOpen }: { user: AuthedUser; onOpen: (cls: ClassItem) => void }) {
  const c = useTheme();
  const p = perms(user);
  const classes = useClasses();
  const years = useYears();
  const current = years.data?.find((y) => y.is_current);
  const [create, setCreate] = useState(false);
  const [yearsOpen, setYearsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([classes.refetch(), years.refetch()]);
    setRefreshing(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar
        title="Sinflar"
        meta={classes.data ? `${classes.data.items.length} ta sinf` : undefined}
        right={p.admin ? <IconButton name="calendar" label="O'quv yillari" onPress={() => setYearsOpen(true)} /> : undefined}
      />
      {classes.data?.stale && <Banner kind="warn" icon="wifi-off" text="Internet yo'q — saqlangan ro'yxat ko'rsatilmoqda" />}

      {/* O'quv yili — sinflar shunga bog'lanadi, shuning uchun doim ko'rinib tursin. */}
      {p.staff && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.surface2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border }}>
          <Text style={{ fontSize: 12, color: c.t3 }}>O'quv yili</Text>
          {years.isPending ? (
            <View style={{ width: 90, height: 22, borderRadius: 999, backgroundColor: c.surface3 }} />
          ) : current ? (
            <>
              <Pill kind="good" icon="check" label={current.name} />
              <Text style={{ fontSize: 12, color: c.t3, fontVariant: ['tabular-nums'] }}>{fmtDate(current.starts_on)} — {fmtDate(current.ends_on)}</Text>
            </>
          ) : (
            <Pill kind="crit" icon="alert-circle" label="Belgilanmagan" />
          )}
        </View>
      )}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 90, paddingTop: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {p.staff && years.data && !current ? (
          <EmptyState
            icon="calendar"
            title="Joriy o'quv yili belgilanmagan"
            text="Sinf o'quv yiliga bog'lanadi, shuning uchun avval o'quv yilini yarating."
            action={p.admin ? { label: "O'quv yilini yaratish", onPress: () => setYearsOpen(true) } : undefined}
          />
        ) : classes.isPending ? (
          <Skeleton rows={4} height={68} />
        ) : classes.isError ? (
          isOffline(classes.error)
            ? <EmptyState icon="wifi-off" title="Internet yo'q" text="Sinflar ro'yxati hali telefonda saqlanmagan." action={{ label: 'Qayta urinish', onPress: refresh }} />
            : <ErrorState message={classes.error.message} onRetry={refresh} />
        ) : classes.data.items.length === 0 ? (
          p.teacher
            ? <EmptyState icon="users" title="Sinf biriktirilmagan" text="Administrator sizni sinfga rahbar yoki fan o'qituvchisi sifatida biriktirishi kerak." />
            : <EmptyState icon="layers" title="Sinf yo'q" text={`${current?.name ?? 'Joriy'} o'quv yili uchun hali sinf ochilmagan.`} action={p.admin ? { label: '+ Yangi sinf', onPress: () => setCreate(true) } : undefined} />
        ) : (
          <View style={{ gap: 9 }}>
            {classes.data.items.map((cls) => {
              const mine = cls.homeroom_teacher_id === user.id;
              const sub = [
                `${cls.student_count} o'quvchi`,
                mine ? 'Sinf rahbari' : cls.homeroom_teacher ? `Rahbar: ${cls.homeroom_teacher}` : 'Rahbar belgilanmagan',
                p.staff ? `${money(cls.monthly_fee)}/oy` : null,
              ].filter(Boolean).join(' · ');
              return (
                <Card key={cls.id} onPress={() => onOpen(cls)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 11, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: c.brandInk }}>{cls.name}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: c.t1 }}>{cls.name} sinf</Text>
                      <Text style={{ fontSize: 12, color: c.t3 }} numberOfLines={2}>{sub}</Text>
                    </View>
                    <Icon name="chevron-right" size={18} color={c.t3} />
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>

      {p.admin && current && <Fab label="Sinf" icon="plus" onPress={() => setCreate(true)} />}
      {p.admin && <ClassSheet key={create ? 'new' : 'closed'} cls={null} open={create} onClose={() => setCreate(false)} />}
      {p.admin && <YearsSheet open={yearsOpen} onClose={() => setYearsOpen(false)} />}
    </View>
  );
}
