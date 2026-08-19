import type { ReactNode } from 'react';

/* Status chip — rang HECH QACHON yolg'iz ma'no tashimaydi: ikonka + so'z birga. */
type ChipKind = 'good' | 'warn' | 'serious' | 'crit' | 'neutral';

const CHIP_ICONS: Record<ChipKind, string> = {
  good: '✓', warn: '◔', serious: '⚠', crit: '✕', neutral: '·',
};

export function Chip({ kind, children }: { kind: ChipKind; children: ReactNode }) {
  return (
    <span className={`chip ${kind}`}>
      <span aria-hidden>{CHIP_ICONS[kind]}</span>
      {children}
    </span>
  );
}

export function invoiceChip(status: string) {
  switch (status) {
    case 'paid': return <Chip kind="good">To'langan</Chip>;
    case 'partial': return <Chip kind="warn">Qisman</Chip>;
    case 'open': return <Chip kind="crit">Qarzdor</Chip>;
    default: return <Chip kind="neutral">{status}</Chip>;
  }
}

export function attendanceChip(status: string) {
  switch (status) {
    case 'present': return <Chip kind="good">Keldi</Chip>;
    case 'late': return <Chip kind="warn">Kech qoldi</Chip>;
    case 'absent': return <Chip kind="crit">Kelmadi</Chip>;
    default: return <Chip kind="neutral">{status}</Chip>;
  }
}

/* Skeleton — to'liq sahifa spinneri TAQIQLANGAN (7-bo'lim). */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton" style={{ width: '22%' }} />
          <div className="skeleton" style={{ width: '12%' }} />
          <div className="skeleton" style={{ width: '18%' }} />
          <div className="skeleton" style={{ width: '10%' }} />
        </div>
      ))}
    </div>
  );
}

export function TileSkeleton() {
  return (
    <div className="card stat-tile" aria-busy>
      <div className="skeleton" style={{ width: 90 }} />
      <div className="skeleton" style={{ width: 130, height: 28, marginTop: 10 }} />
    </div>
  );
}

/* Empty — nima qilish kerakligini AYTADI. */
export function EmptyState({
  icon = '▤', title, text, action,
}: { icon?: string; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="state-box">
      <div className="icon" aria-hidden>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

/* Error — nima ishlamadi + qayta urinish. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const msg =
    (error as any)?.response?.data?.error ??
    (error as any)?.message ??
    'Nomaʼlum xatolik';
  return (
    <div className="state-box">
      <div className="icon" aria-hidden>⚠</div>
      <h3>Yuklab bo'lmadi</h3>
      <p>{String(msg)}</p>
      <button className="btn btn-secondary sm" onClick={onRetry}>Qayta urinish</button>
    </div>
  );
}

export function Modal({
  title, children, onClose,
}: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();
}
