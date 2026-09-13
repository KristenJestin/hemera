/**
 * Theme access for the whole window.
 *
 * There is no cascade in the renderer: a component reads the theme and writes the values it
 * needs into its own style. Switching themes re-renders the tree without unmounting it, so
 * the open session, the unsent draft and the panel sizes survive the switch.
 */

import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'

import type { Theme, ThemeName } from '../tokens/semantic.ts'
import { dark } from './dark.ts'
import { light } from './light.ts'

/** Theme applied when none is stored, or when the stored value is unknown. */
export const DEFAULT_THEME: ThemeName = 'dark'

const THEMES: Record<ThemeName, Theme> = { light, dark }

/** The theme a stored preference names, falling back without failing. */
export function themeOf(name: string | null | undefined): Theme {
  return THEMES[name as ThemeName] ?? THEMES[DEFAULT_THEME]
}

export interface ThemeControl {
  name: ThemeName
  setTheme: (name: ThemeName) => void
}

const ThemeContext = createContext<Theme>(THEMES[DEFAULT_THEME])
const ThemeControlContext = createContext<ThemeControl | null>(null)

export interface ThemeProviderProps {
  /** Theme currently applied; the caller owns the choice and its persistence. */
  name: ThemeName
  onThemeChange: (name: ThemeName) => void
  children: ReactNode
}

export function ThemeProvider({ name, onThemeChange, children }: ThemeProviderProps) {
  const theme = THEMES[name] ?? THEMES[DEFAULT_THEME]
  const control = useMemo<ThemeControl>(
    () => ({ name: theme.name, setTheme: onThemeChange }),
    [theme.name, onThemeChange],
  )
  return (
    <ThemeContext.Provider value={theme}>
      <ThemeControlContext.Provider value={control}>{children}</ThemeControlContext.Provider>
    </ThemeContext.Provider>
  )
}

/** The tokens of the theme in force. */
export function useTheme(): Theme {
  return useContext(ThemeContext)
}

/** The theme in force and the way to change it. */
export function useThemeControl(): ThemeControl {
  const control = useContext(ThemeControlContext)
  if (control === null) throw new Error('useThemeControl used outside a ThemeProvider')
  return control
}
