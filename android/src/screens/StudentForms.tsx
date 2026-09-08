import { useState } from 'react';
import { Text } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { fmtNum, maskUzDate, parseAmount, parseUzDate, fmtDate } from '../format';
import { ErrorText, FormSheet, Help, MoneyField, Select } from '../forms';
import { useClasses } from '../queries';
import { useTheme } from '../theme';
import { BigButton, Field } from '../ui';

/**
 * O'quvchini tahrirlash oynalari — backenddagi uchta endpointga 1:1 mos
 * (web StudentEdit bilan bir xil):
 *   PATCH /students/:id            — shaxsiy ma'lumot
 *   PATCH /students/:id/enrollment — sinf, oylik to'lov, chegirma (auditga tushadi)
 *   POST  /students/:id/archive    — arxivlash
 */
export interface EditableStudent {
  id: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  birth_date: string | null;
  gender: string | null;
  class_id: string | null;
  monthly_fee: number | null;
  discount_percent: number | null;
  discount_reason: string | null;
}

const GENDERS = [
  { value: '', label: "Ko'rsatilmagan" },
  { value: 'm', label: "O'g'il" },
  { value: 'f', label: 'Qiz' },
] as const;

export function EditInfoSheet({ s, open, onClose }: { s: EditableStudent; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    lastName: s.last_name,
    firstName: s.first_name,
    middleName: s.middle_name ?? '',
    birthDate: s.birth_date ? fmtDate(s.birth_date) : '',
    gender: (s.gender ?? '') as '' | 'm' | 'f',
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const birthIso = f.birthDate ? parseUzDate(f.birthDate) : null;
  const badBirth = f.birthDate.length > 0 && !birthIso;

  const save = useMutation({
    mutationFn: () =>
      api(`/students/${s.id}`, 'PATCH', {
        lastName: f.lastName.trim(),
        firstName: f.firstName.trim(),
        // null yuborilsa maydon tozalanadi; undefined bo'lsa tegilmaydi.
        middleName: f.middleName.trim() || null,
        birthDate: birthIso,
        gender: f.gender || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', s.id] });
      qc.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
  });

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="O'quvchi ma'lumotlari"
      footer={
        <>
          <BigButton title={save.isPending ? 'Saqlanmoqda…' : 'Saqlash'} onPress={() => save.mutate()} busy={save.isPending} disabled={f.lastName.trim().length < 2 || f.firstName.trim().length < 2 || badBirth} />
          <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={onClose} />
        </>
      }
    >
      <Field label="Familiya" value={f.lastName} onChangeText={set('lastName')} autoCapitalize="words" />
      <Field label="Ism" value={f.firstName} onChangeText={set('firstName')} autoCapitalize="words" />
      <Field label="Otasining ismi" value={f.middleName} onChangeText={set('middleName')} autoCapitalize="words" />
      <Field label="Tug'ilgan sana" value={f.birthDate} onChangeText={(v) => set('birthDate')(maskUzDate(v))} keyboardType="number-pad" placeholder="KK.OO.YYYY" error={badBirth} />
      {badBirth && <Help text="Sana formati: 09.08.2015" error />}
      <Select label="Jinsi" value={f.gender} options={[...GENDERS]} onChange={set('gender')} />
      <ErrorText text={save.error?.message} />
    </FormSheet>
  );
}

export function EditClassSheet({ s, open, onClose }: { s: EditableStudent; open: boolean; onClose: () => void }) {
  const c = useTheme();
  const qc = useQueryClient();
  const classes = useClasses();
  const [f, setF] = useState({
    classId: s.class_id ?? '',
    monthlyFee: s.monthly_fee != null ? fmtNum(String(Math.round(s.monthly_fee))) : '',
    discountPercent: String(s.discount_percent ?? 0),
    discountReason: s.discount_reason ?? '',
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const disc = Number(f.discountPercent);
  const badDisc = !Number.isFinite(disc) || disc < 0 || disc > 100;

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        discountPercent: Number(f.discountPercent) || 0,
        discountReason: f.discountReason.trim() || null,
        // Bo'sh qoldirilsa sinf narxi ishlatiladi (null = sinfnikini olish).
        monthlyFee: f.monthlyFee.trim() ? parseAmount(f.monthlyFee) : null,
      };
      if (f.classId) body.classId = f.classId;
      return api(`/students/${s.id}/enrollment`, 'PATCH', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student', s.id] });
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['classes'] });
      onClose();
    },
  });

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Sinf va to'lov"
      footer={
        <>
          <BigButton title={save.isPending ? 'Saqlanmoqda…' : 'Saqlash'} onPress={() => save.mutate()} busy={save.isPending} disabled={badDisc} />
          <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={onClose} />
        </>
      }
    >
      <Select
        label="Sinf"
        value={f.classId}
        options={[{ value: '', label: 'Tanlanmagan' }, ...(classes.data?.items ?? []).map((x) => ({ value: x.id, label: x.name }))]}
        onChange={set('classId')}
        help={!s.class_id ? "O'quvchi hali sinfga biriktirilmagan" : undefined}
      />
      <MoneyField label="Oylik to'lov" value={f.monthlyFee} onChangeText={set('monthlyFee')} placeholder="sinf narxi" help="Bo'sh qoldirilsa sinf narxi ishlatiladi" />
      <Field label="Chegirma %" value={f.discountPercent} onChangeText={set('discountPercent')} keyboardType="number-pad" error={badDisc} />
      {badDisc && <Help text="0 dan 100 gacha" error />}
      <Field label="Chegirma sababi" value={f.discountReason} onChangeText={set('discountReason')} placeholder="aka-uka, xodim farzandi, grant…" />
      <Text style={{ fontSize: 12, color: c.t3 }}>To'lov va chegirma o'zgarishi audit jurnaliga yoziladi.</Text>
      <ErrorText text={save.error?.message} />
    </FormSheet>
  );
}

export function ArchiveSheet({ id, name, open, onClose, onDone }: { id: string; name: string; open: boolean; onClose: () => void; onDone: () => void }) {
  const c = useTheme();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const archive = useMutation({
    mutationFn: () => api(`/students/${id}/archive`, 'POST', { reason: reason.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['students'] }); onDone(); },
  });

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="O'quvchini arxivlash"
      sub={name}
      footer={
        <>
          <BigButton title={archive.isPending ? 'Arxivlanmoqda…' : 'Arxivlash'} variant="danger" onPress={() => archive.mutate()} busy={archive.isPending} />
          <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={onClose} />
        </>
      }
    >
      <Text style={{ fontSize: 13, color: c.t2, lineHeight: 19 }}>
        Ro'yxatdan chiqadi va sinfdagi biriktirish yopiladi. Hisoblari va to'lovlari saqlanib qoladi — o'chirilmaydi.
      </Text>
      <Field label="Sabab (ixtiyoriy)" value={reason} onChangeText={setReason} />
      <ErrorText text={archive.error?.message} />
    </FormSheet>
  );
}
