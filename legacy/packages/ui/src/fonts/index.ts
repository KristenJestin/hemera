/**
 * Fonts the design system ships with the application.
 *
 * This module only declares them: reading files belongs to the application, which owns the
 * platform. The renderer reads its font list once, when the text system starts, so the
 * application registers these before it opens its first window.
 */

export interface EmbeddedFont {
  /** Family name the renderer resolves, as written in the font file. */
  family: string
  /** Weight of the closed weight scale this file carries. */
  weight: number
  /** Path of the file, relative to this directory. */
  file: string
}

/** Interface text family. */
export const SANS_FAMILY = 'Inter'

/** Identifiers, paths and technical values family. */
export const MONO_FAMILY = 'JetBrains Mono'

export const EMBEDDED_FONTS: readonly EmbeddedFont[] = [
  { family: SANS_FAMILY, weight: 400, file: 'inter/Inter-Regular.ttf' },
  { family: SANS_FAMILY, weight: 500, file: 'inter/Inter-Medium.ttf' },
  { family: SANS_FAMILY, weight: 600, file: 'inter/Inter-SemiBold.ttf' },
  { family: SANS_FAMILY, weight: 700, file: 'inter/Inter-Bold.ttf' },
  { family: MONO_FAMILY, weight: 400, file: 'jetbrains-mono/JetBrainsMono-Regular.ttf' },
  { family: MONO_FAMILY, weight: 500, file: 'jetbrains-mono/JetBrainsMono-Medium.ttf' },
  { family: MONO_FAMILY, weight: 700, file: 'jetbrains-mono/JetBrainsMono-Bold.ttf' },
]

/** Licence file shipped beside each family, as required by the SIL Open Font License. */
export const FONT_LICENCES: readonly string[] = ['inter/OFL.txt', 'jetbrains-mono/OFL.txt']
