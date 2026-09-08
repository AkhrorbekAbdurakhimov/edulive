import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, perms, qs, type AuthedUser } from '../api';
import { initials, maskUzDate, parseUzDate, rosterName } from '../format';
import { Chips, ErrorText, Fab, FormSheet, Help, ListItem, SearchField, Select, useDebounced } from '../forms';
import { useClasses } from '../queries';
import { useTheme } from '../theme';
import { AppBar, Avatar, BigButton, EmptyState, ErrorState, Field, Pill, Skeleton } from '../ui';

export interface StudentRow {
  id: string;
  last_name: string;
  first_name: string;
  class_id: string | null;
  class_name: string | null;
  status: string;
}

type Gender = '' | 'm' | 'f';

/** O'quvchilar ro'yxati (web Students). Excel import faqat web'da — fayl tanlash telefon uchun emas. */
export function StudentsScreen({ user, onOpen }: { user: AuthedUser; onOpen: (id: string) => void }) {
  const c = useTheme();
  const p = perms(user);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [classId, setClassId] = useState('');
  const [gender, setGender] = useState<Gender>('');
  const [create, setCreate] = useState(false);

  const classes = useClasses();
  const students = useQuery({
    queryKey: ['students', dq, classId, gender],
    queryFn: () => api<{ items: StudentRow[]; total: number }>(`/students${qs({ q: dq, classId, gender, limit: 100 })}`),
  });

  const filtered = !!(dq || classId || gender);

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar title="O'quvchilar" meta={students.data ? `${students.data.total} ta` : undefined} />

      <View style={{ paddingHorizontal: 14, gap: 8, paddingBottom: 8 }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Ism yoki familiya…" />
        <Chips
          value={classId}
          onChange={setClassId}
          options={[{ value: '', label: 'Barcha sinflar' }, ...(classes.data?.items ?? []).map((x) => ({ value: x.id, label: x.name }))]}
        />
        <Chips<Gender>
          value={gender}
          onChange={setGender}
          options={[{ value: '', label: 'Jinsi: barchasi' }, { value: 'm', label: "O'g'il bolalar" }, { value: 'f', label: 'Qizlar' }]}
        />
      </View>

      {students.isPending ? (
        <View style={{ padding: 14 }}><Skeleton rows={7} height={52} /></View>
      ) : students.isError ? (
        <ErrorState message={students.error.message} onRetry={() => students.refetch()} />
      ) : students.data.items.length === 0 ? (
        <EmptyState
          icon="users"
          title="O'quvchi topilmadi"
          text={filtered ? "Filtrni o'zgartirib ko'ring" : "Birinchi o'quvchini qo'shing. Ko'p o'quvchini bir yo'la kiritish uchun web'dagi Excel importdan foydalaning."}
          action={p.staff && !filtered ? { label: "+ Yangi o'quvchi", onPress: () => setCreate(true) } : undefined}
        />
      ) : (
        <FlatList
          data={students.data.items}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 90 }}
          renderItem={({ item, index }) => (
            <ListItem
              title={rosterName(item)}
              sub={item.class_name ?? 'Sinfga biriktirilmagan'}
              left={<Avatar text={initials(rosterName(item))} />}
              right={item.status !== 'active' ? <Pill kind="neutral" icon="archive" label={item.status === 'archived' ? 'Arxiv' : item.status} /> : undefined}
              onPress={() => onOpen(item.id)}
              last={index === students.data.items.length - 1}
            />
          )}
        />
      )}

      {p.staff && <Fab label="O'quvchi" icon="user-plus" onPress={() => setCreate(true)} />}
      {p.staff && (
        <CreateStudentSheet
          open={create}
          onClose={() => setCreate(false)}
          classes={(classes.data?.items ?? []).map((x) => ({ value: x.id, label: x.name }))}
        />
      )}
    </View>
  );
}

const RELATIONS = [
  { value: 'father', label: 'Otasi' },
  { value: 'mother', label: 'Onasi' },
  { value: 'guardian', label: 'Vasiy' },
] as const;

const GENDERS = [
  { value: '', label: "Ko'rsatilmagan" },
  { value: 'm', label: "O'g'il" },
  { value: 'f', label: 'Qiz' },
] as const;

function CreateStudentSheet({ open, onClose, classes }: { open: boolean; onClose: () => void; classes: Array<{ value: string; label: string }> }) {
  const qc = useQueryClient();
  const empty = { lastName: '', firstName: '', middleName: '', birthDate: '', gender: '' as Gender, classId: '', parentName: '', parentPhone: '+998', relation: 'father' as 'father' | 'mother' | 'guardian' };
  const [f, setF] = useState(empty);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));

  const birthIso = f.birthDate ? parseUzDate(f.birthDate) : null;
  const badBirth = f.birthDate.length > 0 && !birthIso;
  const badPhone = f.parentName.trim().length > 0 && !/^\+998\d{9}$/.test(f.parentPhone.replace(/\s/g, ''));

  const create = useMutation({
    mutationFn: () => {
      // Bo'sh qoldirilgan maydon umuman yuborilmaydi — backend ularni ixtiyoriy deb biladi.
      const body: Record<string, unknown> = { lastName: f.lastName.trim(), firstName: f.firstName.trim() };
      if (f.classId) body.classId = f.classId;
      if (f.middleName.trim()) body.middleName = f.middleName.trim();
      if (birthIso) body.birthDate = birthIso;
      if (f.gender) body.gender = f.gender;
      if (f.parentName.trim()) body.parent = { fullName: f.parentName.trim(), phone: f.parentPhone.replace(/\s/g, ''), relation: f.relation };
      return api('/students', 'POST', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['classes'] });
      setF(empty);
      onClose();
    },
  });

  const ok = f.lastName.trim().length >= 2 && f.firstName.trim().length >= 2 && !badBirth && !badPhone;

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Yangi o'quvchi"
      footer={
        <>
          <BigButton title={create.isPending ? 'Saqlanmoqda…' : 'Saqlash'} onPress={() => create.mutate()} busy={create.isPending} disabled={!ok} />
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
      <Select label="Sinf" value={f.classId} options={[{ value: '', label: 'Keyin biriktiriladi' }, ...classes]} onChange={set('classId')} />
      <Field label="Ota-ona (ixtiyoriy)" value={f.parentName} onChangeText={set('parentName')} placeholder="F.I.Sh" autoCapitalize="words" />
      {f.parentName.trim().length > 0 && (
        <>
          <Field label="Ota-ona telefoni" value={f.parentPhone} onChangeText={set('parentPhone')} keyboardType="phone-pad" error={badPhone} />
          {badPhone && <Help text="Format: +998XXXXXXXXX" error />}
          <Select label="Kim bo'ladi" value={f.relation} options={[...RELATIONS]} onChange={set('relation')} />
        </>
      )}
      <ErrorText text={create.error?.message} />
    </FormSheet>
  );
}
