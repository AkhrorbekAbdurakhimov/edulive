import { useState } from 'react';
import { FlatList, Linking, Share, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { fmtDateTime, fmtPhone } from '../format';
import { Chips, ListItem } from '../forms';
import { useTheme } from '../theme';
import { Alarm, AppBar, BigButton, Card, EmptyState, ErrorState, Pill, Skeleton, type IconName, type StatusKind } from '../ui';

interface Row {
  id: string; kind: string; status: string; body: string | null;
  error: string | null; attempts: number;
  created_at: string; sent_at: string | null;
  parent_name: string | null; parent_phone: string | null; student_name: string | null;
}
type Status = 'all' | 'queued' | 'sent' | 'failed';

const KIND_LABEL: Record<string, string> = {
  'payment.received': "To'lov qabul qilindi",
  'attendance.absent': 'Darsga kelmadi',
  'attendance.late': 'Darsga kechikdi',
  'attendance.present': 'Darsga keldi',
  'debt.reminder': 'Qarz eslatmasi',
  // Ota-ona botda "bu mening farzandim emas" dedi — tekshirish kerak.
  'parent.link.rejected': "Ota-ona ma'lumotni tasdiqlamadi",
};

function statusOf(s: string): { kind: StatusKind; label: string } {
  if (s === 'sent') return { kind: 'good', label: 'Yuborildi' };
  if (s === 'queued') return { kind: 'neutral', label: 'Navbatda' };
  if (s === 'failed') return { kind: 'crit', label: 'Yuborilmadi' };
  return { kind: 'neutral', label: s };
}

export function NotificationsScreen() {
  const c = useTheme();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>('all');

  const q = useQuery({
    queryKey: ['notifications', status],
    queryFn: () => api<{ items: Row[]; total: number; counts: Record<string, number> }>(`/notifications${qs({ status: status === 'all' ? '' : status })}`),
  });
  const retry = useMutation({
    mutationFn: (id: string) => api(`/notifications/${id}/retry`, 'POST'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const counts = q.data?.counts ?? {};

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar title="Xabarlar" meta={q.data ? `${counts.sent ?? 0} yuborildi · ${counts.queued ?? 0} navbatda · ${counts.failed ?? 0} xato` : undefined} />
      <FlatList
        data={q.data?.items ?? []}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 8 }}>
            <InviteCard />
            <Chips<Status>
              value={status}
              onChange={setStatus}
              options={[{ value: 'all', label: 'Hammasi' }, { value: 'sent', label: 'Yuborilgan' }, { value: 'queued', label: 'Navbatda' }, { value: 'failed', label: 'Xato' }]}
            />
            {q.isPending && <Skeleton rows={4} height={64} />}
            {q.isError && <ErrorState message={q.error.message} onRetry={() => q.refetch()} />}
            {q.data && q.data.items.length === 0 && (
              <EmptyState
                icon="send"
                title="Xabar yo'q"
                text={status === 'all'
                  ? "Davomat tasdiqlanganda va to'lov qabul qilinganda ota-onaga avtomatik xabar ketadi. Buning uchun maktabga bot ulangan va ota-ona botda ro'yxatdan o'tgan bo'lishi kerak."
                  : "Bu holatda xabar yo'q."}
              />
            )}
          </View>
        }
        renderItem={({ item: n, index }) => {
          const st = statusOf(n.status);
          return (
            <ListItem
              title={`${KIND_LABEL[n.kind] ?? n.kind}${n.student_name ? ` · ${n.student_name}` : ''}`}
              sub={`${fmtDateTime(n.sent_at ?? n.created_at)} · ${n.parent_name ?? '—'}${n.body ? `\n${n.body}` : ''}${n.error ? `\n${n.error}` : ''}`}
              right={
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Pill kind={st.kind} icon={st.kind === 'good' ? 'check' : st.kind === 'crit' ? 'x' : 'clock'} label={st.label} />
                  {n.status === 'failed' && (
                    <BigButton title="Qayta" icon="refresh-cw" variant="secondary" height={36} onPress={() => retry.mutate(n.id)} busy={retry.isPending && retry.variables === n.id} />
                  )}
                </View>
              }
              last={index === (q.data?.items.length ?? 0) - 1}
            />
          );
        }}
      />
    </View>
  );
}

interface TgInfo {
  bot: string | null;
  ownBot: boolean;
  inviteLink: string | null;
  parents: { total: number; connected: number; waiting: number; rejected: number };
  pending: Array<{
    id: string; full_name: string; phone: string; students: string | null;
    /** none — botni ochmagan · pending — tasdiq kutilmoqda · rejected — tasdiqlamadi */
    state: 'none' | 'pending' | 'rejected';
  }>;
}

/**
 * Ota-onalarni botga ulash — xabar zanjirining eng ko'p uziladigan bo'g'ini.
 * Havola telefondan to'g'ridan-to'g'ri ulashiladi (Telegram, SMS).
 */
function InviteCard() {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['telegram-invite'], queryFn: () => api<TgInfo>('/notifications/telegram') });

  if (q.isPending) return <Skeleton rows={1} height={80} />;
  if (q.isError) return <Card><ErrorState message={q.error.message} onRetry={() => q.refetch()} /></Card>;
  const d = q.data;

  if (!d.bot) {
    return (
      <Card>
        <Text style={{ fontSize: 15, fontWeight: '700', color: c.t1 }}>Telegram bot ulanmagan</Text>
        <Text style={{ fontSize: 13, color: c.t2, marginTop: 4, lineHeight: 19 }}>
          Maktabga bot ulanmaguncha ota-onalarga xabar yuborib bo'lmaydi. Bot ulash platforma administratori orqali amalga oshiriladi.
        </Text>
      </Card>
    );
  }

  const left = d.parents.total - d.parents.connected;
  const share = () => Share.share({ message: `EduLive — ${d.bot} boti. Farzandingiz haqidagi xabarlarni olish uchun havolani oching va telefon raqamingizni tasdiqlang:\n${d.inviteLink}` });

  return (
    <Card style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: c.t1 }}>Ota-onalarni botga ulash</Text>
        <Pill kind={left === 0 ? 'good' : 'warn'} icon={left === 0 ? 'check' : 'clock'} label={`${d.parents.connected} / ${d.parents.total} ulangan`} />
      </View>
      <Text style={{ fontSize: 13, color: c.t2, lineHeight: 19 }}>
        Xabar faqat botga ulangan ota-onaga boradi. Havolani ota-onalarga yuboring: ular botni ochib telefon raqamini tasdiqlaydi, so'ng bot farzandi ma'lumotini ko'rsatib "Ha / Yo'q" deb so'raydi.
      </Text>
      {d.parents.rejected > 0 && (
        <Alarm title={`${d.parents.rejected} ta ota-ona "bu mening farzandim emas" dedi`}>
          <Text style={{ fontSize: 13, color: c.t2 }}>
            Raqam yoki biriktirish xato bo'lishi mumkin — ro'yxatda "Tasdiqlamadi" deb turganlarni tekshiring. Tuzatilgunga qadar ularga xabar yuborilmaydi.
          </Text>
        </Alarm>
      )}
      <Text style={{ fontSize: 12, color: c.brandInk, fontVariant: ['tabular-nums'] }} selectable>{d.inviteLink}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><BigButton title="Ulashish" icon="share-2" height={44} onPress={share} /></View>
        <View style={{ flex: 1 }}><BigButton title="Botni ochish" icon="external-link" variant="secondary" height={44} onPress={() => Linking.openURL(d.inviteLink!)} /></View>
      </View>
      {!d.ownBot && (
        <Text style={{ fontSize: 12, color: c.t3 }}>Umumiy platforma boti ishlatilyapti. Havoladagi kod maktabni aniqlaydi — o'zgartirmasdan yuboring.</Text>
      )}
      {left > 0 && (
        <>
          <BigButton title={open ? 'Yashirish' : `Xabar bormaydigan ${left} ta raqamni ko'rish`} variant="secondary" height={40} onPress={() => setOpen((v) => !v)} />
          {open && d.pending.map((p, i) => {
            const st = LINK_STATE[p.state] ?? LINK_STATE.none;
            return (
              <ListItem
                key={p.id}
                title={p.full_name}
                sub={`${fmtPhone(p.phone)}${p.students ? ` · ${p.students}` : ''}`}
                right={<Pill kind={st.kind} icon={st.icon} label={st.label} />}
                last={i === d.pending.length - 1}
              />
            );
          })}
        </>
      )}
    </Card>
  );
}

/** Raqamga nega xabar bormayotgani — rang yolg'iz emas, ikonka + so'z. */
const LINK_STATE: Record<string, { kind: StatusKind; icon: IconName; label: string }> = {
  rejected: { kind: 'crit', icon: 'alert-triangle', label: 'Tasdiqlamadi' },
  pending: { kind: 'warn', icon: 'clock', label: 'Tasdiq kutilmoqda' },
  none: { kind: 'neutral', icon: 'x', label: 'Botni ochmagan' },
};
