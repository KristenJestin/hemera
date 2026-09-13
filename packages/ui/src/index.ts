/**
 * Public surface of the Hemera design system.
 *
 * Consumers import from here and never from a path inside `src`.
 */

export type { Shadow } from './tokens/primitives.ts'
export {
  duration,
  fontFamily,
  fontSize,
  fontWeight,
  iconSize,
  lineHeight,
  radius,
  space,
} from './tokens/primitives.ts'
export { content, control, dot, icon, row, shell } from './tokens/components.ts'
export { COLOR_ROLES } from './tokens/semantic.ts'
export type { Theme, ThemeColors, ThemeName, ThemeShadows } from './tokens/semantic.ts'
export { ICONS } from './icons/catalog.ts'
export type { IconName } from './icons/catalog.ts'
export { EMBEDDED_FONTS, FONT_LICENCES, MONO_FAMILY, SANS_FAMILY } from './fonts/index.ts'
export type { EmbeddedFont } from './fonts/index.ts'
export * from './lib/index.ts'
export * from './primitives/index.ts'
export {
  DEFAULT_THEME,
  ThemeProvider,
  themeOf,
  useTheme,
  useThemeControl,
} from './theme/provider.tsx'
export type { ThemeControl, ThemeProviderProps } from './theme/provider.tsx'
export { dark } from './theme/dark.ts'
export { light } from './theme/light.ts'
