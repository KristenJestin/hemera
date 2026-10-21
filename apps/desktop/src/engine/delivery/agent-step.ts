/**
 * The Agent step of the delivery (S1): the Project's task given to one fresh session of the
 * Delivery role, in the repository's worktree of the mission's Workspace.
 *
 * - The tree the step starts from is snapshotted first, and kept with the step with its session's
 *   lineage, which the role's brief reads.
 * - The session counts in the Project's cap as a fixed phase: it waits for a slot, and Now says so.
 * - The step is done when the session reports `done`, failed when it reports `failed` (its
 *   summary), when its turn ends without a report, or when the session stops.
 * - **Ship froze the trees**: once the session reported done, the repository is snapshotted
 *   again; a tree that changed goes back to the user as a decision need listing the changed files
 *   with their diff: "Discard these changes" (recommended: the tree the step started from is
 *   restored) or "Keep them and push them to the pull request" (the tree accepted is kept with the
 *   step, the tree S3's head check expects).
 * - Cut off midway (a stop of the engine), it has no post-condition: it becomes the user's, and its
 *   session is ended.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { lineDifference } from '@hemera/core/domain'
import { and, eq } from 'drizzle-orm'
import { Data, Deferred, Effect, Option, Predicate, Schema, Stream } from 'effect'

import { type FileDiff, Snapshots } from '../building/snapshots.ts'
import { Cap } from '../sessions/cap.ts'
import { SessionPost } from '../sessions/post.ts'
import { Sessions } from '../sessions/service.ts'
import { getSession } from '../sessions/store.ts'
import { Database, refusedWhile } from '../storage/database.ts'
import { deliverySteps } from '../storage/schema.ts'
import { DomainEvents } from '../domain-events.ts'
import { answered, refusal } from '../tools/files.ts'
import { DeliveryDesk } from './agent-desk.ts'
import { stepOfLineage } from './agent-role.ts'
import { StepAsks, type StepAt, type StepType, done, failed, notDone } from './steps.ts'

export const DISCARD = 'Discard these changes'
export const KEEP = 'Keep them and push them to the pull request'

/** How the Agent step's session ended: its report, or its end without one. */
type Ended = Data.TaggedEnum<{
  Reported: { readonly outcome: 'done' | 'failed'; readonly summary: string }
  Silent: { readonly why: string }
}>
const Ended = Data.taggedEnum<Ended>()

/** What the step keeps for the user's answer: the trees before and after its session. */
const Kept = Schema.Struct({ before: Schema.String, after: Schema.String, summary: Schema.String })
const readKept = Schema.decodeUnknownOption(Kept)
const readLineage = Schema.decodeUnknownOption(Schema.String)

/** How much of a file's diff the need shows. */
const SHOWN_DIFF = 4_000

const decoder = new TextDecoder('utf-8', { fatal: true })
const textOf = (bytes: Uint8Array | null): string | null => {
  if (bytes === null) return null
  try {
    return decoder.decode(bytes)
  } catch {
    return null
  }
}

/** One changed file as the need lists it: its status and path, then its diff when it is text. */
const fileSaid = (file: FileDiff): string => {
  const head = `${file.status} ${file.oldPath === null ? file.path : `${file.oldPath} → ${file.path}`}`
  const before = file.before === null ? '' : textOf(file.before.content)
  const after = file.after === null ? '' : textOf(file.after.content)
  if (before === null || after === null) return `${head} (not shown: binary or withheld)`
  const diff = lineDifference(before, after)
  return diff === ''
    ? head
    : `${head}\n${diff.length > SHOWN_DIFF ? `${diff.slice(0, SHOWN_DIFF)}\n…` : diff}`
}

/** A side Hemera can write back as it was: its content, neither masked nor withheld. */
const restorable = (file: FileDiff) =>
  file.before === null ||
  (file.before.content !== null && !file.before.masked && file.before.withheld === null)

export const agentStepType = Effect.gen(function* () {
  const context = yield* Effect.context<
    Database | Sessions | Cap | Snapshots | SessionPost | DomainEvents | DeliveryDesk
  >()
  const sessions = yield* Sessions
  const cap = yield* Cap
  const snapshots = yield* Snapshots
  const post = yield* SessionPost
  const database = yield* Database
  const scope = yield* Effect.scope

  /** The sessions waiting for their report, by lineage. */
  const waiting = new Map<string, Deferred.Deferred<Ended>>()

  const setStep = (at: StepAt, set: Partial<typeof deliverySteps.$inferInsert>) =>
    database
      .update(deliverySteps)
      .set(set)
      .where(
        and(
          eq(deliverySteps.missionId, at.missionId),
          eq(deliverySteps.repositoryId, at.repositoryId),
          eq(deliverySteps.stepId, at.step.id),
        ),
      )
      .pipe(Effect.mapError(refusedWhile('recording an Agent step')))

  const report = DeliveryDesk.use((desk) =>
    desk.serve({
      report: (grant, args) =>
        Effect.gen(function* () {
          const session = yield* getSession(grant.sessionId)
          const ended = waiting.get(session.lineage)
          if (ended === undefined) return refusal('This session runs no delivery step now.')
          yield* Deferred.succeed(
            ended,
            Ended.Reported({ outcome: args.outcome, summary: args.summary }),
          )
          return answered(
            'Reported. Hemera compares the repository with the frozen tree; your session ends.',
          )
        }).pipe(
          Effect.orElseSucceed(() => refusal('The report could not be recorded.')),
          Effect.provide(context),
        ),
    }),
  )
  yield* report

  /** A turn that ended without the report, or a session that stopped: the step failed. */
  const silent = (sessionId: string, why: string) =>
    Effect.gen(function* () {
      const session = yield* getSession(sessionId)
      const ended = waiting.get(session.lineage)
      if (ended === undefined) return
      yield* sessions.settled(sessionId)
      const now = yield* getSession(sessionId)
      if (now.state === 'idle' || now.state === 'ended' || now.state === 'failed') {
        yield* Deferred.succeed(ended, Ended.Silent({ why }))
      }
    }).pipe(Effect.ignore)
  yield* post.turns.pipe(
    Stream.filter((turn) => !turn.on),
    Stream.runForEach((turn) =>
      Effect.forkIn(
        silent(turn.sessionId, 'The session ended its turn without delivery_step_report.'),
        scope,
      ),
    ),
    Effect.forkScoped,
  )
  const stopped = yield* DomainEvents.use((events) => events.subscribe)
  yield* stopped.pipe(
    Stream.filter(
      (event) =>
        event.type === 'session.stopped' &&
        event.payload['role'] === 'delivery' &&
        event.payload['state'] !== 'replaced',
    ),
    Stream.runForEach((event) => {
      const ended = Option.match(readLineage(event.payload['lineage']), {
        onNone: () => undefined,
        onSome: (lineage) => waiting.get(lineage),
      })
      return ended === undefined
        ? Effect.void
        : Deferred.succeed(
            ended,
            Ended.Silent({ why: 'The session stopped without delivery_step_report.' }),
          )
    }),
    Effect.forkScoped,
  )

  /** Ends the step's session and frees its slot: once it reported, stopped, or was cut off. */
  const close = (lineage: string, why: string) =>
    Effect.all([sessions.end(lineage, why), cap.release(lineage)], { discard: true }).pipe(
      Effect.ignore,
    )

  const run = (at: StepAt) =>
    Effect.gen(function* () {
      if (at.step.kind !== 'agent') return failed(`${at.step.kind} is not an Agent step.`)
      if (at.folder === null) {
        return failed(`The worktree of ${at.repository} is not on the disk.`)
      }
      const place = { name: at.repository, folder: at.folder }
      const lineage = crypto.randomUUID()
      const before = yield* snapshots.take(place, {
        kind: 'run',
        missionId: at.missionId,
        runId: lineage,
        side: 'before',
      })
      yield* setStep(at, { lineage, startTree: before, acceptedTree: null })
      const ended = yield* Deferred.make<Ended>()
      waiting.set(lineage, ended)
      const outcome = yield* Effect.gen(function* () {
        yield* cap.acquire({
          projectId: at.projectId,
          lineage,
          missionId: at.missionId,
          requestedBy: 'hemera',
          phase: 'Delivery',
        })
        yield* sessions.reopen(
          lineage,
          {
            owner: { kind: 'mission', missionId: at.missionId },
            role: 'delivery',
            folder: at.folder ?? '',
            requestedBy: 'hemera',
          },
          `the delivery step ${at.step.id} of ${at.repository} starts`,
        )
        return yield* Deferred.await(ended)
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() => {
            waiting.delete(lineage)
            return close(lineage, 'its delivery step ended')
          }),
        ),
      )
      if (Predicate.isTagged(outcome, 'Silent')) return failed(outcome.why)
      if (outcome.outcome === 'failed') return failed(outcome.summary)
      const after = yield* snapshots.take(place, {
        kind: 'run',
        missionId: at.missionId,
        runId: lineage,
        side: 'after',
      })
      if (after === before) return done(outcome.summary)
      const files = yield* snapshots.changed(at.missionId, place, before, after)
      const captured = yield* snapshots.collect(at.missionId, place, before, after, files)
      return StepAsks.make({
        question: [
          `The Agent step “${at.step.id}” of ${at.repository} changed the tree frozen at Ship:`,
          ...captured.files.map(fileSaid),
        ].join('\n\n'),
        options: [DISCARD, KEEP],
        recommended: {
          option: DISCARD,
          reason:
            'The tree was reviewed and frozen at Ship: discarding restores it as the step found it.',
        },
        kept: { before, after, summary: outcome.summary },
      })
    }).pipe(
      Effect.catch((failure) => Effect.succeed(failed(failure.message))),
      Effect.provide(context),
    )

  /** The tree the step started from, written back over what its session changed. */
  const discard = (at: StepAt, before: string, after: string) =>
    Effect.gen(function* () {
      if (at.folder === null) return failed(`The worktree of ${at.repository} is not on the disk.`)
      const folder = at.folder
      const place = { name: at.repository, folder }
      const files = yield* snapshots.changed(at.missionId, place, before, after)
      const captured = yield* snapshots.collect(at.missionId, place, before, after, files)
      const kept = captured.files.filter((file) => !restorable(file)).map((file) => file.path)
      if (kept.length > 0) {
        return failed(
          `These files cannot be written back as they were (withheld or masked): ${kept.join(', ')}. Restore them by hand, then Retry.`,
        )
      }
      for (const file of captured.files) {
        const target = join(folder, file.path)
        if (file.oldPath !== null && file.oldPath !== file.path) {
          rmSync(target, { force: true })
        }
        const path = join(folder, file.oldPath ?? file.path)
        if (file.before === null) {
          if (existsSync(target)) rmSync(target, { force: true })
          continue
        }
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, file.before.content ?? new Uint8Array())
      }
      const now = yield* snapshots.take(place, {
        kind: 'run',
        missionId: at.missionId,
        runId: crypto.randomUUID(),
        side: 'after',
      })
      return now === before
        ? done('changes discarded')
        : failed('The tree could not be restored as the step found it: check the worktree.')
    }).pipe(
      Effect.catch((failure) => Effect.succeed(failed(failure.message))),
      Effect.catchDefect((defect) => Effect.succeed(failed(String(defect)))),
    )

  const agentType: StepType = {
    postCondition: false,
    acts: true,
    forge: false,
    check: () => Effect.succeed(notDone),
    run,
    answered: (at, option, json) =>
      Option.match(readKept(json), {
        onNone: () => Effect.succeed(failed('What the step kept for your answer is unreadable.')),
        onSome: (kept) =>
          option === KEEP
            ? setStep(at, { acceptedTree: kept.after }).pipe(
                Effect.as(done(`changes kept: ${kept.summary}`)),
                Effect.catch((failure) => Effect.succeed(failed(failure.message))),
              )
            : discard(at, kept.before, kept.after),
      }).pipe(Effect.provide(context)),
    cut: (at) =>
      Effect.gen(function* () {
        const [row] = yield* database
          .select({ lineage: deliverySteps.lineage })
          .from(deliverySteps)
          .where(
            and(
              eq(deliverySteps.missionId, at.missionId),
              eq(deliverySteps.repositoryId, at.repositoryId),
              eq(deliverySteps.stepId, at.step.id),
            ),
          )
          .pipe(Effect.mapError(refusedWhile('reading an Agent step')))
        const lineage = row?.lineage ?? null
        if (lineage !== null && (yield* stepOfLineage(lineage)) !== null) {
          yield* close(lineage, 'its delivery step was cut off midway')
        }
      }).pipe(Effect.ignore, Effect.provide(context)),
  }
  return agentType
})
