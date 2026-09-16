import type { ThemePreference } from '@hemera/ipc'
import type { Theme } from '@hemera/ui/window'

/**
 * Which theme the page wears, and asking the platform for it (design D1-03, D3-08).
 *
 * The system is followed unless the user says otherwise, and saying otherwise now lasts: the
 * preference belongs to the profile, and the page is handed it before it mounts anything.
 *
 * The preference itself is what crosses to the main process, not the colour it resolves to.
 * Only the main process can set `nativeTheme.themeSource`, and only that puts a native
 * `<select>`, a scrollbar and the frame on the same theme as the page — or lifts the override
 * again when the user goes back to following the desktop. The page therefore says what it
 * wants and reads back what the platform decided; it never decides for it.
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

/**
 * The next preference the one control cycles to: `system`, then `light`, then `dark`.
 *
 * Three states and not two, because the profile made the choice durable: a two-state toggle on
 * a preference that is remembered is a one-way door out of following the desktop. `system`
 * comes first in the cycle so that the way back is never more than two presses away.
 */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  if (current === 'system') return 'light'
  if (current === 'light') return 'dark'
  return 'system'
}

/**
 * Starts the page on what the profile holds, before anything is drawn.
 *
 * Nothing is written back here and nothing is asked of the platform: the main process has
 * already put it on this theme, which is why the first frame is in it.
 */
export function startTheme(held: ThemePreference): void {
  preference = held
  paint()
}

export function setThemePreference(next: ThemePreference): void {
  preference = next
  paint()
  // The page does not wait for the profile, but it does not drop the answer either: a channel
  // that refused, timed out or found nobody there rejects, and a rejection nobody is holding is
  // an unhandled one. What the page can do about it is say so; the window keeps what was asked.
  window.hemera
    .invoke('preferences.write', { theme: next })
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a rejected channel carries whatever the main process threw, and this is where it stops
    .catch((failed: unknown) => {
      console.error('preferences.write: the theme was not written to the profile', failed)
    })
  for (const listener of listeners) listener()
}

/** Subscribes to every reason the theme can change: the user's choice, and the system's. */
export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener)
  const media = globalThis.matchMedia(DARK)
  const follow = (): void => {
    if (preference === 'system') {
      paint()
      listener()
    }
  }
  media.addEventListener('change', follow)
  return () => {
    listeners.delete(listener)
    media.removeEventListener('change', follow)
  }
}

/** Puts the theme on the page. What the platform wears is the main process's to set. */
function paint(): void {
  document.documentElement.classList.toggle('dark', currentTheme() === 'dark')
}
