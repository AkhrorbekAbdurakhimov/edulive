import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import type { AuthedUser } from '../api';
import { isOffline } from '../api';
import { useClasses, type ClassItem } from '../queries';
import { useTheme } from '../theme';
import { AppBar, Banner, Card, EmptyState, ErrorState, Icon, Skeleton } from '../ui';

/** Sinflar tabi: o'qituvchiga biriktirilgan sinflar → sinf kartasi (oylik davomat). */
export function ClassesScreen({ user, onOpen }: { user: AuthedUser; onOpen: (cls: ClassItem) => void }) {
  const c = useTheme();
  const classes = useClasses();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await classes.refetch();
    setRefreshing(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar title="Sinflar" meta={classes.data ? `${classes.data.items.length} ta sinf` : undefined} />
      {classes.data?.stale && <Banner kind="warn" icon="wifi-off" text="Internet yo'q — saqlangan ro'yxat ko'rsatilmoqda" />}

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {classes.isPending ? (
          <Skeleton rows={4} height={68} />
        ) : classes.isError ? (
          isOffline(classes.error)
            ? <EmptyState icon="wifi-off" title="Internet yo'q" text="Sinflar ro'yxati hali telefonda saqlanmagan." action={{ label: 'Qayta urinish', onPress: refresh }} />
            : <ErrorState message={classes.error.message} onRetry={refresh} />
        ) : classes.data.items.length === 0 ? (
          <EmptyState icon="users" title="Sinf biriktirilmagan" text="Administrator sizni sinfga rahbar yoki fan o'qituvchisi sifatida biriktirishi kerak." />
        ) : (
          <View style={{ gap: 9 }}>
            {classes.data.items.map((cls) => {
              const mine = cls.homeroom_teacher_id === user.id;
              return (
                <Card key={cls.id} onPress={() => onOpen(cls)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 11, backgroundColor: c.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: c.brandInk }}>{cls.name}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: c.t1 }}>{cls.name} sinf</Text>
                      <Text style={{ fontSize: 12, color: c.t3 }} numberOfLines={1}>
                        {cls.student_count} o'quvchi · {mine ? 'Sinf rahbari' : cls.homeroom_teacher ? `Rahbar: ${cls.homeroom_teacher}` : 'Rahbar belgilanmagan'}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={18} color={c.t3} />
                  </View>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
