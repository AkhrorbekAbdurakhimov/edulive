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

/**
 * Kanal — ALOHIDA amal, tanlov emas.
 *
 * Telegram bepul, lekin faqat botga ulangan ota-onaga yetadi. SMS pullik,
 * lekin hammaga boradi. Bitta tugma ikkalasini birdan yuborsa, ma'mur qancha
 * pul sarflaganini bilmaydi va "qaysi biri ketdi?" degan savolga javob
 * qolmaydi — shuning uchun har kanal o'z tugmasi bilan.
 */
type Channel = 'telegram' | 'sms';

interface RemindResult { channel: Channel; telegram: number; sms: number }

interface BulkResult extends RemindResult {
  students: number; skipped: number; noContact: number;
}

interface SmsPreview { enabled: boolean; example: string; parts: number; unicode: boolean }

const CHANNEL_LABEL: Record<Channel, string> = { telegram: 'Telegram', sms: 'SMS' };

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
  // Qaysi o'quvchiga, qaysi kanaldan ketgani/xatosi — qatorning o'zida.
  const [note, setNote] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<Channel | null>(null);

  const q = useQuery({
    queryKey: ['debtors'],
    queryFn: async () =>
      (await api.get<{ items: DebtorRow[]; total: number; totalOutstanding: number }>('/debtors')).data,
  });

  const sms = useQuery({
    queryKey: ['sms-preview'],
    queryFn: async () => (await api.get<SmsPreview>('/debtors/sms-preview')).data,
  });

  const remind = useMutation({
    mutationFn: async (v: { studentId: string; channel: Channel }) =>
      (await api.post(`/debtors/${v.studentId}/remind`, { channel: v.channel })).data as RemindResult,
    onSuccess: (d, v) =>
      setNote((n) => ({
        ...n,
        [v.studentId]: `✓ ${CHANNEL_LABEL[d.channel]}: ${d.telegram + d.sms} ta`,
      })),
    onError: (e: unknown, v) =>
      setNote((n) => ({
        ...n,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [v.studentId]: `✕ ${(e as any)?.response?.data?.error ?? 'Yuborilmadi'}`,
      })),
  });

  const rows = q.data?.items ?? [];
  const allPicked = rows.length > 0 && rows.every((r) => picked.has(r.student_id));
  const smsOff = sms.data?.enabled === false;

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const busy = (id: string, c: Channel) =>
    remind.isPending && remind.variables?.studentId === id && remind.variables?.channel === c;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Qarzdorlar</h1>
        <div className="row" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {q.data && (
            <span className="muted">
              {q.data.total} o'quvchi · jami <strong className="num">{money(q.data.totalOutstanding)}</strong>
            </span>
          )}
          {rows.length > 0 && (
            <>
              <span className="muted">
                {picked.size > 0 ? `${picked.size} ta tanlandi —` : 'Hammaga —'}
              </span>
              <button className="btn btn-secondary sm" onClick={() => setBulk('telegram')}>
                Telegram
              </button>
              <button
                className="btn btn-primary sm"
                onClick={() => setBulk('sms')}
                disabled={smsOff}
                title={smsOff ? "SMS o'chiq — Sozlamalar > SMS" : undefined}
              >
                SMS
              </button>
            </>
          )}
        </div>
      </div>

      {bulk && (
        <BulkRemind
          channel={bulk}
          studentIds={picked.size > 0 ? [...picked] : null}
          preview={sms.data}
          onClose={(sent) => {
            setBulk(null);
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
                    type="checkbox" checked={allPicked}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.student_id)))}
                    aria-label="Hammasini tanlash"
                  />
                </th>
                <th>F.I.Sh</th><th>Sinf</th><th className="right">Qarz</th>
                <th>Muddati o'tgan</th><th>Eng eski muddat</th><th>Ota-ona</th>
                <th>Eslatma</th>
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
                  <td data-label="Eslatma">
                    <div className="send-buttons">
                      <button
                        className="btn btn-secondary sm"
                        onClick={() => remind.mutate({ studentId: d.student_id, channel: 'telegram' })}
                        disabled={busy(d.student_id, 'telegram')}
                      >
                        {busy(d.student_id, 'telegram') ? '…' : 'Telegram'}
                      </button>
                      <button
                        className="btn btn-secondary sm"
                        onClick={() => remind.mutate({ studentId: d.student_id, channel: 'sms' })}
                        disabled={smsOff || busy(d.student_id, 'sms')}
                        title={smsOff ? "SMS o'chiq — Sozlamalar > SMS" : undefined}
                      >
                        {busy(d.student_id, 'sms') ? '…' : 'SMS'}
                      </button>
                    </div>
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
 * Ko'pchilikka eslatma — bitta kanal orqali.
 *
 * Nega tasdiqlash oynasi: bosgandan keyin qaytarib bo'lmaydi, SMS esa pul
 * turadi. Kimga va nima ketishi yuborishdan OLDIN aytiladi.
 */
function BulkRemind({
  channel,
  studentIds,
  preview,
  onClose,
}: {
  channel: Channel;
  studentIds: string[] | null;
  preview?: SmsPreview;
  onClose: (sent: boolean) => void;
}) {
  const [overdueOnly, setOverdueOnly] = useState(true);
  const [result, setResult] = useState<BulkResult | null>(null);

  const send = useMutation({
    mutationFn: async () =>
      (await api.post('/debtors/remind-all', {
        channel,
        ...(studentIds ? { studentIds } : { overdueOnly }),
      })).data as BulkResult,
    onSuccess: setResult,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const err = (send.error as any)?.response?.data?.error;
  const who = studentIds ? `tanlangan ${studentIds.length} o'quvchiga` : 'hamma qarzdorga';

  return (
    <Modal
      title={`${CHANNEL_LABEL[channel]} eslatmasi — ${who}`}
      onClose={() => onClose(result !== null)}
    >
      {result ? (
        <>
          <p className="save-note">✓ Navbatga qo'yildi</p>
          <ul className="muted">
            <li>
              {CHANNEL_LABEL[channel]}:{' '}
              <strong className="num">{result.telegram + result.sms}</strong> ta xabar
            </li>
            {result.skipped > 0 && (
              <li>
                {result.skipped} ta o'quvchi shu kanaldan yaqinda eslatma olgan — takrorlanmadi
              </li>
            )}
            {result.noContact > 0 && (
              <li>
                {result.noContact} ta o'quvchiga bu kanal orqali yetib bormaydi
                {channel === 'telegram' ? ' (botga ulanmagan)' : ' (raqami yo\'q)'}
              </li>
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
            <label className="check-row" style={{ marginTop: 0 }}>
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

          <div className="field" style={{ marginTop: 14 }}>
            <label>{channel === 'sms' ? 'SMS matni' : 'Telegram xabari'}</label>
            {channel === 'sms' ? (
              <>
                <p className="help">
                  Barcha raqamlarga ketadi — Telegramga ulanganiga ham. Har bir
                  eslatma {preview?.parts ?? 1} ta SMS, ya'ni pullik.
                </p>
                {preview && <p className="sms-preview">{preview.example}</p>}
              </>
            ) : (
              <p className="help">
                Bepul, lekin faqat botga ULANGAN va farzandini tasdiqlagan
                ota-onalarga yetadi. Ulanmaganlarga SMS kerak bo'ladi.
              </p>
            )}
          </div>

          {err && <p className="hint">{err}</p>}

          <div className="actions">
            <button className="btn btn-ghost" onClick={() => onClose(false)}>Bekor qilish</button>
            <button className="btn btn-primary" onClick={() => send.mutate()} disabled={send.isPending}>
              {send.isPending ? 'Yuborilmoqda…' : `${CHANNEL_LABEL[channel]} yuborish`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
