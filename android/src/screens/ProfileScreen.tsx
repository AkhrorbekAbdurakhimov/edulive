import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { API_URL, api, roleLabel, saveToken, saveUser, type AuthedUser } from '../api';
import { ErrorText, FormSheet, Help, SaveNote } from '../forms';
import { fmtPhone, initials } from '../format';
import { useOnline } from '../net';
import { useQueue } from '../store';
import { HIT, radius, useTheme } from '../theme';
import { AppBar, Avatar, Banner, BigButton, Field, Icon, Pill, Sheet, type IconName } from '../ui';

export function ProfileScreen({ user, onLogout, onUserUpdate }: { user: AuthedUser; onLogout: () => Promise<void>; onUserUpdate: (u: AuthedUser) => void }) {
  const c = useTheme();
  const online = useOnline();
  const queue = useQueue();
  const [pwOpen, setPwOpen] = useState(false);
  const [profOpen, setProfOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const version = Constants.expoConfig?.version ?? '—';

  // Navbatda yuborilmagan davomat bo'lsa chiqish bloklanadi: token o'chsa u
  // yuborilmay qoladi, keyingi kirgan odam nomidan ketib qolishi ham mumkin.
  const blocked = queue.length > 0;

  const logout = async () => {
    setBusy(true);
    try {
      await api('/auth/logout', 'POST').catch(() => undefined); // oflayn bo'lsa ham lokal chiqamiz
      await saveToken(null);
      await onLogout();
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar title="Profil" />
      {!online && <Banner kind="warn" icon="wifi-off" text="Internet yo'q" />}

      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 24, gap: 14 }}>
        <View style={{ alignItems: 'center', paddingVertical: 10, gap: 8 }}>
          <Avatar text={initials(user.fullName)} size={64} brand />
          <Text style={{ fontSize: 19, fontWeight: '700', color: c.t1, letterSpacing: -0.3 }}>{user.fullName}</Text>
          <Text style={{ fontSize: 13, color: c.t2 }}>{fmtPhone(user.phone) || ' '}</Text>
          <Pill kind="brand" icon="user" label={roleLabel(user.role)} />
        </View>

        <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
          <Row icon="edit-2" label="Profilni tahrirlash" onPress={() => setProfOpen(true)} />
          <Row icon="lock" label="Parolni o'zgartirish" onPress={() => setPwOpen(true)} />
          <Row icon="upload-cloud" label="Yuborilmagan davomat" value={queue.length ? `${queue.length} ta` : "Yo'q"} last />
        </View>

        <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.card, backgroundColor: c.surface, overflow: 'hidden' }}>
          <Row icon="server" label="Server" value={API_URL.replace(/^https?:\/\//, '').replace(/\/api$/, '')} />
          <Row icon="info" label="Ilova versiyasi" value={version} last />
        </View>

        {blocked && (
          <Text style={{ fontSize: 12, color: c.warnInk, textAlign: 'center' }}>
            Chiqishdan oldin navbatdagi {queue.length} ta davomat yuborilishi kerak.
          </Text>
        )}
        <BigButton title="Chiqish" icon="log-out" variant="danger" onPress={() => setConfirmOut(true)} disabled={blocked} />
      </ScrollView>

      <ChangePasswordSheet open={pwOpen} onClose={() => setPwOpen(false)} />
      <ProfileSheet key={user.fullName + user.phone} user={user} open={profOpen} onClose={() => setProfOpen(false)} onSaved={onUserUpdate} />

      <Sheet open={confirmOut} onClose={() => !busy && setConfirmOut(false)} title="Hisobdan chiqasizmi?" sub="Qayta kirish uchun telefon raqam va parol kerak bo'ladi">
        <View style={{ gap: 8 }}>
          <BigButton title="Chiqish" variant="danger" onPress={logout} busy={busy} />
          <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={() => setConfirmOut(false)} disabled={busy} />
        </View>
      </Sheet>
    </View>
  );
}

function Row({ icon, label, value, onPress, last }: { icon: IconName; label: string; value?: string; onPress?: () => void; last?: boolean }) {
  const c = useTheme();
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: HIT + 4, borderBottomWidth: last ? 0 : 1, borderColor: c.border }}>
      <Icon name={icon} size={18} color={c.t2} />
      <Text style={{ flex: 1, fontSize: 14, fontWeight: '500', color: c.t1 }}>{label}</Text>
      {value && <Text style={{ fontSize: 13, color: c.t3, fontVariant: ['tabular-nums'] }} numberOfLines={1}>{value}</Text>}
      {onPress && <Icon name="chevron-right" size={18} color={c.t3} />}
    </View>
  );
  if (!onPress) return inner;
  return <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{inner}</Pressable>;
}

function ChangePasswordSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => { setCurrent(''); setNext(''); setRepeat(''); setError(null); setDone(false); };

  const submit = async () => {
    setError(null);
    if (next.length < 8) return setError("Yangi parol kamida 8 belgidan iborat bo'lishi kerak");
    if (next !== repeat) return setError('Yangi parollar bir xil emas');
    setBusy(true);
    try {
      // Server token_version ni oshiradi va yangi token qaytaradi — sessiya uzilmaydi.
      const r = await api<{ token: string }>('/auth/change-password', 'POST', { currentPassword: current, newPassword: next });
      await saveToken(r.token);
      setDone(true);
      setTimeout(() => { onClose(); reset(); }, 1200);
    } catch (err: any) {
      setError(err?.message ?? 'Xatolik');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={() => { if (!busy) { onClose(); reset(); } }} title="Parolni o'zgartirish">
      <View style={{ gap: 12 }}>
        <Field label="Joriy parol" value={current} onChangeText={setCurrent} secureTextEntry error={!!error} />
        <Field label="Yangi parol" value={next} onChangeText={setNext} secureTextEntry placeholder="Kamida 8 belgi" error={!!error} />
        <Field label="Yangi parol (takror)" value={repeat} onChangeText={setRepeat} secureTextEntry error={!!error} />
        {error && <Text style={{ color: c.critInk, fontSize: 13 }}>{error}</Text>}
        {done && (
          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            <Icon name="check-circle" size={15} color={c.goodInk} />
            <Text style={{ color: c.goodInk, fontSize: 13, fontWeight: '600' }}>Parol o'zgartirildi</Text>
          </View>
        )}
        <BigButton title={busy ? 'Saqlanmoqda…' : 'Saqlash'} onPress={submit} busy={busy} disabled={!current || !next || !repeat || done} />
      </View>
    </Sheet>
  );
}

/** Ism va telefon — telefon bu login, o'zgarsa keyingi safar shu raqam bilan kiriladi. */
function ProfileSheet({ user, open, onClose, onSaved }: { user: AuthedUser; open: boolean; onClose: () => void; onSaved: (u: AuthedUser) => void }) {
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const badPhone = phone.length > 0 && !/^\+998\d{9}$/.test(phone.replace(/\s/g, ''));
  const dirty = fullName.trim() !== user.fullName || phone.replace(/\s/g, '') !== (user.phone ?? '');

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api<{ user: AuthedUser }>('/auth/profile', 'PATCH', { fullName: fullName.trim(), phone: phone.replace(/\s/g, '') });
      const next = { ...user, ...r.user };
      await saveUser(next);
      onSaved(next);
      setDone(true);
      setTimeout(() => { setDone(false); onClose(); }, 1200);
    } catch (err: any) {
      setError(err?.message ?? 'Xatolik');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      open={open} onClose={onClose} title="Profil"
      footer={
        <>
          <BigButton title={busy ? 'Saqlanmoqda…' : 'Saqlash'} onPress={save} busy={busy} disabled={!dirty || badPhone || fullName.trim().length < 3 || done} />
          <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={onClose} disabled={busy} />
        </>
      }
    >
      <Field label="F.I.Sh" value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      <Field label="Telefon" value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={badPhone} />
      <Help text={badPhone ? 'Format: +998XXXXXXXXX' : "Telefon — bu login. O'zgartirsangiz keyingi safar shu raqam bilan kirasiz."} error={badPhone} />
      <ErrorText text={error} />
      <SaveNote text={done ? 'Profil saqlandi' : null} />
    </FormSheet>
  );
}
