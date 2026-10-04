/**
 * The colours the window opens on, read from the design system's theme at build time: the page's
 * own colour under everything, the sheet's under the system's buttons, which stand at the end of
 * the sheet's header, and the text's for the buttons' glyphs. The window is painted with them
 * before the page has drawn anything, so a cold start shows the colours the page then draws, in
 * the theme main chose before the window existed.
 */

import theme from '@hemera/ui/theme.css?raw'
import { roleIn, type Theme } from '@hemera/ui/tokens'

import type { WindowColors } from './window-options.ts'

const colorsOf = (name: Theme): WindowColors => ({
  background: roleIn(theme, 'surface-page', name),
  sheet: roleIn(theme, 'surface-content', name),
  foreground: roleIn(theme, 'foreground', name),
})

export const OPENING_COLORS: Readonly<Record<Theme, WindowColors>> = {
  light: colorsOf('light'),
  dark: colorsOf('dark'),
}
