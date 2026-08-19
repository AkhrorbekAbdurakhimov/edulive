import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { EmptyState, ErrorState, Modal, TableSkeleton, initials } from '../components/ui';

type Status = 'present' | 'absent' | 'late';

interface ClassRow { id: string; name: string; student_count: number }
interface ClassStudent { id: string; last_name: string; first_name: string }
interface SessionView {
  session: {
    id: string; confirmed_at: string | null;
    total_count: number; present_count: number; absent_count: number; late_count: number;
  } | null;
  items: Array<{ student_id: string; last_name: string; first_name: string; status: Status; minutes_late: number | null }>;
}

const today = () => new Date().toISOString().slice(0, 10);
const NEXT: Record<Status, Status> = { present: 'absent', absent: 'late', late: 'present' };

export default function Attendance() {
  const [classId, setClassId] = useState('');
  const [onDate, setOnDate] = useState(today());

  const classes = useQuery({
    queryKey: ['classes'],
    queryFn: async () => (await api.get<{ items: ClassRow[] }>('/classes')).data.items,
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Davomat</h1>
        <div className="grow" />
        <input type="date" className="input" value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Sinfni tanlang</option>
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>{c.name} · {c.student_count} o'quvchi</option>
          ))}
        </select>
      </div>

      {classes.isError ? (
        <div className="card"><ErrorState error={classes.error} onRetry={() => classes.refetch()} /></div>
      ) : !classId ? (
        <div className="card">
          <EmptyState
            icon="✓"
            title="Sinf tanlanmagan"
            text="Davomat olish uchun yuqoridan sinfni tanlang. Sukut bo'yicha hamma «Keldi» — faqat kelmaganlarni belgilaysiz."
          />
        </div>
      ) : (
        <TakePanel key={`${classId}:${onDate}`} classId={classId} onDate={onDate} />
      )}
    </div>
  );
}

function TakePanel({ classId, onDate }: { classId: string; onDate: string }) {
  const qc = useQueryClient();
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // Mavjud sessiya — tahrir rejimi uchun boshlang'ich holat
  const view = useQuery({
    queryKey: ['attendance', classId, onDate],
    queryFn: async () =>
      (await api.get<SessionView>(`/attendance?classId=${classId}&date=${onDate}`)).data,
  });

  const roster = useQuery({
    queryKey: ['class-roster', classId],
    queryFn: async () =>
      (await api.get<{ students: ClassStudent[] }>(`/classes/${classId}`)).data.students,
    enabled: !!view.data && view.data.session === null,
  });

  // Ro'yxat: sessiya bo'lsa undan, bo'lmasa sinf ro'yxatidan (hammasi 'present')
  const students = useMemo<Array<ClassStudent & { initial: Status }>>(() => {
    if (view.data?.session) {
      return view.data.items.map((i) => ({
        id: i.student_id, last_name: i.last_name, first_name: i.first_name, initial: i.status,
      }));
    }
    return (roster.data ?? []).map((s) => ({ ...s, initial: 'present' as Status }));
  }, [view.data, roster.data]);

  const statusOf = (id: string, initial: Status): Status => marks[id] ?? initial;

  const counts = useMemo(() => {
    let present = 0, absent = 0, late = 0;
    for (const s of students) {
      const st = statusOf(s.id, s.initial);
      if (st === 'absent') absent++;
      else if (st === 'late') late++;
      else present++;
    }
    return { total: students.length, present, absent, late };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, marks]);

  const take = useMutation({
    mutationFn: async () => {
      const markList = students
        .map((s) => ({ studentId: s.id, status: statusOf(s.id, s.initial) }))
        .filter((m) => m.status !== 'present') // 5-qoida: faqat istisnolar yuboriladi
        .map((m) => (m.status === 'late' ? { ...m, minutesLate: 0 } : m));
      return (await api.post('/attendance/take', { classId, date: onDate, marks: markList })).data;
    },
    onSuccess: () => {
      setSavedNote('Saqlandi ✓');
      setTimeout(() => setSavedNote(null), 2000);
      qc.invalidateQueries({ queryKey: ['attendance', classId, onDate] });
      setMarks({});
    },
  });

  const confirm = useMutation({
    mutationFn: async () => {
      // Avval oxirgi holat saqlanadi, keyin tasdiqlanadi
      const takeRes = await api.post('/attendance/take', {
        classId, date: onDate,
        marks: students
          .map((s) => ({ studentId: s.id, status: statusOf(s.id, s.initial) }))
          .filter((m) => m.status !== 'present')
          .map((m) => (m.status === 'late' ? { ...m, minutesLate: 0 } : m)),
      });
      return (await api.post(`/attendance/${takeRes.data.sessionId}/confirm`)).data;
    },
    onSuccess: () => {
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ['attendance', classId, onDate] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setMarks({});
    },
  });

  if (view.isPending || (view.data?.session === null && roster.isPending)) {
    return <div className="card"><TableSkeleton rows={6} /></div>;
  }
  if (view.isError) {
    return <div className="card"><ErrorState error={view.error} onRetry={() => view.refetch()} /></div>;
  }
  if (students.length === 0) {
    return (
      <div className="card">
        <EmptyState title="Sinfda faol o'quvchi yo'q" text="Avval o'quvchilarni sinfga biriktiring." />
      </div>
    );
  }

  const confirmed = !!view.data?.session?.confirmed_at;
  const errMsg = (take.error as any)?.response?.data?.error ?? (confirm.error as any)?.response?.data?.error;

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row card-pad" style={{ paddingBottom: 12, flexWrap: 'wrap' }}>
          <strong className="num">Jami {counts.total}</strong>
          <span className="chip good">✓ Keldi {counts.present}</span>
          <span className="chip crit">✕ Kelmadi {counts.absent}</span>
          <span className="chip warn">◔ Kech {counts.late}</span>
          <div className="grow" style={{ flex: 1 }} />
          {confirmed && <span className="chip neutral">Tasdiqlangan — tahrir 3 soat ichida</span>}
          {savedNote && <span className="save-note">{savedNote}</span>}
        </div>

        <div>
          {students.map((s) => {
            const st = statusOf(s.id, s.initial);
            return (
              <div className="att-row" key={s.id}>
                <span className="avatar">{initials(`${s.last_name} ${s.first_name}`)}</span>
                <span className="name">{s.last_name} {s.first_name}</span>
                <div className="att-seg" role="group" aria-label="Davomat holati">
                  <button
                    className={st === 'present' ? 'on-present' : st === 'absent' ? 'on-absent' : 'on-late'}
                    onClick={() => setMarks((m) => ({ ...m, [s.id]: NEXT[st] }))}
                    title="Bosib holatni almashtiring"
                  >
                    {st === 'present' ? '✓ Keldi' : st === 'absent' ? '✕ Kelmadi' : '◔ Kech qoldi'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {errMsg && <p className="hint" style={{ marginBottom: 12 }}>{errMsg}</p>}

      <div className="row">
        <button className="btn btn-secondary" onClick={() => take.mutate()} disabled={take.isPending}>
          {take.isPending ? 'Saqlanmoqda…' : 'Saqlash (tasdiqlamasdan)'}
        </button>
        {!confirmed && (
          <button className="btn btn-primary" onClick={() => setConfirmOpen(true)}>
            Tasdiqlash
          </button>
        )}
      </div>

      {confirmOpen && (
        <Modal title="Davomatni tasdiqlash" onClose={() => setConfirmOpen(false)}>
          <p style={{ marginBottom: 8 }}>
            Jami <strong className="num">{counts.total}</strong> · Keldi{' '}
            <strong className="num">{counts.present}</strong> · Kelmadi{' '}
            <strong className="num">{counts.absent}</strong> · Kech qoldi{' '}
            <strong className="num">{counts.late}</strong>
          </p>
          <p className="muted">
            Tasdiqlangach kelmagan va kech qolgan o'quvchilarning ota-onalariga xabar yuboriladi.
          </p>
          <div className="actions">
            <button className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>Bekor qilish</button>
            <button className="btn btn-primary" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
              {confirm.isPending ? 'Tasdiqlanmoqda…' : 'Tasdiqlash va yuborish'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
