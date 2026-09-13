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
  // Ota-ona botda "bu mening farzandim emas" dedi — tekshirish kerak.
  'parent.link.rejected': "Ota-ona ma'lumotni tasdiqlamadi",
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

      <InviteCard />

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

interface TgInfo {
  bot: string | null;
  ownBot: boolean;
  inviteLink: string | null;
  parents: { total: number; connected: number; waiting: number; rejected: number };
  pending: Array<{
    id: string; full_name: string; phone: string; students: string | null;
    /** none — botni ochmagan · pending — tasdiq kutilmoqda · rejected — tasdiqlamadi */
    state: 'none' | 'pending' | 'rejected';
  }>;
}

/**
 * Ota-onalarni botga ulash.
 *
 * Xabar yuborish zanjirining eng oxirgi va eng ko'p uziladigan bo'g'ini shu:
 * bot ulangan, kod ishlaydi, lekin ota-ona botni ochmagan bo'lsa xabar
 * hech qayerga bormaydi. Shuning uchun havola ham, ulanmaganlar ro'yxati ham
 * xabarlar sahifasining boshida turadi.
 */
function InviteCard() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const q = useQuery({
    queryKey: ['telegram-invite'],
    queryFn: async () => (await api.get<TgInfo>('/notifications/telegram')).data,
  });

  if (q.isPending) return <div className="card card-pad"><div className="skeleton" style={{ width: '50%' }} /></div>;
  if (q.isError) {
    return (
      <div className="card card-pad">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  }

  const d = q.data;

  if (!d.bot) {
    return (
      <div className="card card-pad">
        <h2 style={{ marginTop: 0 }}>Telegram bot ulanmagan</h2>
        <p className="muted">
          Maktabga bot ulanmaguncha ota-onalarga xabar yuborib bo'lmaydi.
          Bot ulash platforma administratori orqali amalga oshiriladi.
        </p>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.inviteLink!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard ruxsati bo'lmasa havola baribir ko'rinib turadi.
      setCopied(false);
    }
  };

  const left = d.parents.total - d.parents.connected;

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Ota-onalarni botga ulash</h2>
        <Chip kind={left === 0 ? 'good' : 'warn'}>
          {d.parents.connected} / {d.parents.total} ulangan
        </Chip>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        Xabar faqat botga ulangan ota-onaga boradi. Quyidagi havolani ota-onalarga
        yuboring: ular botni ochib, telefon raqamini tasdiqlaydi, so'ng bot
        farzandining ma'lumotini ko'rsatadi va "Ha / Yo'q" deb so'raydi.
      </p>

      {d.parents.rejected > 0 && (
        <div className="alarm" role="alert">
          {/* Rang yolg'iz ma'no tashimaydi — ikonka va so'z birga. */}
          <span className="alarm-icon" aria-hidden>⚠</span>
          <div>
            <strong>
              {d.parents.rejected} ta ota-ona "bu mening farzandim emas" dedi
            </strong>
            <span>
              Raqam yoki biriktirish xato bo'lishi mumkin — pastdagi ro'yxatda
              "Tasdiqlamadi" deb turganlarni tekshiring. Tuzatilgunga qadar ularga
              xabar yuborilmaydi.
            </span>
          </div>
        </div>
      )}

      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <code className="invite-link">{d.inviteLink}</code>
        <button type="button" className="btn btn-secondary sm" onClick={copy}>
          {copied ? '✓ Nusxa olindi' : 'Nusxa olish'}
        </button>
        <a className="btn btn-secondary sm" href={d.inviteLink!} target="_blank" rel="noreferrer">
          Botni ochish
        </a>
      </div>

      {!d.ownBot && (
        <p className="help" style={{ marginTop: 8 }}>
          Hozir umumiy platforma boti ishlatilyapti. Havoladagi kod maktabni
          aniqlaydi — shuning uchun havolani o'zgartirmasdan yuboring.
        </p>
      )}

      {left > 0 && (
        <>
          <button
            type="button" className="btn btn-ghost sm" style={{ marginTop: 10 }}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Yashirish' : `Xabar bormaydigan ${left} ta raqamni ko'rish`}
          </button>
          {open && (
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="tbl">
                <thead>
                  <tr><th>Ota-ona</th><th>Telefon</th><th>Farzandi</th><th>Holat</th></tr>
                </thead>
                <tbody>
                  {d.pending.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Ota-ona">{p.full_name}</td>
                      <td data-label="Telefon" className="num">{p.phone}</td>
                      <td data-label="Farzandi">
                        {p.students ?? <span className="muted">—</span>}
                      </td>
                      <td data-label="Holat">
                        {p.state === 'rejected'
                          ? <Chip kind="crit">Tasdiqlamadi</Chip>
                          : p.state === 'pending'
                            ? <Chip kind="warn">Tasdiq kutilmoqda</Chip>
                            : <Chip kind="neutral">Botni ochmagan</Chip>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
