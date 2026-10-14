import type { Ball } from '../blocks/ball/ball-legends.ts'
import { type MissionStage } from '../blocks/mission/vocabulary.ts'
import { MISSION } from './shell-cast.ts'

/** A mission of Acme as the sidebar lists it. */
export interface SidebarMissionEntry {
  missionKey: string
  title: string
  stage: MissionStage
  ball: Ball
  event?: string | undefined
  needsYou: boolean
  percent?: number | undefined
}

/** Acme's missions: one in most stages, one that needs the user, and two that are over. */
export const SIDEBAR_MISSIONS: readonly SidebarMissionEntry[] = [
  {
    missionKey: 'ACME-12',
    title: MISSION.title,
    stage: 'Review',
    ball: 'you',
    event: 'Round 1 addressed: 4 points',
    needsYou: true,
  },
  {
    missionKey: 'ACME-15',
    title: 'Retry a failed webhook from its row',
    stage: 'Building',
    ball: 'agent',
    event: 'T3 done in api, T4 started in web',
    needsYou: false,
    percent: 60,
  },
  {
    missionKey: 'ACME-14',
    title: 'An audit log of who read what',
    stage: 'Planning',
    ball: 'you',
    event: 'Two questions wait for you',
    needsYou: true,
  },
  {
    missionKey: 'ACME-9',
    title: 'Export the movements',
    stage: 'Done',
    ball: 'idle',
    event: 'Shipped',
    needsYou: false,
  },
  {
    missionKey: 'ACME-8',
    title: 'Sort invoices by due date',
    stage: 'Done',
    ball: 'idle',
    event: 'Shipped',
    needsYou: false,
  },
  {
    missionKey: 'ACME-6',
    title: 'Dark mode for the invoices',
    stage: 'Cancelled',
    ball: 'idle',
    event: 'Cancelled',
    needsYou: false,
  },
]
