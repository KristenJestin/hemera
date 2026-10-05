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
 * Its implementation is `HemeraRunConsent` (`permissions/consent.ts`): a permission need, and the
 * run waits for its answer. An agent's call never comes here: the gate has decided it.
 */

import type { RunStarter } from '@hemera/core/domain'
import { Context, type Effect } from 'effect'

/** What is asked: which command, where, by whom, and at which level the need is raised. */
export interface PermissionAsk {
  readonly runId: string
  readonly projectId: string
  readonly workspaceId: string | null
  readonly commandId: string
  readonly name: string
  readonly line: string
  readonly startedBy: RunStarter
  /** The mission the run is for, whose need it then is; null outside a mission. */
  readonly missionId: string | null
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
