import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useReadOnly } from '../lib/auth';
import { api, date, money } from '../lib/api';
import { ErrorState, TableSkeleton, initials, invoiceChip } from '../components/ui';

interface CardData {
  student: {
    id: string; last_name: string; first_name: string; middle_name: string | null;
    birth_date: string | null; status: string;
    class_id: string | null; class_name: string | null;
    monthly_fee: number | null; discount_percent: number | null; discount_reason: string | null;
  };
  parents: Array<{ id: string; full_name: string; phone: string; relation: string | null; is_primary: boolean }>;
  finance: { invoiced: number; paid: number; outstanding: number };
}
interface InvoiceRow {
  id: string; period_month: string; amount: number; discount: number;
  due_date: string; status: string; paid: number; outstanding: number;
}

const REL: Record<string, string> = { father: 'Otasi', mother: 'Onasi', guardian: 'Vasiy' };

export default function StudentCard() {
  const { id } = useParams<{ id: string }>();
  const readOnly = useReadOnly();
  const navigate = useNavigate();

  const card = useQuery({
    queryKey: ['student', id],
    queryFn: async () => (await api.get<CardData>(`/students/${id}`)).data,
  });

  const invoices = useQuery({
    queryKey: ['invoices', id],
    queryFn: async () => (await api.get<{ items: InvoiceRow[] }>(`/invoices?studentId=${id}`)).data.items,
    enabled: !!card.data,
  });

  if (card.isPending) {
    return <div className="page"><div className="card"><TableSkeleton /></div></div>;
  }
  if (card.isError) {
    return <div className="page"><div className="card"><ErrorState error={card.error} onRetry={() => card.refetch()} /></div></div>;
  }

  const s = card.data.student;
  const fullName = `${s.last_name} ${s.first_name}`;

  return (
    <div className="page">
      <div className="page-head">
        <button className="btn btn-ghost sm" onClick={() => navigate(-1)}>← Orqaga</button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="avatar" style={{ width: 48, height: 48, fontSize: 16 }}>{initials(fullName)}</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 20, fontWeight: 600 }}>{fullName}</div>
            <div className="muted">
              {s.class_name ?? 'Sinfga biriktirilmagan'}
              {s.birth_date && <> · {date(s.birth_date)}</>}
              {s.monthly_fee != null && <> · <span className="num">{money(s.monthly_fee)}/oy</span></>}
              {(s.discount_percent ?? 0) > 0 && <> · chegirma {s.discount_percent}% ({s.discount_reason})</>}
            </div>
          </div>
          {!readOnly && (
            <Link to={`/payments?studentId=${s.id}`} className="btn btn-primary">To'lov qabul qilish</Link>
          )}
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="card stat-tile">
          <div className="label">Hisoblangan</div>
          <div className="value num" style={{ fontSize: 24 }}>{money(card.data.finance.invoiced)}</div>
        </div>
        <div className="card stat-tile">
          <div className="label">To'langan</div>
          <div className="value num" style={{ fontSize: 24 }}>{money(card.data.finance.paid)}</div>
        </div>
        <div className="card stat-tile">
          <div className="label">Qoldiq qarz</div>
          <div className="value num" style={{ fontSize: 24 }}>{money(card.data.finance.outstanding)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Oylik hisoblar</h2></div>
        {invoices.isPending ? (
          <TableSkeleton rows={3} />
        ) : invoices.isError ? (
          <ErrorState error={invoices.error} onRetry={() => invoices.refetch()} />
        ) : invoices.data.length === 0 ? (
          <p className="muted" style={{ padding: '12px 20px 20px' }}>
            Hisoblar hali chiqarilmagan — To'lovlar sahifasidagi "Oylik hisoblarni chiqarish" tugmasidan foydalaning.
          </p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Oy</th><th>Summa</th><th>To'langan</th><th>Qoldiq</th><th>Muddat</th><th>Holat</th></tr></thead>
            <tbody>
              {invoices.data.map((i) => (
                <tr key={i.id}>
                  <td data-label="Oy">{String(i.period_month).slice(0, 7)}</td>
                  <td data-label="Summa" className="num">{money(i.amount - i.discount)}</td>
                  <td data-label="To'langan" className="num">{money(i.paid)}</td>
                  <td data-label="Qoldiq" className="num"><strong>{money(i.outstanding)}</strong></td>
                  <td data-label="Muddat">{date(i.due_date)}</td>
                  <td data-label="Holat">{invoiceChip(i.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card card-pad">
        <h2>Ota-onalar</h2>
        {card.data.parents.length === 0 ? (
          <p className="muted">Ota-ona qo'shilmagan.</p>
        ) : (
          card.data.parents.map((p) => (
            <div key={p.id} className="row" style={{ padding: '8px 0' }}>
              <span className="avatar">{initials(p.full_name)}</span>
              <div>
                <strong>{p.full_name}</strong>{' '}
                {p.is_primary && <span className="chip neutral">asosiy</span>}
                <div className="muted">{p.relation ? REL[p.relation] : ''} · <span className="num">{p.phone}</span></div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
