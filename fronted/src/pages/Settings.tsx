import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
      <TelegramLink />
      <ChangePassword />
      <SchoolSettings />
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

/**
 * Maktab sozlamalari (3-qoida: kodda emas, bazada).
 *
 * Faqat admin uchun: to'lov muddati va oy ulushi pulga tegadi.
 */
function SchoolSettings() {
  const { user } = useAuth();
  const [dueDay, setDueDay] = useState('10');
  const [prorate, setProrate] = useState(false);
  const [done, setDone] = useState(false);

  const q = useQuery({
    queryKey: ['school-settings'],
    enabled: user?.role === 'admin',
    queryFn: async () => {
      const { data } = await api.get<{ school: { settings: Record<string, unknown> } }>('/school');
      const s = data.school.settings ?? {};
      setDueDay(String(s.payment_due_day ?? 10));
      setProrate(s.prorate_partial_months === true);
      return s;
    },
  });

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch('/school/settings', {
        payment_due_day: Number(dueDay) || 10,
        prorate_partial_months: prorate,
      })).data,
    onSuccess: () => setDone(true),
  });

  // Faqat maktab admini o'zgartira oladi; boshqalarga umuman ko'rsatilmaydi.
  if (user?.role !== 'admin') return null;
  if (q.isPending) return null;

  return (
    <Section title="Maktab sozlamalari" hint="Hisob-kitobga ta'sir qiladi — o'zgartirish audit jurnaliga yoziladi.">
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); setDone(false); save.mutate(); }}>
        <div className="field">
          <label htmlFor="st-due">To'lov muddati kuni</label>
          <input
            id="st-due" className="input num" type="number" min={1} max={28}
            value={dueDay} onChange={(e) => { setDone(false); setDueDay(e.target.value); }}
          />
          <span className="help">Oylik hisob shu kunda to'lanishi kerak.</span>
        </div>

        <label className="check-row">
          <input
            type="checkbox" checked={prorate}
            onChange={(e) => { setDone(false); setProrate(e.target.checked); }}
          />
          <span>
            Oy ulushini hisobga olish
            <span className="help">
              O'quv yili o'rtasida kelgan yoki ketgan o'quvchiga to'liq oy emas,
              o'qigan kunlari uchun hisob yoziladi. O'chirilgan bo'lsa har doim
              to'liq oy.
            </span>
          </span>
        </label>

        {save.error != null && (
          <p className="hint">{(save.error as any)?.response?.data?.error ?? "Saqlab bo'lmadi"}</p>
        )}
        {done && <p className="save-note">✓ Saqlandi</p>}

        <div className="actions">
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Section>
  );
}

/**
 * Xizmat botiga ulanish.
 *
 * Chat raqami qo'lda kiritilmaydi — bir martalik havola beriladi va bot
 * o'zi qaysi hisob ekanini biladi. Aks holda birov boshqaning hisobotini
 * o'z chatiga yo'naltirib olishi mumkin edi.
 */
function TelegramLink() {
  const qc = useQueryClient();
  const [link, setLink] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['staffbot-link'],
    queryFn: async () =>
      (await api.get<{ linked: boolean; configured: boolean; username: string }>('/staffbot/link')).data,
  });

  const make = useMutation({
    mutationFn: async () => (await api.post<{ link: string }>('/staffbot/link')).data,
    onSuccess: (d) => setLink(d.link),
  });

  const unlink = useMutation({
    mutationFn: async () => (await api.delete('/staffbot/link')).data,
    onSuccess: () => { setLink(null); qc.invalidateQueries({ queryKey: ['staffbot-link'] }); },
  });

  if (q.isPending || !q.data?.configured) return null;

  return (
    <Section
      title="Telegram"
      hint="Kunlik hisobot, to'lov xabarlari va zaxira nusxa shu bot orqali keladi."
    >
      {q.data.linked ? (
        <>
          <p className="save-note">✓ Hisobingiz botga ulangan</p>
          <p className="muted">
            Botda <strong>/bugun</strong>, <strong>/hafta</strong>, <strong>/oy</strong> deb
            yozsangiz hisobot darhol keladi.
          </p>
          <div className="actions">
            <button className="btn btn-secondary" onClick={() => unlink.mutate()} disabled={unlink.isPending}>
              Ulanishni uzish
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Tugmani bosing — Telegram ochiladi va hisobingiz botga bog'lanadi.
          </p>
          {link ? (
            <>
              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                <a className="btn btn-primary" href={link} target="_blank" rel="noreferrer">
                  Telegramda ochish
                </a>
                <code className="invite-link">{link}</code>
              </div>
              <p className="help">
                Ochilgach <strong>Boshlash</strong> tugmasini bosing. Havola 15 daqiqa
                amal qiladi; ulangach shu sahifani yangilang.
              </p>
            </>
          ) : (
            <div className="actions">
              <button className="btn btn-primary" onClick={() => make.mutate()} disabled={make.isPending}>
                {make.isPending ? 'Tayyorlanmoqda…' : 'Telegramni ulash'}
              </button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}
