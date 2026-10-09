/**
 * What Home says from what the engine gave: the open questions grouped by mission, the pages of
 * Since you left merged into one list, Recent's rows from missions, and when Home counts as looked
 * at. Plain values and functions, no React: the route that holds them is `home-route.tsx`.
 */

import type {
  JournalTail,
  Mission,
  OpenQuestion,
  Project,
  SinceEvent,
  SinceGroup,
  SincePage,
} from '@hemera/ipc'
import type { HomeQuestionRow, HomeRecentRow, HomeSinceGroup } from '@hemera/ui'

import { repositoryNamer } from './mission-header-model.ts'
import { ballOf, lineOf } from './missions.ts'
import { whenOf } from './needs.ts'
import { eventsOf } from './project-lines.ts'

/** The answer the ticket proposes for a question: the latest one still proposed, if any. */
const proposedOf = (question: OpenQuestion): string | undefined =>
  question.proposals
    .filter((one) => one.state === 'proposed')
    .toSorted((a, b) => b.proposedAt.localeCompare(a.proposedAt))[0]?.text

/** The open questions as rows, a mission's together, the mission that has waited longest first. */
export function questionRowsOf(
  questions: ReadonlyArray<OpenQuestion>,
  now: Date,
): HomeQuestionRow[] {
  const byMission = new Map<string, OpenQuestion[]>()
  for (const one of questions) {
    byMission.set(one.missionId, [...(byMission.get(one.missionId) ?? []), one])
  }
  const oldest = (of: ReadonlyArray<OpenQuestion>): string =>
    of.map((one) => one.since).toSorted()[0] ?? ''
  return [...byMission.values()]
    .toSorted((a, b) => oldest(a).localeCompare(oldest(b)))
    .flatMap((of) =>
      of
        .toSorted((a, b) => a.wave - b.wave || a.since.localeCompare(b.since))
        .map((one): HomeQuestionRow => ({
          id: `${one.missionId}:${one.questionId}`,
          missionId: one.missionId,
          project: one.projectName,
          missionKey: one.missionKey,
          title: one.text,
          when: whenOf(one.since, now),
          proposed: proposedOf(one),
        })),
    )
}

const groupKey = (one: SinceGroup): string => one.missionId ?? `project:${one.projectId}`

const newestFirst = (a: SinceEvent, b: SinceEvent): number =>
  b.at.localeCompare(a.at) || b.sequence - a.sequence

/**
 * The pages of Since you left as one list, the newest page first: a mission's groups of two pages
 * make one, an event heard twice stands once, and the groups follow their newest event.
 */
export function mergeSince(pages: ReadonlyArray<SincePage>): SinceGroup[] {
  const merged = new Map<string, SinceGroup>()
  for (const one of pages.flatMap((each) => each.groups)) {
    const key = groupKey(one)
    const before = merged.get(key)
    if (before === undefined) {
      merged.set(key, one)
      continue
    }
    const known = new Set(before.events.map((event) => event.sequence))
    merged.set(key, {
      ...before,
      events: [...before.events, ...one.events.filter((event) => !known.has(event.sequence))],
    })
  }
  return [...merged.values()]
    .map((one) => Object.assign({}, one, { events: one.events.toSorted(newestFirst) }))
    .toSorted((a, b) => {
      const [x, y] = [a.events[0], b.events[0]]
      return x === undefined || y === undefined ? 0 : newestFirst(x, y)
    })
}

/** The cursor of the next, older page: the last page read says it; none read yet, none to ask. */
export function sinceCursorOf(
  first: SincePage | null,
  older: ReadonlyArray<SincePage>,
): number | null {
  return (older.at(-1) ?? first)?.before ?? null
}

/** The groups as cards: the Project and the time in words; a Project that is gone is left out. */
export function sinceGroupsOf(
  groups: ReadonlyArray<SinceGroup>,
  projects: ReadonlyArray<Pick<Project, 'id' | 'name'>>,
  now: Date,
): HomeSinceGroup[] {
  return groups.flatMap((one): HomeSinceGroup[] => {
    const named = projects.find((each) => each.id === one.projectId)
    if (named === undefined) return []
    return [
      {
        id: groupKey(one),
        missionId: one.missionId ?? undefined,
        project: named.name,
        missionKey: one.missionKey ?? undefined,
        title: one.title,
        ball: one.ball === null ? undefined : ballOf(one.ball),
        events: one.events.map((event) => ({
          id: String(event.sequence),
          tone: event.tone,
          text: event.text,
          when: whenOf(event.at, now),
        })),
      },
    ]
  })
}

/** Recent's rows, in the engine's order (the last opened first), a second line from the Journal. */
export function recentRowsOf(
  missions: ReadonlyArray<Mission>,
  tails: ReadonlyArray<JournalTail>,
  projects: ReadonlyArray<Project>,
  now: Date,
): HomeRecentRow[] {
  const events = eventsOf(tails)
  return missions.flatMap((one): HomeRecentRow[] => {
    const owner = projects.find((each) => each.id === one.projectId)
    if (owner === undefined) return []
    const line = lineOf(one, repositoryNamer(owner))
    return [
      {
        id: line.id,
        project: owner.name,
        missionKey: line.key,
        title: line.title,
        when: whenOf(line.updatedAt, now),
        ball: line.ball,
        event: events.get(line.id),
        marks: line.marks,
      },
    ]
  })
}

/** What Home has been to the user so far: on screen with its content, in a window with the focus. */
export interface Sight {
  readonly shown: boolean
  readonly focused: boolean
  /** Whether it was ever shown while the window had the focus. */
  readonly seen: boolean
}

export const UNSEEN: Sight = { shown: false, focused: false, seen: false }

/** The sight after Home was shown or hidden, or the window gained or lost the focus. */
export function sightAfter(sight: Sight, change: Partial<Pick<Sight, 'shown' | 'focused'>>): Sight {
  const next = { ...sight, ...change }
  return { ...next, seen: sight.seen || (next.shown && next.focused) }
}

/** Whether leaving Home moves the cursor of Since you left: only after it was seen. */
export const leavesLooked = (sight: Sight): boolean => sight.seen
