/**
 * Where the gate reaches the Building (#141): the Builder's tools, the file claims as a mandatory
 * guard of the writing tools, and the attribution of every write to its task (#142). The Builder's
 * service stands on the sessions, above the gate; it puts its work here once it runs, and a call
 * made before waits for it, as the Probes' desk does.
 */

import type { AttemptResult, ToolArguments } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer } from 'effect'

import type { LaunchWithdrawn } from '../runs.ts'
import type { Grant } from '../tools/access.ts'
import type { ToolAnswer } from '../tools/files.ts'
import { GateGuards, type Guard, type GuardedCall, WriteAttribution } from '../tools/ports.ts'
import { DocsDesk } from './docs-desk.ts'

export interface BuildWork {
  readonly read: (grant: Grant, args: ToolArguments<'build_read'>) => Effect.Effect<ToolAnswer>
  readonly start: (grant: Grant, args: ToolArguments<'task_start'>) => Effect.Effect<ToolAnswer>
  readonly finished: (
    grant: Grant,
    args: ToolArguments<'task_finished'>,
  ) => Effect.Effect<ToolAnswer>
  readonly blocked: (grant: Grant, args: ToolArguments<'task_blocked'>) => Effect.Effect<ToolAnswer>
  readonly need: (grant: Grant, args: ToolArguments<'report_need'>) => Effect.Effect<ToolAnswer>
  readonly propose: (grant: Grant, args: ToolArguments<'need_propose'>) => Effect.Effect<ToolAnswer>
  readonly summary: (
    grant: Grant,
    args: ToolArguments<'build_summary'>,
  ) => Effect.Effect<ToolAnswer>
  /** A scenario's proof run by Hemera when the Builder or a helper asks (#144). */
  readonly proofRun: (grant: Grant, args: ToolArguments<'proof_run'>) => Effect.Effect<ToolAnswer>
  /**
   * Runs again every stale proof and every stale final check of the mission on the current tree
   * (#144, CT-38): #147's end sequence calls it before the mission leaves Building.
   */
  readonly refreshProofs: (missionId: string) => Effect.Effect<ProofsRefreshed>
  /**
   * The mission's Builder, resumed when its session ended while its Building is still active:
   * what #147's exit calls when a late write sends the end back to the Builder.
   */
  readonly ensureBuilder: (missionId: string) => Effect.Effect<void>
  /** The proofs and final checks whose repository moved since they ran, among these (R9). */
  readonly touchedProofs: (
    missionId: string,
    repositories: ReadonlyArray<string>,
  ) => Effect.Effect<ProofsRefreshed>
  /**
   * A write's claim: refused when another running task holds the file, recorded when outside; a
   * write where another task's command holds the write lock waits for it (#142).
   */
  readonly claim: Guard
  /** Where a mission's writes are attributed to their task (#142). */
  readonly attribution: WriteAttribution['Service']
  /**
   * The checks of a requirement or of the end asked through `TaskChecks` (#143, #147): a red opens
   * an attempt on that scope, handed to the Builder, without changing any task's state. Pending
   * when the user cancelled the mission while they ran: there is no verdict.
   */
  readonly judgeScope: (
    missionId: string,
    scope: 'requirement' | 'end',
    subject: string | null,
  ) => Effect.Effect<AttemptResult | 'pending'>
  /**
   * A check's run in the mission's Building (#143), on the write locks of its repositories: null
   * when the mission has no active Building.
   */
  readonly checkRun: (
    missionId: string,
    name: string,
    repositories: ReadonlyArray<string>,
  ) => Effect.Effect<CheckRunWatch | null>
}

/** The proofs, by scenario, and the final checks, by name and place, a refresh or a change named. */
export interface ProofsRefreshed {
  readonly proofs: ReadonlyArray<string>
  readonly checks: ReadonlyArray<string>
}

/** A check's run watched: its locks and trees taken right before its launch, let go at its end. */
export interface CheckRunWatch {
  /** Takes the locks, then the trees it runs on; a snapshot that fails withdraws the launch. */
  readonly launch: Effect.Effect<
    ReadonlyArray<{ readonly repository: string; readonly tree: string }>,
    LaunchWithdrawn
  >
  /** Records what the run changed (the Building's), then lets the locks go. */
  readonly finish: (runId: string | null) => Effect.Effect<void>
}

export class BuildDesk extends Context.Service<
  BuildDesk,
  BuildWork & { readonly serve: (work: BuildWork) => Effect.Effect<void> }
>()('BuildDesk') {}

/** The tools whose path a claim guards. */
const WRITES: ReadonlyArray<GuardedCall['tool']> = ['fs_write', 'fs_edit']

export const buildDeskLayer = Layer.effect(
  BuildDesk,
  Effect.gen(function* () {
    const served = yield* Deferred.make<BuildWork>()
    const work = Deferred.await(served)
    return {
      read: (grant, args) => Effect.flatMap(work, (one) => one.read(grant, args)),
      start: (grant, args) => Effect.flatMap(work, (one) => one.start(grant, args)),
      finished: (grant, args) => Effect.flatMap(work, (one) => one.finished(grant, args)),
      blocked: (grant, args) => Effect.flatMap(work, (one) => one.blocked(grant, args)),
      need: (grant, args) => Effect.flatMap(work, (one) => one.need(grant, args)),
      propose: (grant, args) => Effect.flatMap(work, (one) => one.propose(grant, args)),
      summary: (grant, args) => Effect.flatMap(work, (one) => one.summary(grant, args)),
      proofRun: (grant, args) => Effect.flatMap(work, (one) => one.proofRun(grant, args)),
      refreshProofs: (missionId) => Effect.flatMap(work, (one) => one.refreshProofs(missionId)),
      ensureBuilder: (missionId) => Effect.flatMap(work, (one) => one.ensureBuilder(missionId)),
      touchedProofs: (missionId, repositories) =>
        Effect.flatMap(work, (one) => one.touchedProofs(missionId, repositories)),
      // Only a mission's write to a path is a claim's business: nothing else waits for the desk.
      claim: (call) =>
        call.session.missionId === null || call.path === null || !WRITES.includes(call.tool)
          ? Effect.succeed(null)
          : Effect.flatMap(work, (one) => one.claim(call)),
      attribution: {
        // Only a mission's write is the Building's business: nothing else waits for the desk.
        written: (file) => (transaction) =>
          Effect.flatMap(work, (one) => one.attribution.written(file)(transaction)),
        command: (asked) => Effect.flatMap(work, (one) => one.attribution.command(asked)),
        holding: (file, write) =>
          Effect.flatMap(work, (one) => one.attribution.holding(file, write)),
      },
      judgeScope: (missionId, scope, subject) =>
        Effect.flatMap(work, (one) => one.judgeScope(missionId, scope, subject)),
      checkRun: (missionId, name, repositories) =>
        Effect.flatMap(work, (one) => one.checkRun(missionId, name, repositories)),
      serve: (one) => Effect.asVoid(Deferred.succeed(served, one)),
    }
  }),
)

/** The gate's guards: the documenter's writes (#146), then the claims of a Building. */
export const buildingGuards = Layer.effect(
  GateGuards,
  Effect.gen(function* () {
    const docs = yield* DocsDesk
    const desk = yield* BuildDesk
    return [docs.guard, desk.claim]
  }),
)

/** Where the gate's file tools and commands attribute their writes: the Builder's (#142). */
export const deskAttribution = Layer.effect(
  WriteAttribution,
  Effect.map(BuildDesk, (desk) => desk.attribution),
)
