import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, perms, type AuthedUser } from '../api';
import { fmtDate, fmtNum } from '../format';
import { ErrorText, ListItem, MoneyField, SaveNote, Select } from '../forms';
import { useTheme } from '../theme';
import { AppBar, BigButton, ErrorState, Field, Pill, SectionLabel, Sheet, Skeleton, ThumbZone, type IconName, type StatusKind } from '../ui';
import { CATEGORY, GRADES, LANGUAGE, libraryInvalidate, opts, type BookRow } from './LibraryForms';

interface CopyRow { id: string; inventory_no: string; condition: string; status: string; holder_name: string | null; loan_id: string | null; due_on: string | null }

function copyStatus(s: string): { kind: StatusKind; label: string; icon: IconName } {
  switch (s) {
    case 'shelf': return { kind: 'good', label: 'Javonda', icon: 'check' };
    case 'issued': return { kind: 'neutral', label: 'Berilgan', icon: 'book' };
    case 'lost': return { kind: 'crit', label: "Yo'qolgan", icon: 'x' };
    case 'repair': return { kind: 'warn', label: "Ta'mirda", icon: 'tool' };
    case 'written_off': return { kind: 'neutral', label: 'Hisobdan chiqarilgan', icon: 'minus' };
    default: return { kind: 'neutral', label: s, icon: 'minus' };
  }
}

/**
 * Kitob kartasi: tahrirlash, nusxalar holati (kimda), nusxa qo'shish, arxivlash.
 * Nusxa kimdaligi shu yerda — javondan topolmagan kutubxonachi birinchi shuni qidiradi.
 */
export function BookDetailScreen({ book, user, onBack }: { book: BookRow; user: AuthedUser; onBack: () => void }) {
  const c = useTheme();
  const canEdit = perms(user).library;
  const qc = useQueryClient();
  const [f, setF] = useState({
    title: book.title, author: book.author ?? '', category: book.category,
    grade: book.grade ? String(book.grade) : '', language: book.language,
    shelf: book.shelf ?? '', price: book.price ? fmtNum(String(Math.round(book.price))) : '',
  });
  const set = <K extends keyof typeof f>(k: K) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const [addCount, setAddCount] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  const detail = useQuery({
    queryKey: ['book', book.id],
    queryFn: () => api<{ book: BookRow; copies: CopyRow[] }>(`/library/books/${book.id}`),
  });

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { title: f.title.trim(), category: f.category, language: f.language, author: f.author.trim() || null, shelf: f.shelf.trim() || null };
      if (f.grade) body.grade = Number(f.grade);
      if (f.price) body.price = Number(f.price.replace(/\s/g, ''));
      return api(`/library/books/${book.id}`, 'PATCH', body);
    },
    onSuccess: () => { libraryInvalidate(qc); setSaved(true); setTimeout(() => setSaved(false), 2000); },
  });
  const addCopies = useMutation({
    mutationFn: () => api(`/library/books/${book.id}/copies`, 'POST', { count: Number(addCount) || 1 }),
    onSuccess: () => { setAddCount(''); libraryInvalidate(qc); },
  });
  const archive = useMutation({
    mutationFn: () => api(`/library/books/${book.id}`, 'DELETE'),
    onSuccess: () => { libraryInvalidate(qc); onBack(); },
  });

  const b = detail.data?.book ?? book;

  return (
    <View style={{ flex: 1, backgroundColor: c.surface }}>
      <AppBar title={b.title} meta={`${b.available_copies} / ${b.total_copies} nusxa javonda`} onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
        <Field label="Nomi" value={f.title} onChangeText={set('title')} editable={canEdit} />
        <Field label="Muallif" value={f.author} onChangeText={set('author')} editable={canEdit} />
        <Select label="Bo'lim" value={f.category} options={opts(CATEGORY)} onChange={set('category')} disabled={!canEdit} />
        <Select label="Sinf" value={f.grade} options={GRADES} onChange={set('grade')} disabled={!canEdit} />
        <Select label="Til" value={f.language} options={opts(LANGUAGE)} onChange={set('language')} disabled={!canEdit} />
        <Field label="Javon" value={f.shelf} onChangeText={set('shelf')} editable={canEdit} />
        <MoneyField label="Narxi" value={f.price} onChangeText={set('price')} placeholder="0" />
        <ErrorText text={save.error?.message} />
        <SaveNote text={saved ? 'Saqlandi' : null} />

        <View style={{ marginTop: 6 }}>
          <SectionLabel>{`Nusxalar${detail.data ? ` (${detail.data.copies.length} ta)` : ''}`}</SectionLabel>
          {detail.isPending ? (
            <Skeleton rows={3} height={48} />
          ) : detail.isError ? (
            <ErrorState message={detail.error.message} onRetry={() => detail.refetch()} />
          ) : (
            detail.data.copies.map((cp, i) => {
              const st = copyStatus(cp.status);
              return (
                <ListItem
                  key={cp.id}
                  title={cp.inventory_no}
                  sub={cp.holder_name ? `${cp.holder_name}${cp.due_on ? ` · muddat ${fmtDate(cp.due_on)}` : ''}` : undefined}
                  right={<Pill kind={st.kind} icon={st.icon} label={st.label} />}
                  last={i === detail.data.copies.length - 1}
                />
              );
            })
          )}
        </View>

        {canEdit && (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field label="Nusxa qo'shish" value={addCount} onChangeText={(v) => setAddCount(v.replace(/\D/g, ''))} keyboardType="number-pad" placeholder="0" />
            </View>
            <View style={{ width: 130, paddingBottom: 0 }}>
              <BigButton title={addCopies.isPending ? '…' : "Qo'shish"} variant="secondary" height={48} onPress={() => addCopies.mutate()} disabled={!Number(addCount)} busy={addCopies.isPending} />
            </View>
          </View>
        )}
        <ErrorText text={(addCopies.error ?? archive.error)?.message} />

        {canEdit && (
          <BigButton title="Kitobni arxivlash" icon="archive" variant="danger" height={44} onPress={() => setArchiveOpen(true)} />
        )}
      </ScrollView>

      {canEdit && (
        <ThumbZone>
          <BigButton title={save.isPending ? 'Saqlanmoqda…' : 'Saqlash'} icon="check" onPress={() => save.mutate()} busy={save.isPending} disabled={f.title.trim().length < 2} />
        </ThumbZone>
      )}

      <Sheet open={archiveOpen} onClose={() => setArchiveOpen(false)} title="Kitobni arxivlash" sub={b.title}>
        <Text style={{ fontSize: 13, color: c.t2, lineHeight: 19 }}>Kitob o'chirilmaydi — arxivga o'tadi, berish tarixi saqlanib qoladi. Qo'lda bo'lgan nusxalar bo'lsa server rad etadi.</Text>
        <View style={{ marginTop: 14, gap: 8 }}>
          <BigButton title={archive.isPending ? '…' : 'Arxivlash'} variant="danger" onPress={() => archive.mutate()} busy={archive.isPending} />
          <BigButton title="Bekor qilish" variant="secondary" height={44} onPress={() => setArchiveOpen(false)} />
        </View>
      </Sheet>
    </View>
  );
}
