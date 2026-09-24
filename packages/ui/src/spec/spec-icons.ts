import type { FunctionComponent } from 'react'

import {
  IconAlertCircle,
  IconBook,
  IconBorderOuter,
  IconBug,
  IconBulb,
  IconChecklist,
  IconCompass,
  IconFlask,
  IconListCheck,
  IconListTree,
  IconLock,
  IconMessageQuestion,
  IconPlayerPlay,
  type IconProps,
  IconRoute,
  IconTarget,
} from '../icons.ts'
import type { PhaseName, SpecTarget } from './model.ts'

/**
 * The glyph of each phase and of each part of a Spec (lot 19, brief revision 4b).
 *
 * Folded, the panel is a band of glyphs and nothing else: a glyph shared by several parts is a
 * glyph that says nothing, so each one wears its own, and each phase heading too. The rail
 * unfolded draws the same glyph before the name, so the band reads as the rail it folds from.
 */

/** A phase: the idea shaped, the way planned, the work broken down, the prototype tried. */
export const SPEC_PHASE_ICONS: Record<PhaseName, FunctionComponent<IconProps>> = {
  shape: IconBulb,
  plan: IconCompass,
  decompose: IconListTree,
  prototype: IconFlask,
}

/** A part: what is wrong, where it lands, its edges, its proof, its own section, the lists. */
export const SPEC_PART_ICONS: Record<SpecTarget, FunctionComponent<IconProps>> = {
  problem: IconAlertCircle,
  expected_outcome: IconTarget,
  scope: IconBorderOuter,
  verification: IconChecklist,
  behaviour: IconPlayerPlay,
  reproduction: IconBug,
  invariants: IconLock,
  plan: IconRoute,
  stories: IconBook,
  tasks: IconListCheck,
  questions: IconMessageQuestion,
}
