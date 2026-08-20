import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, downloadFile } from '../lib/api';
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
  const [showImport, setShowImport] = useState(false);
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
          <>
            <button className="btn btn-secondary" onClick={() => setShowImport(true)}>Excel import</button>
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Yangi o'quvchi</button>
          </>
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

      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
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

interface ImportError { row: number; column: string; message: string }

/**
 * Excel import: shablonni yuklab olish -> to'ldirish -> qaytadan yuklash.
 *
 * Server importni atomik bajaradi — bitta qatorda ham xato bo'lsa hech narsa
 * yozilmaydi. Shuning uchun bu yerda "qisman muvaffaqiyat" holati yo'q:
 * yo hammasi kiritiladi, yo xatolar ro'yxati ko'rsatiladi.
 */
function ImportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [tplError, setTplError] = useState<string | null>(null);

  const template = useMutation({
    mutationFn: () => downloadFile('/students/import/template', 'edulive-oquvchilar-shablon.xlsx'),
    onError: () => setTplError("Shablonni yuklab bo'lmadi — qaytadan urinib ko'ring"),
  });

  const send = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file!);
      return (await api.post<{ students: number; parents: number }>('/students/import', form)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['classes'] });
    },
  });

  const err = (send.error as any)?.response?.data;
  const rowErrors: ImportError[] = err?.errors ?? [];

  if (send.data) {
    return (
      <Modal title="Import yakunlandi" onClose={onClose}>
        <p className="save-note" style={{ fontSize: 15 }}>
          ✓ {send.data.students} ta o'quvchi kiritildi
          {send.data.parents > 0 && `, ${send.data.parents} ta ota-ona bog'landi`}
        </p>
        <div className="actions">
          <button className="btn btn-primary" onClick={onClose}>Yopish</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Excel orqali import" onClose={onClose}>
      <ol className="import-steps">
        <li>
          <strong>Shablonni yuklab oling.</strong>
          <p className="muted">
            Sinf va jinsi ustunlari ro'yxatdan tanlanadi — noto'g'ri yozib bo'lmaydi.
          </p>
          <button
            className="btn btn-secondary sm" type="button"
            onClick={() => { setTplError(null); template.mutate(); }}
            disabled={template.isPending}
          >
            {template.isPending ? 'Tayyorlanmoqda…' : 'Shablonni yuklab olish'}
          </button>
          {tplError && <p className="hint">{tplError}</p>}
        </li>
        <li>
          <strong>To'ldiring.</strong>
          <p className="muted">
            Familiya va ism majburiy, qolgani ixtiyoriy. Namuna qatorini o'chirib
            tashlang. Bir faylda 500 tagacha o'quvchi.
          </p>
        </li>
        <li>
          <strong>Faylni qaytaring.</strong>
          <input
            className="input" type="file" accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </li>
      </ol>

      {err && !rowErrors.length && <p className="hint">{err.error}</p>}

      {rowErrors.length > 0 && (
        <div className="import-errors">
          <p className="hint" style={{ marginBottom: 8 }}>{err.error}</p>
          <table className="tbl">
            <thead><tr><th>Qator</th><th>Ustun</th><th>Xato</th></tr></thead>
            <tbody>
              {rowErrors.map((e, i) => (
                <tr key={i}>
                  <td data-label="Qator" className="num">{e.row}</td>
                  <td data-label="Ustun">{e.column}</td>
                  <td data-label="Xato">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
        <button
          className="btn btn-primary" type="button"
          onClick={() => send.mutate()} disabled={!file || send.isPending}
        >
          {send.isPending ? 'Yuklanmoqda…' : 'Import qilish'}
        </button>
      </div>
    </Modal>
  );
}
