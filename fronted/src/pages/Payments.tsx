import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useReadOnly } from '../lib/auth';
import { api, date, money, fmtNum, parseAmount, monthLabel } from '../lib/api';
import { ErrorState, Modal, TableSkeleton } from '../components/ui';

interface StudentRow { id: string; last_name: string; first_name: string; class_name: string | null }
interface PaymentRow {
  id: string; student_name: string; amount: number; provider: string;
  paid_at: string; receipt_no: string | null; received_by: string | null;
}
interface Finance { invoiced: number; paid: number; outstanding: number; advance: number }
interface InvoiceRow {
  id: string; period_month: string; amount: number; discount: number;
  outstanding: number; status: string; due_date: string;
}

const PROVIDERS = [
  { v: 'cash', label: 'Naqd' },
  { v: 'click', label: 'Click' },
  { v: 'payme', label: 'Payme' },
  { v: 'transfer', label: "O'tkazma" },
] as const;

export default function Payments() {
  const [params] = useSearchParams();
  const readOnly = useReadOnly();
  const qc = useQueryClient();
  const [studentId, setStudentId] = useState(params.get('studentId') ?? '');
  const [amount, setAmount] = useState('');
  const [provider, setProvider] = useState<string>('cash');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);

  const students = useQuery({
    queryKey: ['students-all'],
    queryFn: async () =>
      (await api.get<{ items: StudentRow[] }>('/students?limit=200')).data.items,
  });

  // Jonli hisob-kitob: joriy qarz → to'lov → yangi qoldiq (4.4-bo'lim)
  const finance = useQuery({
    queryKey: ['student-finance', studentId],
    queryFn: async () => (await api.get<{ finance: Finance }>(`/students/${studentId}`)).data.finance,
    enabled: !!studentId,
  });

  // To'lanmagan oylar — kassir qaysi oy uchun pul olayotganini belgilaydi.
  const invoices = useQuery({
    queryKey: ['student-invoices', studentId],
    queryFn: async () =>
      (await api.get<{ items: InvoiceRow[] }>(`/invoices?studentId=${studentId}&limit=50`)).data.items,
    enabled: !!studentId,
  });
  const unpaid = useMemo(
    () => (invoices.data ?? [])
      .filter((i) => i.status !== 'paid' && i.status !== 'void' && i.outstanding > 0)
      .sort((a, b) => a.period_month.localeCompare(b.period_month)),
    [invoices.data],
  );

  const paymentsToday = useQuery({
    queryKey: ['payments-log'],
    queryFn: async () =>
      (await api.get<{ items: PaymentRow[] }>('/payments?limit=20')).data.items,
  });

  // Oy belgilansa summa o'zi to'ladi; kassir uni keyin qo'lda o'zgartirishi mumkin
  // (qisman to'lov). Tanlov tartibi saqlanadi — pul shu tartibda yoziladi.
  const togglePicked = (inv: InvoiceRow) => {
    setPicked((prev) => {
      const next = prev.includes(inv.id) ? prev.filter((x) => x !== inv.id) : [...prev, inv.id];
      const sum = unpaid.filter((i) => next.includes(i.id)).reduce((s, i) => s + i.outstanding, 0);
      setAmount(sum ? fmtNum(String(Math.round(sum))) : '');
      return next;
    });
  };

  const amountNum = useMemo(() => parseAmount(amount), [amount]);
  const newBalance = (finance.data?.outstanding ?? 0) - amountNum;

  const pay = useMutation({
    mutationFn: async () =>
      (await api.post('/payments', {
        studentId, amount: amountNum, provider, note: note.trim() || undefined,
        // Bo'sh bo'lsa backend eng eski qarzdan boshlab o'zi taqsimlaydi.
        invoiceIds: picked.length ? picked : undefined,
      })).data,
    onSuccess: (data) => {
      setConfirmOpen(false);
      setLastReceipt(data.payment.receipt_no);
      setAmount(''); setNote(''); setPicked([]);
      qc.invalidateQueries({ queryKey: ['payments-log'] });
      qc.invalidateQueries({ queryKey: ['student-finance', studentId] });
      qc.invalidateQueries({ queryKey: ['student-invoices', studentId] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const generate = useMutation({
    mutationFn: async () => {
      const month = new Date().toISOString().slice(0, 7);
      return (await api.post('/invoices/generate', { periodMonth: month })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['student-finance'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (studentId && amountNum > 0) setConfirmOpen(true);
  };

  const selStudent = students.data?.find((s) => s.id === studentId);
  const errMsg = (pay.error as any)?.response?.data?.error;

  return (
    <div className="page">
      <div className="page-head">
        <h1>To'lovlar</h1>
        <div className="grow" />
        {!readOnly && (
          <>
            <button className="btn btn-secondary sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
              {generate.isPending ? 'Chiqarilmoqda…' : 'Oylik hisoblarni chiqarish'}
            </button>
            {generate.data && (
              <span className="save-note">{generate.data.created} ta yangi hisob</span>
            )}
          </>
        )}
      </div>

      <div className="pay-grid">
        {readOnly ? (
          <div className="card card-pad">
            <h2>To'lov qabul qilish</h2>
            <p className="muted" style={{ marginTop: 8 }}>
              Ko'rish rejimi — to'lovni maktab xodimlari qabul qiladi.
            </p>
          </div>
        ) : (
        <form className="card card-pad" onSubmit={submit}>
          <h2>To'lov qabul qilish</h2>
          <div className="form-grid">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>O'quvchi</label>
              <select
                className="input" value={studentId} required
                onChange={(e) => { setStudentId(e.target.value); setPicked([]); setAmount(''); }}
              >
                <option value="">Tanlang…</option>
                {students.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.last_name} {s.first_name}{s.class_name ? ` · ${s.class_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {studentId && (
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label>Qaysi oy uchun</label>
                {invoices.isPending ? (
                  <span className="skeleton" style={{ width: '60%' }} />
                ) : unpaid.length === 0 ? (
                  <span className="help">
                    To'lanmagan oy yo'q — kiritilgan summa avans bo'lib qoladi va
                    keyingi hisob chiqarilganda hisobga olinadi.
                  </span>
                ) : (
                  <>
                    <div className="month-picks">
                      {unpaid.map((i) => (
                        <label key={i.id} className={`month-pick${picked.includes(i.id) ? ' on' : ''}`}>
                          <input
                            type="checkbox" checked={picked.includes(i.id)}
                            onChange={() => togglePicked(i)}
                          />
                          <span className="m">{monthLabel(i.period_month)}</span>
                          <span className="num">{money(i.outstanding)}</span>
                        </label>
                      ))}
                    </div>
                    <span className="help">
                      Belgilamasangiz pul eng eski qarzdan boshlab avtomatik taqsimlanadi.
                    </span>
                  </>
                )}
              </div>
            )}
            <div className="field">
              <label>Summa (so'm)</label>
              <input
                className="input num" value={amount} inputMode="numeric" required
                onChange={(e) => setAmount(fmtNum(e.target.value))} placeholder="1 200 000"
              />
            </div>
            <div className="field">
              <label>Usul</label>
              <select className="input" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {PROVIDERS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
              </select>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Izoh (ixtiyoriy)</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          {errMsg && <p className="hint" style={{ marginTop: 10 }}>{errMsg}</p>}
          {lastReceipt && (
            <p className="save-note" style={{ marginTop: 10 }}>To'lov qabul qilindi ✓ Kvitansiya: {lastReceipt}</p>
          )}
          <div className="actions" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-primary" disabled={!studentId || amountNum <= 0}>Davom etish</button>
          </div>
        </form>
        )}

        <div className="card card-pad">
          <h2>Hisob-kitob</h2>
          {!studentId ? (
            <p className="muted">O'quvchini tanlang — joriy qarz shu yerda ko'rinadi.</p>
          ) : finance.isPending ? (
            <div className="skeleton" style={{ width: '70%', height: 22 }} />
          ) : finance.isError ? (
            <ErrorState error={finance.error} onRetry={() => finance.refetch()} />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <div className="muted">Joriy qarz</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 600 }}>{money(finance.data.outstanding)}</div>
              </div>
              {finance.data.advance > 0 && (
                /* Hisobga bog'lanmagan pul — hisob chiqarilgach o'zi yopiladi.
                   Ko'rsatilmasa, to'langan pul ekranda yo'qolgandek tuyulardi. */
                <div>
                  <div className="muted">Avans (hisobga bog'lanmagan)</div>
                  <div className="num" style={{ fontSize: 18, fontWeight: 600, color: 'var(--good-ink)' }}>
                    {money(finance.data.advance)}
                  </div>
                  <span className="help">Keyingi hisob chiqarilganda avtomatik yopiladi</span>
                </div>
              )}
              <div>
                <div className="muted">To'lov</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 600 }}>− {money(amountNum)}</div>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div className="muted">Yangi qoldiq</div>
                <div className="num" style={{ fontSize: 24, fontWeight: 600 }}>
                  {newBalance < 0 ? `${money(-newBalance)} avans` : money(newBalance)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-pad" style={{ paddingBottom: 0 }}><h2>Oxirgi to'lovlar</h2></div>
        {paymentsToday.isPending ? (
          <TableSkeleton rows={4} />
        ) : paymentsToday.isError ? (
          <ErrorState error={paymentsToday.error} onRetry={() => paymentsToday.refetch()} />
        ) : paymentsToday.data.length === 0 ? (
          <p className="muted" style={{ padding: '12px 20px 20px' }}>Hali to'lov qabul qilinmagan.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>O'quvchi</th><th>Summa</th><th>Usul</th><th>Sana</th><th>Kvitansiya</th><th>Qabul qildi</th></tr></thead>
            <tbody>
              {paymentsToday.data.map((p) => (
                <tr key={p.id}>
                  <td data-label="O'quvchi"><strong>{p.student_name}</strong></td>
                  <td data-label="Summa" className="num">{money(p.amount)}</td>
                  <td data-label="Usul">{PROVIDERS.find((x) => x.v === p.provider)?.label ?? p.provider}</td>
                  <td data-label="Sana">{date(p.paid_at)}</td>
                  <td data-label="Kvitansiya" className="num">{p.receipt_no}</td>
                  <td data-label="Qabul qildi">{p.received_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {confirmOpen && selStudent && (
        <Modal title="To'lovni tasdiqlash" onClose={() => setConfirmOpen(false)}>
          {/* Moliyaviy tasdiq — summa KATTA shriftda takrorlanadi (4.4-bo'lim) */}
          <p className="muted">{selStudent.last_name} {selStudent.first_name} uchun</p>
          <div className="big-sum num" style={{ margin: '8px 0 4px' }}>{money(amountNum)}</div>
          <p className="muted">
            {PROVIDERS.find((x) => x.v === provider)?.label} · yangi qoldiq:{' '}
            <strong className="num">{newBalance < 0 ? `${money(-newBalance)} avans` : money(newBalance)}</strong>
          </p>
          <div className="actions">
            <button className="btn btn-secondary" onClick={() => setConfirmOpen(false)}>Bekor qilish</button>
            <button className="btn btn-primary" onClick={() => pay.mutate()} disabled={pay.isPending}>
              {pay.isPending ? 'Saqlanmoqda…' : 'To\'lovni qabul qilish'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
