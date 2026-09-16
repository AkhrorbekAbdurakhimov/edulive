import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, date, money } from '../lib/api';
import { Chip, EmptyState, ErrorState, Modal, TableSkeleton } from '../components/ui';

interface DebtorRow {
  student_id: string; student_name: string; class_name: string | null;
  outstanding: number; overdue: number; oldest_due: string | null;
  parent_name: string | null; parent_phone: string | null;
}

interface RemindResult { queued: number; telegram: number; sms: number }

interface BulkResult {
  students: number; skipped: number; noContact: number; telegram: number; sms: number;
}

interface SmsPreview {
  enabled: boolean; example: string; parts: number; unicode: boolean;
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

/** "Telegram: 1 · SMS: 2" — qaysi kanaldan ketgani aytiladi: SMS pullik. */
function channels(r: { telegram: number; sms: number }): string {
  const parts = [];
  if (r.telegram) parts.push(`Telegram: ${r.telegram}`);
  if (r.sms) parts.push(`SMS: ${r.sms}`);
  return parts.join(' · ');
}

export default function Debtors() {
  // Qaysi o'quvchiga eslatma ketgani/xatosi — qatorning o'zida ko'rinadi.
  const [note, setNote] = useState<Record<string, string>>({});
  // Tanlanganlar. Bo'sh bo'lsa "hammaga" degani.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const q = useQuery({
    queryKey: ['debtors'],
    queryFn: async () =>
      (await api.get<{ items: DebtorRow[]; total: number; totalOutstanding: number }>('/debtors')).data,
  });

  const remind = useMutation({
    mutationFn: async (studentId: string) =>
      (await api.post(`/debtors/${studentId}/remind`)).data as RemindResult,
    onSuccess: (d, id) =>
      setNote((n) => ({ ...n, [id]: `✓ Yuborildi — ${channels(d) || d.queued}` })),
    onError: (e: unknown, id) =>
      setNote((n) => ({
        ...n,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [id]: `✕ ${(e as any)?.response?.data?.error ?? 'Yuborilmadi'}`,
      })),
  });

  const rows = q.data?.items ?? [];
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.student_id));

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.student_id)));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Qarzdorlar</h1>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          {q.data && (
            <span className="muted">
              {q.data.total} o'quvchi · jami <strong className="num">{money(q.data.totalOutstanding)}</strong>
            </span>
          )}
          {rows.length > 0 && (
            <button className="btn btn-primary sm" onClick={() => setBulkOpen(true)}>
              {picked.size > 0 ? `Tanlanganlarga eslatma (${picked.size})` : 'Hammaga eslatma'}
            </button>
          )}
        </div>
      </div>

      {bulkOpen && (
        <BulkRemind
          studentIds={picked.size > 0 ? [...picked] : null}
          onClose={(sent) => {
            setBulkOpen(false);
            if (sent) setPicked(new Set());
            q.refetch();
          }}
        />
      )}

      <div className="card table-wrap">
        {q.isPending ? (
          <TableSkeleton />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="✓"
            title="Qarzdor yo'q"
            text="Barcha hisoblar to'langan yoki hisoblar hali chiqarilmagan."
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th className="pick-col">
                  <input
                    type="checkbox" checked={allPicked} onChange={toggleAll}
                    aria-label="Hammasini tanlash"
                  />
                </th>
                <th>F.I.Sh</th><th>Sinf</th><th className="right">Qarz</th>
                <th>Muddati o'tgan</th><th>Eng eski muddat</th><th>Ota-ona</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.student_id}>
                  <td data-label="" className="pick-col">
                    <input
                      type="checkbox"
                      checked={picked.has(d.student_id)}
                      onChange={() => toggle(d.student_id)}
                      aria-label={`${d.student_name} — tanlash`}
                    />
                  </td>
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
                      onClick={() => remind.mutate(d.student_id)}
                      disabled={remind.isPending && remind.variables === d.student_id}
                    >
                      Eslatma yuborish
                    </button>
                    {note[d.student_id] && <div className="muted">{note[d.student_id]}</div>}
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

/**
 * Ko'pchilikka eslatma — tanlanganlarga yoki butun ro'yxatga.
 *
 * Nega tasdiqlash oynasi: SMS pul turadi va bosgandan keyin qaytarib
 * bo'lmaydi. Yuborishdan OLDIN kimga ketishi va matn qanday ko'rinishi
 * aytiladi — "yuborildi" dan keyin emas.
 */
function BulkRemind({
  studentIds,
  onClose,
}: {
  studentIds: string[] | null;
  onClose: (sent: boolean) => void;
}) {
  const [overdueOnly, setOverdueOnly] = useState(true);
  const [result, setResult] = useState<BulkResult | null>(null);

  // Ataylab /debtors ostida: o'qituvchi ham ochadi, SMS sozlamalari esa
  // faqat ma'muriyatga ko'rinadi.
  const sms = useQuery({
    queryKey: ['sms-preview'],
    queryFn: async () => (await api.get<SmsPreview>('/debtors/sms-preview')).data,
  });

  const send = useMutation({
    mutationFn: async () =>
      (await api.post('/debtors/remind-all', {
        ...(studentIds ? { studentIds } : { overdueOnly }),
      })).data as BulkResult,
    onSuccess: setResult,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = (send.error as any)?.response?.data?.error;

  return (
    <Modal
      title={studentIds ? `Tanlangan ${studentIds.length} o'quvchiga eslatma` : 'Hamma qarzdorga eslatma'}
      onClose={() => onClose(result !== null)}
    >
      {result ? (
        <>
          <p className="save-note">✓ Navbatga qo'yildi</p>
          <ul className="muted">
            <li>Telegram: <strong className="num">{result.telegram}</strong> ta (bepul)</li>
            <li>SMS: <strong className="num">{result.sms}</strong> ta</li>
            {result.skipped > 0 && (
              <li>{result.skipped} ta o'quvchi yaqinda eslatma olgan — takrorlanmadi</li>
            )}
            {result.noContact > 0 && (
              <li>{result.noContact} ta o'quvchida xabar boradigan raqam yo'q</li>
            )}
          </ul>
          <p className="help">
            Xabarlar fon rejimida jo'natiladi. Natijani <Link to="/notifications">Xabarlar</Link>{' '}
            sahifasida ko'ring.
          </p>
          <div className="actions">
            <button className="btn btn-primary" onClick={() => onClose(true)}>Yopish</button>
          </div>
        </>
      ) : (
        <>
          {studentIds ? (
            <p className="muted" style={{ marginTop: 0 }}>
              Faqat siz belgilagan {studentIds.length} ta o'quvchiga ketadi.
            </p>
          ) : (
            <label className="check-row">
              <input
                type="checkbox" checked={overdueOnly}
                onChange={(e) => setOverdueOnly(e.target.checked)}
              />
              <span>
                Faqat muddati o'tganlarga
                <span className="help">
                  O'chirilsa, muddati hali kelmagan hisoblar bo'yicha ham eslatma ketadi.
                </span>
              </span>
            </label>
          )}

          {sms.data && (
            <div className="field" style={{ marginTop: 14 }}>
              <label>Xabar</label>
              {sms.data.enabled ? (
                <>
                  <p className="help">
                    Har bir qarzdorning barcha raqamlariga SMS ketadi — Telegramga
                    ulanganiga ham. Har bir eslatma {sms.data.parts} ta SMS.
                  </p>
                  <p className="sms-preview">{sms.data.example}</p>
                </>
              ) : (
                <p className="help">
                  SMS o'chiq — xabar faqat Telegram botga ulangan ota-onalarga boradi.
                  Yoqish: Sozlamalar &gt; SMS (admin).
                </p>
              )}
            </div>
          )}

          {err && <p className="hint">{err}</p>}

          <div className="actions">
            <button className="btn btn-ghost" onClick={() => onClose(false)}>Bekor qilish</button>
            <button className="btn btn-primary" onClick={() => send.mutate()} disabled={send.isPending}>
              {send.isPending ? 'Yuborilmoqda…' : 'Yuborish'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
