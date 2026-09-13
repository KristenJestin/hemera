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
export { dark } from './theme/dark.ts'
export { light } from './theme/light.ts'
