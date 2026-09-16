/**
 * SMS (Eskiz.uz) sozlamalari — to'lov qilmaganlarga qarz eslatmasi.
 *
 * Nega hamma nazorat bir joyda: SMS PULLIK. Yoqilgan-yoqilmagani, matni,
 * nechta SMS ketishi va balans — hammasi yuborishdan OLDIN ko'rinishi kerak.
 * Aks holda "nega hisob shuncha?" degan savol keyin chiqadi.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, money } from '../lib/api';
import { useAuth } from '../lib/auth';

interface SmsState {
  configured: boolean;
  own: boolean;
  email: string | null;
  from: string;
  balance: number | null;
  enabled: boolean;
  template: string;
  example: string;
  parts: number;
  unicode: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errText = (e: unknown): string | undefined => (e as any)?.response?.data?.error;

export default function SmsSettings() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [tpl, setTpl] = useState('');
  // Matn yozilayotganda har bosishda so'rov ketmasin.
  const [draft, setDraft] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDraft(tpl), 400);
    return () => clearTimeout(t);
  }, [tpl]);

  const q = useQuery({
    queryKey: ['sms', draft],
    enabled: user?.role === 'admin',
    queryFn: async () => {
      const { data } = await api.get<SmsState>('/sms', {
        params: draft ? { template: draft } : {},
      });
      // Birinchi yuklashda maydonlar saqlangan qiymat bilan to'ladi.
      setTpl((cur) => cur || data.template);
      setEnabled(data.enabled);
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch('/school/settings', {
        sms_debt_enabled: enabled,
        sms_debt_template: tpl.trim(),
      })).data,
    onSuccess: () => {
      setDone(true);
      qc.invalidateQueries({ queryKey: ['sms'] });
    },
  });

  // Faqat maktab admini: SMS pulga tegadi.
  if (user?.role !== 'admin') return null;
  if (q.isPending && !q.data) return null;

  const d = q.data;

  return (
    <section className="card card-pad settings-card">
      <h2>SMS (Eskiz.uz)</h2>
      <p className="section-hint">
        Qarz eslatmasi to'lov qilmagan o'quvchilarning barcha raqamlariga SMS bilan
        boradi. SMS pullik.
      </p>

      <p className="muted" style={{ marginTop: 0 }}>
        {!d?.configured ? (
          <>⚠ Hisob ulanmagan — SMS yuborilmaydi.</>
        ) : (
          <>
            {d.own ? "Maktabning o'z hisobi" : 'Platforma hisobi'} · jo'natuvchi:{' '}
            <strong>{d.from}</strong>
            {d.balance !== null && (
              <>
                {' '}· balans <strong className="num">{money(d.balance)}</strong>
              </>
            )}
          </>
        )}
      </p>

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setDone(false);
          save.mutate();
        }}
      >
        <label className="check-row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setDone(false);
              setEnabled(e.target.checked);
            }}
          />
          <span>
            Qarz eslatmasini SMS bilan ham yuborish
            <span className="help">
              To'lov qilmagan o'quvchining <strong>barcha</strong> mas'ul shaxs
              raqamlariga — Telegramga ulanganiga ham. Ulangani Telegramdan ham,
              SMS dan ham oladi: to'lov eslatmasi ko'rilmay qolmasligi kerak.
              Xabarni o'chirgan raqam (o'quvchi kartochkasida) hech nima olmaydi.
            </span>
          </span>
        </label>

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="sms-tpl">SMS matni</label>
          <textarea
            id="sms-tpl"
            className="input"
            rows={3}
            maxLength={400}
            value={tpl}
            onChange={(e) => {
              setDone(false);
              setTpl(e.target.value);
            }}
          />
          <span className="help">
            O'rinbosarlar: <code>{'{school}'}</code> <code>{'{student}'}</code>{' '}
            <code>{'{amount}'}</code> <code>{'{due}'}</code>. Matn Eskiz kabinetida
            moderatsiyadan o'tgan shablonga mos bo'lishi shart.
          </span>
        </div>

        {d && (
          <>
            <p className="sms-preview">{d.example}</p>
            <p className={d.parts > 1 ? 'hint' : 'help'}>
              {d.parts > 1
                ? `⚠ ${d.parts} ta SMS ketadi — har bir eslatma ${d.parts} barobar turadi.`
                : '✓ Bitta SMS'}
              {d.unicode && " · matnda lotin bo'lmagan belgi bor: sig'im 160 emas, 70 belgi."}
            </p>
          </>
        )}

        {save.error != null && <p className="hint">{errText(save.error) ?? "Saqlab bo'lmadi"}</p>}
        {done && <p className="save-note">✓ Saqlandi</p>}

        <div className="actions">
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>

      <SmsAccount own={d?.own ?? false} email={d?.email ?? null} from={d?.from ?? ''} />
    </section>
  );
}

/** Maktabning o'z Eskiz hisobi va tekshiruv SMS si. */
function SmsAccount({ own, email, from }: { own: boolean; email: string | null; from: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: email ?? '', secret: '', from });
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const attach = useMutation({
    mutationFn: async () =>
      (await api.put('/sms', {
        email: form.email.trim(),
        secret: form.secret.trim(),
        from: form.from.trim() || undefined,
      })).data,
    onSuccess: () => {
      setOpen(false);
      setNote('Hisob ulandi');
      // Maxfiy kod formada qolmasin.
      setForm((f) => ({ ...f, secret: '' }));
      qc.invalidateQueries({ queryKey: ['sms'] });
    },
  });

  const detach = useMutation({
    mutationFn: async () => (await api.delete('/sms')).data,
    onSuccess: () => {
      setNote('Hisob uzildi');
      qc.invalidateQueries({ queryKey: ['sms'] });
    },
  });

  const test = useMutation({
    mutationFn: async () => (await api.post('/sms/test', { phone })).data,
    onSuccess: () => setNote('Tekshiruv SMS si yuborildi'),
  });

  const problem = errText(attach.error) ?? errText(test.error) ?? errText(detach.error);

  return (
    <div className="sms-account">
      <h3>Hisob</h3>
      {own ? (
        <p className="muted">
          Maktabning o'z hisobi ulangan: <strong>{email}</strong>
        </p>
      ) : (
        <p className="muted">
          Platforma hisobi ishlatilyapti. Maktab o'z Eskiz hisobini ulasa, SMS xarajati
          to'g'ridan-to'g'ri maktab balansidan yechiladi.
        </p>
      )}

      {open ? (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setNote(null);
            attach.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="sms-email">Eskiz elektron pochtasi</label>
            <input
              id="sms-email"
              className="input"
              type="email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="sms-secret">SMS API maxfiy kodi</label>
            <input
              id="sms-secret"
              className="input"
              type="password"
              autoComplete="new-password"
              value={form.secret}
              onChange={(e) => setForm((f) => ({ ...f, secret: e.target.value }))}
            />
            <span className="help">
              Kabinetdagi <strong>SMS API</strong> bo'limidan olinadi — hisobga kirish
              paroli emas. Shifrlab saqlanadi va qaytarib ko'rsatilmaydi.
            </span>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="sms-from">Jo'natuvchi nomi (nik)</label>
            <input
              id="sms-from"
              className="input"
              maxLength={11}
              value={form.from}
              onChange={(e) => setForm((f) => ({ ...f, from: e.target.value }))}
            />
            <span className="help">
              Eskizda tasdiqlangan nik. Tasdiqlanmagan bo'lsa 4546 (sinov niki) qoldiring.
            </span>
          </div>
          {problem && <p className="hint">{problem}</p>}
          <div className="actions">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Bekor qilish
            </button>
            <button className="btn btn-primary" disabled={attach.isPending}>
              {attach.isPending ? 'Tekshirilmoqda…' : 'Ulash'}
            </button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button className="btn btn-secondary" onClick={() => setOpen(true)}>
            {own ? 'Hisobni almashtirish' : "O'z hisobini ulash"}
          </button>
          {own && (
            <button
              className="btn btn-ghost"
              onClick={() => detach.mutate()}
              disabled={detach.isPending}
            >
              Uzish
            </button>
          )}
        </div>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label htmlFor="sms-test">Tekshiruv SMS si</label>
        <div className="row">
          <input
            id="sms-test"
            className="input num"
            placeholder="+998901234567"
            value={phone}
            onChange={(e) => {
              setNote(null);
              setPhone(e.target.value);
            }}
          />
          <button
            className="btn btn-secondary"
            onClick={() => {
              setNote(null);
              test.mutate();
            }}
            disabled={test.isPending || phone.replace(/\D/g, '').length < 9}
          >
            {test.isPending ? 'Yuborilmoqda…' : 'Yuborish'}
          </button>
        </div>
        <span className="help">
          Eskizning oldindan tasdiqlangan sinov matni ketadi — ulanish ishlayaptimi,
          shuni tekshiradi.
        </span>
      </div>

      {!open && problem && <p className="hint">{problem}</p>}
      {note && <p className="save-note">✓ {note}</p>}
    </div>
  );
}
