import type { ThemePreference } from '@hemera/ipc'
import type { Theme } from '@hemera/ui/window'

/**
 * Which theme the page wears, and asking the platform for it (design D1-03).
 *
 * The system is followed unless the user says otherwise, and saying otherwise lasts as long as
 * the window does: the preference belongs to the profile, which arrives in lot 3.
 *
 * The preference itself is what crosses to the main process, not the colour it resolves to.
 * Only the main process can set `nativeTheme.themeSource`, and only that puts a native
 * `<select>`, a scrollbar and the frame on the same theme as the page — or lifts the override
 * again when the user goes back to following the desktop.
 *
 * Nothing here animates. The class on `<html>` changes and every token changes with it, which
 * is the one colour change of the application that is allowed to be instant — a page that
 * cross-fades its entire palette is a page that flashes.
 */
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

/** Says once, at start-up, what the page is asking for, so the platform starts out on it. */
export function syncTheme(): void {
  wear()
}

export function setThemePreference(next: ThemePreference): void {
  preference = next
  wear()
  for (const listener of listeners) listener()
}

/** Subscribes to every reason the theme can change: the user's choice, and the system's. */
export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener)
  const media = globalThis.matchMedia(DARK)
  const follow = (): void => {
    if (preference === 'system') {
      wear()
      listener()
    }
  }
  media.addEventListener('change', follow)
  return () => {
    listeners.delete(listener)
    media.removeEventListener('change', follow)
  }
}

/** Puts the theme on the page, and hands the preference to the platform. */
function wear(): void {
  document.documentElement.classList.toggle('dark', currentTheme() === 'dark')
  void window.hemera.invoke('theme.set', { preference })
}
