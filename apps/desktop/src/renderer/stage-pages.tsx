import type { FreezeReadiness, KeptAgent, Mission } from '@hemera/ipc'
import {
  MissionFrameDifference,
  type MissionStage,
  type MissionView,
  type NeedRow,
  type NeedsYouListProps,
  type ViewWidth,
} from '@hemera/ui'
import { IconGitCompare, IconHistory, IconRefresh } from '@hemera/ui/icons'
import { createElement, type ReactNode } from 'react'

import { DiffHeadActions, DiffSheet, VersionSheet } from './diff-route.tsx'
import type { Link } from './link.ts'
import { differenceOf } from './mission-header-model.ts'
import { PlanningStage } from './planning-stage.tsx'

/** What a stage's page puts in the mission's frame, beside what the frame draws itself. */
export interface StageFrame {
  base: ReactNode
  /** The views the page opens over itself, beside the mission's. */
  views?: readonly MissionView[] | undefined
  /** The Now line of the head. */
  now?: string | undefined
  /** Brings the user to what the Now line names. */
  onNow?: (() => void) | undefined
  /** What runs, beside the Now line: its chip. */
  nowChip?: ReactNode
  /** The stage's action in the head, and the line under it. */
  action?: ReactNode
  actionNote?: ReactNode
  /** Why a gesture of the page did not go through, in words. */
  notice?: string | undefined
  /** The needs drawn above the base: all of the mission's unless the page lists them itself. */
  needs?: readonly NeedRow[] | undefined
  /** Whether the head draws the ball as the face; not when the page draws the face itself. */
  ballFace?: boolean | undefined
}

/** What a stage's page is handed: the mission, and the way to open a view over it. */
export interface StagePageProps {
  link: Link
  engineReady: boolean
  mission: Mission
  /** Opens a view over the base, by its id in `MISSION_VIEWS` or among the page's own. */
  open: (view: string) => void
  /** Goes to another mission of the Project, by its key. */
  goMission: (key: string) => void
  /** What stands between a Planning mission and its Freeze, once the engine said. */
  readiness: FreezeReadiness | null
  /** Opens a Chat of the Project, by its id. */
  openChat: (chatId: string) => void
  /** Why the last Freeze was refused, each reason in words. */
  refused?: ReadonlyArray<string> | undefined
  /** The mission's agents Hemera started before its last restart and could not stop (#320). */
  kept: ReadonlyArray<KeptAgent>
  /** Freezes the Spec at the version the engine offered it on. */
  freeze: () => void
  /** Whether a Freeze is on its way: Freeze then works and is not sent again. */
  freezing: boolean
  /** The mission's needs that wait, and what answers each. */
  needs: { rows: readonly NeedRow[]; on: NeedsYouListProps['on'] }
  /** Draws the mission's frame around what the page gives it. */
  frame: (parts: StageFrame) => ReactNode
}

/**
 * The page of each stage, which is the base of the mission's frame. A stage with no page here
 * shows an empty base with its name; the tickets that build a stage's page register it.
 */
export const STAGE_PAGES: Partial<Record<MissionStage, (props: StagePageProps) => ReactNode>> = {
  Planning: PlanningStage,
}

/** What a view's body is handed beside its mission: the link, and the way to open another view. */
export interface ViewContext {
  link: Link
  open: (view: string) => void
}

/** A view a mission can open over its base: the one contract of every view. */
export interface MissionViewEntry {
  title: string
  icon: ReactNode
  width: ViewWidth
  /** What the sheet's head holds beside its title. */
  actions?: ((mission: Mission) => ReactNode) | undefined
  body: (mission: Mission, context: ViewContext) => ReactNode
}

/**
 * The views of a mission by id; the outdated mark opens `difference`, the mission's `…` the diff,
 * and an outdated comment of the diff the version it was written on.
 */
export const MISSION_VIEWS = {
  difference: {
    title: 'What changed',
    icon: createElement(IconRefresh, { size: 'sm' }),
    width: 'narrow',
    body: (mission) => {
      const seen = differenceOf(mission)
      return createElement(MissionFrameDifference, {
        why: seen?.why ?? 'Nothing is outdated',
        difference: seen?.difference ?? null,
      })
    },
  },
  diff: {
    title: 'Diff',
    icon: createElement(IconGitCompare, { size: 'sm' }),
    width: 'wide',
    actions: (mission) => createElement(DiffHeadActions, { mission }),
    body: (mission, { link, open }) => createElement(DiffSheet, { link, mission, open }),
  },
  version: {
    title: 'Commented version',
    icon: createElement(IconHistory, { size: 'sm' }),
    width: 'wide',
    body: (mission, { link }) => createElement(VersionSheet, { link, mission }),
  },
} satisfies Record<string, MissionViewEntry>
