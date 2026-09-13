/**
 * Showcase registry of the catalogue.
 *
 * Every component registers its demonstration here; the page that renders them lives in the
 * application and is only reachable from a `dev` package. A component without an entry is
 * refused by the structural check.
 */

import type { ReactNode } from 'react'

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

import { buttonShowcase } from './button/button.showcase.tsx'
import { kbdShowcase } from './kbd/kbd.showcase.tsx'
import { separatorShowcase } from './separator/separator.showcase.tsx'

/** Every demonstration of the catalogue, in catalogue order. */
export const SHOWCASE: readonly ShowcaseEntry[] = [buttonShowcase, separatorShowcase, kbdShowcase]
