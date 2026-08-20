import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { EmptyState, ErrorState, Modal, TableSkeleton } from '../components/ui';
import { useReadOnly } from '../lib/auth';

interface StudentRow {
  id: string;
  last_name: string;
  first_name: string;
  class_id: string | null;
  class_name: string | null;
  status: string;
}
interface ClassRow { id: string; name: string; student_count: number }

export default function Students() {
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const readOnly = useReadOnly();
  const navigate = useNavigate();

  const classes = useQuery({
    queryKey: ['classes'],
    queryFn: async () => (await api.get<{ items: ClassRow[] }>('/classes')).data.items,
  });

  const students = useQuery({
    queryKey: ['students', q, classId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (classId) params.set('classId', classId);
      params.set('limit', '100');
      return (await api.get<{ items: StudentRow[]; total: number }>(`/students?${params}`)).data;
    },
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>O'quvchilar</h1>
        {students.data && <span className="muted num">{students.data.total} ta</span>}
        <div className="grow" />
        {!readOnly && (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Yangi o'quvchi</button>
        )}
      </div>

      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="input" placeholder="Ism yoki familiya bo'yicha qidirish…"
          value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }}
        />
        <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Barcha sinflar</option>
          {classes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      <div className="card table-wrap">
        {students.isPending ? (
          <TableSkeleton />
        ) : students.isError ? (
          <ErrorState error={students.error} onRetry={() => students.refetch()} />
        ) : students.data.items.length === 0 ? (
          <EmptyState
            title="O'quvchi topilmadi"
            text={q || classId ? "Filtrni o'zgartirib ko'ring" : "Birinchi o'quvchini qo'shing"}
            action={readOnly ? undefined : <button className="btn btn-primary sm" onClick={() => setShowCreate(true)}>+ Yangi o'quvchi</button>}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>F.I.Sh</th><th>Sinf</th><th>Holat</th></tr>
            </thead>
            <tbody>
              {students.data.items.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => navigate(`/students/${s.id}`)}>
                  <td data-label="F.I.Sh"><strong>{s.last_name} {s.first_name}</strong></td>
                  <td data-label="Sinf">{s.class_name ?? <span className="muted">biriktirilmagan</span>}</td>
                  <td data-label="Holat">{s.status === 'active' ? 'Faol' : s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateStudentModal
          classes={classes.data ?? []}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}

function CreateStudentModal({ classes, onClose }: { classes: ClassRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    lastName: '', firstName: '', classId: '', parentName: '', parentPhone: '+998', relation: 'father',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: async () => {
      const body: any = {
        lastName: form.lastName.trim(),
        firstName: form.firstName.trim(),
        classId: form.classId || undefined,
      };
      if (form.parentName.trim()) {
        body.parent = { fullName: form.parentName.trim(), phone: form.parentPhone.trim(), relation: form.relation };
      }
      return (await api.post('/students', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      onClose();
    },
  });

  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  const errMsg = (create.error as any)?.response?.data?.error;

  return (
    <Modal title="Yangi o'quvchi" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label>Familiya</label>
            <input className="input" value={form.lastName} onChange={set('lastName')} required minLength={2} />
          </div>
          <div className="field">
            <label>Ism</label>
            <input className="input" value={form.firstName} onChange={set('firstName')} required minLength={2} />
          </div>
          <div className="field">
            <label>Sinf</label>
            <select className="input" value={form.classId} onChange={set('classId')}>
              <option value="">Keyin biriktiriladi</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Ota-ona (ixtiyoriy)</label>
            <input className="input" value={form.parentName} onChange={set('parentName')} placeholder="F.I.Sh" />
          </div>
          {form.parentName.trim() && (
            <>
              <div className="field">
                <label>Ota-ona telefoni</label>
                <input className="input" value={form.parentPhone} onChange={set('parentPhone')} inputMode="tel" />
              </div>
              <div className="field">
                <label>Kim bo'ladi</label>
                <select className="input" value={form.relation} onChange={set('relation')}>
                  <option value="father">Otasi</option>
                  <option value="mother">Onasi</option>
                  <option value="guardian">Vasiy</option>
                </select>
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
