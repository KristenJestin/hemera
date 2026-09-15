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
import { cardShowcase } from './card/card.showcase.tsx'
import { composerShowcase } from './composer/composer.showcase.tsx'
import { modalShowcase } from './modal/modal.showcase.tsx'
import { emptyStateShowcase } from './empty-state/empty-state.showcase.tsx'
import { gutterShowcase } from './gutter/gutter.showcase.tsx'
import { iconButtonShowcase } from './icon-button/icon-button.showcase.tsx'
import { inputShowcase } from './input/input.showcase.tsx'
import { kbdShowcase } from './kbd/kbd.showcase.tsx'
import { listItemShowcase } from './list-item/list-item.showcase.tsx'
import { navItemShowcase } from './nav-item/nav-item.showcase.tsx'
import { noticeShowcase } from './notice/notice.showcase.tsx'
import { selectShowcase } from './select/select.showcase.tsx'
import { separatorShowcase } from './separator/separator.showcase.tsx'
import { tabShowcase } from './tab/tab.showcase.tsx'
import { textareaShowcase } from './textarea/textarea.showcase.tsx'
import { timelineItemShowcase } from './timeline-item/timeline-item.showcase.tsx'

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
  cardShowcase,
  listItemShowcase,
  navItemShowcase,
  tabShowcase,
  composerShowcase,
  selectShowcase,
  inputShowcase,
  textareaShowcase,
  separatorShowcase,
  gutterShowcase,
  timelineItemShowcase,
  emptyStateShowcase,
  modalShowcase,
  noticeShowcase,
  kbdShowcase,
]
