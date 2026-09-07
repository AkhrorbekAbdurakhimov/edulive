import type { ReactNode } from 'react';
import {
  ActivityIndicator, Modal, Pressable, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HIT, radius, tint, useTheme, type Palette } from './theme';

/** Maketdagi stroke-ikonkalar (Feather bilan bir xil to'plam). */
export type IconName = keyof typeof Feather.glyphMap;
export function Icon({ name, size = 18, color }: { name: IconName; size?: number; color?: string }) {
  const c = useTheme();
  return <Feather name={name} size={size} color={color ?? c.t2} />;
}

// ---------------------------------------------------------------- tugmalar
/** Asosiy tugma — H50, bosh barmoq zonasi uchun (README 2-qoida). */
export function BigButton({
  title, onPress, disabled, busy, variant = 'primary', icon, height = 50,
}: {
  title: string; onPress: () => void;
  disabled?: boolean; busy?: boolean; variant?: 'primary' | 'secondary' | 'danger';
  icon?: IconName; height?: number;
}) {
  const c = useTheme();
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? c.critInk : c.t1;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      style={({ pressed }) => ({
        height, minHeight: HIT, borderRadius: radius.big,
        alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
        backgroundColor: variant === 'primary' ? c.brand : c.surface,
        borderWidth: variant === 'primary' ? 0 : 1,
        borderColor: variant === 'danger' ? tint(c.crit, 0.4) : c.border,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 15, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- status
export type StatusKind = 'good' | 'warn' | 'crit' | 'neutral' | 'brand';

export function statusColors(c: Palette, kind: StatusKind): { fg: string; bg: string } {
  switch (kind) {
    case 'good': return { fg: c.goodInk, bg: tint(c.good, 0.13) };
    case 'warn': return { fg: c.warnInk, bg: tint(c.warn, 0.22) };
    case 'crit': return { fg: c.critInk, bg: tint(c.crit, 0.14) };
    case 'brand': return { fg: c.brandInk, bg: c.brandSoft };
    default: return { fg: c.t2, bg: c.surface3 };
  }
}

/** Kichik belgi (maket .pill, H22). Rang HECH QACHON yolg'iz emas: ikonka + so'z. */
export function Pill({ kind, label, icon }: { kind: StatusKind; label: string; icon?: IconName }) {
  const c = useTheme();
  const { fg, bg } = statusColors(c, kind);
  return (
    <View style={{
      backgroundColor: bg, borderRadius: 999, paddingHorizontal: 8, height: 22,
      flexDirection: 'row', alignItems: 'center', gap: 4,
    }}>
      {icon && <Icon name={icon} size={10} color={fg} />}
      <Text style={{ color: fg, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

/** Davomat holati tugmasi (maket .stbtn: H34, min-width 96). */
export function StatusButton({
  kind, label, icon, onPress, onLongPress,
}: { kind: StatusKind; label: string; icon: IconName; onPress: () => void; onLongPress?: () => void }) {
  const c = useTheme();
  const { fg, bg } = statusColors(c, kind);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Holat: ${label}. Bosib almashtiring`}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={({ pressed }) => ({
        height: 34, minWidth: 96, paddingHorizontal: 10, borderRadius: radius.tile,
        backgroundColor: bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={12} color={fg} />
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------- konteynerlar
export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const c = useTheme();
  const base: ViewStyle = {
    backgroundColor: c.surface, borderRadius: radius.card,
    borderWidth: 1, borderColor: c.border, padding: 13,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, style, { opacity: pressed ? 0.85 : 1 }]}>
      {children}
    </Pressable>
  );
}

/** Kvadrat avatar (maket .sav: 34, radius 9). */
export function Avatar({ text, size = 34, brand }: { text: string; size?: number; brand?: boolean }) {
  const c = useTheme();
  return (
    <View style={{
      width: size, height: size, borderRadius: Math.round(size * 0.27),
      backgroundColor: brand ? c.brandSoft : c.surface3,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: brand ? c.brandInk : c.t2, fontWeight: '700', fontSize: Math.round(size * 0.33) }}>
        {text}
      </Text>
    </View>
  );
}

/** "BUGUNGI SINFLAR" kabi bo'lim yorlig'i. */
export function SectionLabel({ children }: { children: string }) {
  const c = useTheme();
  return (
    <Text style={{ fontSize: 12, fontWeight: '600', color: c.t3, letterSpacing: 0.5, marginBottom: 8, textTransform: 'uppercase' }}>
      {children}
    </Text>
  );
}

/** KPI kartasi (bosh ekran yuqorisi). */
export function KpiCard({ label, value, tone }: { label: string; value: number | string; tone?: StatusKind }) {
  const c = useTheme();
  return (
    <View style={{ flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 11, padding: 12, backgroundColor: c.surface }}>
      <Text style={{ fontSize: 11, color: c.t3, fontWeight: '500' }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: '700', color: tone ? statusColors(c, tone).fg : c.t1, fontVariant: ['tabular-nums'], marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}

/** Tasdiqlash oynasidagi 2×2 hisob (maket .tally). */
export function Tally({ items }: { items: Array<{ value: number; label: string; tone?: StatusKind }> }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map((it) => (
        <View key={it.label} style={{
          width: '48%', flexGrow: 1, backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border,
          borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
        }}>
          <Text style={{ fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'], color: it.tone ? statusColors(c, it.tone).fg : c.t1 }}>
            {it.value}
          </Text>
          <Text style={{ fontSize: 11, color: c.t3, fontWeight: '500' }}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- sarlavha
export function AppBar({ title, meta, onBack, right }: { title: string; meta?: string; onBack?: () => void; right?: ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 }}>
      {onBack && (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Orqaga"
          style={{ width: HIT, height: HIT, marginLeft: -12, alignItems: 'center', justifyContent: 'center', borderRadius: 8 }}
        >
          <Icon name="chevron-left" size={22} color={c.t2} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 19, fontWeight: '700', color: c.t1, letterSpacing: -0.3 }}>{title}</Text>
        {meta && <Text style={{ fontSize: 12, color: c.t3, marginTop: 2 }}>{meta}</Text>}
      </View>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------- holatlar
export function Banner({ kind, text, icon, action }: { kind: StatusKind; text: string; icon: IconName; action?: { label: string; onPress: () => void } }) {
  const c = useTheme();
  const { fg, bg } = statusColors(c, kind);
  return (
    <View style={{ backgroundColor: bg, paddingVertical: 9, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={15} color={fg} />
      <Text style={{ flex: 1, fontWeight: '600', fontSize: 13, color: fg }}>{text}</Text>
      {action && (
        <Pressable onPress={action.onPress} style={{ minHeight: 32, justifyContent: 'center', paddingHorizontal: 6 }}>
          <Text style={{ color: fg, fontWeight: '700', fontSize: 13, textDecorationLine: 'underline' }}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Skeleton({ rows = 3, height = 64 }: { rows?: number; height?: number }) {
  const c = useTheme();
  return (
    <View style={{ gap: 9 }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ height, borderRadius: radius.card, backgroundColor: c.surface3, opacity: 0.7 }} />
      ))}
    </View>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text: string; action?: { label: string; onPress: () => void } }) {
  const c = useTheme();
  return (
    <View style={{ padding: 24, alignItems: 'center', gap: 6 }}>
      <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: c.surface3, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
        <Icon name={icon} size={24} color={c.t3} />
      </View>
      <Text style={{ color: c.t1, fontWeight: '600', fontSize: 15, textAlign: 'center' }}>{title}</Text>
      <Text style={{ color: c.t2, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>{text}</Text>
      {action && (
        <View style={{ marginTop: 12, alignSelf: 'stretch' }}>
          <BigButton title={action.label} onPress={action.onPress} variant="secondary" height={44} />
        </View>
      )}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <EmptyState
      icon="alert-circle"
      title="Yuklab bo'lmadi"
      text={message}
      action={{ label: 'Qayta urinish', onPress: onRetry }}
    />
  );
}

// ---------------------------------------------------------------- sheet
/** Pastdan chiqadigan oyna: 18px radius, drag handle, tugmalar bosh barmoq zonasida. */
export function Sheet({ open, onClose, title, sub, children }: { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={{ flex: 1, backgroundColor: c.scrim }} onPress={onClose} accessibilityLabel="Yopish" />
      <View style={{
        backgroundColor: c.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
        paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 + insets.bottom,
      }}>
        <View style={{ width: 34, height: 4, borderRadius: 99, backgroundColor: c.borderStrong, alignSelf: 'center', marginBottom: 14 }} />
        <Text style={{ fontSize: 17, fontWeight: '700', color: c.t1, letterSpacing: -0.3 }}>{title}</Text>
        {sub && <Text style={{ fontSize: 12, color: c.t3, marginTop: 3 }}>{sub}</Text>}
        <View style={{ marginTop: 14 }}>{children}</View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------- forma
export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: boolean }) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 13, fontWeight: '500', color: c.t2 }}>{label}</Text>
      <TextInput
        placeholderTextColor={c.t3}
        {...props}
        style={{
          height: 48, borderWidth: 1, borderColor: error ? c.crit : c.border,
          borderRadius: radius.control, paddingHorizontal: 14, color: c.t1,
          backgroundColor: c.surface, fontSize: 16,
        }}
      />
    </View>
  );
}

/** Ekran pastidagi amal zonasi (maket .thumb): hairline + surface fon + safe-area. */
export function ThumbZone({ children, hint }: { children: ReactNode; hint?: string }) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ padding: 14, paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderColor: c.border, backgroundColor: c.surface }}>
      {children}
      {hint && <Text style={{ fontSize: 11, color: c.t3, textAlign: 'center', marginTop: 8 }}>{hint}</Text>}
    </View>
  );
}
