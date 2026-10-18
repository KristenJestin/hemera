/**
 * A Review round's small Spec as the database keeps it (#468, R2): its points, their scenarios
 * and proofs, its tasks and decisions, and where its feedback stands. Everything here reads or
 * writes inside a transaction a caller holds, or on the database: the Builder, the proofs, the
 * end of a Building and the briefs read the round through it, so it imports nothing that imports
 * the sessions back.
 */

import {
  Delta,
  type Proof,
  RoundDecisionAsked,
  type RoundPointKind,
  ROUND_POINT_KINDS,
  type RoundState,
  TaskTarget,
} from '@hemera/core/domain'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { Effect, Option, Schema } from 'effect'

import type { EventPayload, NewEvent } from '../journal.ts'
import { readProof } from '../planning/plan.ts'
import { type Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import {
  buildingLaunches,
  questions,
  reviewFeedback,
  reviewRounds,
  roundDecisions,
  roundPoints,
  roundScenarios,
  roundTasks,
  workspaces,
} from '../storage/schema.ts'

type Reader = EngineTransaction | Database['Service']

const json = <A, E>(schema: Schema.Codec<A, E>) => {
  const codec = Schema.fromJsonString(schema)
  return {
    read: Schema.decodeUnknownOption(codec),
    write: (value: A): string => Schema.encodeSync(codec)(value),
  }
}

const strings = json(Schema.Array(Schema.String))
const decisionsJson = json(Schema.Array(RoundDecisionAsked))
const targetsJson = json(Schema.Array(TaskTarget))

export const writeRoundStrings = strings.write
export const writeRoundDecisions = decisionsJson.write
export const writeRoundTargets = targetsJson.write

const stringsOf = (text: string): ReadonlyArray<string> =>
  Option.getOrElse(strings.read(text), () => [])

const readDelta = Schema.decodeUnknownOption(Delta)

/** A point of a round as it is kept. */
export interface RoundPointNow {
  readonly round: number
  readonly id: string
  readonly number: number
  readonly text: string
  readonly kind: RoundPointKind
  readonly delta: {
    readonly requirement: string
    readonly change: Delta
    readonly livingVersion: number
  } | null
  readonly sources: ReadonlyArray<string>
  readonly decisions: ReadonlyArray<RoundDecisionAsked>
  readonly removed: boolean
  readonly removedReason: string | null
}

/** A scenario of a round's point as it is kept, with its proof. */
export interface RoundScenarioNow {
  readonly round: number
  readonly point: string
  readonly id: string
  readonly number: number
  readonly rank: number
  readonly when: string
  readonly then: string
  readonly proof: Proof | null
  readonly removed: boolean
}

/** A task of a round as it is kept: its points stand where a Spec task has requirements. */
export interface RoundTaskNow {
  readonly round: number
  readonly id: string
  readonly number: number
  readonly rank: number
  readonly title: string
  readonly result: string
  readonly points: ReadonlyArray<string>
  readonly scenarios: ReadonlyArray<string>
  readonly targets: ReadonlyArray<TaskTarget>
  readonly dependsOn: ReadonlyArray<string>
  readonly removed: boolean
}

/** A decision a round took. */
export interface RoundDecisionNow {
  readonly id: string
  readonly round: number
  readonly point: string | null
  readonly feedbackId: string | null
  readonly kind: 'behaviour' | 'point' | 'clarify'
  readonly choice: string
  readonly alternatives: ReadonlyArray<string>
  readonly why: string
  readonly at: string
}

const pointOf = (row: typeof roundPoints.$inferSelect): RoundPointNow => {
  const change = Option.getOrNull(readDelta(row.deltaChange))
  return {
    round: row.round,
    id: row.id,
    number: row.number,
    text: row.text,
    kind: ROUND_POINT_KINDS.find((one) => one === row.kind) ?? 'corrective',
    delta:
      row.deltaRequirement === null || change === null
        ? null
        : {
            requirement: row.deltaRequirement,
            change,
            livingVersion: row.deltaLivingVersion ?? 0,
          },
    sources: stringsOf(row.sources),
    decisions: Option.getOrElse(decisionsJson.read(row.decisions), () => []),
    removed: row.removed,
    removedReason: row.removedReason,
  }
}

const scenarioOf = (row: typeof roundScenarios.$inferSelect): RoundScenarioNow => ({
  round: row.round,
  point: row.point,
  id: row.id,
  number: row.number,
  rank: row.rank,
  when: row.when,
  then: row.then,
  proof: Option.getOrNull(readProof(row.block)),
  removed: row.removed,
})

export const roundTaskOf = (row: typeof roundTasks.$inferSelect): RoundTaskNow => ({
  round: row.round,
  id: row.id,
  number: row.number,
  rank: row.rank,
  title: row.title,
  result: row.result,
  points: stringsOf(row.points),
  scenarios: stringsOf(row.scenarios),
  targets: Option.getOrElse(targetsJson.read(row.targets), () => []),
  dependsOn: stringsOf(row.dependsOn),
  removed: row.removed,
})

const DECISION_KINDS = ['behaviour', 'point', 'clarify'] as const

const decisionOf = (row: typeof roundDecisions.$inferSelect): RoundDecisionNow => ({
  id: row.id,
  round: row.round,
  point: row.point,
  feedbackId: row.feedbackId,
  kind: DECISION_KINDS.find((one) => one === row.kind) ?? 'point',
  choice: row.choice,
  alternatives: stringsOf(row.alternatives),
  why: row.why,
  at: row.at,
})

/** A round of the mission, or null. */
export const roundRowIn = (reader: Reader, missionId: string, number: number) =>
  reader
    .select()
    .from(reviewRounds)
    .where(and(eq(reviewRounds.missionId, missionId), eq(reviewRounds.number, number)))
    .pipe(
      Effect.mapError(refusedWhile('reading a round')),
      Effect.map(([row]) => row ?? null),
    )

/** The number of the mission's round in a state, or null: at most one runs at a time. */
export const roundInState = (reader: Reader, missionId: string, state: RoundState) =>
  reader
    .select({ number: reviewRounds.number })
    .from(reviewRounds)
    .where(and(eq(reviewRounds.missionId, missionId), eq(reviewRounds.state, state)))
    .orderBy(asc(reviewRounds.number))
    .pipe(
      Effect.mapError(refusedWhile('reading the rounds')),
      Effect.map((rows) => rows.at(-1)?.number ?? null),
    )

/** The mission's round being grilled, or null. */
export const grillingRoundIn = (reader: Reader, missionId: string) =>
  roundInState(reader, missionId, 'grilling')

/** The role a mission's Planner deliveries go to now: its Planner in round mode while a round is grilled. */
export const plannerRoleIn = (reader: Reader, missionId: string) =>
  Effect.map(grillingRoundIn(reader, missionId), (round) =>
    round === null ? 'planner' : 'round-planner',
  )

/** The folder of the mission's launched Workspace, or null when it has none. */
export const workspaceFolderIn = (reader: Reader, missionId: string) =>
  reader
    .select({ folder: workspaces.folder })
    .from(buildingLaunches)
    .innerJoin(workspaces, eq(workspaces.id, buildingLaunches.workspaceId))
    .where(and(eq(buildingLaunches.missionId, missionId), eq(buildingLaunches.state, 'launched')))
    .orderBy(desc(buildingLaunches.startedAt))
    .limit(1)
    .pipe(
      Effect.mapError(refusedWhile('reading the Workspace')),
      Effect.map(([row]) => row?.folder ?? null),
    )

/** Every point of a round, removed ones included, in their order. */
export const roundPointsIn = (reader: Reader, missionId: string, round: number) =>
  reader
    .select()
    .from(roundPoints)
    .where(and(eq(roundPoints.missionId, missionId), eq(roundPoints.round, round)))
    .orderBy(asc(roundPoints.number))
    .pipe(
      Effect.mapError(refusedWhile('reading the points')),
      Effect.map((rows) => rows.map(pointOf)),
    )

/** The live scenarios of a round, in their order. */
export const roundScenariosIn = (reader: Reader, missionId: string, round: number) =>
  reader
    .select()
    .from(roundScenarios)
    .where(
      and(
        eq(roundScenarios.missionId, missionId),
        eq(roundScenarios.round, round),
        eq(roundScenarios.removed, false),
      ),
    )
    .orderBy(asc(roundScenarios.rank))
    .pipe(
      Effect.mapError(refusedWhile('reading the scenarios')),
      Effect.map((rows) => rows.map(scenarioOf)),
    )

/** The live tasks of a round, in their order. */
export const roundTasksIn = (reader: Reader, missionId: string, round: number) =>
  reader
    .select()
    .from(roundTasks)
    .where(
      and(
        eq(roundTasks.missionId, missionId),
        eq(roundTasks.round, round),
        eq(roundTasks.removed, false),
      ),
    )
    .orderBy(asc(roundTasks.rank))
    .pipe(
      Effect.mapError(refusedWhile('reading the tasks')),
      Effect.map((rows) => rows.map(roundTaskOf)),
    )

/** Every decision the mission's rounds took, the first first. */
export const roundDecisionsIn = (reader: Reader, missionId: string) =>
  reader
    .select()
    .from(roundDecisions)
    .where(eq(roundDecisions.missionId, missionId))
    .orderBy(asc(roundDecisions.round), asc(roundDecisions.at))
    .pipe(
      Effect.mapError(refusedWhile('reading the decisions')),
      Effect.map((rows) => rows.map(decisionOf)),
    )

/** The Proof block of a round's scenario, or null when no round of the mission has it. */
export const roundProofIn = (reader: Reader, missionId: string, scenario: string) =>
  reader
    .select({ block: roundScenarios.block })
    .from(roundScenarios)
    .where(and(eq(roundScenarios.missionId, missionId), eq(roundScenarios.id, scenario)))
    .pipe(
      Effect.mapError(refusedWhile('reading a proof')),
      Effect.map(([row]) => (row === undefined ? null : Option.getOrNull(readProof(row.block)))),
    )

/** The feedback of a round, in the order written. */
export const roundFeedbackIn = (reader: Reader, missionId: string, round: number) =>
  reader
    .select()
    .from(reviewFeedback)
    .where(and(eq(reviewFeedback.missionId, missionId), eq(reviewFeedback.round, round)))
    .orderBy(asc(reviewFeedback.createdAt))
    .pipe(Effect.mapError(refusedWhile('reading the feedback')))

/**
 * The sources of a round's live points still waiting for the Builder's answer: in the round, not
 * answered, not withdrawn. The end of the round's Building does not start while one is left.
 */
export const unansweredSourcesIn = (reader: Reader, missionId: string, round: number) =>
  Effect.gen(function* () {
    const points = (yield* roundPointsIn(reader, missionId, round)).filter((one) => !one.removed)
    const sources = [...new Set(points.flatMap((one) => one.sources))]
    if (sources.length === 0) return []
    const rows = yield* reader
      .select({ id: reviewFeedback.id, state: reviewFeedback.state })
      .from(reviewFeedback)
      .where(and(eq(reviewFeedback.missionId, missionId), inArray(reviewFeedback.id, sources)))
      .pipe(Effect.mapError(refusedWhile('reading the feedback')))
    return sources.filter((id) => rows.find((row) => row.id === id)?.state === 'in_round')
  })

/** The questions a round's grilling asked, by their ids. */
export const roundQuestionsIn = (reader: Reader, missionId: string, round: number) =>
  reader
    .select()
    .from(questions)
    .where(and(eq(questions.missionId, missionId), eq(questions.round, round)))
    .orderBy(asc(questions.number))
    .pipe(Effect.mapError(refusedWhile('reading the questions')))

/** What a feedback's event carries for the Journal, as Review's own events do (#341). */
export const feedbackEventPayload = (row: typeof reviewFeedback.$inferSelect): EventPayload => ({
  feedbackId: row.id,
  round: row.round,
  kind: row.kind,
  body: row.body,
  authorKind: row.authorKind,
  authorLogin: row.authorLogin,
  repository: row.anchorRepository,
  path: row.anchorPath,
  start: row.anchorStart,
  end: row.anchorEnd,
  item: row.anchorItem,
})

/** An event of a round, written by Hemera. */
export const roundEvent = (missionId: string, type: string, payload: EventPayload): NewEvent => ({
  type,
  entityKind: 'mission',
  entityId: missionId,
  source: 'system',
  author: 'hemera',
  payload,
})

/**
 * The round a Building of the round just ended, answered, in the transaction that moves the
 * mission back to Review: its events, or none when it is not building.
 */
export const roundAnsweredIn = (transaction: EngineTransaction, missionId: string, round: number) =>
  Effect.gen(function* () {
    const written = yield* transaction
      .update(reviewRounds)
      .set({ state: 'answered', movedAt: new Date().toISOString() })
      .where(
        and(
          eq(reviewRounds.missionId, missionId),
          eq(reviewRounds.number, round),
          eq(reviewRounds.state, 'building'),
        ),
      )
      .returning({ number: reviewRounds.number })
      .pipe(Effect.mapError(refusedWhile('answering the round')))
    if (written.length === 0) return []
    const events = [
      roundEvent(missionId, 'review.round_moved', { round, from: 'building', to: 'answered' }),
      roundEvent(missionId, 'review.round_answered', { round }),
    ]
    // Answered with every feedback already settled: it closes now, as #341's rounds do.
    const rows = yield* roundFeedbackIn(transaction, missionId, round)
    if (!rows.every((one) => one.state === 'resolved' || one.state === 'withdrawn')) return events
    yield* transaction
      .update(reviewRounds)
      .set({ state: 'closed', movedAt: new Date().toISOString() })
      .where(and(eq(reviewRounds.missionId, missionId), eq(reviewRounds.number, round)))
      .pipe(Effect.mapError(refusedWhile('closing the round')))
    return [
      ...events,
      roundEvent(missionId, 'review.round_moved', { round, from: 'answered', to: 'closed' }),
    ]
  })

// --- How the round's agents read it -------------------------------------------------------------

/** A feedback of a round as an agent's brief lists it: its id, kind and state, then its text. */
export const feedbackLine = (row: typeof reviewFeedback.$inferSelect): string => {
  const head = `- ${row.id} (${row.kind}, ${row.state.replace('_', ' ')})`
  const answer = row.answer === null ? '' : `\n  Answered: ${row.answer}`
  return `${head}:\n  ${(row.said ?? row.body).replaceAll('\n', '\n  ')}${answer}`
}

/** A point as an agent's brief lists it, with its scenarios and their proofs in short. */
export const pointSaid = (point: RoundPointNow, scenarios: ReadonlyArray<RoundScenarioNow>) =>
  [
    `- ${point.id} (${point.kind === 'behaviour' ? 'behaviour change' : 'corrective'}${point.removed ? `, removed: ${point.removedReason ?? ''}` : ''}): ${point.text}`,
    point.delta === null
      ? null
      : `  Delta: ${point.delta.change} ${point.delta.requirement}, written against living version ${String(point.delta.livingVersion)}.`,
    `  Sources: ${point.sources.join(', ')}.`,
    ...scenarios
      .filter((one) => one.point === point.id)
      .map(
        (one) =>
          `  ${one.id}: WHEN ${one.when} THEN ${one.then} (${one.proof?.mode === 'automated' ? `automated: ${one.proof.test?.repository ?? ''}/${one.proof.test?.path ?? ''}` : 'verified by hand'})`,
      ),
    ...point.decisions.map(
      (one) =>
        `  Decision: ${one.choice} (why: ${one.why}${one.alternatives.length === 0 ? '' : `; set aside: ${one.alternatives.join('; ')}`})`,
    ),
  ]
    .filter((line) => line !== null)
    .join('\n')

/** A task of a round as an agent's brief lists it. */
export const roundTaskSaid = (task: RoundTaskNow): string =>
  [
    `- ${task.id} · ${task.title}: ${task.result}`,
    `Points: ${task.points.join(', ') || 'none'}.`,
    task.scenarios.length === 0 ? null : `Scenarios: ${task.scenarios.join(', ')}.`,
    task.targets.length === 0
      ? null
      : `Targets: ${task.targets.map((one) => `${one.intent} ${one.repository}/${one.path}`).join(', ')}.`,
    task.dependsOn.length === 0 ? null : `After: ${task.dependsOn.join(', ')}.`,
  ]
    .filter((part) => part !== null)
    .join(' ')

/** A round's decisions as the Spec's reader lists them; null when there is none. */
export const roundDecisionsSaid = (decisions: ReadonlyArray<RoundDecisionNow>): string | null =>
  decisions.length === 0
    ? null
    : decisions
        .map(
          (one) =>
            `- Round ${String(one.round)}${one.point === null ? '' : `, ${one.point}`}${one.feedbackId === null ? '' : `, on ${one.feedbackId}`} (${one.kind}): ${one.choice}${one.why === '' ? '' : ` Why: ${one.why}`}`,
        )
        .join('\n')
