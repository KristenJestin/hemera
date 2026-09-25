/**
 * The Project's checks, and how a build runs them (design D10-06, D10-07).
 *
 * A check is a catalogue command or a line of the user's, run where and when the Project says,
 * judged by its exit code or by a number read in its output. Hemera runs it through the Commands
 * service in the build's Workspace — its output kept like any run's, shown in the Session's
 * activity — and never through the agent; its verdict is Hemera's.
 */

import type { CheckVerdict, CheckWhen } from '@hemera/core'
import { Context, type Effect } from 'effect'

import type { DatabaseError } from '../storage/database.ts'

/** What one run of the checks is asked for: an attempt, the moment, and what the work changed. */
export interface CheckRunRequest {
  /** The build Session: its runs show in its activity. */
  readonly sessionId: string
  readonly projectId: string
  /** The Workspace the build works in; null for `main`. */
  readonly workspaceId: string | null
  /** Which of the Project's checks run: after a task, after a story, or at the end. */
  readonly when: CheckWhen
  /** The attempt the results are written under. */
  readonly attemptId: string
  /**
   * What the work changed, per repository: its path relative to the Workspace root (`''` for a
   * repository at the root) and the files changed in it, relative to that repository. What a
   * `changed` check runs in, and what `{files}` is expanded from.
   */
  readonly changes: readonly {
    readonly repository: string
    readonly files: readonly string[]
  }[]
}

/** One check as it ran, and what Hemera made of it. */
export interface CheckOutcome {
  readonly id: string
  /** The check it ran; null once the check was removed from the Project. */
  readonly checkId: string | null
  readonly name: string
  /** Where it ran: `''` for the Workspace root, or the repository's path. */
  readonly place: string
  /** The line as it ran, `{files}` expanded. */
  readonly line: string
  readonly verdict: CheckVerdict
  readonly exitCode: number | null
  readonly value: number | null
  /** Why it is red or skipped, in plain words (`64.2 < 70`); null when green. */
  readonly detail: string | null
  /** The last lines of its output. */
  readonly outputTail: string
  /** The run of the Commands service; null for a check that was skipped without running. */
  readonly runId: string | null
  readonly ranAt: string
}

/** How the build runs the Project's checks. */
export interface BuildChecksService {
  /**
   * Runs the Project's checks of `when` for one attempt, writes each result under it with its
   * Journal line, and answers them in the Project's order: empty when none is configured — a task
   * done, not verified.
   */
  readonly run: (request: CheckRunRequest) => Effect.Effect<readonly CheckOutcome[], DatabaseError>
}

export class BuildChecks extends Context.Service<BuildChecks, BuildChecksService>()(
  'BuildChecks',
) {}
