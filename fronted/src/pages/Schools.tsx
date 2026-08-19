import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, date } from '../lib/api';
import { useSchool } from '../lib/school';
import { REGIONS, DISTRICTS } from '../lib/regions';
import { EmptyState, ErrorState, Modal, TableSkeleton, initials, schoolStatusChip } from '../components/ui';

interface SchoolRow {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  district: string | null;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  plan: string;
  status: string;
  created_at: string;
  student_count: number;
  user_count: number;
}

const PLANS = [
  { value: 'trial', label: 'Sinov' },
  { value: 'standart', label: 'Standart' },
  { value: 'pro', label: 'Pro' },
];
const planLabel = (p: string) => PLANS.find((x) => x.value === p)?.label ?? p;

/**
 * Tanlangan viloyatning tumanlari. Agar bazadagi joriy qiymat ro'yxatda
 * bo'lmasa (eski yozuv yoki ro'yxat eskirgan), u birinchi variant sifatida
 * qo'shiladi — aks holda tahrirlashda jimgina yo'qolib ketardi.
 */
function districtOptions(region: string, current: string): string[] {
  const list = DISTRICTS[region] ?? [];
  return current && !list.includes(current) ? [current, ...list] : list;
}

/** Maktab nomidan slug: backend `^[a-z0-9-]{2,40}$` ni talab qiladi. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[ʻʼ'"«»]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Logotip yoki uning o'rniga nom bosh harflari. */
function SchoolLogo({ school, size = 36 }: { school: { name: string; logo_url: string | null }; size?: number }) {
  if (school.logo_url) {
    return <img className="school-logo" src={school.logo_url} alt="" style={{ width: size, height: size }} />;
  }
  return <span className="avatar" style={{ width: size, height: size }}>{initials(school.name)}</span>;
}

export default function Schools() {
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<SchoolRow | null>(null);
  const { enter } = useSchool();
  const navigate = useNavigate();

  const schools = useQuery({
    queryKey: ['schools'],
    queryFn: async () => (await api.get<{ items: SchoolRow[] }>('/schools')).data.items,
  });

  // Maktabga kirish keshni tozalaydi, shuning uchun navigatsiya undan keyin.
  const openSchool = (id: string) => { enter(id); navigate('/dashboard'); };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Maktablar</h1>
        {schools.data && <span className="muted num">{schools.data.length} ta</span>}
        <div className="grow" />
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Yangi maktab</button>
      </div>

      <div className="card table-wrap">
        {schools.isPending ? (
          <TableSkeleton />
        ) : schools.isError ? (
          <ErrorState error={schools.error} onRetry={() => schools.refetch()} />
        ) : schools.data.length === 0 ? (
          <EmptyState
            icon="🏫"
            title="Hali maktab yo'q"
            text="Birinchi maktabni qo'shing — o'sha yerdayoq uning administratorini ham yaratsangiz bo'ladi."
            action={<button className="btn btn-primary sm" onClick={() => setShowCreate(true)}>+ Yangi maktab</button>}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Maktab</th><th>Manzil</th><th>Tarif</th><th>Holat</th>
                <th>O'quvchi</th><th>Xodim</th><th>Qo'shilgan</th><th aria-label="Amallar" />
              </tr>
            </thead>
            <tbody>
              {schools.data.map((s) => (
                <tr key={s.id}>
                  <td data-label="Maktab">
                    <div className="row">
                      <SchoolLogo school={s} />
                      <div>
                        <strong>{s.name}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>{s.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Manzil">
                    {s.district || s.region ? (
                      <>
                        {s.district ?? <span className="muted">—</span>}
                        {s.region && <div className="muted" style={{ fontSize: 12 }}>{s.region}</div>}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td data-label="Tarif">{planLabel(s.plan)}</td>
                  <td data-label="Holat">{schoolStatusChip(s.status)}</td>
                  <td data-label="O'quvchi" className="num">{s.student_count}</td>
                  <td data-label="Xodim" className="num">{s.user_count}</td>
                  <td data-label="Qo'shilgan" className="num">{date(s.created_at)}</td>
                  <td data-label="Amallar">
                    <div className="row">
                      <button className="btn btn-secondary sm" onClick={() => setEditing(s)}>Tahrirlash</button>
                      <button className="btn btn-primary sm" onClick={() => openSchool(s.id)}>Kirish</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <CreateSchoolModal onClose={() => setShowCreate(false)} />}
      {editing && <EditSchoolModal school={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CreateSchoolModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '', slug: '', slugTouched: false, region: '', district: '', address: '',
    phone: '', tgCode: '', plan: 'standart',
    adminName: '', adminPhone: '+998', adminPassword: '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Viloyat almashsa tuman ham tozalanadi — aks holda boshqa viloyatning
  // tumani saqlanib qolardi.
  const setRegion = (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, region: e.target.value, district: '' }));

  // Slug nomdan o'zi to'ladi; foydalanuvchi tahrirlasa, avtomatik to'ldirish to'xtaydi.
  const setName = (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, name: e.target.value, slug: f.slugTouched ? f.slug : toSlug(e.target.value) }));

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        plan: form.plan,
      };
      if (form.region) body.region = form.region;
      if (form.district.trim()) body.district = form.district.trim();
      if (form.address.trim()) body.address = form.address.trim();
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.tgCode.trim()) body.tgCode = form.tgCode.trim();
      if (form.adminName.trim()) {
        body.admin = {
          fullName: form.adminName.trim(),
          phone: form.adminPhone.trim(),
          password: form.adminPassword,
        };
      }
      return (await api.post('/schools', body)).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['schools'] }); onClose(); },
  });

  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  const errMsg = (create.error as any)?.response?.data?.error;

  return (
    <Modal title="Yangi maktab" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label>Maktab nomi</label>
            <input className="input" value={form.name} onChange={setName} required minLength={2} />
          </div>
          <div className="field">
            <label>Slug</label>
            <input
              className="input" value={form.slug} required pattern="[a-z0-9\-]{2,40}"
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value, slugTouched: true }))}
            />
            <span className="help">Kichik lotin harflar, raqam va "-". Keyin o'zgartirib bo'lmaydi.</span>
          </div>
          <div className="field">
            <label>Viloyat</label>
            <select className="input" value={form.region} onChange={setRegion}>
              <option value="">Tanlanmagan</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Tuman / shahar</label>
            <select className="input" value={form.district} onChange={set('district')} disabled={!form.region}>
              <option value="">{form.region ? 'Tanlanmagan' : 'Avval viloyatni tanlang'}</option>
              {districtOptions(form.region, form.district).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Manzil</label>
            <input className="input" value={form.address} onChange={set('address')} placeholder="Ko'cha, uy raqami" />
          </div>
          <div className="field">
            <label>Telefon</label>
            <input className="input" value={form.phone} onChange={set('phone')} inputMode="tel" />
          </div>
          <div className="field">
            <label>Tarif</label>
            <select className="input" value={form.plan} onChange={set('plan')}>
              {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Telegram kodi</label>
            <input className="input" value={form.tgCode} onChange={set('tgCode')} placeholder="bo'sh bo'lsa slug ishlatiladi" />
            <span className="help">Ota-ona /start &lt;kod&gt; orqali maktabni topadi.</span>
          </div>
        </div>

        <h3 style={{ marginTop: 18, marginBottom: 4, fontSize: 14 }}>Birinchi administrator</h3>
        <p className="muted" style={{ marginTop: 0, marginBottom: 10, fontSize: 13 }}>
          Ixtiyoriy. To'ldirsangiz, maktab shu zahoti ishlay boshlaydi — admin o'z telefoni bilan kiradi.
        </p>
        <div className="form-grid">
          <div className="field">
            <label>F.I.Sh</label>
            <input className="input" value={form.adminName} onChange={set('adminName')} minLength={3} />
          </div>
          {form.adminName.trim() && (
            <>
              <div className="field">
                <label>Telefon</label>
                <input
                  className="input" value={form.adminPhone} onChange={set('adminPhone')}
                  inputMode="tel" required pattern="\+998[0-9]{9}"
                />
                <span className="help">+998XXXXXXXXX</span>
              </div>
              <div className="field">
                <label>Parol</label>
                <input
                  className="input" value={form.adminPassword} onChange={set('adminPassword')}
                  required minLength={8} autoComplete="new-password"
                />
                <span className="help">Kamida 8 belgi. Adminga yetkazing — u keyin o'zi o'zgartiradi.</span>
              </div>
            </>
          )}
        </div>

        {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
          <button className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Logotip formadan alohida saqlanadi: fayl yuborish uchun multipart kerak,
 * qolgan maydonlar esa JSON bilan ketadi. Shuning uchun rasm tanlangan
 * zahoti yuklanadi va "Saqlash" ni kutmaydi.
 */
function LogoEditor({ school }: { school: SchoolRow }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(school.logo_url);
  const [err, setErr] = useState<string | null>(null);

  const done = (next: string | null) => {
    setUrl(next);
    setErr(null);
    qc.invalidateQueries({ queryKey: ['schools'] });
  };
  const fail = (e: any) => setErr(e?.response?.data?.error ?? "Yuklab bo'lmadi");

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append('logo', file);
      return (await api.post<{ logoUrl: string }>(`/schools/${school.id}/logo`, body)).data;
    },
    onSuccess: (d) => done(d.logoUrl),
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: async () => (await api.delete(`/schools/${school.id}/logo`)).data,
    onSuccess: () => done(null),
    onError: fail,
  });

  const busy = upload.isPending || remove.isPending;

  return (
    <div className="logo-editor">
      <SchoolLogo school={{ name: school.name, logo_url: url }} size={56} />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className={`btn btn-secondary sm${busy ? ' disabled' : ''}`}>
            {upload.isPending ? 'Yuklanmoqda…' : url ? "Rasmni almashtirish" : 'Rasm tanlash'}
            <input
              type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';           // bir xil faylni qayta tanlash ishlasin
                if (f) upload.mutate(f);
              }}
            />
          </label>
          {url && (
            <button type="button" className="btn btn-ghost sm" disabled={busy} onClick={() => remove.mutate()}>
              O'chirish
            </button>
          )}
        </div>
        {err ? <span className="hint">{err}</span> : <span className="help">PNG, JPEG yoki WEBP — 2 MB gacha</span>}
      </div>
    </div>
  );
}

function EditSchoolModal({ school, onClose }: { school: SchoolRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: school.name, region: school.region ?? '', district: school.district ?? '',
    address: school.address ?? '', phone: school.phone ?? '',
    plan: school.plan, status: school.status,
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  // Viloyat almashsa tuman tozalanadi (yaratish formasidagi kabi).
  const setRegion = (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, region: e.target.value, district: '' }));

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/schools/${school.id}`, {
        name: form.name.trim(),
        region: form.region,
        district: form.district.trim(),
        address: form.address.trim(),
        phone: form.phone.trim(),
        plan: form.plan,
        status: form.status,
      })).data,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['schools'] }); onClose(); },
  });

  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const errMsg = (save.error as any)?.response?.data?.error;

  return (
    <Modal title={school.name} onClose={onClose}>
      <LogoEditor school={school} />
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label>Maktab nomi</label>
            <input className="input" value={form.name} onChange={set('name')} required minLength={2} />
          </div>
          <div className="field">
            <label>Viloyat</label>
            <select className="input" value={form.region} onChange={setRegion}>
              <option value="">Tanlanmagan</option>
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Tuman / shahar</label>
            <select className="input" value={form.district} onChange={set('district')} disabled={!form.region}>
              <option value="">{form.region ? 'Tanlanmagan' : 'Avval viloyatni tanlang'}</option>
              {districtOptions(form.region, form.district).map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Manzil</label>
            <input className="input" value={form.address} onChange={set('address')} placeholder="Ko'cha, uy raqami" />
          </div>
          <div className="field">
            <label>Telefon</label>
            <input className="input" value={form.phone} onChange={set('phone')} inputMode="tel" />
          </div>
          <div className="field">
            <label>Tarif</label>
            <select className="input" value={form.plan} onChange={set('plan')}>
              {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Holat</label>
            <select className="input" value={form.status} onChange={set('status')}>
              <option value="active">Faol</option>
              <option value="trial">Sinov</option>
              <option value="suspended">To'xtatilgan</option>
            </select>
            <span className="help">"To'xtatilgan" maktab xodimlari tizimga kira olmaydi.</span>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Slug <strong>{school.slug}</strong> — o'zgarmaydi, unga havolalar bog'langan.
        </p>
        {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
          <button className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
