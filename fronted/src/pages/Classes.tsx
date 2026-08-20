import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, money, date } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Chip, EmptyState, ErrorState, Modal, TableSkeleton } from '../components/ui';

interface ClassRow {
  id: string;
  grade: number;
  letter: string;
  name: string;
  monthly_fee: number;
  homeroom_teacher_id: string | null;
  homeroom_teacher: string | null;
  student_count: number;
}
interface YearRow {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_current: boolean;
}
interface TeacherRow { id: string; full_name: string }

export default function Classes() {
  const { user } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [showYears, setShowYears] = useState(false);
  const [editing, setEditing] = useState<ClassRow | null>(null);

  // Superadmin ataylab yo'q: maktab ichidagi o'zgarishlar maktabning o'z ishi.
  const canManage = user?.role === 'admin';

  const years = useQuery({
    queryKey: ['years'],
    queryFn: async () => (await api.get<{ items: YearRow[] }>('/years')).data.items,
  });
  const current = years.data?.find((y) => y.is_current);

  // Joriy o'quv yili bo'lmasa sinflar so'rovi baribir xato qaytaradi —
  // uni umuman yubormaymiz.
  const classes = useQuery({
    queryKey: ['classes'],
    queryFn: async () => (await api.get<{ items: ClassRow[] }>('/classes')).data.items,
    enabled: !!current,
  });

  const teachers = useQuery({
    queryKey: ['users', 'teacher'],
    queryFn: async () => (await api.get<{ items: TeacherRow[] }>('/users?role=teacher')).data.items,
    enabled: canManage,
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Sinflar</h1>
        {current && classes.data && <span className="muted num">{classes.data.length} ta</span>}
        <div className="grow" />
        {current && canManage && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Yangi sinf</button>
        )}
      </div>

      {/* O'quv yili — sinflar shunga bog'lanadi, shuning uchun doim ko'rinib tursin. */}
      <div className="year-bar">
        <span className="muted">O'quv yili</span>
        {years.isPending ? (
          <span className="skeleton" style={{ width: 90 }} />
        ) : current ? (
          <>
            <Chip kind="good">{current.name}</Chip>
            <span className="muted">{date(current.starts_on)} — {date(current.ends_on)}</span>
          </>
        ) : (
          <Chip kind="crit">Belgilanmagan</Chip>
        )}
        <div className="grow" />
        {canManage && (
          <button className="btn btn-secondary sm" onClick={() => setShowYears(true)}>
            O'quv yillari
          </button>
        )}
      </div>

      <div className="card table-wrap">
        {years.isPending ? (
          <TableSkeleton />
        ) : years.isError ? (
          <ErrorState error={years.error} onRetry={() => years.refetch()} />
        ) : !current ? (
          <EmptyState
            icon="🗓"
            title="Joriy o'quv yili belgilanmagan"
            text="Sinf o'quv yiliga bog'lanadi, shuning uchun avval o'quv yilini yarating."
            action={canManage
              ? <button className="btn btn-primary sm" onClick={() => setShowYears(true)}>O'quv yilini yaratish</button>
              : undefined}
          />
        ) : classes.isPending ? (
          <TableSkeleton />
        ) : classes.isError ? (
          <ErrorState error={classes.error} onRetry={() => classes.refetch()} />
        ) : classes.data.length === 0 ? (
          <EmptyState
            icon="▦"
            title="Sinf yo'q"
            text={`${current.name} o'quv yili uchun hali sinf ochilmagan.`}
            action={canManage
              ? <button className="btn btn-primary sm" onClick={() => setShowCreate(true)}>+ Yangi sinf</button>
              : undefined}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Sinf</th><th>Sinf rahbari</th><th>O'quvchi</th><th>Oylik to'lov</th>
                {canManage && <th aria-label="Amallar" />}
              </tr>
            </thead>
            <tbody>
              {classes.data.map((c) => (
                <tr key={c.id}>
                  <td data-label="Sinf"><strong>{c.name}</strong></td>
                  <td data-label="Sinf rahbari">
                    {c.homeroom_teacher ?? <span className="muted">biriktirilmagan</span>}
                  </td>
                  <td data-label="O'quvchi" className="num">{c.student_count}</td>
                  <td data-label="Oylik to'lov" className="num">{money(c.monthly_fee)}</td>
                  {canManage && (
                    <td data-label="Amallar">
                      <button className="btn btn-secondary sm" onClick={() => setEditing(c)}>Tahrirlash</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && current && (
        <ClassModal teachers={teachers.data ?? []} onClose={() => setShowCreate(false)} />
      )}
      {editing && (
        <ClassModal cls={editing} teachers={teachers.data ?? []} onClose={() => setEditing(null)} />
      )}
      {showYears && <YearsModal years={years.data ?? []} onClose={() => setShowYears(false)} />}
    </div>
  );
}

/** Yaratish va tahrirlash bitta forma: farqi faqat sinf raqamida (u o'zgarmaydi). */
function ClassModal({ cls, teachers, onClose }: {
  cls?: ClassRow; teachers: TeacherRow[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    grade: cls ? String(cls.grade) : '1',
    letter: cls?.letter ?? 'A',
    monthlyFee: cls ? String(cls.monthly_fee) : '',
    teacherId: cls?.homeroom_teacher_id ?? '',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async () => {
      const fee = Number(form.monthlyFee);
      if (cls) {
        return (await api.patch(`/classes/${cls.id}`, {
          letter: form.letter.trim(),
          monthlyFee: fee,
          // null yuborilsa rahbar olib tashlanadi; undefined bo'lsa tegilmaydi.
          homeroomTeacherId: form.teacherId || null,
        })).data;
      }
      const body: Record<string, unknown> = {
        grade: Number(form.grade),
        letter: form.letter.trim(),
        monthlyFee: fee,
      };
      if (form.teacherId) body.homeroomTeacherId = form.teacherId;
      return (await api.post('/classes', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classes'] });
      onClose();
    },
  });

  const feeNum = Number(form.monthlyFee);
  const badFee = form.monthlyFee !== '' && (!Number.isFinite(feeNum) || feeNum < 0);
  const errMsg = (save.error as any)?.response?.data?.error;

  return (
    <Modal title={cls ? `${cls.name} sinfi` : 'Yangi sinf'} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!badFee) save.mutate(); }}>
        <div className="form-grid">
          <div className="field">
            <label>Sinf</label>
            <select className="input" value={form.grade} onChange={set('grade')} disabled={!!cls}>
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i} value={String(i)}>{i === 0 ? 'Tayyorlov (0)' : i}</option>
              ))}
            </select>
            {cls && <span className="help">Sinf raqami o'zgarmaydi</span>}
          </div>
          <div className="field">
            <label>Harf</label>
            <input className="input" value={form.letter} onChange={set('letter')} required maxLength={4} />
          </div>
          <div className="field">
            <label>Oylik to'lov</label>
            <input
              className={`input num${badFee ? ' err' : ''}`} value={form.monthlyFee}
              onChange={set('monthlyFee')} inputMode="numeric" required
            />
            {badFee
              ? <span className="hint">Faqat musbat son</span>
              : <span className="help">So'mda, butun son — masalan 1500000</span>}
          </div>
          <div className="field">
            <label>Sinf rahbari</label>
            <select className="input" value={form.teacherId} onChange={set('teacherId')}>
              <option value="">Biriktirilmagan</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
            {teachers.length === 0 && <span className="help">Avval Xodimlar bo'limida o'qituvchi qo'shing</span>}
          </div>
        </div>
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

function YearsModal({ years, onClose }: { years: YearRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(years.length === 0);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['years'] });
    qc.invalidateQueries({ queryKey: ['classes'] });
  };

  const setCurrent = useMutation({
    mutationFn: async (id: string) => (await api.patch(`/years/${id}/set-current`)).data,
    onSuccess: refresh,
  });

  return (
    <Modal title="O'quv yillari" onClose={onClose}>
      {years.length > 0 && (
        <table className="tbl" style={{ marginBottom: 16 }}>
          <tbody>
            {years.map((y) => (
              <tr key={y.id}>
                <td data-label="Yil">
                  <strong>{y.name}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>{date(y.starts_on)} — {date(y.ends_on)}</div>
                </td>
                <td data-label="Holat">
                  {y.is_current ? (
                    <Chip kind="good">Joriy</Chip>
                  ) : (
                    <button
                      className="btn btn-ghost sm" disabled={setCurrent.isPending}
                      onClick={() => setCurrent.mutate(y.id)}
                    >
                      Joriy qilish
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(setCurrent.error as any) && (
        <p className="hint">{(setCurrent.error as any)?.response?.data?.error}</p>
      )}

      {adding
        ? <AddYearForm hasAny={years.length > 0} onDone={() => { refresh(); setAdding(false); }} onCancel={() => setAdding(false)} />
        : (
          <div className="actions">
            <button className="btn btn-secondary" onClick={onClose}>Yopish</button>
            <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Yangi o'quv yili</button>
          </div>
        )}
    </Modal>
  );
}

function AddYearForm({ hasAny, onDone, onCancel }: {
  hasAny: boolean; onDone: () => void; onCancel: () => void;
}) {
  // Taklif: joriy sanadan kelib chiqib. Sentyabrgacha bo'lsa o'tgan yil boshlanadi.
  const now = new Date();
  const startYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const [form, setForm] = useState({
    name: `${startYear}-${startYear + 1}`,
    startsOn: `${startYear}-09-01`,
    endsOn: `${startYear + 1}-05-31`,
    // Birinchi yil bo'lsa joriy qilib qo'yamiz — aks holda sinf yaratib bo'lmaydi.
    isCurrent: !hasAny,
  });
  const set = (k: 'name' | 'startsOn' | 'endsOn') => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: async () => (await api.post('/years', form)).data,
    onSuccess: onDone,
  });

  const badRange = form.endsOn <= form.startsOn;
  const errMsg = (create.error as any)?.response?.data?.error;

  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!badRange) create.mutate(); }}>
      <div className="form-grid">
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Nomi</label>
          <input className="input" value={form.name} onChange={set('name')} required minLength={4} />
        </div>
        <div className="field">
          <label>Boshlanishi</label>
          <input className="input" type="date" value={form.startsOn} onChange={set('startsOn')} required />
        </div>
        <div className="field">
          <label>Tugashi</label>
          <input
            className={`input${badRange ? ' err' : ''}`} type="date"
            value={form.endsOn} onChange={set('endsOn')} required
          />
          {badRange && <span className="hint">Tugash sanasi boshlanishdan keyin bo'lishi kerak</span>}
        </div>
      </div>

      <label className="check-row">
        <input
          type="checkbox" checked={form.isCurrent} disabled={!hasAny}
          onChange={(e) => setForm((f) => ({ ...f, isCurrent: e.target.checked }))}
        />
        <span>
          Joriy o'quv yili
          <span className="help">
            {hasAny
              ? 'Belgilansa, avvalgi joriy yil oddiy yilga aylanadi'
              : 'Birinchi yil — sinf yaratish uchun joriy bo\'lishi shart'}
          </span>
        </span>
      </label>

      {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}
      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Bekor qilish</button>
        <button className="btn btn-primary" disabled={badRange || create.isPending}>
          {create.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
      </div>
    </form>
  );
}
