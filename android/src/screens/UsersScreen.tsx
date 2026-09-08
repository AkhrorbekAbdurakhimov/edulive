import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, perms, qs, roleLabel, type AuthedUser } from '../api';
import { fmtDate, fmtPhone, initials } from '../format';
import { Chips, ErrorText, Fab, FormSheet, Help, ListItem, Select, Toggle } from '../forms';
import { useTheme } from '../theme';
import { AppBar, Avatar, BigButton, EmptyState, ErrorState, Field, Pill, Skeleton } from '../ui';

interface StaffRow {
  id: string; full_name: string; phone: string | null; email: string | null;
  role: 'admin' | 'manager' | 'teacher'; is_librarian: boolean; is_active: boolean;
  last_login_at: string | null; created_at: string;
}
type Role = StaffRow['role'];
const ROLES: Array<{ value: Role; label: string }> = [
  { value: 'admin', label: 'Administrator' },
  { value: 'manager', label: 'Menejer' },
  { value: 'teacher', label: "O'qituvchi" },
];
const PHONE = /^\+998\d{9}$/;

/** Xodimlar (web Users). Menejer ro'yxatni ko'radi, faqat admin o'zgartiradi (backend ham shunday). */
export function UsersScreen({ user }: { user: AuthedUser }) {
  const c = useTheme();
  const canManage = perms(user).admin;
  const [role, setRole] = useState<'' | Role>('');
  const [create, setCreate] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);

  const staff = useQuery({
    queryKey: ['users', role],
    queryFn: () => api<{ items: StaffRow[] }>(`/users${qs({ role })}`),
    select: (r) => r.items,
  });

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar title="Xodimlar" meta={staff.data ? `${staff.data.length} ta` : undefined} />
      <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
        <Chips<'' | Role> value={role} onChange={setRole} options={[{ value: '', label: 'Barcha rollar' }, ...ROLES]} />
      </View>

      {staff.isPending ? (
        <View style={{ padding: 14 }}><Skeleton rows={6} height={56} /></View>
      ) : staff.isError ? (
        <ErrorState message={staff.error.message} onRetry={() => staff.refetch()} />
      ) : staff.data.length === 0 ? (
        <EmptyState icon="briefcase" title="Xodim topilmadi" text={role ? "Filtrni o'zgartirib ko'ring" : "Birinchi xodimni qo'shing — u o'z telefoni bilan kiradi."} action={canManage && !role ? { label: '+ Yangi xodim', onPress: () => setCreate(true) } : undefined} />
      ) : (
        <FlatList
          data={staff.data}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 90 }}
          renderItem={({ item: s, index }) => (
            <ListItem
              title={s.full_name}
              sub={`${roleLabel(s.role)}${s.is_librarian ? ' · kutubxonachi' : ''} · ${fmtPhone(s.phone) || '—'} · ${s.last_login_at ? `kirgan ${fmtDate(s.last_login_at)}` : 'hech qachon kirmagan'}`}
              left={<Avatar text={initials(s.full_name)} />}
              right={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {s.is_active ? <Pill kind="good" icon="check" label="Faol" /> : <Pill kind="crit" icon="x" label="O'chirilgan" />}
                  {canManage && <Text style={{ fontSize: 11, color: c.brandInk, fontWeight: '600' }}>Tahrirlash</Text>}
                </View>
              }
              onPress={canManage ? () => setEditing(s) : undefined}
              last={index === staff.data.length - 1}
            />
          )}
        />
      )}

      {canManage && <Fab label="Xodim" icon="user-plus" onPress={() => setCreate(true)} />}
      {canManage && <CreateStaffSheet open={create} onClose={() => setCreate(false)} />}
      {canManage && <EditStaffSheet key={editing?.id ?? 'none'} staff={editing} self={user.id} onClose={() => setEditing(null)} />}
    </View>
  );
}

function CreateStaffSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const empty = { fullName: '', phone: '+998', email: '', password: '', role: 'teacher' as Role, isLibrarian: false };
  const [f, setF] = useState(empty);
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const badPhone = f.phone.length > 4 && !PHONE.test(f.phone.replace(/\s/g, ''));

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { fullName: f.fullName.trim(), phone: f.phone.replace(/\s/g, ''), password: f.password, role: f.role, isLibrarian: f.isLibrarian };
      if (f.email.trim()) body.email = f.email.trim();
      return api('/users', 'POST', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setF(empty); onClose(); },
  });
  const ok = f.fullName.trim().length >= 3 && PHONE.test(f.phone.replace(/\s/g, '')) && f.password.length >= 8;

  return (
    <FormSheet
      open={open} onClose={onClose} title="Yangi xodim"
      footer={
        <>
          <BigButton title={create.isPending ? 'Saqlanmoqda…' : 'Saqlash'} onPress={() => create.mutate()} busy={create.isPending} disabled={!ok} />
          <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={onClose} />
        </>
      }
    >
      <Field label="F.I.Sh" value={f.fullName} onChangeText={set('fullName')} autoCapitalize="words" />
      <Select<Role> label="Rol" value={f.role} options={ROLES} onChange={set('role')} />
      <Field label="Telefon" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={badPhone} />
      <Help text={badPhone ? 'Format: +998XXXXXXXXX' : "Bu login bo'ladi"} error={badPhone} />
      <Field label="Email (ixtiyoriy)" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Boshlang'ich parol" value={f.password} onChangeText={set('password')} autoCapitalize="none" />
      <Help text="Kamida 8 belgi. Xodimga yetkazing — u Profil orqali o'zi o'zgartiradi." />
      <Toggle label="Kutubxonachi" help="Kutubxona bo'limiga kirish huquqi. Rolga bog'liq emas." value={f.isLibrarian} onChange={set('isLibrarian')} />
      <ErrorText text={create.error?.message} />
    </FormSheet>
  );
}

function EditStaffSheet({ staff, self, onClose }: { staff: StaffRow | null; self: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    fullName: staff?.full_name ?? '', phone: staff?.phone ?? '', email: staff?.email ?? '',
    role: (staff?.role ?? 'teacher') as Role, isActive: staff?.is_active ?? true, isLibrarian: staff?.is_librarian ?? false,
  });
  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const isSelf = staff?.id === self;
  const badPhone = f.phone.length > 0 && !PHONE.test(f.phone.replace(/\s/g, ''));

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { fullName: f.fullName.trim(), phone: f.phone.replace(/\s/g, ''), role: f.role, isActive: f.isActive, isLibrarian: f.isLibrarian };
      if (f.email.trim()) body.email = f.email.trim();
      return api(`/users/${staff!.id}`, 'PATCH', body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });
  const reset = useMutation({
    mutationFn: () => api(`/users/${staff!.id}/reset-password`, 'POST', { newPassword: pw }),
    onSuccess: () => { setPw(''); setPwOpen(false); },
  });

  return (
    <>
      <FormSheet
        open={!!staff && !pwOpen} onClose={onClose} title={staff?.full_name ?? ''}
        footer={
          <>
            <BigButton title={save.isPending ? 'Saqlanmoqda…' : 'Saqlash'} onPress={() => save.mutate()} busy={save.isPending} disabled={f.fullName.trim().length < 3 || badPhone} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><BigButton title="Parolni tiklash" icon="key" variant="secondary" height={44} onPress={() => setPwOpen(true)} /></View>
              <View style={{ flex: 1 }}><BigButton title="Bekor qilish" variant="secondary" height={44} onPress={onClose} /></View>
            </View>
          </>
        }
      >
        <Field label="F.I.Sh" value={f.fullName} onChangeText={set('fullName')} autoCapitalize="words" />
        <Select<Role> label="Rol" value={f.role} options={ROLES} onChange={set('role')} />
        <Field label="Telefon" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={badPhone} />
        {badPhone && <Help text="Format: +998XXXXXXXXX" error />}
        <Field label="Email" value={f.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
        <Toggle label="Kutubxonachi" help="Kutubxona bo'limiga kirish huquqi. O'qituvchi bo'lib turib kutubxonachi ham bo'lishi mumkin." value={f.isLibrarian} onChange={set('isLibrarian')} />
        <Toggle label="Faol" help={isSelf ? "O'zingizni o'chira olmaysiz" : "O'chirilgan xodim tizimga kira olmaydi, sessiyalari darhol bekor bo'ladi"} value={f.isActive} onChange={set('isActive')} disabled={isSelf} />
        <ErrorText text={save.error?.message} />
      </FormSheet>

      <FormSheet
        open={pwOpen} onClose={() => setPwOpen(false)} title="Yangi parol" sub={staff?.full_name}
        footer={
          <>
            <BigButton title={reset.isPending ? 'Saqlanmoqda…' : 'Parolni tiklash'} onPress={() => reset.mutate()} busy={reset.isPending} disabled={pw.length < 8} />
            <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={() => setPwOpen(false)} />
          </>
        }
      >
        <Help text="Xodimning barcha sessiyalari darhol bekor bo'ladi. Yangi parolni unga o'zingiz yetkazasiz." />
        <Field label="Yangi parol" value={pw} onChangeText={setPw} autoCapitalize="none" placeholder="Kamida 8 belgi" />
        <ErrorText text={reset.error?.message} />
      </FormSheet>
    </>
  );
}
