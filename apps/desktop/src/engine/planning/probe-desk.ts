/**
 * Where the parts below the role sessions reach the Probes (#89): the gate hands the three Probe
 * tools here, and a mission's cancel wipes its Probes from here. The Probes themselves stand on
 * the sessions, above the gate; they put their work here once they run, and a call made before
 * waits for it, as the sessions' post does.
 *
 * Beside it, the hook a wipe calls between the end of a Probe's processes and the removal of its
 * worktrees: the Project's Cleanup steps (S6) fill it; this version's does nothing.
 */

import type { ToolArguments } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer, Schema } from 'effect'

import type { DatabaseError } from '../storage/database.ts'
import type { Grant } from '../tools/access.ts'
import type { ToolAnswer } from '../tools/files.ts'

/** A wipe that did not succeed: the Probe stays `wiping`, and the next start tries again. */
export class ProbeWipeFailed extends Schema.TaggedError<ProbeWipeFailed>()('ProbeWipeFailed', {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason
  }
}

export interface ProbeWork {
  readonly launch: (grant: Grant, args: ToolArguments<'probe_launch'>) => Effect.Effect<ToolAnswer>
  readonly read: (grant: Grant, args: ToolArguments<'probe_read'>) => Effect.Effect<ToolAnswer>
  readonly report: (grant: Grant, args: ToolArguments<'probe_report'>) => Effect.Effect<ToolAnswer>
  /** The complete wipe of one Probe, in its order. */
  readonly wipe: (probeId: string) => Effect.Effect<void, ProbeWipeFailed | DatabaseError>
  /** Every Probe of a mission wiped: at Freeze (#92), at Cancel (#34), when it is deleted. */
  readonly wipeAll: (missionId: string) => Effect.Effect<void, ProbeWipeFailed | DatabaseError>
}

export class ProbeDesk extends Context.Service<
  ProbeDesk,
  ProbeWork & { readonly serve: (work: ProbeWork) => Effect.Effect<void> }
>()('ProbeDesk') {}

export const probeDeskLayer = Layer.effect(
  ProbeDesk,
  Effect.gen(function* () {
    const served = yield* Deferred.make<ProbeWork>()
    const work = Deferred.await(served)
    return {
      launch: (grant, args) => Effect.flatMap(work, (one) => one.launch(grant, args)),
      read: (grant, args) => Effect.flatMap(work, (one) => one.read(grant, args)),
      report: (grant, args) => Effect.flatMap(work, (one) => one.report(grant, args)),
      wipe: (probeId) => Effect.flatMap(work, (one) => one.wipe(probeId)),
      wipeAll: (missionId) => Effect.flatMap(work, (one) => one.wipeAll(missionId)),
      serve: (one) => Effect.asVoid(Deferred.succeed(served, one)),
    }
  }),
)

/** The Probe a cleanup is run for. */
export interface CleanedProbe {
  readonly probeId: string
  readonly missionId: string
  readonly folder: string
}

/** The Project's Cleanup steps for a Probe's folder (S6), never its Closing. */
export class ProbeCleanup extends Context.Service<
  ProbeCleanup,
  { readonly run: (probe: CleanedProbe) => Effect.Effect<void, ProbeWipeFailed> }
>()('ProbeCleanup') {}

/** This version's hook: nothing to clean up yet. */
export const noProbeCleanup = Layer.succeed(ProbeCleanup, { run: () => Effect.void })
