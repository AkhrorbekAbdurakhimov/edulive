import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, date } from '../lib/api';
import { useAuth, roleLabel } from '../lib/auth';
import { Chip, EmptyState, ErrorState, Modal, TableSkeleton, initials } from '../components/ui';

interface StaffRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: 'admin' | 'manager' | 'teacher';
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
}

const ROLES = [
  { value: 'admin', label: 'Administrator' },
  { value: 'manager', label: 'Menejer' },
  { value: 'teacher', label: "O'qituvchi" },
] as const;

export default function Users() {
  const { user } = useAuth();
  const [role, setRole] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<StaffRow | null>(null);
  const [resetting, setResetting] = useState<StaffRow | null>(null);

  // Menejer ro'yxatni ko'radi, lekin o'zgartira olmaydi (backend ham shunday).
  const canManage = user?.role === 'admin' || user?.role === 'superadmin';

  const staff = useQuery({
    queryKey: ['users', role],
    queryFn: async () =>
      (await api.get<{ items: StaffRow[] }>(`/users${role ? `?role=${role}` : ''}`)).data.items,
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Xodimlar</h1>
        {staff.data && <span className="muted num">{staff.data.length} ta</span>}
        <div className="grow" />
        {canManage && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Yangi xodim</button>
        )}
      </div>

      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Barcha rollar</option>
          {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      <div className="card table-wrap">
        {staff.isPending ? (
          <TableSkeleton />
        ) : staff.isError ? (
          <ErrorState error={staff.error} onRetry={() => staff.refetch()} />
        ) : staff.data.length === 0 ? (
          <EmptyState
            icon="🧑"
            title="Xodim topilmadi"
            text={role ? "Filtrni o'zgartirib ko'ring" : 'Birinchi xodimni qo\'shing — u o\'z telefoni bilan kiradi.'}
            action={canManage && !role
              ? <button className="btn btn-primary sm" onClick={() => setShowCreate(true)}>+ Yangi xodim</button>
              : undefined}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Xodim</th><th>Telefon</th><th>Rol</th><th>Holat</th>
                <th>Oxirgi kirish</th>{canManage && <th aria-label="Amallar" />}
              </tr>
            </thead>
            <tbody>
              {staff.data.map((s) => (
                <tr key={s.id}>
                  <td data-label="Xodim">
                    <div className="row">
                      <span className="avatar">{initials(s.full_name)}</span>
                      <div>
                        <strong>{s.full_name}</strong>
                        {s.email && <div className="muted" style={{ fontSize: 12 }}>{s.email}</div>}
                      </div>
                    </div>
                  </td>
                  <td data-label="Telefon" className="num">{s.phone ?? <span className="muted">—</span>}</td>
                  <td data-label="Rol">{roleLabel(s.role)}</td>
                  <td data-label="Holat">
                    {s.is_active
                      ? <Chip kind="good">Faol</Chip>
                      : <Chip kind="crit">O'chirilgan</Chip>}
                  </td>
                  <td data-label="Oxirgi kirish" className="num">
                    {s.last_login_at ? date(s.last_login_at) : <span className="muted">hech qachon</span>}
                  </td>
                  {canManage && (
                    <td data-label="Amallar">
                      <div className="row">
                        <button className="btn btn-secondary sm" onClick={() => setEditing(s)}>Tahrirlash</button>
                        <button className="btn btn-ghost sm" onClick={() => setResetting(s)}>Parol</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <CreateStaffModal onClose={() => setShowCreate(false)} />}
      {editing && <EditStaffModal staff={editing} onClose={() => setEditing(null)} />}
      {resetting && <ResetPasswordModal staff={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function CreateStaffModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    fullName: '', phone: '+998', email: '', password: '', role: 'teacher',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        password: form.password,
        role: form.role,
      };
      if (form.email.trim()) body.email = form.email.trim();
      return (await api.post('/users', body)).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });

  const badPhone = form.phone.length > 3 && !/^\+998\d{9}$/.test(form.phone);
  const errMsg = (create.error as any)?.response?.data?.error;

  return (
    <Modal title="Yangi xodim" onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!badPhone) create.mutate(); }}>
        <div className="form-grid">
          <div className="field">
            <label>F.I.Sh</label>
            <input className="input" value={form.fullName} onChange={set('fullName')} required minLength={3} />
          </div>
          <div className="field">
            <label>Rol</label>
            <select className="input" value={form.role} onChange={set('role')}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Telefon</label>
            <input
              className={`input${badPhone ? ' err' : ''}`} value={form.phone}
              onChange={set('phone')} inputMode="tel" required
            />
            {badPhone ? <span className="hint">Format: +998XXXXXXXXX</span> : <span className="help">Bu login bo'ladi</span>}
          </div>
          <div className="field">
            <label>Email (ixtiyoriy)</label>
            <input className="input" type="email" value={form.email} onChange={set('email')} />
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Boshlang'ich parol</label>
            <input className="input" value={form.password} onChange={set('password')} required minLength={8} />
            <span className="help">Kamida 8 belgi. Xodimga yetkazing — u Sozlamalar orqali o'zi o'zgartiradi.</span>
          </div>
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

function EditStaffModal({ staff, onClose }: { staff: StaffRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState({
    fullName: staff.full_name,
    phone: staff.phone ?? '',
    email: staff.email ?? '',
    role: staff.role as string,
    isActive: staff.is_active,
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        role: form.role,
        isActive: form.isActive,
      };
      if (form.email.trim()) body.email = form.email.trim();
      return (await api.patch(`/users/${staff.id}`, body)).data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
  });

  const isSelf = user?.id === staff.id;
  const badPhone = form.phone.length > 0 && !/^\+998\d{9}$/.test(form.phone);
  const errMsg = (save.error as any)?.response?.data?.error;

  return (
    <Modal title={staff.full_name} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!badPhone) save.mutate(); }}>
        <div className="form-grid">
          <div className="field">
            <label>F.I.Sh</label>
            <input className="input" value={form.fullName} onChange={set('fullName')} required minLength={3} />
          </div>
          <div className="field">
            <label>Rol</label>
            <select className="input" value={form.role} onChange={set('role')}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Telefon</label>
            <input
              className={`input${badPhone ? ' err' : ''}`} value={form.phone}
              onChange={set('phone')} inputMode="tel" required
            />
            {badPhone && <span className="hint">Format: +998XXXXXXXXX</span>}
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={form.email} onChange={set('email')} />
          </div>
        </div>

        <label className="check-row">
          <input
            type="checkbox" checked={form.isActive} disabled={isSelf}
            onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
          />
          <span>
            Faol
            <span className="help">
              {isSelf
                ? "O'zingizni o'chira olmaysiz"
                : "O'chirilgan xodim tizimga kira olmaydi, sessiyalari darhol bekor bo'ladi"}
            </span>
          </span>
        </label>

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

function ResetPasswordModal({ staff, onClose }: { staff: StaffRow; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const reset = useMutation({
    mutationFn: async () =>
      (await api.post(`/users/${staff.id}/reset-password`, { newPassword: password })).data,
    onSuccess: onClose,
  });
  const errMsg = (reset.error as any)?.response?.data?.error;

  return (
    <Modal title={`${staff.full_name} — yangi parol`} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); reset.mutate(); }}>
        <p className="section-hint">
          Xodimning barcha sessiyalari darhol bekor bo'ladi. Yangi parolni unga o'zingiz yetkazasiz.
        </p>
        <div className="field">
          <label>Yangi parol</label>
          <input className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          <span className="help">Kamida 8 belgi</span>
        </div>
        {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
          <button className="btn btn-primary" disabled={password.length < 8 || reset.isPending}>
            {reset.isPending ? 'Saqlanmoqda…' : 'Parolni tiklash'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
