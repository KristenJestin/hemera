/**
 * What the Project page and the sidebar's missions say, from what the engine gave: the missions
 * grouped by stage as rows, the last event of each, the living spec's card, the Chats of the rail.
 * Plain values and functions, no React: the routes that draw them are `project-route.tsx` and
 * `sidebar-missions.tsx`.
 */

import type { ChatSummary, JournalTail, LivingDomain } from '@hemera/ipc'
import {
  FOLDED_STAGES,
  type MissionStage,
  type ProjectChat,
  type ProjectLivingSpec,
  type ProjectStageGroup,
  type SidebarRowProps,
} from '@hemera/ui'

import { byStage, type MissionLine } from './missions.ts'
import { whenOf } from './needs.ts'

/** The last line of each mission's Journal, by mission; a mission with none has no entry. */
export function eventsOf(tails: ReadonlyArray<JournalTail>): ReadonlyMap<string, string> {
  return new Map(
    tails.flatMap((tail): Array<[string, string]> =>
      tail.line === null ? [] : [[tail.missionId, tail.line.text]],
    ),
  )
}

/** The stages of a Project's page with their rows, in the order of the page. */
export function groupsOf(
  lines: readonly MissionLine[],
  events: ReadonlyMap<string, string>,
  now: Date,
): ProjectStageGroup[] {
  return byStage(lines).map((group) => ({
    stage: group.stage,
    rows: group.lines.map((line) => ({
      missionKey: line.key,
      title: line.title,
      when: whenOf(line.updatedAt, now),
      ball: line.ball,
      event: events.get(line.id),
      marks: line.marks,
    })),
  }))
}

/** One stage of the sidebar: its rows, how many, and whether it starts folded. */
export interface SidebarGroup {
  stage: MissionStage
  count: number
  folded: boolean
  rows: ReadonlyArray<Omit<SidebarRowProps, 'current' | 'onPress'>>
}

/** The stages under an open Project in the sidebar, in the order of the page. */
export function sidebarGroupsOf(
  lines: readonly MissionLine[],
  events: ReadonlyMap<string, string>,
): SidebarGroup[] {
  return byStage(lines).map((group) => ({
    stage: group.stage,
    count: group.lines.length,
    folded: FOLDED_STAGES.has(group.stage),
    rows: group.lines.map((line) => ({
      missionKey: line.key,
      title: line.title,
      ball: line.ball,
      event: events.get(line.id),
      needsYou: line.needs > 0,
    })),
  }))
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`

/** When the living spec changed, as the card says it: `4 min ago`, `yesterday`, `1 Oct`. */
const updatedWords = (when: string): string =>
  when === 'now'
    ? 'updated just now'
    : /^\d+ (min|h)$/.test(when)
      ? `updated ${when} ago`
      : `updated ${when}`

/** The card of the living spec; null while the Project has no domain yet. */
export function livingSpecOf(
  domains: ReadonlyArray<LivingDomain>,
  now: Date,
): ProjectLivingSpec | null {
  const latest = domains
    .map((domain) => domain.lastChange)
    .toSorted()
    .at(-1)
  if (latest === undefined) return null
  return {
    domains: domains.map((domain) => ({
      id: domain.id,
      name: domain.name,
      waiting: domain.state === 'proposed' || domain.pending > 0,
    })),
    about: `${plural(domains.length, 'domain', 'domains')} · ${updatedWords(whenOf(latest, now))}`,
  }
}

/** The Chats of the rail, the latest first. */
export function chatRowsOf(chats: ReadonlyArray<ChatSummary>, now: Date): ProjectChat[] {
  return chats
    .toSorted((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
    .map((chat) => ({
      id: chat.id,
      title: chat.title,
      when: whenOf(chat.lastActivityAt, now),
    }))
}
