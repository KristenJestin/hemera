/**
 * The ports the single gate calls and later tickets fill: the verdict on a call (Hemera's rules,
 * sensitive places, the remote judge: #36 and #38), the single human question that follows an
 * `ask` (#37), the sensitive places (#36), and the ordered list of the roles' mandatory guards
 * (file claims, command write locks: later tickets).
 *
 * The verdict is the order of decision (`../permissions/order.ts`), the sensitive places are
 * `../permissions/sensitive.ts`, and the question is a permission request
 * (`../permissions/requests.ts`): the agent is answered at once, nothing waits on a human.
 */

import {
  PLACE_NAMES,
  type GateClass,
  type PlaceKind,
  type Role,
  type ToolName,
} from '@hemera/core/domain'
import { Context, Layer } from 'effect'
import type { Effect, Schema } from 'effect'

import type { GrantAsked } from './access.ts'
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
  /** The line this system runs: its own when it has one. */
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
  /** For a free line, the folder it runs in under the place, as the agent wrote it. */
  readonly folder: string | null
  /** The agent's reason for the call: shown beside Hemera's, never read as an instruction. */
  readonly why: string | null
}

/** A verdict, and who gave it. */
export type Verdict =
  | { readonly verdict: 'allow'; readonly by: string }
  | {
      readonly verdict: 'ask'
      readonly reason: string
      readonly by: string
      /** The call touches a sensitive place: it is never allowed for the whole mission. */
      readonly sensitive?: boolean
      /** The settings section that would settle such a call (`hemera-auto`), when one would. */
      readonly settingsSection?: string
    }
  | { readonly verdict: 'deny'; readonly reason: string; readonly by: string }

export class Verdicts extends Context.Service<
  Verdicts,
  {
    readonly judge: (call: JudgedCall) => Effect.Effect<Verdict>
    /**
     * Only the refusals of the order (the "never" list and Hemera's refusal rules), as a reason or
     * null: what an approval is checked against again when Hemera comes to act on it.
     */
    readonly refusal: (call: JudgedCall) => Effect.Effect<string | null>
  }
>()('Verdicts') {}

/** What a call outside the role's place is refused with. */
export const outsideReason = (session: CallSession, path: JudgedPath, home: string): string =>
  `outside ${PLACE_NAMES[session.place.kind]}: ${shownPath(path.resolved, home)}`

/** The whole of a call, as it can be acted on later: the place it was called on, its arguments. */
export interface FrozenCall {
  /** The session's grant, without its token's digest. */
  readonly grant: GrantAsked
  readonly tool: ToolName
  /** The arguments as the agent sent them. */
  readonly arguments: Schema.Json
}

/** What a call that asks hands the question. */
export interface RequestAsked {
  readonly call: JudgedCall
  readonly frozen: FrozenCall
  /** Hemera's reasons, as the verdict gave them. */
  readonly reason: string
  readonly sensitive: boolean
  /** The settings section the question links to (`hemera-auto`), or null. */
  readonly settingsSection: string | null
  /** The agent's own key of the call: the same key from the same owner is the same request. */
  readonly key: string | null
}

/**
 * The single human question a call that asks becomes. It answers the agent at once, with what
 * the agent is told (the gate never waits on a human).
 */
export class PermissionRequests extends Context.Service<
  PermissionRequests,
  { readonly request: (asked: RequestAsked) => Effect.Effect<{ readonly answer: string }> }
>()('PermissionRequests') {}

/** Who asks about a place, and whether the call may write there. */
export interface PlaceAsked {
  readonly session: CallSession
  readonly writes: boolean
}

/**
 * Whether a resolved path is a sensitive place, and why (`sensitive place: ~/.ssh`); null when it
 * is not. The session decides which folders of Hemera's data folder are its own.
 */
export class SensitivePlaces extends Context.Service<
  SensitivePlaces,
  { readonly sensitive: (path: string, asked: PlaceAsked) => Effect.Effect<string | null> }
>()('SensitivePlaces') {}

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
