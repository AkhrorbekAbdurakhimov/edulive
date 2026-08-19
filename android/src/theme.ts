/**
 * EduLive mobil tokenlari — web bilan BIR XIL qiymatlar.
 * Manba: development/DESIGN_PROMPT.md
 */
export interface Palette {
  page: string; surface: string; surface2: string; surface3: string;
  border: string;
  t1: string; t2: string; t3: string;
  brand: string; brandSoft: string; brandInk: string;
  good: string; warn: string; serious: string; crit: string;
  goodInk: string; warnInk: string; critInk: string;
}

export const light: Palette = {
  page: '#F6F7F9', surface: '#FFFFFF', surface2: '#FAFBFC', surface3: '#F2F4F7',
  border: '#E5E7EB',
  t1: '#0F1115', t2: '#4B5563', t3: '#8B8F98',
  brand: '#4F46E5', brandSoft: '#EEF2FF', brandInk: '#4F46E5',
  good: '#0CA30C', warn: '#FAB219', serious: '#EC835A', crit: '#D03B3B',
  goodInk: '#067806', warnInk: '#9A6800', critInk: '#B22C2C',
};

export const dark: Palette = {
  page: '#0E1014', surface: '#16181D', surface2: '#1C1F26', surface3: '#22262E',
  border: '#262A33',
  t1: '#F5F6F8', t2: '#A8ADB8', t3: '#6F757F',
  brand: '#4F46E5', brandSoft: '#1E1B4B', brandInk: '#818CF8',
  good: '#0CA30C', warn: '#FAB219', serious: '#EC835A', crit: '#D03B3B',
  goodInk: '#3FC03F', warnInk: '#FAB219', critInk: '#E86B6B',
};

/** Teginish nishoni — Android'da hech qachon 44dp dan kichik emas. */
export const HIT = 44;
export const radius = { control: 8, card: 12, sheet: 16 } as const;
