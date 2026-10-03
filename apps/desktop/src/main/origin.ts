/**
 * Whose port main serves: the application's own page, and nothing else.
 *
 * A port carries every call the window may make, so one handed over by any other document (a
 * frame of another origin, a page navigated to by mistake) is refused before anything is served.
 */

import type { RendererSource } from './renderer-source.ts'

/**
 * The origin the application's page is served from: the development server's address, or the
 * files of the package.
 */
export function applicationOrigin(source: RendererSource): string {
  return source.kind === 'server' ? new URL(source.location).origin : 'file://'
}

/** Whether a frame, by its address, is the application's own page; a gone frame never is. */
export function isOwnFrame(url: string | null, origin: string): boolean {
  if (url === null) return false
  if (origin === 'file://') return url.startsWith('file://')
  return URL.parse(url)?.origin === origin
}
