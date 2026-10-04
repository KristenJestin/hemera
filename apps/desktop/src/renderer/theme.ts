/**
 * The theme the window wears. Main decides it — the user's choice, read before the window
 * existed, or the system's — and gives it to the page as the page's colour scheme, so the page
 * only follows `prefers-color-scheme` and puts the design system's `dark` class on `<html>`.
 *
 * The first time is in `index.html`, in a script of the head that runs before anything is
 * painted; this module keeps the class right when the theme changes afterwards.
 */

/** The query whose answer is the theme main chose. */
export const DARK_QUERY = '(prefers-color-scheme: dark)'

type DarkQuery = Pick<MediaQueryList, 'matches'> & {
  readonly addEventListener: (type: 'change', listener: () => void) => void
  readonly removeEventListener: (type: 'change', listener: () => void) => void
}

/** Wears the theme now and at every change, until the returned function is called. */
export function wearTheme(wear: (dark: boolean) => void, query: DarkQuery): () => void {
  const follow = (): void => wear(query.matches)
  follow()
  query.addEventListener('change', follow)
  return () => query.removeEventListener('change', follow)
}
