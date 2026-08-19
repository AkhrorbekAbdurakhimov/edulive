import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, date, money } from '../lib/api';
import { Chip, EmptyState, ErrorState, TableSkeleton } from '../components/ui';

interface DebtorRow {
  student_id: string; student_name: string; class_name: string | null;
  outstanding: number; overdue: number; oldest_due: string | null;
  parent_name: string | null; parent_phone: string | null;
}

/** Muddati o'tgan davr — xavf darajasi. Rang HAR DOIM ikonka + so'z bilan. */
function riskChip(oldestDue: string | null) {
  if (!oldestDue) return <Chip kind="neutral">Muddat kelmagan</Chip>;
  const months = Math.floor((Date.now() - new Date(oldestDue).getTime()) / (30 * 24 * 3600 * 1000));
  if (months >= 3) return <Chip kind="crit">{months} oy</Chip>;
  if (months >= 2) return <Chip kind="serious">{months} oy</Chip>;
  if (months >= 1) return <Chip kind="warn">{months} oy</Chip>;
  return <Chip kind="warn">1 oydan kam</Chip>;
}

export default function Debtors() {
  const q = useQuery({
    queryKey: ['debtors'],
    queryFn: async () =>
      (await api.get<{ items: DebtorRow[]; total: number; totalOutstanding: number }>('/debtors')).data,
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Qarzdorlar</h1>
        {q.data && (
          <span className="muted">
            {q.data.total} o'quvchi · jami <strong className="num">{money(q.data.totalOutstanding)}</strong>
          </span>
        )}
      </div>

      <div className="card table-wrap">
        {q.isPending ? (
          <TableSkeleton />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState
            icon="✓"
            title="Qarzdor yo'q"
            text="Barcha hisoblar to'langan yoki hisoblar hali chiqarilmagan."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>F.I.Sh</th><th>Sinf</th><th className="right">Qarz</th>
                <th>Muddati o'tgan</th><th>Eng eski muddat</th><th>Ota-ona</th><th></th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((d) => (
                <tr key={d.student_id}>
                  <td data-label="F.I.Sh">
                    <Link to={`/students/${d.student_id}`}><strong>{d.student_name}</strong></Link>
                  </td>
                  <td data-label="Sinf">{d.class_name ?? '—'}</td>
                  <td data-label="Qarz" className="right num"><strong>{money(d.outstanding)}</strong></td>
                  <td data-label="Muddati">{riskChip(d.oldest_due)}</td>
                  <td data-label="Eng eski muddat">{d.oldest_due ? date(d.oldest_due) : '—'}</td>
                  <td data-label="Ota-ona">
                    {d.parent_name
                      ? <>{d.parent_name}<div className="muted num">{d.parent_phone}</div></>
                      : <span className="muted">qo'shilmagan</span>}
                  </td>
                  <td data-label="">
                    <button
                      className="btn btn-secondary sm"
                      title="Telegram bot ulangach ishlaydi (2-bosqich)"
                      disabled
                    >
                      Eslatma yuborish
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
