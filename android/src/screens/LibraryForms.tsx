import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { addDays, fmtDate, isoDate, maskUzDate, parseUzDate, rosterName } from '../format';
import { ErrorText, FormSheet, Help, ListItem, MoneyField, SearchPicker, Select } from '../forms';
import { radius, useTheme } from '../theme';
import { Alarm, BigButton, ErrorState, Field, Pill, Skeleton, type IconName, type StatusKind } from '../ui';
import type { StudentPick } from './StudentCardScreen';

export interface BookRow {
  id: string; title: string; author: string | null; category: string;
  grade: number | null; language: string; shelf: string | null; price: number | null;
  total_copies: number; available_copies: number; issued_copies: number;
}
export interface LoanRow {
  id: string; issued_on: string; due_on: string; returned_on: string | null;
  status: string; overdue: boolean; days_late: number;
  book_id: string; title: string; author: string | null; inventory_no: string;
  student_id: string; student_name: string; class_name: string | null;
  issued_by_name: string | null; condition_in: string | null;
}

/** Kitob berishdan oldin tekshiriladi: o'quvchi qo'lida nima turibdi. */
export interface ActiveLoans {
  limit: number;
  blocked: boolean;
  message: string | null;
  items: Array<{
    id: string; title: string; author: string | null; inventory_no: string;
    issued_on: string; due_on: string; overdue: boolean; days_late: number;
  }>;
}

export const CATEGORY: Record<string, string> = { darslik: 'Darslik', badiiy: 'Badiiy', qollanma: "Qo'llanma", ilmiy: 'Ilmiy', boshqa: 'Boshqa' };
export const LANGUAGE: Record<string, string> = { uz: "O'zbek", ru: 'Rus', en: 'Ingliz', other: 'Boshqa' };
export const CONDITION: Record<string, string> = { new: 'Yangi', good: 'Yaxshi', worn: 'Eskirgan', damaged: 'Shikastlangan' };
export const opts = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }));
export const GRADES = [{ value: '', label: 'Umumiy' }, ...Array.from({ length: 11 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}-sinf` }))];

/** Rang yolg'iz ma'no tashimaydi — ikonka + so'z. */
export function loanStatus(l: LoanRow): { kind: StatusKind; label: string; icon: IconName } {
  if (l.status === 'lost') return { kind: 'crit', label: "Yo'qolgan", icon: 'x' };
  if (l.status === 'returned') {
    return l.condition_in === 'damaged'
      ? { kind: 'warn', label: 'Shikast bilan qaytdi', icon: 'alert-triangle' }
      : { kind: 'good', label: 'Qaytarilgan', icon: 'check' };
  }
  if (l.overdue) return { kind: 'crit', label: `${l.days_late} kun kechikdi`, icon: 'clock' };
  return { kind: 'neutral', label: "Qo'lida", icon: 'book' };
}

export function libraryInvalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['loans'] });
  qc.invalidateQueries({ queryKey: ['books'] });
  qc.invalidateQueries({ queryKey: ['book'] });
  qc.invalidateQueries({ queryKey: ['library-counts'] });
  qc.invalidateQueries({ queryKey: ['student-books'] });
}

// ---------------------------------------------------------------- kitob berish
export function IssueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useTheme();
  const qc = useQueryClient();
  const [student, setStudent] = useState<StudentPick | null>(null);
  const [book, setBook] = useState<BookRow | null>(null);
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');

  // Sukut muddat sozlamadan keladi — kodda "14 kun" deb yozilmaydi.
  const settings = useQuery({
    queryKey: ['library-settings'],
    queryFn: () => api<{ loanDays: number; defaultDueOn: string }>('/library/settings'),
    enabled: open,
  });
  useEffect(() => {
    if (settings.data && !due) setDue(fmtDate(settings.data.defaultDueOn));
  }, [settings.data, due]);

  const dueIso = parseUzDate(due);
  const badDue = due.length > 0 && (!dueIso || dueIso < isoDate());

  // O'quvchi tanlangach darrov tekshiramiz — "Berish" bosilishini kutmaymiz.
  const held = useQuery({
    queryKey: ['student-active', student?.id],
    enabled: Boolean(student),
    queryFn: () => api<ActiveLoans>(`/library/students/${student!.id}/active`),
  });
  const blocked = held.data?.blocked ?? false;

  const issue = useMutation({
    mutationFn: () => api('/library/loans', 'POST', { studentId: student!.id, bookId: book!.id, dueOn: dueIso, note: note.trim() || undefined }),
    onSuccess: () => {
      libraryInvalidate(qc);
      qc.invalidateQueries({ queryKey: ['student-active'] });
      setStudent(null); setBook(null); setNote(''); setDue('');
      onClose();
    },
  });

  const quick = (days: number) => setDue(fmtDate(addDays(isoDate(), days)));

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Kitob berish"
      footer={
        <>
          <BigButton title={issue.isPending ? 'Beriladi…' : 'Berish'} onPress={() => issue.mutate()} busy={issue.isPending} disabled={!student || !book || !dueIso || badDue || blocked || held.isFetching} />
          <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={onClose} />
        </>
      }
    >
      <SearchPicker<StudentPick>
        label="O'quvchi"
        placeholder="Familiya yoki ism…"
        fetch={(q) => api<{ items: StudentPick[] }>(`/students${qs({ q, limit: 20 })}`).then((r) => r.items)}
        getKey={(s) => s.id}
        getLabel={rosterName}
        getHint={(s) => s.class_name ?? 'sinfsiz'}
        value={student}
        onPick={setStudent}
        emptyText="O'quvchi topilmadi"
      />
      {blocked && held.data ? <LoanAlarm data={held.data} /> : null}
      <SearchPicker<BookRow>
        label="Kitob"
        placeholder="Kitob nomi yoki muallif…"
        help="Faqat javonda bo'sh nusxasi bor kitoblar ko'rsatiladi. Inventar raqami avtomatik — javondagi birinchi bo'sh nusxa."
        fetch={(q) => api<{ items: BookRow[] }>(`/library/books${qs({ search: q, availableOnly: 'true', limit: 20 })}`).then((r) => r.items)}
        getKey={(b) => b.id}
        getLabel={(b) => b.title}
        getHint={(b) => `${b.author ?? '—'} · javonda ${b.available_copies} ta`}
        value={book}
        onPick={setBook}
        emptyText="Bo'sh kitob topilmadi"
      />
      <Field label="Qaytarish sanasi" value={due} onChangeText={(v) => setDue(maskUzDate(v))} keyboardType="number-pad" placeholder="KK.OO.YYYY" error={badDue} />
      {badDue ? <Help text="Sana bugundan keyin bo'lishi kerak (KK.OO.YYYY)" error /> : settings.data ? <Help text={`Sukut bo'yicha ${settings.data.loanDays} kun.`} /> : null}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[7, 14, 30].map((d) => (
          <Pressable key={d} onPress={() => quick(d)} style={{ flex: 1, height: 40, borderRadius: radius.tile, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: c.t2 }}>+{d} kun</Text>
          </Pressable>
        ))}
      </View>
      <Field label="Izoh" value={note} onChangeText={setNote} placeholder="ixtiyoriy" />
      <ErrorText text={issue.error?.message} />
    </FormSheet>
  );
}

/**
 * Qo'lida kitobi bor o'quvchi — kutubxonachiga ogohlantirish.
 */
function LoanAlarm({ data }: { data: ActiveLoans }) {
  const c = useTheme();
  return (
    <Alarm
      title={
        data.items.length === 1
          ? "Bu o'quvchi hozir kitob o'qiyapti"
          : `Bu o'quvchida ${data.items.length} ta kitob bor — chegara ${data.limit} ta`
      }
    >
      {data.items.map((l) => (
        <Text key={l.id} style={{ fontSize: 13, color: c.t2 }}>
          {l.title}
          {l.author ? ` — ${l.author}` : ''} · {l.inventory_no} · muddat {fmtDate(l.due_on)}
          {l.overdue ? ` · ${l.days_late} kun kechikdi` : ''}
        </Text>
      ))}
      <Text style={{ fontSize: 12, color: c.t3 }}>
        Avval shu kitobni qabul qiling — «Berilganlar» bo'limi.
      </Text>
    </Alarm>
  );
}

// ---------------------------------------------------------------- qabul qilish
export function ReturnSheet({ loan, onClose }: { loan: LoanRow | null; onClose: () => void }) {
  const c = useTheme();
  const qc = useQueryClient();
  const [condition, setCondition] = useState('good');
  const [note, setNote] = useState('');
  const done = () => { libraryInvalidate(qc); setCondition('good'); setNote(''); onClose(); };

  const back = useMutation({
    mutationFn: () => api(`/library/loans/${loan!.id}/return`, 'POST', { condition, note: note.trim() || undefined }),
    onSuccess: done,
  });
  const lost = useMutation({
    mutationFn: () => api(`/library/loans/${loan!.id}/lost`, 'POST', { note: note.trim() || undefined }),
    onSuccess: done,
  });
  const busy = back.isPending || lost.isPending;

  return (
    <FormSheet
      open={!!loan}
      onClose={onClose}
      title="Kitobni qabul qilish"
      sub={loan ? `${loan.student_name} — ${loan.title}` : undefined}
      footer={
        <>
          <BigButton title={back.isPending ? 'Qabul qilinmoqda…' : 'Qabul qildim'} icon="check" onPress={() => back.mutate()} busy={back.isPending} disabled={busy} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><BigButton title="Yo'qolgan" icon="x" variant="danger" height={44} onPress={() => lost.mutate()} busy={lost.isPending} disabled={busy} /></View>
            <View style={{ flex: 1 }}><BigButton title="Bekor qilish" variant="secondary" height={44} onPress={onClose} disabled={busy} /></View>
          </View>
        </>
      }
    >
      {loan && (
        <Text style={{ fontSize: 13, color: c.t2, lineHeight: 19 }}>
          Inventar: <Text style={{ fontVariant: ['tabular-nums'], color: c.t1 }}>{loan.inventory_no}</Text> · muddat {fmtDate(loan.due_on)}
          {loan.overdue && <Text style={{ fontWeight: '700', color: c.critInk }}> · {loan.days_late} kun kechikdi</Text>}
        </Text>
      )}
      <Select label="Kitob holati" value={condition} options={opts(CONDITION)} onChange={setCondition} help="Shikastlangan kitob javonga qaytmaydi — ta'mir ro'yxatiga tushadi." />
      <Field label="Izoh" value={note} onChangeText={setNote} placeholder="ixtiyoriy" />
      <ErrorText text={(back.error ?? lost.error)?.message} />
    </FormSheet>
  );
}

// ---------------------------------------------------------------- kitob qo'shish
export function BookCreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const empty = { title: '', author: '', category: 'boshqa', grade: '', language: 'uz', publisher: '', publishedYear: '', isbn: '', shelf: '', price: '', copies: '1' };
  const [f, setF] = useState(empty);
  const set = <K extends keyof typeof f>(k: K) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { title: f.title.trim(), category: f.category, language: f.language, copies: Number(f.copies) || 1 };
      if (f.author.trim()) body.author = f.author.trim();
      if (f.grade) body.grade = Number(f.grade);
      if (f.publisher.trim()) body.publisher = f.publisher.trim();
      if (f.publishedYear) body.publishedYear = Number(f.publishedYear);
      if (f.isbn.trim()) body.isbn = f.isbn.trim();
      if (f.shelf.trim()) body.shelf = f.shelf.trim();
      if (f.price) body.price = Number(f.price.replace(/\s/g, ''));
      return api('/library/books', 'POST', body);
    },
    onSuccess: () => { libraryInvalidate(qc); setF(empty); onClose(); },
  });

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Yangi kitob"
      footer={
        <>
          <BigButton title={create.isPending ? 'Saqlanmoqda…' : 'Saqlash'} onPress={() => create.mutate()} busy={create.isPending} disabled={f.title.trim().length < 2} />
          <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={onClose} />
        </>
      }
    >
      <Field label="Nomi" value={f.title} onChangeText={set('title')} />
      <Field label="Muallif" value={f.author} onChangeText={set('author')} />
      <Select label="Bo'lim" value={f.category} options={opts(CATEGORY)} onChange={set('category')} />
      <Select label="Sinf" value={f.grade} options={GRADES} onChange={set('grade')} />
      <Select label="Til" value={f.language} options={opts(LANGUAGE)} onChange={set('language')} />
      <Field label="Nashriyot" value={f.publisher} onChangeText={set('publisher')} />
      <Field label="Nashr yili" value={f.publishedYear} onChangeText={set('publishedYear')} keyboardType="number-pad" />
      <Field label="ISBN" value={f.isbn} onChangeText={set('isbn')} />
      <Field label="Javon" value={f.shelf} onChangeText={set('shelf')} placeholder="A-3" />
      <MoneyField label="Narxi" value={f.price} onChangeText={set('price')} placeholder="0" help="Yo'qolganda undiriladigan qiymat." />
      <Field label="Nusxalar soni" value={f.copies} onChangeText={set('copies')} keyboardType="number-pad" />
      <Help text="Inventar raqamlari avtomatik beriladi (KT-000001…). Ko'p kitobni Excel orqali kiritish web'da." />
      <ErrorText text={create.error?.message} />
    </FormSheet>
  );
}

/** O'quvchi kartasida ko'rsatiladigan kitob tarixi. */
export function StudentBooks({ studentId }: { studentId: string }) {
  const c = useTheme();
  const q = useQuery({
    queryKey: ['student-books', studentId],
    queryFn: () => api<{ items: LoanRow[]; active: number; total: number }>(`/library/students/${studentId}/history`),
  });
  if (q.isPending) return <Skeleton rows={2} height={48} />;
  if (q.isError) return <ErrorState message={q.error.message} onRetry={() => q.refetch()} />;
  if (!q.data.total) return <Text style={{ fontSize: 13, color: c.t3 }}>Kitob olmagan.</Text>;
  return (
    <View>
      {q.data.items.map((l, i) => {
        const st = loanStatus(l);
        return (
          <ListItem
            key={l.id}
            title={l.title}
            sub={`${l.inventory_no} · olgan ${fmtDate(l.issued_on)}${l.returned_on ? ` · qaytargan ${fmtDate(l.returned_on)}` : ` · muddat ${fmtDate(l.due_on)}`}`}
            right={<Pill kind={st.kind} icon={st.icon} label={st.label} />}
            last={i === q.data.items.length - 1}
          />
        );
      })}
    </View>
  );
}
