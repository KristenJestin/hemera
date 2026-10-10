import type { Mission } from '@hemera/ipc'
import {
  MissionFrameDifference,
  type MissionStage,
  type MissionView,
  type ViewWidth,
} from '@hemera/ui'
import { IconRefresh } from '@hemera/ui/icons'
import { createElement, type ReactNode } from 'react'

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
  /** Why a gesture of the page did not go through, in words. */
  notice?: string | undefined
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
  /** Why the last Freeze was refused, each reason in words. */
  refused?: ReadonlyArray<string> | undefined
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

/** A view a mission can open over its base: the one contract of every view. */
export interface MissionViewEntry {
  title: string
  icon: ReactNode
  width: ViewWidth
  body: (mission: Mission) => ReactNode
}

/** The views of a mission by id; the outdated mark opens `difference`. */
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
} satisfies Record<string, MissionViewEntry>
