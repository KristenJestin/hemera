/**
 * What a tool asks the human before it acts outside the Workspace root (design D5-09, D6-05).
 *
 * The root is a promise to the user, not to the agent: an agent that reads and writes wherever
 * it likes is an agent the user cannot reason about. A path outside the root is therefore not
 * refused — it is asked about, once per call, and a refusal ends the call the way any refusal
 * does.
 *
 * The question is a port because it is a question: who is asked, and how it is put, is the
 * window's business, and what this service promises the engine is only that the answer arrives.
 * An engine with no window to ask — a test, a headless run — answers with the layer it is given
 * rather than with a default that would quietly let a tool through.
 */

import { Context, type Effect } from 'effect'

/** What the human is asked, as the Session's thread shows it. */
export interface OutsideRequest {
  /** The identifier this question is asked under, which is what the answer comes back with. */
  readonly id: string
  readonly sessionId: string
  readonly tool: string
  /** What the tool named, as the human reads it. */
  readonly named: string
  /** The root it is outside of. */
  readonly root: string
}

/** What the human said, and what an unanswered question never is. */
export type OutsideAnswer = 'allowed' | 'refused'

export interface ToolPermissionsService {
  /** Waits for the human, for as long as they take. */
  readonly askOutside: (asked: OutsideRequest) => Effect.Effect<OutsideAnswer>
  /** Answers a question that is waiting, and answers false for one nothing is waiting on. */
  readonly answer: (id: string, answer: OutsideAnswer) => Effect.Effect<boolean>
}

export class ToolPermissions extends Context.Service<ToolPermissions, ToolPermissionsService>()(
  'ToolPermissions',
) {}
