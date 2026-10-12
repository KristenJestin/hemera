/**
 * Where the gate reaches the documenter (#146): `docs_report`, and the write guard that refuses its
 * `fs_write` and `fs_edit` outside the files the mission's doc recipes name. The documenter's
 * service stands on the sessions, above the gate; it puts its work here once it runs, and a call
 * made before waits for it, as the helpers' desk does. Only a documenter's write waits for it.
 */

import type { ToolArguments } from '@hemera/core/domain'
import { Context, Deferred, Effect, Layer } from 'effect'

import type { Grant } from '../tools/access.ts'
import type { ToolAnswer } from '../tools/files.ts'
import type { Guard, GuardedCall } from '../tools/ports.ts'

export interface DocsWork {
  readonly report: (grant: Grant, args: ToolArguments<'docs_report'>) => Effect.Effect<ToolAnswer>
  /** A documenter's write: refused outside the recipes' files, let on otherwise. */
  readonly guard: Guard
}

export class DocsDesk extends Context.Service<
  DocsDesk,
  DocsWork & { readonly serve: (work: DocsWork) => Effect.Effect<void> }
>()('DocsDesk') {}

/** The tools the write guard judges. */
const WRITES: ReadonlyArray<GuardedCall['tool']> = ['fs_write', 'fs_edit']

export const docsDeskLayer = Layer.effect(
  DocsDesk,
  Effect.gen(function* () {
    const served = yield* Deferred.make<DocsWork>()
    const work = Deferred.await(served)
    return {
      report: (grant, args) => Effect.flatMap(work, (one) => one.report(grant, args)),
      guard: (call) =>
        call.session.role !== 'documenter' || !WRITES.includes(call.tool)
          ? Effect.succeed(null)
          : Effect.flatMap(work, (one) => one.guard(call)),
      serve: (one) => Effect.asVoid(Deferred.succeed(served, one)),
    }
  }),
)
