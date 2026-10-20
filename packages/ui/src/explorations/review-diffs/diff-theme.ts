import { createCSSVariablesTheme, registerCustomTheme } from '@pierre/diffs'
import { useSyncExternalStore } from 'react'

/**
 * How the diff is coloured: by the design system, and by nothing of the library's own.
 *
 * `@pierre/diffs` highlights with Shiki and takes any Shiki theme. The one registered here writes
 * every token as `var(--shiki-token-*)`, and `review-diffs.css` says what each role is in the
 * design system's words, so one theme serves light and dark and the switch is the `.dark` class on
 * the document, as everywhere else. The library's own themes are never loaded.
 */
export const DIFF_THEME = 'hemera-tokens'

registerCustomTheme(DIFF_THEME, () =>
  Promise.resolve(createCSSVariablesTheme({ name: DIFF_THEME, variablePrefix: '--shiki-' })),
)

const documentTheme = (): 'light' | 'dark' =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light'

function watchDocumentTheme(changed: () => void): () => void {
  const observer = new MutationObserver(changed)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

/**
 * Whether the document is light or dark, followed live: the library mixes its own backgrounds
 * with `light-dark()` from the theme type it is given, and left to itself follows the system
 * rather than the window's class.
 */
export function useDocumentTheme(): 'light' | 'dark' {
  return useSyncExternalStore(watchDocumentTheme, documentTheme, () => 'light')
}
