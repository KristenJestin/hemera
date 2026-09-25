/**
 * What a `build` Session's agent is handed at a safe point, composed from the build's rows with the
 * core's `composeBuildBrief` (design D10-02, D10-03, D10-07, D10-09).
 *
 * A build is driven by deliveries, never by a message of the user's: the `prepare` brief until the
 * approach note exists; in `execute`, every ready task not handed yet and the failures not told yet
 * — a task's red attempt, a story's or the end checks', a blocker the user dismissed —; the resume
 * brief after a Resume, a restart, or to an agent whose own session holds none; and at `verify`, the
 * `verify` brief then the failures of the end checks. The first delivery of a phase, and a resume, is
 * a brief folded in the thread; the others are a line of Hemera's.
 *
 * What a delivery hands is marked as it goes out (`handing`): the agent's first tool call inside
 * that very delivery starts the tasks it holds (L3). It counts as given once the agent took it
 * (`taken`), and a delivery the agent did not take is unmarked again (`missed`) for the next safe
 * point.
 */

import {
  type ActiveBuildPhase,
  type BriefAttempt,
  type BriefFailure,
  type BriefTask,
  composeBuildBrief,
  readySet,
} from '@hemera/core'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { Effect } from 'effect'

import { fingerprintOf } from '../context/service.ts'
import type { EngineTransaction } from '../storage/database.ts'
import { buildAttempts, buildTasks, contextDeliveries } from '../storage/schema.ts'
import { failed, now } from '../specs/snapshot.ts'
import {
  type AttemptRow,
  type BuildRows,
  type TaskRow,
  asBuildTasks,
  attemptsOf,
  briefPath,
  openBlockerOf,
  pendingFailures,
  resultOf,
  specTaskOf,
  stateOf,
  verdictOf,
} from './tasks.ts'

/** One delivery of a build, as the runtime hands it over and gives it back. */
export interface BuildDelivery {
  readonly sessionId: string
  readonly kind: 'prepare' | 'execute' | 'resume' | 'verify'
  /** The phase it was composed in. */
  readonly phase: ActiveBuildPhase
  /** What the agent is handed. */
  readonly text: string
  /** Whether it is a brief folded in the thread — a phase's first, or a resume — or a line. */
  readonly opens: boolean
  /** What the line says, in the user's words, when it is one. */
  readonly said: string
  /** The build tasks it hands for the first time. */
  readonly handed: readonly string[]
  /** The attempts whose failures it tells. */
  readonly told: readonly string[]
  /** The story and build attempts whose checks run again once the turn carrying them ends (L7). */
  readonly retold: readonly string[]
  /** When it was composed: the mark `handing` writes, which `missed` takes back. */
  readonly stamp: string
}

function briefAttempt(rows: BuildRows, attempt: AttemptRow): BriefAttempt {
  return {
    number: attempt.number,
    result: resultOf(attempt),
    files: rows.files
      .filter((file) => file.attemptId === attempt.id)
      .map((file) => ({
        repository: file.repository,
        path: file.path,
        status: file.status,
        added: file.added,
        removed: file.removed,
      })),
    checks: rows.results
      .filter((result) => result.attemptId === attempt.id)
      .map((result) => ({
        name: result.name,
        place: result.place,
        verdict: verdictOf(result),
        detail: result.detail,
        outputTail: result.outputTail,
      })),
  }
}

/** One task with its definition and where it stands, as a brief tells it. */
export function briefTask(rows: BuildRows, task: TaskRow): BriefTask {
  const spec = specTaskOf(rows, task)
  const labelOf = (taskId: string) =>
    rows.tasks.find((one) => one.taskId === taskId)?.label ?? taskId
  const attempts = attemptsOf(rows, task)
  const running = attempts.findLast((attempt) => attempt.endedAt === null)
  const state = stateOf(task)
  return {
    label: task.label,
    title: spec?.title ?? task.label,
    result: spec?.result ?? '',
    criteria: spec?.criteria ?? '',
    type: spec?.type ?? '',
    executor: spec?.executor ?? 'agent',
    state,
    dependsOn: rows.snapshot.dependencies
      .filter((dependency) => dependency.taskId === task.taskId)
      .map((dependency) => labelOf(dependency.dependsOnId)),
    covers: rows.snapshot.taskStories
      .filter((link) => link.taskId === task.taskId)
      .flatMap((link) => rows.snapshot.stories.filter((story) => story.id === link.storyId))
      .map((story) => story.title),
    attempts: attempts.map((attempt) => briefAttempt(rows, attempt)),
    snapshots:
      running === undefined
        ? []
        : rows.trees
            .filter((tree) => tree.attemptId === running.id)
            .map((tree) => ({ repository: tree.repository, tree: tree.startTree })),
    reason: reasonOf(rows, task),
  }
}

/** Why a task is held back, as a brief tells it: the user's skip, or the agent's blocker. */
function reasonOf(rows: BuildRows, task: TaskRow): string | null {
  const state = stateOf(task)
  if (state === 'skipped') return task.skipReason
  if (state === 'blocked') return openBlockerOf(rows, task)?.reason ?? null
  return null
}

function briefFailure(rows: BuildRows, attempt: AttemptRow): BriefFailure {
  return {
    story: rows.snapshot.stories.find((story) => story.id === attempt.storyId)?.title ?? null,
    attempt: briefAttempt(rows, attempt),
  }
}

/** The red attempt of a task that is to be told: the last one that ended, when it is red. */
function untoldRed(rows: BuildRows, task: TaskRow): AttemptRow | undefined {
  const last = attemptsOf(rows, task).findLast((attempt) => attempt.endedAt !== null)
  return last !== undefined && resultOf(last) === 'red' && last.toldAt === null ? last : undefined
}

/** A list of words the way a sentence says them: `T1`, `T1 and T2`, `T1, T2 and T3`. */
function listed(words: readonly string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`
}

/**
 * What waits for a build Session's agent, or null when nothing does: a build that is closed,
 * paused, or has nothing new to hand. `resumeDue` says the agent is to be handed the resume brief —
 * after a Resume or a restart, or because its own session holds no brief (L9).
 */
export function deliveryFor(rows: BuildRows, resumeDue: boolean): BuildDelivery | null {
  const { phase } = rows
  if (rows.session.buildPausedAt !== null) return null
  if (phase === null || phase === 'accepted' || phase === 'stopped') return null
  const sessionId = rows.session.id
  const stamp = now()
  const labels = new Map(rows.tasks.map((task) => [task.taskId, task.label]))
  const base = { sessionId, phase, stamp }

  if (phase === 'prepare') {
    // Until the note exists, the `prepare` brief is what an agent starting over is handed again:
    // it is the whole of what a resume in `prepare` has to say (L2).
    if (!resumeDue && rows.briefed.has(briefPath('prepare'))) return null
    return {
      ...base,
      kind: 'prepare',
      opens: true,
      said: 'Hemera handed the agent the Spec to prepare its build.',
      text: composeBuildBrief({ kind: 'prepare', snapshot: rows.snapshot, labels }),
      handed: [],
      told: [],
      retold: [],
    }
  }

  const failures = pendingFailures(rows)
  const untold = failures.filter((attempt) => attempt.toldAt === null)
  const byTaskId = new Map(rows.tasks.map((task) => [task.taskId, task]))
  const ready = readySet(asBuildTasks(rows), rows.snapshot.dependencies).flatMap((one) => {
    const task = byTaskId.get(one.taskId)
    return task === undefined ? [] : [task]
  })

  if (resumeDue) {
    const red = ready.flatMap((task) => {
      const attempt = untoldRed(rows, task)
      return attempt === undefined ? [] : [attempt.id]
    })
    return {
      ...base,
      kind: 'resume',
      opens: true,
      said: 'Hemera handed the agent where the build stands.',
      text: composeBuildBrief({
        kind: 'resume',
        phase,
        snapshot: rows.snapshot,
        labels,
        tasks: rows.tasks.map((task) => briefTask(rows, task)),
        ready: ready.map((task) => briefTask(rows, task)),
        failures: failures.map((attempt) => briefFailure(rows, attempt)),
      }),
      handed: ready.filter((task) => task.handedAt === null).map((task) => task.id),
      told: [...red, ...untold.map((attempt) => attempt.id)],
      retold: failures.map((attempt) => attempt.id),
    }
  }

  const told = untold.map((attempt) => attempt.id)
  const endsSaid = untold.map((attempt) => {
    const story = rows.snapshot.stories.find((one) => one.id === attempt.storyId)
    return story === undefined
      ? 'the failures of the end checks'
      : `the failures of the checks of “${story.title}”`
  })

  if (phase === 'verify') {
    const opens = !rows.briefed.has(briefPath('verify'))
    if (!opens && untold.length === 0) return null
    return {
      ...base,
      kind: 'verify',
      opens,
      said: `Hemera handed the agent ${listed(endsSaid)}.`,
      text: composeBuildBrief({
        kind: 'verify',
        failures: untold.map((attempt) => briefFailure(rows, attempt)),
      }),
      handed: [],
      told,
      retold: told,
    }
  }

  // `execute`: every ready task not handed yet, and every one whose red attempt is not told yet.
  const toHand = ready.filter(
    (task) => task.handedAt === null || untoldRed(rows, task) !== undefined,
  )
  const dismissed = toHand.flatMap((task) => {
    const blocker = rows.blockers.findLast((one) => one.buildTaskId === task.id)
    return task.handedAt === null && blocker !== undefined && blocker.dismissedAt !== null
      ? [{ task, blocker }]
      : []
  })
  if (toHand.length === 0 && untold.length === 0) return null
  const fresh = toHand.filter((task) => task.handedAt === null)
  const retried = toHand.flatMap((task) => {
    const attempt = untoldRed(rows, task)
    return attempt === undefined ? [] : [{ task, attempt }]
  })
  const words = [
    ...(fresh.length === 0 ? [] : [listed(fresh.map((task) => task.label))]),
    ...retried.map(({ task }) => `the failures of ${task.label}`),
    ...endsSaid,
  ]
  return {
    ...base,
    kind: 'execute',
    opens: !rows.briefed.has(briefPath('execute')),
    said: `Hemera handed the agent ${listed(words)}.`,
    text: composeBuildBrief({
      kind: 'execute',
      ready: toHand.map((task) => briefTask(rows, task)),
      failures: untold.map((attempt) => briefFailure(rows, attempt)),
      dismissed: dismissed.map(({ task, blocker }) => ({
        label: task.label,
        title: specTaskOf(rows, task)?.title ?? task.label,
        reason: blocker.reason,
      })),
    }),
    handed: fresh.map((task) => task.id),
    told: [...retried.map(({ attempt }) => attempt.id), ...told],
    retold: told,
  }
}

/**
 * Marks what a delivery hands as it goes out: the tasks handed for the first time, and the attempts
 * whose failures it tells. Written before the agent reads it, because its first tool call inside
 * this very delivery is what starts those tasks (L3).
 */
export function handing(transaction: EngineTransaction, delivery: BuildDelivery) {
  return Effect.gen(function* () {
    if (delivery.handed.length > 0) {
      yield* transaction
        .update(buildTasks)
        .set({ handedAt: delivery.stamp, updatedAt: delivery.stamp })
        .where(and(inArray(buildTasks.id, [...delivery.handed]), isNull(buildTasks.handedAt)))
        .pipe(Effect.mapError(failed('marking the tasks handed')))
    }
    if (delivery.told.length > 0) {
      yield* transaction
        .update(buildAttempts)
        .set({ toldAt: delivery.stamp })
        .where(and(inArray(buildAttempts.id, [...delivery.told]), isNull(buildAttempts.toldAt)))
        .pipe(Effect.mapError(failed('marking the failures told')))
    }
  })
}

/**
 * The agent took the delivery: a brief is recorded under its phase, so the next delivery of that
 * phase is a line and not a brief again.
 */
export function taken(transaction: EngineTransaction, delivery: BuildDelivery) {
  if (!delivery.opens) return Effect.void
  return transaction
    .insert(contextDeliveries)
    .values({
      id: crypto.randomUUID(),
      sessionId: delivery.sessionId,
      kind: 'brief',
      path: briefPath(delivery.phase),
      fingerprint: fingerprintOf(delivery.text),
      deliveredAt: now(),
    })
    .pipe(Effect.mapError(failed('recording the brief of the build')), Effect.asVoid)
}

/**
 * The agent did not take the delivery: what it marked and nothing has acted on since is unmarked,
 * so the next safe point hands it again. A task the agent started inside it stays started.
 */
export function missed(transaction: EngineTransaction, delivery: BuildDelivery) {
  return Effect.gen(function* () {
    if (delivery.handed.length > 0) {
      yield* transaction
        .update(buildTasks)
        .set({ handedAt: null })
        .where(
          and(
            inArray(buildTasks.id, [...delivery.handed]),
            eq(buildTasks.handedAt, delivery.stamp),
            eq(buildTasks.state, 'ready'),
          ),
        )
        .pipe(Effect.mapError(failed('unmarking the tasks handed')))
    }
    if (delivery.told.length > 0) {
      yield* transaction
        .update(buildAttempts)
        .set({ toldAt: null })
        .where(
          and(
            inArray(buildAttempts.id, [...delivery.told]),
            eq(buildAttempts.toldAt, delivery.stamp),
          ),
        )
        .pipe(Effect.mapError(failed('unmarking the failures told')))
    }
  })
}
