/**
 * The font files, embedded in the package.
 *
 * Each file is imported as a resource, so the bundler carries it into the assembled
 * executable: a package started outside the sources finds its typography without a folder
 * beside it and without resolving a module path at runtime.
 */

import interBold from '@hemera/ui/fonts/inter/Inter-Bold.ttf' with { type: 'file' }
import interMedium from '@hemera/ui/fonts/inter/Inter-Medium.ttf' with { type: 'file' }
import interRegular from '@hemera/ui/fonts/inter/Inter-Regular.ttf' with { type: 'file' }
import interSemiBold from '@hemera/ui/fonts/inter/Inter-SemiBold.ttf' with { type: 'file' }
import monoBold from '@hemera/ui/fonts/jetbrains-mono/JetBrainsMono-Bold.ttf' with { type: 'file' }
import monoMedium from '@hemera/ui/fonts/jetbrains-mono/JetBrainsMono-Medium.ttf' with { type: 'file' }
import monoRegular from '@hemera/ui/fonts/jetbrains-mono/JetBrainsMono-Regular.ttf' with { type: 'file' }

/** Where each declared file landed, by the name the design system gives it. */
export const EMBEDDED_FONT_FILES: Readonly<Record<string, string>> = {
  'inter/Inter-Regular.ttf': interRegular,
  'inter/Inter-Medium.ttf': interMedium,
  'inter/Inter-SemiBold.ttf': interSemiBold,
  'inter/Inter-Bold.ttf': interBold,
  'jetbrains-mono/JetBrainsMono-Regular.ttf': monoRegular,
  'jetbrains-mono/JetBrainsMono-Medium.ttf': monoMedium,
  'jetbrains-mono/JetBrainsMono-Bold.ttf': monoBold,
}

/** Reads the embedded copy of a declared file. */
export function embeddedFontLocator(file: string): string {
  return EMBEDDED_FONT_FILES[file] ?? file
}
