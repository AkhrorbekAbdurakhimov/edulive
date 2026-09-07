import { createContext, useContext } from 'react';

/**
 * EduLive mobil tokenlari — web bilan BIR XIL qiymatlar.
 * Manba: development/DESIGN_PROMPT.md §2 va development/mobile-ui.dc.html :root.
 */
export interface Palette {
  page: string; surface: string; surface2: string; surface3: string;
  border: string; borderStrong: string;
  t1: string; t2: string; t3: string;
  brand: string; brandSoft: string; brandInk: string;
  good: string; warn: string; serious: string; crit: string;
  goodInk: string; warnInk: string; critInk: string;
  scrim: string;
}

export const light: Palette = {
  page: '#F6F7F9', surface: '#FFFFFF', surface2: '#FAFBFC', surface3: '#F2F4F7',
  border: '#E5E7EB', borderStrong: '#D3D7DE',
  t1: '#0F1115', t2: '#4B5563', t3: '#8B8F98',
  brand: '#4F46E5', brandSoft: '#EEF2FF', brandInk: '#4F46E5',
  good: '#0CA30C', warn: '#FAB219', serious: '#EC835A', crit: '#D03B3B',
  goodInk: '#067806', warnInk: '#9A6800', critInk: '#B22C2C',
  scrim: 'rgba(8,10,14,.5)',
};

export const dark: Palette = {
  page: '#0E1014', surface: '#16181D', surface2: '#1C1F26', surface3: '#22262E',
  border: '#262A33', borderStrong: '#343945',
  t1: '#F5F6F8', t2: '#A8ADB8', t3: '#6F757F',
  brand: '#4F46E5', brandSoft: '#1E1B4B', brandInk: '#818CF8',
  good: '#0CA30C', warn: '#FAB219', serious: '#EC835A', crit: '#D03B3B',
  goodInk: '#3FC03F', warnInk: '#FAB219', critInk: '#E86B6B',
  scrim: 'rgba(0,0,0,.6)',
};

/** Teginish nishoni — Android'da hech qachon 44dp dan kichik emas. */
export const HIT = 44;

/** Maketdagi radiuslar: tugma/tile 9–12, karta 12, sheet 18. */
export const radius = { control: 9, card: 12, tile: 9, sheet: 18, big: 12 } as const;

/**
 * Maketdagi `color-mix(in srgb, var(--good) 13%, transparent)` ning RN ekvivalenti:
 * hex rangga alfa bayt qo'shiladi.
 */
export function tint(hex: string, alpha: number): string {
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

export const ThemeContext = createContext<Palette>(light);
export const useTheme = (): Palette => useContext(ThemeContext);
