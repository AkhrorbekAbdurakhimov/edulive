import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { api, perms, qs, type AuthedUser } from '../api';
import { fmtDate } from '../format';
import { Chips, Fab, IconButton, ListItem, SearchField, useDebounced } from '../forms';
import { useTheme } from '../theme';
import { AppBar, BigButton, Card, EmptyState, ErrorState, Pill, Skeleton } from '../ui';
import { BookCreateSheet, CATEGORY, IssueSheet, LANGUAGE, ReturnSheet, loanStatus, type BookRow, type LoanRow } from './LibraryForms';

type Tab = 'books' | 'loans' | 'overdue';

/** Kutubxona (web Library): kitoblar · berilganlar · muddati o'tgan. */
export function LibraryScreen({ user, onOpenBook }: { user: AuthedUser; onOpenBook: (b: BookRow) => void }) {
  const c = useTheme();
  const p = perms(user);
  const canEdit = p.library;
  const [tab, setTab] = useState<Tab>('books');
  const [issue, setIssue] = useState(false);
  const [create, setCreate] = useState(false);

  const counts = useQuery({
    queryKey: ['library-counts'],
    queryFn: () => api<{ counts: { issued: number; overdue: number; returned: number; lost: number } }>('/library/loans?limit=1'),
    select: (r) => r.counts,
  });

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar
        title="Kutubxona"
        meta={counts.data ? `${counts.data.issued} ta o'quvchida${counts.data.overdue > 0 ? ` · ${counts.data.overdue} tasining muddati o'tgan` : ''}` : undefined}
        right={canEdit ? <IconButton name="plus-square" label="Yangi kitob" onPress={() => setCreate(true)} /> : undefined}
      />
      <View style={{ paddingHorizontal: 14, paddingBottom: 8 }}>
        <Chips<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'books', label: 'Kitoblar' },
            { value: 'loans', label: 'Berilganlar' },
            { value: 'overdue', label: `Muddati o'tgan${counts.data?.overdue ? ` (${counts.data.overdue})` : ''}` },
          ]}
        />
      </View>

      {tab === 'books' ? <BooksTab onOpen={onOpenBook} /> : <LoansTab key={tab} overdueOnly={tab === 'overdue'} canEdit={canEdit} />}

      {canEdit && <Fab label="Kitob berish" icon="book-open" onPress={() => setIssue(true)} />}
      {canEdit && <IssueSheet open={issue} onClose={() => setIssue(false)} />}
      {canEdit && <BookCreateSheet open={create} onClose={() => setCreate(false)} />}
    </View>
  );
}

function BooksTab({ onOpen }: { onOpen: (b: BookRow) => void }) {
  const c = useTheme();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [category, setCategory] = useState('');
  const [avail, setAvail] = useState<'all' | 'available'>('all');

  const books = useQuery({
    queryKey: ['books', dq, category, avail],
    queryFn: () => api<{ items: BookRow[]; total: number }>(`/library/books${qs({ search: dq, category, availableOnly: avail === 'available' ? 'true' : '', limit: 100 })}`),
  });

  return (
    <>
      <View style={{ paddingHorizontal: 14, gap: 8, paddingBottom: 8 }}>
        <SearchField value={q} onChangeText={setQ} placeholder="Kitob nomi, muallif yoki ISBN…" />
        <Chips value={category} onChange={setCategory} options={[{ value: '', label: "Barcha bo'limlar" }, ...Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))]} />
        <Chips<'all' | 'available'> value={avail} onChange={setAvail} options={[{ value: 'all', label: 'Hammasi' }, { value: 'available', label: 'Faqat javonda borlari' }]} />
      </View>
      {books.isPending ? (
        <View style={{ padding: 14 }}><Skeleton rows={6} height={56} /></View>
      ) : books.isError ? (
        <ErrorState message={books.error.message} onRetry={() => books.refetch()} />
      ) : books.data.items.length === 0 ? (
        <EmptyState icon="book" title="Kitob topilmadi" text={dq || category ? "Filtrni o'zgartirib ko'ring" : "Kitoblarni yuqoridagi + orqali bittalab qo'shing yoki web'da Excel orqali bir yo'la yuklang."} />
      ) : (
        <FlatList
          data={books.data.items}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 90 }}
          renderItem={({ item: b, index }) => (
            <ListItem
              title={b.title}
              sub={[b.author, CATEGORY[b.category] ?? b.category, b.grade ? `${b.grade}-sinf` : null, LANGUAGE[b.language], b.shelf ? `javon ${b.shelf}` : null].filter(Boolean).join(' · ')}
              right={
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: c.t1, fontVariant: ['tabular-nums'] }}>
                    {b.available_copies}<Text style={{ color: c.t3, fontWeight: '500' }}> / {b.total_copies}</Text>
                  </Text>
                  {b.available_copies > 0 ? <Pill kind="good" icon="check" label="Javonda bor" /> : <Pill kind="warn" icon="clock" label="Hammasi berilgan" />}
                </View>
              }
              onPress={() => onOpen(b)}
              last={index === books.data.items.length - 1}
            />
          )}
        />
      )}
    </>
  );
}

function LoansTab({ overdueOnly, canEdit }: { overdueOnly: boolean; canEdit: boolean }) {
  const c = useTheme();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [status, setStatus] = useState(overdueOnly ? 'overdue' : 'issued');
  const [returning, setReturning] = useState<LoanRow | null>(null);
  const effective = overdueOnly ? 'overdue' : status;

  const loans = useQuery({
    queryKey: ['loans', effective, dq],
    queryFn: () => api<{ items: LoanRow[]; total: number }>(`/library/loans${qs({ status: effective, search: dq, limit: 100 })}`),
  });

  return (
    <>
      <View style={{ paddingHorizontal: 14, gap: 8, paddingBottom: 8 }}>
        <SearchField value={q} onChangeText={setQ} placeholder="O'quvchi, kitob yoki inventar raqami…" />
        {!overdueOnly && (
          <Chips value={status} onChange={setStatus} options={[{ value: 'issued', label: "Qo'lida" }, { value: 'returned', label: 'Qaytarilgan' }, { value: 'lost', label: "Yo'qolgan" }, { value: '', label: 'Hammasi' }]} />
        )}
      </View>
      {loans.isPending ? (
        <View style={{ padding: 14 }}><Skeleton rows={5} height={96} /></View>
      ) : loans.isError ? (
        <ErrorState message={loans.error.message} onRetry={() => loans.refetch()} />
      ) : loans.data.items.length === 0 ? (
        <EmptyState
          icon={overdueOnly ? 'check-circle' : 'book'}
          title={overdueOnly ? "Muddati o'tgan kitob yo'q" : "Yozuv yo'q"}
          text={overdueOnly ? "Hamma kitob o'z vaqtida qaytarilgan." : "Kitob berilganda shu yerda ko'rinadi."}
        />
      ) : (
        <FlatList
          data={loans.data.items}
          keyExtractor={(l) => l.id}
          contentContainerStyle={{ padding: 14, paddingBottom: 90, gap: 9 }}
          renderItem={({ item: l }) => {
            const st = loanStatus(l);
            return (
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: c.t1 }}>{l.student_name}</Text>
                    <Text style={{ fontSize: 12, color: c.t3 }}>{l.class_name ?? 'Sinfsiz'}</Text>
                  </View>
                  <Pill kind={st.kind} icon={st.icon} label={st.label} />
                </View>
                <Text style={{ fontSize: 14, color: c.t1, marginTop: 8 }}>{l.title}</Text>
                <Text style={{ fontSize: 12, color: c.t3, fontVariant: ['tabular-nums'] }}>
                  {l.inventory_no} · berilgan {fmtDate(l.issued_on)} · {l.returned_on ? `qaytarilgan ${fmtDate(l.returned_on)}` : `muddat ${fmtDate(l.due_on)}`}
                </Text>
                {l.status === 'issued' && canEdit && (
                  <View style={{ marginTop: 10 }}>
                    <BigButton title="Qabul qilish" icon="check" variant="secondary" height={44} onPress={() => setReturning(l)} />
                  </View>
                )}
              </Card>
            );
          }}
        />
      )}
      <ReturnSheet loan={returning} onClose={() => setReturning(null)} />
    </>
  );
}
