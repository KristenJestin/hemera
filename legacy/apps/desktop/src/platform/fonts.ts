/**
 * Registers the fonts the design system ships, before the first window opens.
 *
 * The renderer reads its font list once, when the text system starts; a font registered
 * afterwards is never used. A file that cannot be read is reported by family and weight and
 * the application starts on the system fallback family instead of failing silently.
 */

import { EMBEDDED_FONTS } from '@hemera/ui/fonts/index.ts'
import type { EmbeddedFont } from '@hemera/ui/fonts/index.ts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface FontRegistration {
  /** Files handed to the renderer. */
  registered: EmbeddedFont[]
  /** Files that could not be read, with the reason. */
  missing: { font: EmbeddedFont; reason: string }[]
}

/** Human-readable diagnostic naming the families that will fall back. */
export function missingFontDiagnostic(registration: FontRegistration): string | null {
  if (registration.missing.length === 0) return null
  const families = [...new Set(registration.missing.map((entry) => entry.font.family))]
  const details = registration.missing
    .map(
      (entry) => `${entry.font.family} ${entry.font.weight} (${entry.font.file}): ${entry.reason}`,
    )
    .join('; ')
  return `embedded font files missing for ${families.join(', ')}; starting on the system fallback family — ${details}`
}

/**
 * Directory the design system keeps its font files in, resolved from its public module.
 *
 * This resolves a module path, so it only answers inside the sources: an assembled package
 * reads the copies embedded in it instead.
 */
export function embeddedFontsDirectory(): string {
  return fileURLToPath(new URL('./fonts/', import.meta.resolve('@hemera/ui')))
}

/** Where a declared file is, for a run that reads a directory on disk. */
export function fontsFromDirectory(directory: string): (file: string) => string {
  return (file) => join(directory, file)
}

export function registerEmbeddedFonts(
  locate: (file: string) => string,
  addFonts: (fonts: Buffer[]) => void,
): FontRegistration {
  const registered: EmbeddedFont[] = []
  const missing: { font: EmbeddedFont; reason: string }[] = []
  const buffers: Buffer[] = []

  for (const font of EMBEDDED_FONTS) {
    try {
      buffers.push(readFileSync(locate(font.file)))
      registered.push(font)
    } catch (error) {
      missing.push({ font, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  if (buffers.length > 0) addFonts(buffers)

  return { registered, missing }
}
