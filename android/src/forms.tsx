import { useEffect, useState, type ReactNode } from 'react';
import {
  Dimensions, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HIT, radius, useTheme } from './theme';
import { Card, Field, Icon, Sheet, Skeleton, statusColors, type IconName, type StatusKind } from './ui';

/**
 * Ro'yxat va forma qismlari — web'dagi Picker, Chip, Modal, form-grid
 * ekvivalentlari, telefon uchun: hamma tanlov pastdan chiqadigan sheet'da,
 * teginish nishoni ≥ 44dp.
 */

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Qidiruv maydoni (H44, ikonka bilan). */
export function SearchField({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder?: string }) {
  const c = useTheme();
  return (
    <View style={{ height: HIT, borderWidth: 1, borderColor: c.border, borderRadius: radius.control, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 }}>
      <Icon name="search" size={16} color={c.t3} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.t3}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{ flex: 1, color: c.t1, fontSize: 15, paddingVertical: 0 }}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText('')} hitSlop={8} accessibilityLabel="Tozalash">
          <Icon name="x" size={16} color={c.t3} />
        </Pressable>
      )}
    </View>
  );
}

/** Gorizontal filtr chiplari — bitta tanlov. */
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  const c = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{ height: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderColor: on ? c.brand : c.border, backgroundColor: on ? c.brandSoft : c.surface }}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: on ? c.brandInk : c.t2 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Maydon ko'rinishidagi bosiladigan qator: yorliq + qiymat + chevron. */
function FieldButton({ label, value, placeholder, help, error, onPress, onClear, disabled }: {
  label: string; value: string; placeholder?: string; help?: string; error?: string; onPress: () => void; onClear?: () => void; disabled?: boolean;
}) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '500', color: c.t2 }}>{label}</Text>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        style={{ minHeight: 48, borderWidth: 1, borderColor: error ? c.crit : c.border, borderRadius: radius.control, backgroundColor: c.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8, opacity: disabled ? 0.6 : 1 }}
      >
        <Text style={{ flex: 1, fontSize: 16, color: value ? c.t1 : c.t3 }} numberOfLines={1}>{value || placeholder || 'Tanlang…'}</Text>
        {value && onClear ? (
          <Pressable onPress={onClear} hitSlop={8} accessibilityLabel="Tanlovni bekor qilish"><Icon name="x" size={16} color={c.t3} /></Pressable>
        ) : (
          <Icon name="chevron-down" size={18} color={c.t3} />
        )}
      </Pressable>
      {error ? <Text style={{ fontSize: 12, color: c.critInk }}>{error}</Text> : help ? <Text style={{ fontSize: 12, color: c.t3 }}>{help}</Text> : null}
    </View>
  );
}

/** Variantlardan tanlash — <select> ekvivalenti, pastdan chiqadigan ro'yxat. */
export function Select<T extends string>({ label, value, options, onChange, placeholder, help, disabled }: {
  label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; placeholder?: string; help?: string; disabled?: boolean;
}) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <FieldButton label={label} value={current?.label ?? ''} placeholder={placeholder} help={help} onPress={() => setOpen(true)} disabled={disabled} />
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView style={{ maxHeight: 380 }}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <Pressable
                key={o.value}
                onPress={() => { onChange(o.value); setOpen(false); }}
                accessibilityRole="menuitem"
                style={{ minHeight: HIT + 4, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: c.border }}
              >
                <Text style={{ flex: 1, fontSize: 15, color: on ? c.brandInk : c.t1, fontWeight: on ? '700' : '500' }}>{o.label}</Text>
                {on && <Icon name="check" size={18} color={c.brandInk} />}
              </Pressable>
            );
          })}
        </ScrollView>
      </Sheet>
    </>
  );
}

/**
 * Qidiruvli tanlagich (web `Picker` ekvivalenti). Ro'yxat serverdan qidirib
 * keltiriladi — yuzlab o'quvchi, minglab kitob uchun oddiy select yaramaydi.
 * Tanlangan element alohida saqlanadi: qidiruv natijasi o'zgarsa ham ko'rinib turadi.
 */
export function SearchPicker<T>({ label, placeholder, help, error, fetch, getKey, getLabel, getHint, value, onPick, emptyText = 'Topilmadi' }: {
  label: string; placeholder?: string; help?: string; error?: string;
  fetch: (q: string) => Promise<T[]>;
  getKey: (item: T) => string; getLabel: (item: T) => string; getHint?: (item: T) => string;
  value: T | null; onPick: (item: T | null) => void; emptyText?: string;
}) {
  const c = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [items, setItems] = useState<T[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setItems(null);
    setFailed(null);
    fetch(dq.trim()).then((r) => alive && setItems(r)).catch((e: any) => alive && setFailed(e?.message ?? 'Xatolik'));
    return () => { alive = false; };
    // fetch har renderda yangi funksiya bo'lishi mumkin — bog'liqlikka qo'shilmaydi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dq]);

  return (
    <>
      <FieldButton
        label={label} value={value ? getLabel(value) : ''} placeholder={placeholder} help={help} error={error}
        onPress={() => { setQ(''); setOpen(true); }} onClear={() => onPick(null)}
      />
      <Sheet open={open} onClose={() => setOpen(false)} title={label}>
        <SearchField value={q} onChangeText={setQ} placeholder={placeholder ?? 'Qidirish…'} />
        <ScrollView style={{ maxHeight: 360, marginTop: 8 }} keyboardShouldPersistTaps="handled">
          {failed ? (
            <Text style={{ color: c.critInk, fontSize: 13, padding: 12 }}>{failed}</Text>
          ) : items === null ? (
            <View style={{ paddingTop: 8 }}><Skeleton rows={4} height={44} /></View>
          ) : items.length === 0 ? (
            <Text style={{ color: c.t3, fontSize: 13, padding: 12, textAlign: 'center' }}>{emptyText}</Text>
          ) : (
            items.map((it) => {
              const k = getKey(it);
              const on = value ? getKey(value) === k : false;
              return (
                <Pressable
                  key={k}
                  onPress={() => { onPick(it); setOpen(false); }}
                  style={{ minHeight: HIT + 4, justifyContent: 'center', paddingHorizontal: 4, borderBottomWidth: 1, borderColor: c.border }}
                >
                  <Text style={{ fontSize: 15, fontWeight: on ? '700' : '600', color: on ? c.brandInk : c.t1 }}>{getLabel(it)}</Text>
                  {getHint && <Text style={{ fontSize: 12, color: c.t3 }}>{getHint(it)}</Text>}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </Sheet>
    </>
  );
}

/** Checkbox qatori (web .check-row). */
export function Toggle({ label, help, value, onChange, disabled }: { label: string; help?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const c = useTheme();
  return (
    <Pressable
      onPress={() => !disabled && onChange(!value)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: HIT, paddingVertical: 6, opacity: disabled ? 0.6 : 1 }}
    >
      <Icon name={value ? 'check-square' : 'square'} size={22} color={value ? c.brandInk : c.t3} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '500', color: c.t1 }}>{label}</Text>
        {help && <Text style={{ fontSize: 12, color: c.t3, marginTop: 2 }}>{help}</Text>}
      </View>
    </Pressable>
  );
}

/** Pul maydoni — yozilayotganda 2 000 000 ko'rinishida. */
export function MoneyField({ label, value, onChangeText, help, placeholder, error }: { label: string; value: string; onChangeText: (v: string) => void; help?: string; placeholder?: string; error?: boolean }) {
  const c = useTheme();
  return (
    <View>
      <Field
        label={label}
        value={value}
        onChangeText={(v) => onChangeText(v.replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, ' '))}
        keyboardType="number-pad"
        placeholder={placeholder ?? '1 200 000'}
        error={error}
      />
      {help && <Text style={{ fontSize: 12, color: c.t3, marginTop: 4 }}>{help}</Text>}
    </View>
  );
}

/** Yordamchi matn maydon ostida. */
export function Help({ text, error }: { text: string; error?: boolean }) {
  const c = useTheme();
  return <Text style={{ fontSize: 12, color: error ? c.critInk : c.t3, marginTop: -6 }}>{text}</Text>;
}

/** Forma uchun sheet: klaviaturadan qochadi, uzun forma aylanadi, tugmalar pastda. */
export function FormSheet({ open, onClose, title, sub, children, footer }: { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode; footer: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const maxH = Dimensions.get('window').height * 0.9;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={onClose} accessibilityLabel="Yopish" />
        <View style={{ backgroundColor: c.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, maxHeight: maxH, paddingBottom: 12 + insets.bottom }}>
          <View style={{ width: 34, height: 4, borderRadius: 99, backgroundColor: c.borderStrong, alignSelf: 'center', marginTop: 8, marginBottom: 10 }} />
          <View style={{ paddingHorizontal: 16 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: c.t1, letterSpacing: -0.3 }}>{title}</Text>
            {sub && <Text style={{ fontSize: 12, color: c.t3, marginTop: 3 }}>{sub}</Text>}
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 12 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          <View style={{ paddingHorizontal: 16, paddingTop: 10, gap: 8, borderTopWidth: 1, borderColor: c.border }}>{footer}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Statistika plitkasi (web .stat-tile). */
export function Tile({ label, value, sub, onPress, tone }: { label: string; value: string | number; sub?: string; onPress?: () => void; tone?: StatusKind }) {
  const c = useTheme();
  return (
    <Card onPress={onPress} style={{ flexGrow: 1, flexBasis: '46%' }}>
      <Text style={{ fontSize: 11, color: c.t3, fontWeight: '500' }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: '700', color: tone ? statusColors(c, tone).fg : c.t1, fontVariant: ['tabular-nums'], marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub && <Text style={{ fontSize: 12, color: c.t3, marginTop: 2 }} numberOfLines={2}>{sub}</Text>}
    </Card>
  );
}

/** Ro'yxat qatori: chap element · sarlavha + izoh · o'ng element. */
export function ListItem({ title, sub, left, right, onPress, last }: { title: string; sub?: string; left?: ReactNode; right?: ReactNode; onPress?: () => void; last?: boolean }) {
  const c = useTheme();
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: last ? 0 : 1, borderColor: c.border, minHeight: HIT + 8 }}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: c.t1 }} numberOfLines={1}>{title}</Text>
        {sub && <Text style={{ fontSize: 12, color: c.t3, marginTop: 1 }} numberOfLines={2}>{sub}</Text>}
      </View>
      {right}
      {onPress && !right && <Icon name="chevron-right" size={18} color={c.t3} />}
    </View>
  );
  if (!onPress) return inner;
  return <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{inner}</Pressable>;
}

/** Inline xato (forma ostida). */
export function ErrorText({ text }: { text: string | null | undefined }) {
  const c = useTheme();
  if (!text) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
      <Icon name="alert-circle" size={14} color={c.critInk} />
      <Text style={{ color: c.critInk, fontSize: 13, flex: 1 }}>{text}</Text>
    </View>
  );
}

/** "Saqlandi" kabi yashil eslatma. */
export function SaveNote({ text }: { text: string | null | undefined }) {
  const c = useTheme();
  if (!text) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
      <Icon name="check-circle" size={14} color={c.goodInk} />
      <Text style={{ color: c.goodInk, fontSize: 13, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}

/** Kichik ikonkali tugma (sarlavhada). */
export function IconButton({ name, onPress, label }: { name: IconName; onPress: () => void; label: string }) {
  const c = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center', borderRadius: 8, opacity: pressed ? 0.6 : 1 })}>
      <Icon name={name} size={20} color={c.t2} />
    </Pressable>
  );
}

/** Ekran pastidagi yumaloq asosiy amal (o'quvchi qo'shish, kitob berish). */
export function Fab({ label, icon, onPress }: { label: string; icon: IconName; onPress: () => void }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({ position: 'absolute', right: 16, bottom: 16 + insets.bottom, height: 50, paddingHorizontal: 18, borderRadius: 999, backgroundColor: c.brand, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.85 : 1, elevation: 4 })}
    >
      <Icon name={icon} size={18} color="#fff" />
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

/** Rang so'z bilan birga: to'lov/hisob holati. */
export function invoiceKind(status: string): { kind: StatusKind; label: string; icon: IconName } {
  switch (status) {
    case 'paid': return { kind: 'good', label: "To'langan", icon: 'check' };
    case 'partial': return { kind: 'warn', label: 'Qisman', icon: 'clock' };
    case 'open': return { kind: 'crit', label: 'Qarzdor', icon: 'alert-circle' };
    default: return { kind: 'neutral', label: status, icon: 'minus' };
  }
}
