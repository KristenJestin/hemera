/**
 * "Ask before running": the one port every run of a command marked so passes through, whoever
 * starts it (the user, a rule of Hemera such as the preparation recipe or the commands run at each
 * opening, and later the checks, the proofs, the end of a mission, delivery and the agents).
 *
 * The port decides whether the command may run now; it may take as long as the user does. For a
 * command run at opening, the request is a permission need at Project level, answered with Allow
 * once or Deny only. Hemera's own runs never go through the agents' permission gate: this port is
 * the only question they ask.
 *
 * The needs are created and answered by later work. Until then this port's own implementation
 * never runs the command and never answers: the run stays waiting for permission, listed with its
 * Project, and the diagnostic log says so.
 */

import type { RunStarter } from '@hemera/core/domain'
import { Context, Effect, Layer } from 'effect'

import type { Log } from '../main/diagnostic.ts'

/** What is asked: which command, where, by whom, and at which level the need is raised. */
export interface PermissionAsk {
  readonly runId: string
  readonly projectId: string
  readonly workspaceId: string | null
  readonly commandId: string
  readonly name: string
  readonly line: string
  readonly startedBy: RunStarter
  /** A command run at opening asks at Project level, with Allow once and Deny only. */
  readonly level: 'project' | 'place'
}

export type PermissionAnswer = 'allowed' | 'denied'

export class AskBeforeRunning extends Context.Service<
  AskBeforeRunning,
  {
    /** Answers once the user has, for as long as that takes. */
    readonly decide: (asked: PermissionAsk) => Effect.Effect<PermissionAnswer>
  }
>()('AskBeforeRunning') {}

/** No one to ask yet: the command waits, never runs, and the diagnostic says so. */
export const nobodyToAskLayer = (log: Log) =>
  Layer.succeed(AskBeforeRunning, {
    decide: (asked) =>
      Effect.andThen(
        Effect.sync(() =>
          log(
            `${asked.name} of Project ${asked.projectId} waits for the user's permission (run ${asked.runId}): this version of Hemera cannot ask yet, so it does not run`,
          ),
        ),
        Effect.never,
      ),
  })
