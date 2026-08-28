import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, date } from '../lib/api';
import { Chip, EmptyState, ErrorState, TableSkeleton } from '../components/ui';

interface Row {
  id: string; kind: string; status: string; body: string | null;
  error: string | null; attempts: number;
  created_at: string; sent_at: string | null;
  parent_name: string | null; parent_phone: string | null; student_name: string | null;
}

type Status = 'all' | 'queued' | 'sent' | 'failed';

const KIND_LABEL: Record<string, string> = {
  'payment.received': "To'lov qabul qilindi",
  'attendance.absent': 'Darsga kelmadi',
  'attendance.present': 'Darsga keldi',
  'debt.reminder': 'Qarz eslatmasi',
};

/** Rang yolg'iz ma'no tashimaydi — har doim ikonka + so'z. */
function statusChip(s: string) {
  if (s === 'sent') return <Chip kind="good">Yuborildi</Chip>;
  if (s === 'queued') return <Chip kind="neutral">Navbatda</Chip>;
  if (s === 'failed') return <Chip kind="crit">Yuborilmadi</Chip>;
  return <Chip kind="neutral">{s}</Chip>;
}

export default function Notifications() {
  const [status, setStatus] = useState<Status>('all');
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['notifications', status],
    queryFn: async () =>
      (
        await api.get<{ items: Row[]; total: number; counts: Record<string, number> }>(
          '/notifications',
          { params: status === 'all' ? {} : { status } },
        )
      ).data,
  });

  const retry = useMutation({
    mutationFn: async (id: string) => (await api.post(`/notifications/${id}/retry`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const counts = q.data?.counts ?? {};

  return (
    <div className="page">
      <div className="page-head">
        <h1>Xabarlar</h1>
        {q.data && (
          <span className="muted">
            {counts.sent ?? 0} yuborildi · {counts.queued ?? 0} navbatda · {counts.failed ?? 0} xato
          </span>
        )}
      </div>

      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        {(['all', 'sent', 'queued', 'failed'] as Status[]).map((s) => (
          <button
            key={s}
            className={`btn ${status === s ? 'btn-primary' : 'btn-secondary'} sm`}
            onClick={() => setStatus(s)}
          >
            {s === 'all' ? 'Hammasi' : s === 'sent' ? 'Yuborilgan' : s === 'queued' ? 'Navbatda' : 'Xato'}
          </button>
        ))}
      </div>

      <div className="card table-wrap">
        {q.isPending ? (
          <TableSkeleton />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data.items.length === 0 ? (
          <EmptyState
            icon="✉"
            title="Xabar yo'q"
            text={
              status === 'all'
                ? "To'lov qabul qilinganda ota-onaga avtomatik xabar ketadi. Buning uchun maktabga Telegram bot ulangan va ota-ona botda ro'yxatdan o'tgan bo'lishi kerak."
                : 'Bu holatda xabar yo‘q.'
            }
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Vaqt</th><th>Kimga</th><th>Turi</th><th>Matn</th><th>Holat</th><th></th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((n) => (
                <tr key={n.id}>
                  <td data-label="Vaqt" className="num">{date(n.sent_at ?? n.created_at)}</td>
                  <td data-label="Kimga">
                    {n.parent_name ?? '—'}
                    {n.student_name && <div className="muted">{n.student_name}</div>}
                  </td>
                  <td data-label="Turi">{KIND_LABEL[n.kind] ?? n.kind}</td>
                  <td data-label="Matn" style={{ whiteSpace: 'pre-line', maxWidth: '28rem' }}>
                    {n.body ?? '—'}
                  </td>
                  <td data-label="Holat">
                    {statusChip(n.status)}
                    {n.error && <div className="muted">{n.error}</div>}
                  </td>
                  <td data-label="">
                    {n.status === 'failed' && (
                      <button
                        className="btn btn-secondary sm"
                        onClick={() => retry.mutate(n.id)}
                        disabled={retry.isPending}
                      >
                        Qayta yuborish
                      </button>
                    )}
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
