import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View, type ViewStyle } from 'react-native';
import { HIT, light, radius } from './theme';

type Palette = typeof light;

/** Asosiy tugma — H52, bosh barmoq zonasi uchun (README 2-qoida). */
export function BigButton({
  title, onPress, c, disabled, busy, variant = 'primary',
}: {
  title: string; onPress: () => void; c: Palette;
  disabled?: boolean; busy?: boolean; variant?: 'primary' | 'secondary';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => ({
        height: 52,
        minHeight: HIT,
        borderRadius: radius.control,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        backgroundColor: variant === 'primary' ? c.brand : c.surface,
        borderWidth: variant === 'primary' ? 0 : 1,
        borderColor: c.border,
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {busy && <ActivityIndicator color={variant === 'primary' ? '#fff' : c.brandInk} />}
      <Text style={{ color: variant === 'primary' ? '#fff' : c.t1, fontSize: 16, fontWeight: '600' }}>
        {title}
      </Text>
    </Pressable>
  );
}

/** Status belgisi — rang HECH QACHON yolg'iz emas: belgi + so'z. */
export function StatusChip({ kind, label, c }: { kind: 'good' | 'warn' | 'crit' | 'neutral'; label: string; c: Palette }) {
  const color = kind === 'good' ? c.goodInk : kind === 'warn' ? c.warnInk : kind === 'crit' ? c.critInk : c.t2;
  const bg =
    kind === 'good' ? `${c.good}1F` : kind === 'warn' ? `${c.warn}29` : kind === 'crit' ? `${c.crit}1F` : c.surface3;
  const icon = kind === 'good' ? '✓' : kind === 'warn' ? '◔' : kind === 'crit' ? '✕' : '·';
  return (
    <View style={{
      backgroundColor: bg, borderRadius: 999, paddingHorizontal: 10, height: 26,
      flexDirection: 'row', alignItems: 'center', gap: 4,
    }}>
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>{icon} {label}</Text>
    </View>
  );
}

export function Card({ children, c, style }: { children: ReactNode; c: Palette; style?: ViewStyle }) {
  return (
    <View style={[{
      backgroundColor: c.surface, borderRadius: radius.card,
      borderWidth: 1, borderColor: c.border, padding: 16,
    }, style]}>
      {children}
    </View>
  );
}

export function initials(name: string): string {
  return name.split(' ').slice(0, 2).map((w) => w[0] ?? '').join('').toUpperCase();
}
