/**
 * Translation access for the desktop application.
 *
 * Every user-visible string goes through `t`. Keys are typed, so a key that does not exist
 * fails the typecheck; a key resolved dynamically at runtime is reported instead of rendering
 * an empty or misleading label. No locale selector is exposed: English is the only locale.
 */

import { en } from './resources/en.ts'

export type TranslationKey = keyof typeof en

/** Marker rendered in place of a missing key so the gap is visible while developing. */
export function missingKeyMarker(key: string): string {
  return `⟦missing:${key}⟧`
}

const resources: Record<string, string> = en

export function t(key: TranslationKey): string {
  const translation = resources[key]
  if (translation === undefined) {
    console.error(`missing translation for key "${key}" in the loaded locale`)
    return missingKeyMarker(key)
  }
  return translation
}
