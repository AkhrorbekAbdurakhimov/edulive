import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth, roleLabel, type User } from '../lib/auth';
import { initials } from '../components/ui';

export default function Settings() {
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Sozlamalar</h1>
      </div>
      <Profile />
      <ChangePassword />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card card-pad settings-card">
      <h2>{title}</h2>
      {hint && <p className="section-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Profile() {
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState({ fullName: user?.fullName ?? '', phone: user?.phone ?? '' });
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setDone(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch<{ user: User }>('/auth/profile', {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
      })).data.user,
    onSuccess: (u) => { updateUser(u); setDone(true); },
  });

  const badPhone = form.phone.length > 0 && !/^\+998\d{9}$/.test(form.phone);
  const errMsg = (save.error as any)?.response?.data?.error;
  const dirty = form.fullName !== (user?.fullName ?? '') || form.phone !== (user?.phone ?? '');

  return (
    <Section title="Profil">
      <div className="row" style={{ marginBottom: 18 }}>
        <span className="avatar lg">{initials(user?.fullName ?? '?')}</span>
        <div>
          <div style={{ fontWeight: 600 }}>{user?.fullName}</div>
          <div className="muted">{roleLabel(user?.role)}</div>
        </div>
      </div>

      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!badPhone) save.mutate(); }}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="fn">F.I.Sh</label>
            <input id="fn" className="input" value={form.fullName} onChange={set('fullName')} required minLength={3} />
          </div>
          <div className="field">
            <label htmlFor="ph">Telefon</label>
            <input
              id="ph" className={`input${badPhone ? ' err' : ''}`} value={form.phone}
              onChange={set('phone')} inputMode="tel" required
            />
            {badPhone
              ? <span className="hint">Format: +998XXXXXXXXX</span>
              : <span className="help">Telefon — bu login. O'zgartirsangiz keyingi safar shu raqam bilan kirasiz.</span>}
          </div>
        </div>

        {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}
        {done && <p className="save-note">✓ Profil saqlandi</p>}

        <div className="actions">
          <button className="btn btn-primary" disabled={!dirty || badPhone || save.isPending}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Section>
  );
}

function ChangePassword() {
  const { setToken } = useAuth();
  const [form, setForm] = useState({ current: '', next: '', repeat: '' });
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setDone(false);
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  // Serverga bormasdan aniqlanadigan xatolar — foydalanuvchi bekorga kutmasin.
  const mismatch = form.repeat.length > 0 && form.next !== form.repeat;
  const tooShort = form.next.length > 0 && form.next.length < 8;
  const same = form.next.length > 0 && form.next === form.current;

  const change = useMutation({
    mutationFn: async () =>
      (await api.post<{ token: string }>('/auth/change-password', {
        currentPassword: form.current,
        newPassword: form.next,
      })).data,
    onSuccess: (data) => {
      // token_version oshdi: eski token yaroqsiz, yangisini saqlamasak
      // keyingi so'rov 401 bilan tushadi va login sahifasiga uloqtiradi.
      setToken(data.token);
      setForm({ current: '', next: '', repeat: '' });
      setDone(true);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mismatch || tooShort || same) return;
    change.mutate();
  };

  const errMsg = (change.error as any)?.response?.data?.error;
  const blocked = mismatch || tooShort || same || !form.current || !form.next;

  return (
    <Section
      title="Parolni o'zgartirish"
      hint="Parol o'zgargach boshqa qurilmalardagi sessiyalar bekor bo'ladi — bu yerda ochiq qolasiz."
    >
      <form onSubmit={submit}>
        <div className="field" style={{ marginBottom: 14 }}>
          <label htmlFor="cur">Joriy parol</label>
          <input
            id="cur" className="input" type="password" autoComplete="current-password"
            value={form.current} onChange={set('current')} required
          />
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="new">Yangi parol</label>
            <input
              id="new" className={`input${tooShort || same ? ' err' : ''}`} type="password"
              autoComplete="new-password" value={form.next} onChange={set('next')} required minLength={8}
            />
            {tooShort ? (
              <span className="hint">Kamida 8 belgi</span>
            ) : same ? (
              <span className="hint">Yangi parol joriy paroldan farq qilishi kerak</span>
            ) : (
              <span className="help">Kamida 8 belgi</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="rep">Yangi parolni takrorlang</label>
            <input
              id="rep" className={`input${mismatch ? ' err' : ''}`} type="password"
              autoComplete="new-password" value={form.repeat} onChange={set('repeat')} required
            />
            {mismatch && <span className="hint">Parollar mos kelmadi</span>}
          </div>
        </div>

        {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}
        {done && <p className="save-note">✓ Parol o'zgartirildi</p>}

        <div className="actions">
          <button className="btn btn-primary" disabled={blocked || change.isPending}>
            {change.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Section>
  );
}
