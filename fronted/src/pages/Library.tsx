import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, date, downloadFile } from '../lib/api';
import { Chip, EmptyState, ErrorState, Modal, TableSkeleton } from '../components/ui';
import { useReadOnly } from '../lib/auth';
import { Picker } from '../components/Picker';

interface BookRow {
  id: string; title: string; author: string | null; category: string;
  grade: number | null; language: string; shelf: string | null; price: number | null;
  total_copies: number; available_copies: number; issued_copies: number;
}

interface CopyRow {
  id: string; inventory_no: string; condition: string; status: string;
  holder_name: string | null; loan_id: string | null; due_on: string | null;
}

interface LoanRow {
  id: string; issued_on: string; due_on: string; returned_on: string | null;
  status: string; overdue: boolean; days_late: number;
  book_id: string; title: string; author: string | null; inventory_no: string;
  student_id: string; student_name: string; class_name: string | null;
  issued_by_name: string | null; condition_in: string | null;
}

const CATEGORY: Record<string, string> = {
  darslik: 'Darslik', badiiy: 'Badiiy', qollanma: "Qo'llanma",
  ilmiy: 'Ilmiy', boshqa: 'Boshqa',
};
const LANGUAGE: Record<string, string> = { uz: "O'zbek", ru: 'Rus', en: 'Ingliz', other: 'Boshqa' };
const CONDITION: Record<string, string> = {
  new: 'Yangi', good: 'Yaxshi', worn: 'Eskirgan', damaged: 'Shikastlangan',
};

/** Kitob berishdan oldin tekshiriladi: o'quvchi qo'lida nima turibdi. */
interface ActiveLoans {
  limit: number;
  blocked: boolean;
  message: string | null;
  items: Array<{
    id: string; title: string; author: string | null; inventory_no: string;
    issued_on: string; due_on: string; overdue: boolean; days_late: number;
  }>;
}

type Tab = 'books' | 'loans' | 'overdue';

export default function Library() {
  const [tab, setTab] = useState<Tab>('books');
  const [showIssue, setShowIssue] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const readOnly = useReadOnly();

  const counts = useQuery({
    queryKey: ['library-counts'],
    queryFn: async () =>
      (await api.get<{ counts: { issued: number; overdue: number; returned: number; lost: number } }>(
        '/library/loans?limit=1')).data.counts,
  });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Kutubxona</h1>
        {counts.data && (
          <span className="muted">
            {counts.data.issued} ta o'quvchida
            {counts.data.overdue > 0 && ` · ${counts.data.overdue} tasining muddati o'tgan`}
          </span>
        )}
        <div className="grow" />
        {!readOnly && (
          <>
            <button className="btn btn-secondary" onClick={() => setShowImport(true)}>Excel import</button>
            <button className="btn btn-secondary" onClick={() => setShowCreate(true)}>+ Kitob</button>
            <button className="btn btn-primary" onClick={() => setShowIssue(true)}>+ Kitob berish</button>
          </>
        )}
      </div>

      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          ['books', 'Kitoblar'],
          ['loans', 'Berilganlar'],
          ['overdue', `Muddati o'tgan${counts.data?.overdue ? ` (${counts.data.overdue})` : ''}`],
        ] as Array<[Tab, string]>).map(([k, label]) => (
          <button
            key={k}
            className={`btn ${tab === k ? 'btn-primary' : 'btn-secondary'} sm`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'books' ? <BooksTab readOnly={readOnly} onAdd={() => setShowCreate(true)} />
        : <LoansTab overdueOnly={tab === 'overdue'} readOnly={readOnly} />}

      {showIssue && <IssueModal onClose={() => setShowIssue(false)} />}
      {showCreate && <BookModal onClose={() => setShowCreate(false)} />}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- kitoblar

function BooksTab({ readOnly, onAdd }: { readOnly: boolean; onAdd: () => void }) {
  const [open, setOpen] = useState<BookRow | null>(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [grade, setGrade] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);

  const books = useQuery({
    queryKey: ['books', q, category, grade, availableOnly],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (q) p.set('search', q);
      if (category) p.set('category', category);
      if (grade) p.set('grade', grade);
      if (availableOnly) p.set('availableOnly', 'true');
      p.set('limit', '100');
      return (await api.get<{ items: BookRow[]; total: number }>(`/library/books?${p}`)).data;
    },
  });

  return (
    <>
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="input" placeholder="Kitob nomi, muallif yoki ISBN…"
          value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }}
        />
        <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Barcha bo'limlar</option>
          {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="">Barcha sinflar</option>
          {Array.from({ length: 11 }, (_, i) => i + 1).map((g) => (
            <option key={g} value={String(g)}>{g}-sinf</option>
          ))}
        </select>
        <label className="check-row" style={{ marginTop: 0, alignItems: 'center' }}>
          <input type="checkbox" checked={availableOnly} onChange={(e) => setAvailableOnly(e.target.checked)} />
          <span>Faqat javonda borlari</span>
        </label>
      </div>

      <div className="card table-wrap">
        {books.isPending ? (
          <TableSkeleton />
        ) : books.isError ? (
          <ErrorState error={books.error} onRetry={() => books.refetch()} />
        ) : books.data.items.length === 0 ? (
          <EmptyState
            icon="▤"
            title="Kitob topilmadi"
            text={q || category || grade ? "Filtrni o'zgartirib ko'ring"
              : "Kitoblarni bittalab qo'shing yoki Excel orqali bir yo'la yuklang."}
            action={readOnly ? undefined
              : <button className="btn btn-primary sm" onClick={onAdd}>+ Kitob</button>}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Nomi</th><th>Muallif</th><th>Bo'lim</th><th>Javon</th>
                <th className="right">Nusxa</th><th>Holat</th><th></th>
              </tr>
            </thead>
            <tbody>
              {books.data.items.map((b) => (
                <tr key={b.id}>
                  <td data-label="Nomi">
                    <strong>{b.title}</strong>
                    {b.grade && <div className="muted">{b.grade}-sinf · {LANGUAGE[b.language]}</div>}
                  </td>
                  <td data-label="Muallif">{b.author ?? <span className="muted">—</span>}</td>
                  <td data-label="Bo'lim">{CATEGORY[b.category] ?? b.category}</td>
                  <td data-label="Javon">{b.shelf ?? <span className="muted">—</span>}</td>
                  <td data-label="Nusxa" className="right num">
                    <strong>{b.available_copies}</strong>
                    <span className="muted"> / {b.total_copies}</span>
                  </td>
                  <td data-label="Holat">
                    {b.available_copies > 0
                      ? <Chip kind="good">Javonda bor</Chip>
                      : <Chip kind="warn">Hammasi berilgan</Chip>}
                  </td>
                  <td data-label="">
                    <button className="btn btn-secondary sm" onClick={() => setOpen(b)}>
                      {readOnly ? 'Ochish' : 'Tahrirlash'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && <BookDetailModal book={open} readOnly={readOnly} onClose={() => setOpen(null)} />}
    </>
  );
}

/**
 * Kitob kartasi: ma'lumotni tahrirlash, nusxalar holati, nusxa qo'shish,
 * arxivlash. Nusxa kimdaligi shu yerda ko'rinadi — javondan topolmagan
 * kutubxonachi birinchi shuni qidiradi.
 */
function BookDetailModal(
  { book, readOnly, onClose }: { book: BookRow; readOnly: boolean; onClose: () => void },
) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: book.title, author: book.author ?? '', category: book.category,
    grade: book.grade ? String(book.grade) : '', language: book.language,
    shelf: book.shelf ?? '', price: book.price ? String(book.price) : '',
  });
  const [addCount, setAddCount] = useState('');
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const detail = useQuery({
    queryKey: ['book', book.id],
    queryFn: async () =>
      (await api.get<{ book: BookRow; copies: CopyRow[] }>(`/library/books/${book.id}`)).data,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['books'] });
    qc.invalidateQueries({ queryKey: ['book', book.id] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        category: form.category,
        language: form.language,
        author: form.author.trim() || null,
        shelf: form.shelf.trim() || null,
      };
      if (form.grade) body.grade = Number(form.grade);
      if (form.price) body.price = Number(form.price.replace(/\s/g, ''));
      return (await api.patch(`/library/books/${book.id}`, body)).data;
    },
    onSuccess: () => { refresh(); onClose(); },
  });

  const addCopies = useMutation({
    mutationFn: async () =>
      (await api.post(`/library/books/${book.id}/copies`, { count: Number(addCount) || 1 })).data,
    onSuccess: () => { setAddCount(''); refresh(); },
  });

  const archive = useMutation({
    mutationFn: async () => (await api.delete(`/library/books/${book.id}`)).data,
    onSuccess: () => { refresh(); onClose(); },
  });

  const errMsg = ((save.error ?? addCopies.error ?? archive.error) as any)?.response?.data?.error;

  return (
    <Modal title={book.title} onClose={onClose}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); if (!readOnly) save.mutate(); }}>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="bd-title">Nomi</label>
            <input id="bd-title" className="input" value={form.title} onChange={set('title')}
                   required minLength={2} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="bd-author">Muallif</label>
            <input id="bd-author" className="input" value={form.author} onChange={set('author')} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="bd-cat">Bo'lim</label>
            <select id="bd-cat" className="input" value={form.category} onChange={set('category')} disabled={readOnly}>
              {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bd-grade">Sinf</label>
            <select id="bd-grade" className="input" value={form.grade} onChange={set('grade')} disabled={readOnly}>
              <option value="">Umumiy</option>
              {Array.from({ length: 11 }, (_, i) => i + 1).map((g) => (
                <option key={g} value={String(g)}>{g}-sinf</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bd-lang">Til</label>
            <select id="bd-lang" className="input" value={form.language} onChange={set('language')} disabled={readOnly}>
              {Object.entries(LANGUAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bd-shelf">Javon</label>
            <input id="bd-shelf" className="input" value={form.shelf} onChange={set('shelf')} disabled={readOnly} />
          </div>
          <div className="field">
            <label htmlFor="bd-price">Narxi</label>
            <input id="bd-price" className="input num" value={form.price} onChange={set('price')} disabled={readOnly} />
          </div>
        </div>

        <h3 style={{ margin: '18px 0 8px', fontSize: 14 }}>
          Nusxalar {detail.data && <span className="muted">({detail.data.copies.length} ta)</span>}
        </h3>
        {detail.isPending ? (
          <div className="skeleton" style={{ width: '70%' }} />
        ) : detail.isError ? (
          <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Inventar</th><th>Holat</th><th>Kimda</th></tr></thead>
              <tbody>
                {detail.data.copies.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Inventar" className="num">{c.inventory_no}</td>
                    <td data-label="Holat">{copyChip(c.status)}</td>
                    <td data-label="Kimda">
                      {c.holder_name
                        ? <>{c.holder_name}<div className="muted num">{c.due_on ? date(c.due_on) : ''}</div></>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!readOnly && (
          <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <div className="field" style={{ marginBottom: 0, width: 140 }}>
              <label htmlFor="bd-add">Nusxa qo'shish</label>
              <input id="bd-add" className="input num" type="number" min={1} max={500}
                     value={addCount} onChange={(e) => setAddCount(e.target.value)} placeholder="0" />
            </div>
            <button
              type="button" className="btn btn-secondary sm"
              onClick={() => addCopies.mutate()}
              disabled={!Number(addCount) || addCopies.isPending}
            >
              {addCopies.isPending ? "Qo'shilmoqda…" : "Qo'shish"}
            </button>
          </div>
        )}

        {errMsg && <p className="hint">{errMsg}</p>}

        <div className="actions" style={{ justifyContent: 'space-between' }}>
          {!readOnly ? (
            <button
              type="button" className="btn btn-ghost"
              onClick={() => archive.mutate()} disabled={archive.isPending}
              title="Kitob o'chirilmaydi — arxivga o'tadi, tarixi saqlanib qoladi"
            >
              Arxivlash
            </button>
          ) : <span />}
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Yopish</button>
            {!readOnly && (
              <button className="btn btn-primary" disabled={save.isPending}>
                {save.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
              </button>
            )}
          </div>
        </div>
      </form>
    </Modal>
  );
}

/** Nusxa holati — rang yolg'iz ma'no tashimaydi, so'z bilan birga. */
function copyChip(status: string) {
  switch (status) {
    case 'shelf': return <Chip kind="good">Javonda</Chip>;
    case 'issued': return <Chip kind="neutral">Berilgan</Chip>;
    case 'lost': return <Chip kind="crit">Yo'qolgan</Chip>;
    case 'repair': return <Chip kind="warn">Ta'mirda</Chip>;
    case 'written_off': return <Chip kind="neutral">Hisobdan chiqarilgan</Chip>;
    default: return <Chip kind="neutral">{status}</Chip>;
  }
}

// ---------------------------------------------------------------- berilganlar

function LoansTab({ overdueOnly, readOnly }: { overdueOnly: boolean; readOnly: boolean }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(overdueOnly ? 'overdue' : 'issued');
  const [returning, setReturning] = useState<LoanRow | null>(null);

  const effective = overdueOnly ? 'overdue' : status;

  const loans = useQuery({
    queryKey: ['loans', effective, q],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (effective) p.set('status', effective);
      if (q) p.set('search', q);
      p.set('limit', '100');
      return (await api.get<{ items: LoanRow[]; total: number }>(`/library/loans?${p}`)).data;
    },
  });

  return (
    <>
      <div className="row" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          className="input" placeholder="O'quvchi, kitob yoki inventar raqami…"
          value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 300 }}
        />
        {!overdueOnly && (
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="issued">Qo'lida</option>
            <option value="returned">Qaytarilgan</option>
            <option value="lost">Yo'qolgan</option>
            <option value="">Hammasi</option>
          </select>
        )}
      </div>

      <div className="card table-wrap">
        {loans.isPending ? (
          <TableSkeleton />
        ) : loans.isError ? (
          <ErrorState error={loans.error} onRetry={() => loans.refetch()} />
        ) : loans.data.items.length === 0 ? (
          <EmptyState
            icon={overdueOnly ? '✓' : '▤'}
            title={overdueOnly ? "Muddati o'tgan kitob yo'q" : 'Yozuv yo\'q'}
            text={overdueOnly
              ? "Hamma kitob o'z vaqtida qaytarilgan."
              : "Kitob berilganda shu yerda ko'rinadi."}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>O'quvchi</th><th>Kitob</th><th>Berilgan</th>
                <th>Qaytarish</th><th>Holat</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loans.data.items.map((l) => (
                <tr key={l.id}>
                  <td data-label="O'quvchi">
                    <strong>{l.student_name}</strong>
                    {l.class_name && <div className="muted">{l.class_name}</div>}
                  </td>
                  <td data-label="Kitob">
                    {l.title}
                    <div className="muted num">{l.inventory_no}</div>
                  </td>
                  <td data-label="Berilgan" className="num">{date(l.issued_on)}</td>
                  <td data-label="Qaytarish" className="num">
                    {l.returned_on ? date(l.returned_on) : date(l.due_on)}
                  </td>
                  <td data-label="Holat">{loanChip(l)}</td>
                  <td data-label="">
                    {l.status === 'issued' && !readOnly && (
                      <button className="btn btn-secondary sm" onClick={() => setReturning(l)}>
                        Qabul qilish
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {returning && <ReturnModal loan={returning} onClose={() => setReturning(null)} />}
    </>
  );
}

/** Rang yolg'iz ma'no tashimaydi — ikonka + so'z birga. */
function loanChip(l: LoanRow) {
  if (l.status === 'lost') return <Chip kind="crit">Yo'qolgan</Chip>;
  if (l.status === 'returned') {
    return l.condition_in === 'damaged'
      ? <Chip kind="warn">Shikast bilan qaytdi</Chip>
      : <Chip kind="good">Qaytarilgan</Chip>;
  }
  if (l.overdue) return <Chip kind="crit">{l.days_late} kun kechikdi</Chip>;
  return <Chip kind="neutral">Qo'lida</Chip>;
}

// ---------------------------------------------------------------- kitob berish

function IssueModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [studentQ, setStudentQ] = useState('');
  const [studentId, setStudentId] = useState('');
  const [bookQ, setBookQ] = useState('');
  const [bookId, setBookId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [note, setNote] = useState('');

  // Sukut muddat sozlamadan keladi — kodda "14 kun" deb yozilmaydi.
  const settings = useQuery({
    queryKey: ['library-settings'],
    queryFn: async () =>
      (await api.get<{ loanDays: number; defaultDueOn: string }>('/library/settings')).data,
  });
  if (settings.data && !dueOn) setDueOn(settings.data.defaultDueOn);

  const students = useQuery({
    queryKey: ['students-pick', studentQ],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: '20' });
      if (studentQ) p.set('q', studentQ);
      return (await api.get<{ items: Array<{ id: string; last_name: string; first_name: string; class_name: string | null }> }>(
        `/students?${p}`)).data.items;
    },
  });

  // O'quvchi tanlangach darrov tekshiramiz — "Berish" bosilishini kutmaymiz.
  const held = useQuery({
    queryKey: ['student-active', studentId],
    enabled: Boolean(studentId),
    queryFn: async () =>
      (await api.get<ActiveLoans>(`/library/students/${studentId}/active`)).data,
  });
  const blocked = held.data?.blocked ?? false;

  const books = useQuery({
    queryKey: ['books-pick', bookQ],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: '20', availableOnly: 'true' });
      if (bookQ) p.set('search', bookQ);
      return (await api.get<{ items: BookRow[] }>(`/library/books?${p}`)).data.items;
    },
  });

  const issue = useMutation({
    mutationFn: async () =>
      (await api.post('/library/loans', { studentId, bookId, dueOn, note: note.trim() || undefined })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loans'] });
      qc.invalidateQueries({ queryKey: ['books'] });
      qc.invalidateQueries({ queryKey: ['library-counts'] });
      qc.invalidateQueries({ queryKey: ['student-active'] });
      onClose();
    },
  });

  const submit = (e: FormEvent) => { e.preventDefault(); issue.mutate(); };
  const errMsg = (issue.error as any)?.response?.data?.error;
  const chosenBook = books.data?.find((b) => b.id === bookId);

  return (
    <Modal title="Kitob berish" onClose={onClose}>
      <form onSubmit={submit}>
        <Picker
          label="O'quvchi"
          placeholder="Familiya yoki ism bo'yicha qidiring…"
          items={students.data ?? []}
          loading={students.isPending}
          value={studentId}
          getKey={(s) => s.id}
          getLabel={(s) => `${s.last_name} ${s.first_name}`}
          getHint={(s) => s.class_name ?? 'sinfsiz'}
          onSearch={setStudentQ}
          onSelect={(s) => setStudentId(s?.id ?? '')}
          emptyText="O'quvchi topilmadi"
          required
        />

        {blocked && held.data && (
          <div className="alarm" role="alert">
            {/* Rang yolg'iz ma'no tashimaydi — ikonka va so'z birga. */}
            <span className="alarm-icon" aria-hidden>⚠</span>
            <div>
              <strong>
                {held.data.items.length === 1
                  ? "Bu o'quvchi hozir kitob o'qiyapti"
                  : `Bu o'quvchida ${held.data.items.length} ta kitob bor — chegara ${held.data.limit} ta`}
              </strong>
              <ul className="alarm-list">
                {held.data.items.map((l) => (
                  <li key={l.id}>
                    {l.title}
                    {l.author ? ` — ${l.author}` : ''}
                    {' · '}
                    <span className="num">{l.inventory_no}</span>
                    {' · muddat '}
                    <span className="num">{date(l.due_on)}</span>
                    {l.overdue && <> · <strong>{l.days_late} kun kechikdi</strong></>}
                  </li>
                ))}
              </ul>
              <span>Avval shu kitobni qabul qiling — «Berilganlar» bo'limi.</span>
            </div>
          </div>
        )}

        <Picker
          label="Kitob"
          placeholder="Kitob nomi yoki muallif…"
          help="Faqat javonda bo'sh nusxasi bor kitoblar ko'rsatiladi."
          items={books.data ?? []}
          loading={books.isPending}
          value={bookId}
          getKey={(b) => b.id}
          getLabel={(b) => b.title}
          getHint={(b) => `${b.author ?? '—'} · javonda ${b.available_copies} ta`}
          onSearch={setBookQ}
          onSelect={(b) => setBookId(b?.id ?? '')}
          emptyText="Bo'sh kitob topilmadi"
          required
        />

        <div className="field">
          <label htmlFor="lib-due">Qaytarish sanasi</label>
          <input
            id="lib-due" className="input" type="date"
            value={dueOn} onChange={(e) => setDueOn(e.target.value)}
            min={new Date().toISOString().slice(0, 10)} required
          />
          {settings.data && (
            <span className="help">Sukut bo'yicha {settings.data.loanDays} kun.</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="lib-note">Izoh</label>
          <input
            id="lib-note" className="input" value={note}
            onChange={(e) => setNote(e.target.value)} placeholder="ixtiyoriy"
          />
        </div>

        {chosenBook && (
          <p className="muted">
            Inventar raqami avtomatik biriktiriladi — javondagi birinchi bo'sh nusxa.
          </p>
        )}
        {errMsg && <p className="hint">{errMsg}</p>}

        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
          <button
            className="btn btn-primary"
            disabled={!studentId || !bookId || !dueOn || blocked || held.isPending || issue.isPending}
          >
            {issue.isPending ? 'Beriladi…' : 'Berish'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- qabul qilish

function ReturnModal({ loan, onClose }: { loan: LoanRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [condition, setCondition] = useState('good');
  const [note, setNote] = useState('');

  const done = () => {
    qc.invalidateQueries({ queryKey: ['loans'] });
    qc.invalidateQueries({ queryKey: ['books'] });
    qc.invalidateQueries({ queryKey: ['library-counts'] });
    onClose();
  };

  const back = useMutation({
    mutationFn: async () =>
      (await api.post(`/library/loans/${loan.id}/return`, { condition, note: note.trim() || undefined })).data,
    onSuccess: done,
  });
  const lost = useMutation({
    mutationFn: async () =>
      (await api.post(`/library/loans/${loan.id}/lost`, { note: note.trim() || undefined })).data,
    onSuccess: done,
  });

  const errMsg = ((back.error ?? lost.error) as any)?.response?.data?.error;

  return (
    <Modal title="Kitobni qabul qilish" onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>
        <strong>{loan.student_name}</strong> — {loan.title}
        <br />
        Inventar raqami: <span className="num">{loan.inventory_no}</span> ·
        {' '}muddat: <span className="num">{date(loan.due_on)}</span>
        {loan.overdue && <> · <strong>{loan.days_late} kun kechikdi</strong></>}
      </p>

      <div className="field">
        <label htmlFor="ret-cond">Kitob holati</label>
        <select id="ret-cond" className="input" value={condition} onChange={(e) => setCondition(e.target.value)}>
          {Object.entries(CONDITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="help">
          Shikastlangan kitob javonga qaytmaydi — ta'mir ro'yxatiga tushadi.
        </span>
      </div>

      <div className="field">
        <label htmlFor="ret-note">Izoh</label>
        <input
          id="ret-note" className="input" value={note}
          onChange={(e) => setNote(e.target.value)} placeholder="ixtiyoriy"
        />
      </div>

      {errMsg && <p className="hint">{errMsg}</p>}

      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <button
          type="button" className="btn btn-ghost"
          onClick={() => lost.mutate()} disabled={lost.isPending}
        >
          Yo'qolgan deb belgilash
        </button>
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
          <button
            type="button" className="btn btn-primary"
            onClick={() => back.mutate()} disabled={back.isPending}
          >
            {back.isPending ? 'Qabul qilinmoqda…' : 'Qabul qildim'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- kitob qo'shish

function BookModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    title: '', author: '', category: 'boshqa', grade: '', language: 'uz',
    publisher: '', publishedYear: '', isbn: '', shelf: '', price: '', copies: '1',
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        title: form.title.trim(),
        category: form.category,
        language: form.language,
        copies: Number(form.copies) || 1,
      };
      // Bo'sh maydon umuman yuborilmaydi — backend uni ixtiyoriy deb biladi.
      if (form.author.trim()) body.author = form.author.trim();
      if (form.grade) body.grade = Number(form.grade);
      if (form.publisher.trim()) body.publisher = form.publisher.trim();
      if (form.publishedYear) body.publishedYear = Number(form.publishedYear);
      if (form.isbn.trim()) body.isbn = form.isbn.trim();
      if (form.shelf.trim()) body.shelf = form.shelf.trim();
      if (form.price) body.price = Number(form.price.replace(/\s/g, ''));
      return (await api.post('/library/books', body)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['books'] });
      onClose();
    },
  });

  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };
  const errMsg = (create.error as any)?.response?.data?.error;

  return (
    <Modal title="Yangi kitob" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="bk-title">Nomi</label>
            <input id="bk-title" className="input" value={form.title} onChange={set('title')} required minLength={2} />
          </div>
          <div className="field">
            <label htmlFor="bk-author">Muallif</label>
            <input id="bk-author" className="input" value={form.author} onChange={set('author')} />
          </div>
          <div className="field">
            <label htmlFor="bk-cat">Bo'lim</label>
            <select id="bk-cat" className="input" value={form.category} onChange={set('category')}>
              {Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bk-grade">Sinf</label>
            <select id="bk-grade" className="input" value={form.grade} onChange={set('grade')}>
              <option value="">Umumiy</option>
              {Array.from({ length: 11 }, (_, i) => i + 1).map((g) => (
                <option key={g} value={String(g)}>{g}-sinf</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bk-lang">Til</label>
            <select id="bk-lang" className="input" value={form.language} onChange={set('language')}>
              {Object.entries(LANGUAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bk-pub">Nashriyot</label>
            <input id="bk-pub" className="input" value={form.publisher} onChange={set('publisher')} />
          </div>
          <div className="field">
            <label htmlFor="bk-year">Nashr yili</label>
            <input id="bk-year" className="input num" type="number" min={1800} max={2100}
                   value={form.publishedYear} onChange={set('publishedYear')} />
          </div>
          <div className="field">
            <label htmlFor="bk-isbn">ISBN</label>
            <input id="bk-isbn" className="input num" value={form.isbn} onChange={set('isbn')} />
          </div>
          <div className="field">
            <label htmlFor="bk-shelf">Javon</label>
            <input id="bk-shelf" className="input" value={form.shelf} onChange={set('shelf')} placeholder="A-3" />
          </div>
          <div className="field">
            <label htmlFor="bk-price">Narxi</label>
            <input id="bk-price" className="input num" value={form.price} onChange={set('price')} placeholder="0" />
            <span className="help">Yo'qolganda undiriladigan qiymat.</span>
          </div>
          <div className="field">
            <label htmlFor="bk-copies">Nusxalar soni</label>
            <input id="bk-copies" className="input num" type="number" min={1} max={500}
                   value={form.copies} onChange={set('copies')} />
            <span className="help">Inventar raqamlari avtomatik beriladi (KT-000001…).</span>
          </div>
        </div>

        {errMsg && <p className="hint">{errMsg}</p>}

        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
          <button className="btn btn-primary" disabled={create.isPending || form.title.trim().length < 2}>
            {create.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Excel import

interface ImportError { row: number; column: string; message: string }

function ImportModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [tplError, setTplError] = useState<string | null>(null);

  const template = useMutation({
    mutationFn: () => downloadFile('/library/books/import/template', 'edulive-kitoblar-shablon.xlsx'),
    onError: () => setTplError("Shablonni yuklab bo'lmadi — qaytadan urinib ko'ring"),
  });

  const send = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file!);
      return (await api.post<{ books: number; copies: number }>('/library/books/import', form)).data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['books'] }),
  });

  const err = (send.error as any)?.response?.data;
  const rowErrors: ImportError[] = err?.errors ?? [];

  if (send.data) {
    return (
      <Modal title="Import yakunlandi" onClose={onClose}>
        <p className="save-note" style={{ fontSize: 15 }}>
          ✓ {send.data.books} ta kitob, {send.data.copies} ta nusxa kiritildi
        </p>
        <div className="actions">
          <button className="btn btn-primary" onClick={onClose}>Yopish</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Kitoblarni Excel orqali kiritish" onClose={onClose}>
      <ol className="import-steps">
        <li>
          <strong>Shablonni yuklab oling.</strong>
          <p className="muted">Bo'lim va til ustunlari ro'yxatdan tanlanadi.</p>
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
            Faqat "Nomi" majburiy. Inventar raqamlarini bo'sh qoldirsangiz avtomatik
            beriladi. Namuna qatorini o'chirib tashlang. Bir faylda 1000 tagacha kitob.
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
                  <td className="num">{e.row}</td>
                  <td>{e.column}</td>
                  <td>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Bekor qilish</button>
        <button
          type="button" className="btn btn-primary"
          onClick={() => send.mutate()} disabled={!file || send.isPending}
        >
          {send.isPending ? 'Yuklanmoqda…' : 'Yuklash'}
        </button>
      </div>
    </Modal>
  );
}

/** O'quvchi kartasida ko'rsatiladigan kitob tarixi. */
export function StudentBooks({ studentId }: { studentId: string }) {
  const q = useQuery({
    queryKey: ['student-books', studentId],
    queryFn: async () =>
      (await api.get<{ items: LoanRow[]; active: number; total: number }>(
        `/library/students/${studentId}/history`)).data,
  });

  if (q.isPending) return <div className="skeleton" style={{ width: '60%' }} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.total) {
    return <p className="muted">Kitob olmagan.</p>;
  }

  return (
    <table className="tbl">
      <thead>
        <tr><th>Kitob</th><th>Olgan</th><th>Qaytargan</th><th>Holat</th></tr>
      </thead>
      <tbody>
        {q.data.items.map((l) => (
          <tr key={l.id}>
            <td data-label="Kitob">
              {l.title}
              <div className="muted num">{l.inventory_no}</div>
            </td>
            <td data-label="Olgan" className="num">{date(l.issued_on)}</td>
            <td data-label="Qaytargan" className="num">
              {l.returned_on ? date(l.returned_on) : <span className="muted">—</span>}
            </td>
            <td data-label="Holat">{loanChip(l)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

