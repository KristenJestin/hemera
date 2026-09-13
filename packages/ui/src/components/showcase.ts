/**
 * Showcase registry of the catalogue.
 *
 * Every component registers its demonstration here; the page that renders them lives in the
 * application and is only reachable from a `dev` package. A component without an entry is
 * refused by the structural check.
 */

import type { ReactNode } from 'react'

import { badgeShowcase } from './badge/badge.showcase.tsx'
import { buttonShowcase } from './button/button.showcase.tsx'
import { iconButtonShowcase } from './icon-button/icon-button.showcase.tsx'
import { inputShowcase } from './input/input.showcase.tsx'
import { kbdShowcase } from './kbd/kbd.showcase.tsx'
import { selectShowcase } from './select/select.showcase.tsx'
import { separatorShowcase } from './separator/separator.showcase.tsx'
import { textareaShowcase } from './textarea/textarea.showcase.tsx'

export interface ShowcaseCase {
  /** What this case demonstrates. */
  name: string
  render: () => ReactNode
}

export interface ShowcaseEntry {
  /** Component name, as exported by the catalogue. */
  component: string
  cases: ShowcaseCase[]
}

/** Every demonstration of the catalogue, in catalogue order. */
export const SHOWCASE: readonly ShowcaseEntry[] = [
  buttonShowcase,
  iconButtonShowcase,
  badgeShowcase,
  inputShowcase,
  textareaShowcase,
  selectShowcase,
  separatorShowcase,
  kbdShowcase,
]
