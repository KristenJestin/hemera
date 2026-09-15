import type { Theme } from '@hemera/ui/window'

/**
 * Which theme the page wears, and telling the frame about it (design D1-03).
 *
 * The system is followed unless the user says otherwise, and saying otherwise lasts as long as
 * the window does: the preference belongs to the profile, which arrives in lot 3.
 *
 * Nothing here animates. The class on `<html>` changes and every token changes with it, which
 * is the one colour change of the application that is allowed to be instant — a page that
 * cross-fades its entire palette is a page that flashes.
 */
export type ThemePreference = 'system' | Theme

const DARK = '(prefers-color-scheme: dark)'

let preference: ThemePreference = 'system'
const listeners = new Set<() => void>()

/** The theme the page is actually wearing, once the system has had its say. */
export function currentTheme(): Theme {
  if (preference !== 'system') return preference
  return globalThis.matchMedia(DARK).matches ? 'dark' : 'light'
}

export function themePreference(): ThemePreference {
  return preference
}

export function setThemePreference(next: ThemePreference): void {
  preference = next
  wear(currentTheme())
  for (const listener of listeners) listener()
}

/** Subscribes to every reason the theme can change: the user's choice, and the system's. */
export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener)
  const media = globalThis.matchMedia(DARK)
  const follow = (): void => {
    if (preference === 'system') {
      wear(currentTheme())
      listener()
    }
  }
  media.addEventListener('change', follow)
  return () => {
    listeners.delete(listener)
    media.removeEventListener('change', follow)
  }
}

/** Puts the theme on the page, and tells the frame, which is outside the page. */
function wear(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  void window.hemera.invoke('theme.set', { theme })
}
