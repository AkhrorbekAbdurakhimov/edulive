import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth, roleLabel } from '../lib/auth';

export default function Settings() {
  const { user } = useAuth();

  return (
    <div className="page">
      <div className="page-head">
        <h1>Sozlamalar</h1>
      </div>

      <div className="card card-pad" style={{ maxWidth: 560, marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Profil</h2>
        <Row label="F.I.Sh" value={user?.fullName} />
        <Row label="Rol" value={roleLabel(user?.role)} />
        <Row label="Telefon" value={user?.phone ?? undefined} />
      </div>

      <ChangePassword />
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="row" style={{ padding: '8px 0', alignItems: 'baseline' }}>
      <span className="muted" style={{ minWidth: 96 }}>{label}</span>
      <strong>{value || <span className="muted">—</span>}</strong>
    </div>
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
    <form className="card card-pad" style={{ maxWidth: 560 }} onSubmit={submit}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Parolni o'zgartirish</h2>
      <p className="muted" style={{ marginTop: 0, marginBottom: 14 }}>
        Parol o'zgargach boshqa qurilmalardagi sessiyalar bekor bo'ladi — bu yerda
        ochiq qolasiz.
      </p>

      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="cur">Joriy parol</label>
        <input
          id="cur" className="input" type="password" autoComplete="current-password"
          value={form.current} onChange={set('current')} required
        />
      </div>

      <div className="field" style={{ marginBottom: 12 }}>
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

      <div className="field" style={{ marginBottom: 12 }}>
        <label htmlFor="rep">Yangi parolni takrorlang</label>
        <input
          id="rep" className={`input${mismatch ? ' err' : ''}`} type="password"
          autoComplete="new-password" value={form.repeat} onChange={set('repeat')} required
        />
        {mismatch && <span className="hint">Parollar mos kelmadi</span>}
      </div>

      {errMsg && <p className="hint">{errMsg}</p>}
      {done && <p className="save-note">✓ Parol o'zgartirildi</p>}

      <div className="actions">
        <button className="btn btn-primary" disabled={blocked || change.isPending}>
          {change.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
      </div>
    </form>
  );
}
