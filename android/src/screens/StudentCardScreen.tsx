import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api, perms, type AuthedUser } from '../api';
import { fmtDate, fmtPhone, initials, money, monthLabel } from '../format';
import { ListItem, Tile, invoiceKind } from '../forms';
import { useTheme } from '../theme';
import { AppBar, Avatar, BigButton, ErrorState, Icon, Pill, SectionLabel, Skeleton, ThumbZone, type IconName, type StatusKind } from '../ui';
import { ArchiveSheet, EditClassSheet, EditInfoSheet } from './StudentForms';
import { StudentBooks } from './LibraryForms';

interface CardData {
  student: {
    id: string; last_name: string; first_name: string; middle_name: string | null;
    birth_date: string | null; gender: string | null; status: string;
    class_id: string | null; class_name: string | null;
    monthly_fee: number | null; discount_percent: number | null; discount_reason: string | null;
  };
  /** Eski shakl: `phone` + `telegram_linked`; yangi (006_parent_phones): `phones[]`. Ikkalasi ham qabul qilinadi. */
  parents: Array<{
    id: string; full_name: string; relation: string | null; is_primary: boolean;
    phone?: string; telegram_linked?: boolean;
    phones?: Array<{ id: string; phone: string; isPrimary: boolean; telegramLinked: boolean; telegramState?: string; notifyEnabled: boolean }>;
  }>;
  finance: { invoiced: number; paid: number; outstanding: number; advance: number };
}
interface InvoiceRow {
  id: string; period_month: string; amount: number; discount: number;
  due_date: string; status: string; paid: number; outstanding: number;
}

const REL: Record<string, string> = { father: 'Otasi', mother: 'Onasi', guardian: 'Vasiy' };

export interface StudentPick { id: string; last_name: string; first_name: string; class_name: string | null }

/** O'quvchi kartasi (web StudentCard): moliya, hisoblar, ota-onalar, kutubxona, tahrir amallari. */
export function StudentCardScreen({ id, user, onBack, onPay, onArchived }: {
  id: string; user: AuthedUser; onBack: () => void; onPay: (s: StudentPick) => void; onArchived: () => void;
}) {
  const c = useTheme();
  const p = perms(user);
  const [editing, setEditing] = useState<null | 'info' | 'class' | 'archive'>(null);

  const card = useQuery({ queryKey: ['student', id], queryFn: () => api<CardData>(`/students/${id}`) });
  const invoices = useQuery({
    queryKey: ['invoices', id],
    queryFn: () => api<{ items: InvoiceRow[] }>(`/invoices?studentId=${id}`),
    enabled: !!card.data,
    select: (r) => r.items,
  });

  if (card.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <AppBar title=" " onBack={onBack} />
        <View style={{ padding: 14 }}><Skeleton rows={4} height={72} /></View>
      </View>
    );
  }
  if (card.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface }}>
        <AppBar title="O'quvchi" onBack={onBack} />
        <ErrorState message={card.error.message} onRetry={() => card.refetch()} />
      </View>
    );
  }

  const s = card.data.student;
  const fin = card.data.finance;
  const fullName = `${s.last_name} ${s.first_name}`;
  const metaParts = [
    s.class_name ?? 'Sinfga biriktirilmagan',
    s.birth_date ? fmtDate(s.birth_date) : null,
    s.monthly_fee != null ? `${money(s.monthly_fee)}/oy` : null,
    (s.discount_percent ?? 0) > 0 ? `chegirma ${s.discount_percent}%` : null,
  ].filter(Boolean);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar title={fullName} meta={metaParts.join(' · ')} onBack={onBack} right={<Avatar text={initials(fullName)} brand />} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24, gap: 14 }}>
        {s.status !== 'active' && <Pill kind="neutral" icon="archive" label="Arxivlangan" />}

        {p.staff && (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><BigButton title="Tahrirlash" icon="edit-2" variant="secondary" height={44} onPress={() => setEditing('info')} /></View>
            <View style={{ flex: 1 }}><BigButton title="Sinf va to'lov" icon="sliders" variant="secondary" height={44} onPress={() => setEditing('class')} /></View>
          </View>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
          <Tile label="Hisoblangan" value={money(fin.invoiced)} />
          <Tile label="To'langan" value={money(fin.paid)} />
          <Tile
            label="Qoldiq qarz"
            value={money(fin.outstanding)}
            tone={fin.outstanding > 0 ? 'crit' : 'good'}
            sub={fin.advance > 0 ? `Avans: ${money(fin.advance)}` : undefined}
          />
        </View>

        <View>
          <SectionLabel>Oylik hisoblar</SectionLabel>
          {invoices.isPending ? (
            <Skeleton rows={3} height={52} />
          ) : invoices.isError ? (
            <ErrorState message={invoices.error.message} onRetry={() => invoices.refetch()} />
          ) : invoices.data.length === 0 ? (
            <Text style={{ fontSize: 13, color: c.t3 }}>Hisoblar hali chiqarilmagan — To'lovlar bo'limidagi "Oylik hisoblarni chiqarish" orqali.</Text>
          ) : (
            invoices.data.map((i, idx) => {
              const k = invoiceKind(i.status);
              return (
                <ListItem
                  key={i.id}
                  title={monthLabel(String(i.period_month).slice(0, 7))}
                  sub={`Muddat ${fmtDate(i.due_date)} · summa ${money(i.amount - i.discount)} · to'langan ${money(i.paid)}`}
                  right={
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: c.t1, fontVariant: ['tabular-nums'] }}>{money(i.outstanding)}</Text>
                      <Pill kind={k.kind} icon={k.icon} label={k.label} />
                    </View>
                  }
                  last={idx === invoices.data.length - 1}
                />
              );
            })
          )}
        </View>

        <View>
          <SectionLabel>Ota-onalar</SectionLabel>
          {card.data.parents.length === 0 ? (
            <Text style={{ fontSize: 13, color: c.t3 }}>Ota-ona qo'shilmagan.</Text>
          ) : (
            card.data.parents.map((pr, idx) => {
              const phones = pr.phones ?? (pr.phone ? [{ phone: pr.phone, telegramLinked: !!pr.telegram_linked }] : []);
              // Botga ulanmagan yoki farzandini tasdiqlamagan ota-onaga xabar bormaydi —
              // buni shu yerda ko'rsatmasak "nega xabar kelmadi?" javobsiz qoladi.
              const tg = telegramPill(phones);
              return (
                <ListItem
                  key={pr.id}
                  title={`${pr.full_name}${pr.is_primary ? ' · asosiy' : ''}`}
                  sub={[pr.relation ? REL[pr.relation] ?? pr.relation : null, ...phones.map((x) => fmtPhone(x.phone))].filter(Boolean).join(' · ')}
                  left={<Avatar text={initials(pr.full_name)} />}
                  right={<Pill kind={tg.kind} icon={tg.icon} label={tg.label} />}
                  last={idx === card.data.parents.length - 1}
                />
              );
            })
          )}
        </View>

        {p.library && (
          <View>
            <SectionLabel>Kutubxona</SectionLabel>
            <StudentBooks studentId={s.id} />
          </View>
        )}

        {p.staff && s.status === 'active' && (
          <Pressable onPress={() => setEditing('archive')} style={{ alignSelf: 'flex-end', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 }}>
            <Icon name="archive" size={14} color={c.t3} />
            <Text style={{ fontSize: 13, color: c.t3, fontWeight: '600' }}>O'quvchini arxivlash</Text>
          </Pressable>
        )}
      </ScrollView>

      {p.staff && s.status === 'active' && (
        <ThumbZone>
          <BigButton title="To'lov qabul qilish" icon="credit-card" onPress={() => onPay({ id: s.id, last_name: s.last_name, first_name: s.first_name, class_name: s.class_name })} />
        </ThumbZone>
      )}

      {p.staff && (
        <>
          <EditInfoSheet key={`i${card.dataUpdatedAt}`} s={s} open={editing === 'info'} onClose={() => setEditing(null)} />
          <EditClassSheet key={`c${card.dataUpdatedAt}`} s={s} open={editing === 'class'} onClose={() => setEditing(null)} />
          <ArchiveSheet id={s.id} name={fullName} admin={p.admin} open={editing === 'archive'} onClose={() => setEditing(null)} onDone={() => { setEditing(null); onArchived(); }} />
        </>
      )}
    </View>
  );
}

/**
 * Ota-onaning Telegram holati (web `Guardians.tsx` bilan bir xil).
 *
 * "Tasdiqlamadi" eng muhimi: ota-ona botda "bu mening farzandim emas" degan,
 * ya'ni raqam yoki biriktirish xato va xabar yuborilmayapti.
 */
function telegramPill(
  phones: Array<{ telegramLinked: boolean; telegramState?: string }>,
): { kind: StatusKind; icon: IconName; label: string } {
  const has = (st: string) => phones.some((x) => (x.telegramState ?? (x.telegramLinked ? 'confirmed' : 'none')) === st);
  if (has('confirmed')) return { kind: 'good', icon: 'check', label: 'Telegram' };
  if (has('rejected')) return { kind: 'crit', icon: 'alert-triangle', label: 'Tasdiqlamadi' };
  if (has('pending')) return { kind: 'warn', icon: 'clock', label: 'Tasdiq kutilmoqda' };
  return { kind: 'warn', icon: 'clock', label: 'Botga ulanmagan' };
}
