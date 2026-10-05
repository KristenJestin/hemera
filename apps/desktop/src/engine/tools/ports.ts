/**
 * The ports the single gate calls and later tickets fill: the verdict on a call (Hemera's rules,
 * sensitive places, the remote judge: #36 and #38), the single human question that follows an
 * `ask` (#37), the sensitive places (#36), and the ordered list of the roles' mandatory guards
 * (file claims, command write locks: later tickets).
 *
 * Until those tickets are merged, the defaults here never allow what they cannot judge: every
 * judged call is denied, a local call is allowed only inside the role's place, and a question is
 * answered at once with a refusal. Nothing waits on a human.
 */

import {
  PLACE_NAMES,
  type GateClass,
  type PlaceKind,
  type Role,
  type ToolName,
} from '@hemera/core/domain'
import { Context, Effect, Layer } from 'effect'

import { shownPath } from './paths.ts'

/** The session a call comes from, as its grant holds it. */
export interface CallSession {
  readonly sessionId: string
  readonly role: Role
  readonly projectId: string
  readonly missionId: string | null
  readonly place: { readonly kind: PlaceKind; readonly readOnly: boolean; readonly root: string }
}

/** A path a call acts on, resolved. */
export interface JudgedPath {
  readonly named: string
  readonly resolved: string
  readonly inside: boolean
  readonly certain: boolean
}

/** A catalogue command a call runs, with the flags the verdict needs. */
export interface JudgedCommand {
  readonly id: string
  readonly name: string
  readonly line: string
  readonly check: boolean
  readonly readOnly: boolean
  readonly askBeforeRunning: boolean
  readonly writeGlobs: ReadonlyArray<string>
}

/** What a verdict is asked about: one call, as the gate has resolved it. */
export interface JudgedCall {
  readonly session: CallSession
  readonly tool: ToolName
  readonly gate: Exclude<GateClass, 'workflow'>
  readonly path: JudgedPath | null
  readonly command: JudgedCommand | null
  /** A free line a call runs, as the agent wrote it. */
  readonly line: string | null
  /** The agent's reason for the call: shown beside Hemera's, never read as an instruction. */
  readonly why: string | null
}

/** A verdict, and who gave it. */
export type Verdict =
  | { readonly verdict: 'allow'; readonly by: string }
  | { readonly verdict: 'ask'; readonly reason: string; readonly by: string }
  | { readonly verdict: 'deny'; readonly reason: string; readonly by: string }

export class Verdicts extends Context.Service<
  Verdicts,
  { readonly judge: (call: JudgedCall) => Effect.Effect<Verdict> }
>()('Verdicts') {}

/** What a call outside the role's place is refused with. */
export const outsideReason = (session: CallSession, path: JudgedPath, home: string): string =>
  `outside ${PLACE_NAMES[session.place.kind]}: ${shownPath(path.resolved, home)}`

/**
 * Until the verdicts exist: a judged call is denied, a local call is allowed only on a path inside
 * the role's place (or without a path), never on an unknown one.
 */
export const verdictsUntilRules = (home: string) =>
  Layer.succeed(Verdicts, {
    judge: (call) =>
      Effect.succeed<Verdict>(
        call.gate === 'judged'
          ? { verdict: 'deny', reason: 'permissions are not available yet', by: 'hemera' }
          : call.path === null || (call.path.inside && call.path.certain)
            ? { verdict: 'allow', by: 'hemera' }
            : {
                verdict: 'deny',
                reason: outsideReason(call.session, call.path, home),
                by: 'hemera',
              },
      ),
  })

/**
 * The single human question a call that asks becomes. It answers the agent at once, with what
 * the agent is told (the gate never waits on a human).
 */
export class PermissionRequests extends Context.Service<
  PermissionRequests,
  {
    readonly request: (
      call: JudgedCall,
      reason: string,
    ) => Effect.Effect<{ readonly answer: string }>
  }
>()('PermissionRequests') {}

/** Until approvals exist: nothing runs, and the agent is told so. */
export const noPermissionRequests = Layer.succeed(PermissionRequests, {
  request: () => Effect.succeed({ answer: 'refused: approvals are not available yet' }),
})

/** Whether a resolved path is a sensitive place, and why; null when it is not. */
export class SensitivePlaces extends Context.Service<
  SensitivePlaces,
  { readonly sensitive: (path: string) => Effect.Effect<string | null> }
>()('SensitivePlaces') {}

/** Until #36 fills it: no place is known to be sensitive. */
export const noSensitivePlaces = Layer.succeed(SensitivePlaces, {
  sensitive: () => Effect.succeed(null),
})

/** One call as a guard sees it: decoded, before any verdict. */
export interface GuardedCall {
  readonly session: CallSession
  readonly tool: ToolName
  readonly path: JudgedPath | null
}

/** A mandatory guard of the roles: a refusal reason, or null to let the call on. */
export type Guard = (call: GuardedCall) => Effect.Effect<string | null>

/** The guards later tickets register, in their order: file claims, command write locks. */
export class GateGuards extends Context.Service<GateGuards, ReadonlyArray<Guard>>()('GateGuards') {}

export const noGateGuards = Layer.succeed(GateGuards, [])
