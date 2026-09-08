import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, perms, qs, type AuthedUser } from '../api';
import { fmtDate, fmtNum, isoDate, money, monthLabel, parseAmount, rosterName } from '../format';
import { ErrorText, IconButton, ListItem, MoneyField, SaveNote, SearchPicker, Select } from '../forms';
import { radius, useTheme } from '../theme';
import { AppBar, BigButton, Card, ErrorState, Field, SectionLabel, Sheet, Skeleton, ThumbZone } from '../ui';
import type { StudentPick } from './StudentCardScreen';

interface PaymentRow {
  id: string; student_name: string; amount: number; provider: string;
  paid_at: string; receipt_no: string | null; received_by: string | null;
}
interface Finance { invoiced: number; paid: number; outstanding: number; advance: number }
/** Jadval qatori: hisobi chiqarilmagan oyda `id` null, summa kutilayotgani. */
interface ScheduleRow { id: string | null; period_month: string; status: string | null; amount: number; discount: number; outstanding: number }

const PROVIDERS = [
  { value: 'cash', label: 'Naqd' },
  { value: 'click', label: 'Click' },
  { value: 'payme', label: 'Payme' },
  { value: 'transfer', label: "O'tkazma" },
] as const;
type Provider = (typeof PROVIDERS)[number]['value'];
const providerLabel = (v: string) => PROVIDERS.find((x) => x.value === v)?.label ?? v;

/**
 * To'lov qabul qilish (web Payments, DESIGN_PROMPT 4.4): o'quvchi → oylar →
 * summa → usul → tasdiqlash (summa KATTA shriftda) → kvitansiya.
 */
export function PaymentsScreen({ user, preselected, onOpenStudent }: { user: AuthedUser; preselected: StudentPick | null; onOpenStudent: (id: string) => void }) {
  const c = useTheme();
  const p = perms(user);
  const qc = useQueryClient();
  const [student, setStudent] = useState<StudentPick | null>(preselected);
  const [picked, setPicked] = useState<string[]>([]);
  const [amount, setAmount] = useState('');
  const [provider, setProvider] = useState<Provider>('cash');
  const [note, setNote] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);

  // O'quvchi kartasidan "To'lov qabul qilish" bilan kelinganda
  useEffect(() => {
    if (preselected) { setStudent(preselected); setPicked([]); setAmount(''); setLastReceipt(null); }
  }, [preselected]);

  const chooseStudent = (s: StudentPick | null) => { setStudent(s); setPicked([]); setAmount(''); setLastReceipt(null); };

  const finance = useQuery({
    queryKey: ['student-finance', student?.id],
    queryFn: () => api<{ finance: Finance }>(`/students/${student!.id}`),
    enabled: !!student,
    select: (r) => r.finance,
  });
  // O'quv yilining HAR BIR oyi — hisobi chiqarilgani ham, chiqarilmagani ham (oldindan to'lov uchun).
  const schedule = useQuery({
    queryKey: ['student-schedule', student?.id],
    queryFn: () => api<{ items: ScheduleRow[] }>(`/invoices/schedule?studentId=${student!.id}`),
    enabled: !!student,
    select: (r) => r.items,
  });
  const months = schedule.data ?? [];
  const payable = useMemo(() => months.filter((m) => m.outstanding > 0), [months]);

  const log = useQuery({
    queryKey: ['payments-log'],
    queryFn: () => api<{ items: PaymentRow[] }>('/payments?limit=20'),
    select: (r) => r.items,
  });

  // Oy belgilansa summa o'zi to'ladi; kassir keyin qo'lda o'zgartirishi mumkin (qisman to'lov).
  const togglePicked = (m: ScheduleRow) => {
    setPicked((prev) => {
      const next = prev.includes(m.period_month) ? prev.filter((x) => x !== m.period_month) : [...prev, m.period_month];
      const sum = payable.filter((i) => next.includes(i.period_month)).reduce((s, i) => s + i.outstanding, 0);
      setAmount(sum ? fmtNum(String(Math.round(sum))) : '');
      return next;
    });
  };

  const amountNum = parseAmount(amount);
  const newBalance = (finance.data?.outstanding ?? 0) - amountNum;
  const balanceLabel = newBalance < 0 ? `${money(-newBalance)} avans` : money(newBalance);

  const pay = useMutation({
    mutationFn: () =>
      api<{ payment: { receipt_no: string | null } }>('/payments', 'POST', {
        studentId: student!.id, amount: amountNum, provider, note: note.trim() || undefined,
        // Hisobi bor oy id bilan, hali chiqarilmagani oy nomi bilan ketadi — backend hisobni o'zi yaratadi.
        invoiceIds: picked.map((k) => months.find((m) => m.period_month === k)?.id).filter((x): x is string => !!x),
        periodMonths: picked.filter((k) => !months.find((m) => m.period_month === k)?.id),
      }),
    onSuccess: (data) => {
      setConfirmOpen(false);
      setLastReceipt(data.payment.receipt_no ?? '—');
      setAmount(''); setNote(''); setPicked([]);
      qc.invalidateQueries({ queryKey: ['payments-log'] });
      qc.invalidateQueries({ queryKey: ['student-finance', student?.id] });
      qc.invalidateQueries({ queryKey: ['student-schedule', student?.id] });
      qc.invalidateQueries({ queryKey: ['student', student?.id] });
      qc.invalidateQueries({ queryKey: ['invoices', student?.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['debtors'] });
    },
  });

  const generate = useMutation({
    mutationFn: () => api<{ created: number }>('/invoices/generate', 'POST', { periodMonth: isoDate().slice(0, 7) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student-finance'] });
      qc.invalidateQueries({ queryKey: ['student-schedule'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['debtors'] });
    },
  });

  const fetchStudents = (q: string) =>
    api<{ items: StudentPick[] }>(`/students${qs({ q, limit: 20 })}`).then((r) => r.items);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar
        title="To'lovlar"
        right={p.staff ? <IconButton name="file-plus" label="Oylik hisoblarni chiqarish" onPress={() => setGenOpen(true)} /> : undefined}
      />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Card style={{ gap: 12 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: c.t1 }}>To'lov qabul qilish</Text>
          <SearchPicker<StudentPick>
            label="O'quvchi"
            placeholder="Familiya yoki ism…"
            fetch={fetchStudents}
            getKey={(s) => s.id}
            getLabel={rosterName}
            getHint={(s) => s.class_name ?? 'sinfsiz'}
            value={student}
            onPick={chooseStudent}
            emptyText="O'quvchi topilmadi"
          />

          {student && (
            <>
              {/* Hisob-kitob: joriy qarz → to'lov → yangi qoldiq */}
              {finance.isPending ? (
                <Skeleton rows={1} height={56} />
              ) : finance.isError ? (
                <ErrorText text={finance.error.message} />
              ) : (
                <View style={{ backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 12, gap: 6 }}>
                  <Row label="Joriy qarz" value={money(finance.data.outstanding)} strong />
                  {finance.data.advance > 0 && <Row label="Avans (hisobga bog'lanmagan)" value={money(finance.data.advance)} good />}
                  <Row label="To'lov" value={`− ${money(amountNum)}`} />
                  <View style={{ borderTopWidth: 1, borderColor: c.border, paddingTop: 6 }}>
                    <Row label="Yangi qoldiq" value={balanceLabel} strong />
                  </View>
                </View>
              )}

              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '500', color: c.t2 }}>Qaysi oy uchun</Text>
                {schedule.isPending ? (
                  <Skeleton rows={1} height={40} />
                ) : months.length === 0 ? (
                  <Text style={{ fontSize: 12, color: c.t3 }}>O'quv yili belgilanmagan yoki o'quvchi sinfga biriktirilmagan — kiritilgan summa avans bo'lib qoladi.</Text>
                ) : (
                  <>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {months.map((m) => {
                        const paid = m.outstanding <= 0;
                        const on = picked.includes(m.period_month);
                        return (
                          <Pressable
                            key={m.period_month}
                            onPress={() => !paid && togglePicked(m)}
                            disabled={paid}
                            accessibilityState={{ selected: on, disabled: paid }}
                            style={{ minHeight: 44, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.tile, borderWidth: 1, borderColor: on ? c.brand : c.border, backgroundColor: on ? c.brandSoft : paid ? c.surface3 : c.surface, opacity: paid ? 0.7 : 1, justifyContent: 'center' }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: '700', color: on ? c.brandInk : c.t1 }}>{monthLabel(m.period_month)}</Text>
                            {paid
                              ? <Text style={{ fontSize: 11, color: c.goodInk, fontWeight: '600' }}>To'langan</Text>
                              : <Text style={{ fontSize: 11, color: c.t3, fontVariant: ['tabular-nums'] }}>{money(m.outstanding)}</Text>}
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={{ fontSize: 12, color: c.t3 }}>Kelgusi oylarni ham belgilash mumkin — oldindan to'lov. Belgilamasangiz pul eng eski qarzdan boshlab taqsimlanadi.</Text>
                  </>
                )}
              </View>

              <MoneyField label="Summa (so'm)" value={amount} onChangeText={setAmount} />
              <Select<Provider> label="Usul" value={provider} options={[...PROVIDERS]} onChange={setProvider} />
              <Field label="Izoh (ixtiyoriy)" value={note} onChangeText={setNote} placeholder="masalan: 2 oy uchun" />
            </>
          )}

          <ErrorText text={pay.error?.message} />
          <SaveNote text={lastReceipt ? `To'lov qabul qilindi · Kvitansiya: ${lastReceipt}` : null} />
          {student && lastReceipt && (
            <BigButton title="O'quvchi kartasini ochish" icon="user" variant="secondary" height={44} onPress={() => onOpenStudent(student.id)} />
          )}
        </Card>

        <View>
          <SectionLabel>Oxirgi to'lovlar</SectionLabel>
          {log.isPending ? (
            <Skeleton rows={4} height={52} />
          ) : log.isError ? (
            <ErrorState message={log.error.message} onRetry={() => log.refetch()} />
          ) : log.data.length === 0 ? (
            <Text style={{ fontSize: 13, color: c.t3 }}>Hali to'lov qabul qilinmagan.</Text>
          ) : (
            log.data.map((r, idx) => (
              <ListItem
                key={r.id}
                title={r.student_name}
                sub={`${fmtDate(r.paid_at)} · ${providerLabel(r.provider)}${r.receipt_no ? ` · №${r.receipt_no}` : ''}${r.received_by ? ` · ${r.received_by}` : ''}`}
                right={<Text style={{ fontSize: 14, fontWeight: '700', color: c.t1, fontVariant: ['tabular-nums'] }}>{money(r.amount)}</Text>}
                last={idx === log.data.length - 1}
              />
            ))
          )}
        </View>
      </ScrollView>

      {p.staff && student && (
        <ThumbZone>
          <BigButton title="Davom etish" icon="arrow-right" onPress={() => setConfirmOpen(true)} disabled={amountNum <= 0} />
        </ThumbZone>
      )}

      {/* Moliyaviy tasdiq — summa KATTA shriftda takrorlanadi */}
      <Sheet open={confirmOpen} onClose={() => !pay.isPending && setConfirmOpen(false)} title="To'lovni tasdiqlash" sub={student ? `${rosterName(student)} uchun` : undefined}>
        <Text style={{ fontSize: 34, fontWeight: '700', color: c.t1, fontVariant: ['tabular-nums'], letterSpacing: -0.5 }}>{money(amountNum)}</Text>
        <Text style={{ fontSize: 13, color: c.t2, marginTop: 4 }}>
          {providerLabel(provider)} · yangi qoldiq: <Text style={{ fontWeight: '700', color: c.t1 }}>{balanceLabel}</Text>
        </Text>
        {picked.length > 0 && (
          <Text style={{ fontSize: 12, color: c.t3, marginTop: 4 }}>Oylar: {picked.map(monthLabel).join(', ')}</Text>
        )}
        <ErrorText text={pay.error?.message} />
        <View style={{ marginTop: 14, gap: 8 }}>
          <BigButton title={pay.isPending ? 'Saqlanmoqda…' : "To'lovni qabul qilish"} onPress={() => pay.mutate()} busy={pay.isPending} />
          <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={() => setConfirmOpen(false)} disabled={pay.isPending} />
        </View>
      </Sheet>

      <Sheet open={genOpen} onClose={() => !generate.isPending && setGenOpen(false)} title="Oylik hisoblarni chiqarish" sub={monthLabel(isoDate().slice(0, 7))}>
        <Text style={{ fontSize: 13, color: c.t2, lineHeight: 19 }}>
          Sinfga biriktirilgan har bir faol o'quvchi uchun shu oyning hisobi yaratiladi. Allaqachon chiqarilganlar takrorlanmaydi.
        </Text>
        {generate.data && <View style={{ marginTop: 8 }}><SaveNote text={`${generate.data.created} ta yangi hisob`} /></View>}
        <ErrorText text={generate.error?.message} />
        <View style={{ marginTop: 14, gap: 8 }}>
          <BigButton title={generate.isPending ? 'Chiqarilmoqda…' : 'Chiqarish'} onPress={() => generate.mutate()} busy={generate.isPending} />
          <BigButton title="Yopish" variant="secondary" height={44} onPress={() => setGenOpen(false)} disabled={generate.isPending} />
        </View>
      </Sheet>

    </View>
  );
}

function Row({ label, value, strong, good }: { label: string; value: string; strong?: boolean; good?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <Text style={{ fontSize: 12, color: c.t3, flexShrink: 1 }}>{label}</Text>
      <Text style={{ fontSize: strong ? 18 : 14, fontWeight: strong ? '700' : '500', color: good ? c.goodInk : c.t1, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}
