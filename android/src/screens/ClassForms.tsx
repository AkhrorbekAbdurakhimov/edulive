import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fmtDate, fmtNum, isoDate, maskUzDate, parseAmount, parseUzDate } from '../format';
import { ErrorText, FormSheet, Help, ListItem, MoneyField, Select, Toggle } from '../forms';
import { classesKey, type ClassItem } from '../queries';
import { useTheme } from '../theme';
import { BigButton, Field, Pill } from '../ui';

export interface YearRow { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean }

export function useYears() {
  return useQuery({ queryKey: ['years'], queryFn: () => api<{ items: YearRow[] }>('/years'), select: (r) => r.items });
}

const GRADE_OPTS = Array.from({ length: 13 }, (_, i) => ({ value: String(i), label: i === 0 ? 'Tayyorlov (0)' : `${i}-sinf` }));

/** Yaratish va tahrirlash bitta forma: farqi faqat sinf raqamida (u o'zgarmaydi). */
export function ClassSheet({ cls, open, onClose, onDeleted }: { cls: ClassItem | null; open: boolean; onClose: () => void; onDeleted?: () => void }) {
  const c = useTheme();
  const qc = useQueryClient();
  const teachers = useQuery({
    queryKey: ['users', 'teacher'],
    queryFn: () => api<{ items: Array<{ id: string; full_name: string }> }>('/users?role=teacher'),
    select: (r) => r.items,
    enabled: open,
  });
  const [f, setF] = useState({
    grade: cls ? String(cls.grade) : '1',
    letter: cls?.letter ?? 'A',
    monthlyFee: cls ? fmtNum(String(Math.round(cls.monthly_fee))) : '',
    teacherId: cls?.homeroom_teacher_id ?? '',
  });
  const set = <K extends keyof typeof f>(k: K) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const [confirmDel, setConfirmDel] = useState(false);
  const fee = parseAmount(f.monthlyFee);

  const done = () => { qc.invalidateQueries({ queryKey: classesKey }); onClose(); };
  const save = useMutation({
    mutationFn: () => {
      if (cls) {
        // null yuborilsa rahbar olib tashlanadi; undefined bo'lsa tegilmaydi.
        return api(`/classes/${cls.id}`, 'PATCH', { letter: f.letter.trim(), monthlyFee: fee, homeroomTeacherId: f.teacherId || null });
      }
      const body: Record<string, unknown> = { grade: Number(f.grade), letter: f.letter.trim(), monthlyFee: fee };
      if (f.teacherId) body.homeroomTeacherId = f.teacherId;
      return api('/classes', 'POST', body);
    },
    onSuccess: done,
  });
  const del = useMutation({
    mutationFn: () => api(`/classes/${cls!.id}`, 'DELETE'),
    onSuccess: () => { qc.invalidateQueries({ queryKey: classesKey }); onClose(); onDeleted?.(); },
  });

  return (
    <FormSheet
      open={open} onClose={onClose} title={cls ? `${cls.name} sinfi` : 'Yangi sinf'}
      footer={
        confirmDel ? (
          <>
            <Text style={{ fontSize: 13, color: c.t2 }}>Sinfda o'quvchi yo'q. Tarixi (davomat, baho) bo'lsa server rad etadi — tarix saqlanib qoladi.</Text>
            <BigButton title={del.isPending ? "O'chirilmoqda…" : "Ha, o'chirish"} variant="danger" onPress={() => del.mutate()} busy={del.isPending} />
            <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={() => setConfirmDel(false)} />
          </>
        ) : (
          <>
            <BigButton title={save.isPending ? 'Saqlanmoqda…' : 'Saqlash'} onPress={() => save.mutate()} busy={save.isPending} disabled={fee <= 0 || !f.letter.trim()} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {cls && cls.student_count === 0 && (
                <View style={{ flex: 1 }}><BigButton title="O'chirish" icon="trash-2" variant="danger" height={44} onPress={() => setConfirmDel(true)} /></View>
              )}
              <View style={{ flex: 1 }}><BigButton title="Bekor qilish" variant="secondary" height={44} onPress={onClose} /></View>
            </View>
          </>
        )
      }
    >
      <Select label="Sinf" value={f.grade} options={GRADE_OPTS} onChange={set('grade')} disabled={!!cls} help={cls ? "Sinf raqami o'zgarmaydi" : undefined} />
      <Field label="Harf" value={f.letter} onChangeText={set('letter')} autoCapitalize="characters" maxLength={4} />
      <MoneyField label="Oylik to'lov" value={f.monthlyFee} onChangeText={set('monthlyFee')} placeholder="1 500 000" help="So'mda — masalan 1 500 000" />
      <Select
        label="Sinf rahbari"
        value={f.teacherId}
        options={[{ value: '', label: 'Biriktirilmagan' }, ...(teachers.data ?? []).map((t) => ({ value: t.id, label: t.full_name }))]}
        onChange={set('teacherId')}
        help={teachers.data && teachers.data.length === 0 ? "Avval Xodimlar bo'limida o'qituvchi qo'shing" : undefined}
      />
      <ErrorText text={(save.error ?? del.error)?.message} />
    </FormSheet>
  );
}

/** O'quv yillari: joriy qilish va yangisini qo'shish. */
export function YearsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useTheme();
  const qc = useQueryClient();
  const years = useYears();
  const list = years.data ?? [];
  const [adding, setAdding] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['years'] }); qc.invalidateQueries({ queryKey: classesKey }); };

  const setCurrent = useMutation({
    mutationFn: (id: string) => api(`/years/${id}/set-current`, 'PATCH'),
    onSuccess: refresh,
  });

  // Taklif: joriy sanadan kelib chiqib. Sentabrgacha bo'lsa o'tgan yil boshlanadi.
  const now = new Date();
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const hasAny = list.length > 0;
  const [f, setF] = useState({
    name: `${startYear}-${startYear + 1}`,
    startsOn: fmtDate(`${startYear}-09-01`),
    endsOn: fmtDate(`${startYear + 1}-05-31`),
    isCurrent: !hasAny,
  });
  const sIso = parseUzDate(f.startsOn);
  const eIso = parseUzDate(f.endsOn);
  const badRange = !sIso || !eIso || eIso <= sIso;

  const create = useMutation({
    mutationFn: () => api('/years', 'POST', { name: f.name.trim(), startsOn: sIso, endsOn: eIso, isCurrent: f.isCurrent || !hasAny }),
    onSuccess: () => { refresh(); setAdding(false); },
  });

  return (
    <FormSheet
      open={open} onClose={onClose} title="O'quv yillari"
      footer={
        adding ? (
          <>
            <BigButton title={create.isPending ? 'Saqlanmoqda…' : 'Saqlash'} onPress={() => create.mutate()} busy={create.isPending} disabled={badRange || f.name.trim().length < 4} />
            <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={() => setAdding(false)} />
          </>
        ) : (
          <>
            <BigButton title="+ Yangi o'quv yili" onPress={() => setAdding(true)} />
            <BigButton title="Yopish" variant="secondary" height={44} onPress={onClose} />
          </>
        )
      }
    >
      {list.map((y, i) => (
        <ListItem
          key={y.id}
          title={y.name}
          sub={`${fmtDate(y.starts_on)} — ${fmtDate(y.ends_on)}`}
          right={y.is_current
            ? <Pill kind="good" icon="check" label="Joriy" />
            : <BigButton title="Joriy qilish" variant="secondary" height={36} onPress={() => setCurrent.mutate(y.id)} busy={setCurrent.isPending && setCurrent.variables === y.id} />}
          last={i === list.length - 1}
        />
      ))}
      {!hasAny && !adding && <Text style={{ fontSize: 13, color: c.t3 }}>Hali o'quv yili yo'q. Sinf yaratish uchun avval o'quv yilini qo'shing.</Text>}
      <ErrorText text={setCurrent.error?.message} />

      {adding && (
        <>
          <Field label="Nomi" value={f.name} onChangeText={(v) => setF((x) => ({ ...x, name: v }))} />
          <Field label="Boshlanishi" value={f.startsOn} onChangeText={(v) => setF((x) => ({ ...x, startsOn: maskUzDate(v) }))} keyboardType="number-pad" placeholder="KK.OO.YYYY" />
          <Field label="Tugashi" value={f.endsOn} onChangeText={(v) => setF((x) => ({ ...x, endsOn: maskUzDate(v) }))} keyboardType="number-pad" placeholder="KK.OO.YYYY" error={badRange} />
          {badRange && <Help text="Tugash sanasi boshlanishdan keyin bo'lishi kerak" error />}
          <Toggle
            label="Joriy o'quv yili"
            help={hasAny ? 'Belgilansa, avvalgi joriy yil oddiy yilga aylanadi' : "Birinchi yil — sinf yaratish uchun joriy bo'lishi shart"}
            value={f.isCurrent || !hasAny}
            onChange={(v) => setF((x) => ({ ...x, isCurrent: v }))}
            disabled={!hasAny}
          />
          <ErrorText text={create.error?.message} />
        </>
      )}
      <Text style={{ fontSize: 11, color: c.t3 }}>Bugun: {fmtDate(isoDate())}</Text>
    </FormSheet>
  );
}
