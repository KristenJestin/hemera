/**
 * A mission as the screens' lists read it: the engine's `Mission` turned into a line a row draws —
 * its stage in the screens' words, the ball in the design system's, its marks as rows show them —
 * and the lists grouped by stage. Plain values and functions, no React: the hook that holds the
 * list is in `use-missions.ts`.
 */

import type { Ball, BlockedCause, Mark, Stage } from '@hemera/core/domain'
import type { Mission, MissionsChange } from '@hemera/ipc'
import {
  STAGE_ORDER,
  type Ball as UiBall,
  type MissionMarkView,
  type MissionStage,
} from '@hemera/ui'
import { Match, Predicate } from 'effect'

/** A mission as a list draws it: everything a row, a group or a header needs, and no more. */
export interface MissionLine {
  id: string
  projectId: string
  key: string
  title: string
  stage: MissionStage
  round: number
  frozen: boolean
  /** The UI ball; null from the engine (Done, Cancelled) becomes `idle`. */
  ball: UiBall
  /** `needsYou` first when the mission owns a pending need. */
  marks: readonly MissionMarkView[]
  /** How many needs of the user the mission owns. */
  needs: number
  type: 'feature' | 'bug' | 'maintenance'
  /** The ticket it came from by its own key and page, null for none. */
  ticket: { key: string; url: string | null } | null
  updatedAt: string
}

const STAGE_WORDS: Record<Stage, MissionStage> = {
  planning: 'Planning',
  ready: 'Ready',
  building: 'Building',
  review: 'Review',
  shipping: 'Shipping',
  done: 'Done',
  cancelled: 'Cancelled',
}

/** The engine's stage in the screens' words. */
export function stageOf(stage: Stage): MissionStage {
  return STAGE_WORDS[stage]
}

const BALLS = Match.type<Ball>().pipe(
  Match.tagsExhaustive({
    AgentWorking: (): UiBall => 'agent',
    WaitingOnYou: (): UiBall => 'you',
    WaitingOnSomeone: (): UiBall => 'someone',
    Blocked: (): UiBall => 'blocked',
    Idle: (): UiBall => 'idle',
  }),
)

/** The engine's ball as the design system's; no ball (Done, Cancelled) is idle. */
export function ballOf(ball: Ball | null): UiBall {
  return ball === null ? 'idle' : BALLS(ball)
}

const CAUSES = Match.type<BlockedCause>().pipe(
  Match.tagsExhaustive({
    Dependency: (cause) => cause.missionKey,
    Resource: (cause) => `${cause.name} · ${cause.heldBy}`,
  }),
)

const markView = (repositoryName: (id: string) => string) =>
  Match.type<Mark>().pipe(
    Match.tagsExhaustive({
      Blocked: (mark): MissionMarkView => ({ kind: 'blocked', cause: CAUSES(mark.cause) }),
      WaitingOnSomeone: (mark): MissionMarkView => ({
        kind: 'waiting',
        on: mark.note ?? mark.question,
      }),
      Outdated: (): MissionMarkView => ({ kind: 'outdated' }),
      ChangedOutside: (mark): MissionMarkView => ({
        kind: 'outside',
        repository: repositoryName(mark.repositoryId),
      }),
      Fixing: (): MissionMarkView => ({ kind: 'fixing' }),
    }),
  )

/** A mission's marks as rows draw them, `needsYou` first when a need waits on the user. */
export function marksOf(
  mission: Mission,
  repositoryName: (id: string) => string,
): MissionMarkView[] {
  const view = markView(repositoryName)
  const marks = mission.marks.map((entry) => view(entry.mark))
  return mission.needs.length > 0 ? [{ kind: 'needsYou' }, ...marks] : marks
}

/** A mission as a line of a list; `repositoryName` says a repository by the name a mark shows. */
export function lineOf(
  mission: Mission,
  repositoryName: (repositoryId: string) => string,
): MissionLine {
  return {
    id: mission.id,
    projectId: mission.projectId,
    key: mission.key,
    title: mission.title,
    stage: stageOf(mission.stage),
    round: mission.round,
    frozen: mission.frozen,
    ball: ballOf(mission.ball),
    marks: marksOf(mission, repositoryName),
    needs: mission.needs.length,
    type: mission.type,
    ticket:
      mission.ticketLink === null
        ? null
        : { key: mission.ticketLink.key, url: mission.ticketLink.url },
    updatedAt: mission.updatedAt,
  }
}

/** The lines by stage in the stages' order, the empty stages dropped, the newest first inside. */
export function byStage(
  lines: readonly MissionLine[],
): ReadonlyArray<{ stage: MissionStage; lines: readonly MissionLine[] }> {
  return STAGE_ORDER.map((stage) => ({
    stage,
    lines: lines
      .filter((line) => line.stage === stage)
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  })).filter((group) => group.lines.length > 0)
}

/**
 * The missions of a Project after a change of the engine's: a changed mission of this Project
 * replaces its earlier self in place or joins the end; a need, or another Project's mission,
 * leaves the list as it was.
 */
export function afterChange(
  missions: ReadonlyArray<Mission>,
  change: MissionsChange,
  projectId: string,
): ReadonlyArray<Mission> {
  if (!Predicate.isTagged(change, 'MissionChanged') || change.mission.projectId !== projectId)
    return missions
  const changed = change.mission
  return missions.some((one) => one.id === changed.id)
    ? missions.map((one) => (one.id === changed.id ? changed : one))
    : [...missions, changed]
}
