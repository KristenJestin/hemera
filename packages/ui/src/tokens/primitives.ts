/**
 * Layer 1 of the token system: the raw palette and the closed numeric scales.
 *
 * This is the only file of the design system where a literal colour or a literal dimension
 * may appear. No component reads it: components read semantic tokens (layer 2) or component
 * tokens (layer 3). Values are extracted from the prototype, normalised into closed scales;
 * the mapping is decided once in design.md (D12a).
 */

/** A single painted shadow layer; the renderer paints one layer and no more. */
export interface Shadow {
  offsetX: number
  offsetY: number
  blurRadius: number
  spreadRadius: number
  color: string
}

/** Raw colours extracted from the prototype, named by hue and step. */
export const palette = {
  transparent: 'rgba(0,0,0,0)',
  white: '#ffffff',

  fuchsia50: '#fdf4ff',
  fuchsia100: '#fae8ff',
  fuchsia300: '#f0abfc',
  fuchsia400: '#e879f9',
  fuchsia500: '#d946ef',
  fuchsia600: '#c026d3',
  fuchsia700: '#a21caf',
  fuchsia500Alpha25: 'rgba(217,70,239,0.25)',
  fuchsia400Alpha10: 'rgba(232,121,249,0.10)',
  fuchsia400Alpha18: 'rgba(232,121,249,0.18)',
  fuchsia400Alpha30: 'rgba(232,121,249,0.30)',

  neutral0: '#040406',
  neutral50: '#0e0e12',
  neutral75: '#121217',
  neutral100: '#16161c',
  neutral150: '#18181e',
  neutral200: '#27272f',
  neutral300: '#363640',
  neutral500: '#62627a',
  neutral600: '#6b6b7b',
  neutral650: '#9a9aa8',
  neutral700: '#9a9aab',
  neutral800: '#d3d3db',
  neutral850: '#e2e2e8',
  neutral875: '#e9e9ee',
  neutral900: '#ededf0',
  neutral925: '#f1f1f4',
  neutral950: '#f4f4f6',
  neutral975: '#f6f6f8',
  ink: '#111118',
  paper: '#ececf1',
  neutral700Alpha12: 'rgba(154,154,171,0.12)',

  green500: '#16a34a',
  green400: '#4ade80',
  green50: '#ecfdf3',
  green400Alpha10: 'rgba(74,222,128,0.10)',

  amber600: '#d97706',
  amber400: '#fbbf24',
  amber50: '#fffbeb',
  amber400Alpha10: 'rgba(251,191,36,0.10)',

  red600: '#dc2626',
  red400: '#f87171',
  red50: '#fef2f2',
  red400Alpha10: 'rgba(248,113,113,0.10)',

  blue600: '#2563eb',
  blue400: '#60a5fa',
  blue50: '#eff6ff',
  blue400Alpha10: 'rgba(96,165,250,0.10)',

  violet600: '#7c3aed',
  violet400: '#a78bfa',
  violet50: '#f3efff',
  violet400Alpha12: 'rgba(167,139,250,0.12)',

  cyan600: '#0891b2',
  cyan400: '#22d3ee',
  cyan50: '#ecfeff',
  cyan400Alpha10: 'rgba(34,211,238,0.10)',

  scrim: 'rgba(10,10,14,0.45)',
  pressLight: 'rgba(16,16,24,0.06)',
  pressDark: 'rgba(255,255,255,0.06)',

  shadowLight05: 'rgba(16,16,24,0.05)',
  shadowLight08: 'rgba(16,16,24,0.08)',
  shadowLight12: 'rgba(16,16,24,0.12)',
  shadowDark50: 'rgba(0,0,0,0.50)',
  shadowDark55: 'rgba(0,0,0,0.55)',
  shadowDark60: 'rgba(0,0,0,0.60)',
} as const

/** Closed spacing scale, in pixels. */
export const space = {
  none: 0,
  '2xs': 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const

/** Closed corner radius scale, in pixels. */
export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  pill: 999,
} as const

/** Closed text size scale, in pixels. */
export const fontSize = {
  xs: 11,
  sm: 12,
  md: 13,
  base: 14,
  lg: 16,
  xl: 20,
  display: 26,
} as const

/** Line height declared for each step of the text scale. */
export const lineHeight = {
  xs: 1.3,
  sm: 1.4,
  md: 1.45,
  base: 1.5,
  lg: 1.4,
  xl: 1.3,
  display: 1.2,
} as const

/** Closed font weight scale. */
export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const

/** Embedded font families. */
export const fontFamily = {
  sans: 'Inter',
  mono: 'JetBrains Mono',
} as const

/** Closed motion duration scale, in seconds. */
export const duration = {
  fast: 0.12,
  base: 0.18,
  slow: 0.28,
} as const

/** Closed icon size scale, in pixels. */
export const iconSize = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
} as const

/** Shadows of the light theme, one painted layer each. */
export const lightShadow = {
  sm: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: palette.shadowLight05 },
  md: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: palette.shadowLight08 },
  lg: { offsetX: 0, offsetY: 12, blurRadius: 32, spreadRadius: 0, color: palette.shadowLight12 },
} as const satisfies Record<string, Shadow>

/** Shadows of the dark theme, one painted layer each. */
export const darkShadow = {
  sm: { offsetX: 0, offsetY: 1, blurRadius: 2, spreadRadius: 0, color: palette.shadowDark50 },
  md: { offsetX: 0, offsetY: 6, blurRadius: 18, spreadRadius: 0, color: palette.shadowDark55 },
  lg: { offsetX: 0, offsetY: 14, blurRadius: 40, spreadRadius: 0, color: palette.shadowDark60 },
} as const satisfies Record<string, Shadow>
