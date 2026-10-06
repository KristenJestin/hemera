/**
 * The role sessions' own words: the states a session goes through, the deliveries Hemera hands it
 * and how each one is marked, the note an urgent delivery travels as, and the bounds of the rules
 * that watch a session (CT-12, CT-15).
 */

import { Schema } from 'effect'

/**
 * Where a session stands: opening, in a turn, between turns, silent too long in a turn, or done
 * with. `replaced` is a session another of the same lineage took over from; it stays readable.
 */
export const SESSION_STATES = [
  'starting',
  'working',
  'idle',
  'stuck',
  'ended',
  'replaced',
  'failed',
] as const
export const SessionState = Schema.Literals(SESSION_STATES)
export type SessionState = typeof SessionState.Type

/** The states of a session that still holds its place: what a restart rebuilds. */
export const LIVE_SESSION_STATES: ReadonlyArray<SessionState> = ['starting', 'working', 'idle']

/** Whether a session in this state still counts as the one its lineage runs on. */
export const isLiveSession = (state: SessionState): boolean => LIVE_SESSION_STATES.includes(state)

/**
 * The kinds of delivery this version sends; a later ticket registers its own kinds beside them
 * (the marker accepts any word of lowercase letters).
 */
export const DELIVERY_KINDS = [
  'brief',
  'answers',
  'result',
  'approval',
  'child',
  'resume',
  'instructions',
  'cancel',
] as const
export type DeliveryKind = (typeof DELIVERY_KINDS)[number]

/** A delivery kind is a lowercase word, so its marker reads the same everywhere. */
export const DeliveryKindName = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z-]*$/, { message: 'a delivery kind is a lowercase word' }),
)

/**
 * How soon a delivery must reach the session: between two turns (the default), urgently as a note
 * in the result of its next Hemera tool call, or by cancelling the turn and sending it.
 */
export const DELIVERY_URGENCIES = ['between-turns', 'urgent', 'redirect'] as const
export const DeliveryUrgency = Schema.Literals(DELIVERY_URGENCIES)
export type DeliveryUrgency = typeof DeliveryUrgency.Type

/** Where a delivery is: waiting, handed to a session, or no longer to be sent. */
export const DELIVERY_STATES = ['queued', 'sent', 'superseded'] as const
export const DeliveryState = Schema.Literals(DELIVERY_STATES)
export type DeliveryState = typeof DeliveryState.Type

/** The first line of every delivery's block: `[hemera:<kind>]`. */
export const deliveryMarker = (kind: string): string => `[hemera:${kind}]`

/**
 * The user's own message to a Chat (#43): the one delivery that carries no marker, because it is
 * the user's words, not Hemera's. Only a Chat's session is ever handed one.
 */
export const USER_MESSAGE = 'user'

/**
 * A body as it travels: a marker at the start of one of its lines and a note's tags are escaped,
 * so what a session, a command or a file wrote never reads as something Hemera says.
 */
export const neutralised = (body: string): string =>
  body.replace(/^(\s*)\[hemera:/gim, '$1\\[hemera:').replace(/<(\/?hemera-note)/gi, '&lt;$1')

/** One delivery as the agent reads it: its marker, then its body; the user's message unmarked. */
export const deliveryBlock = (kind: string, body: string): string => {
  if (kind === USER_MESSAGE) return neutralised(body)
  return body === '' ? deliveryMarker(kind) : `${deliveryMarker(kind)}\n${neutralised(body)}`
}

/** What an urgent delivery travels as, appended to a tool's result. */
export const hemeraNote = (id: string, body: string): string =>
  `<hemera-note id="${id}">\n${deliveryBlock('note', body)}\n</hemera-note>`

/**
 * How long an urgent note waits for the session's next Hemera tool call, while it is in a turn,
 * before Hemera cancels the turn and sends it as a message instead.
 */
export const NOTE_PICKUP_SECONDS = 30

/**
 * How long a session in a turn may give no sign of life (no update, no tool call, no command of
 * its own running, no provider wait) before it is stuck (CT-12).
 */
export const STUCK_AFTER_MINUTES = 5

/**
 * The share of the window the agent announced past which a session whose agent gives no reliable
 * compaction signal is saturated, and replaced (CT-15).
 */
export const SATURATED_AT = 0.8

/** Whether a context this full saturates a session. */
export const saturates = (used: number, size: number): boolean =>
  size > 0 && used / size > SATURATED_AT

/** The line a replacement of a role that does not read the Memory gets, after its first brief. */
export const START_AGAIN = 'A previous session stopped; start again from the beginning.'

/** The resume block a replacement of a role that reads the Memory gets (CT-06). */
export const resumeSaid = (stoppedAt: string, lastLine: string | null): string =>
  [
    `You replace a session that stopped at ${stoppedAt}.`,
    lastLine === null
      ? 'No action of it was recorded.'
      : `Its last recorded action was: “${lastLine}”.`,
    'Something may have happened after it without being recorded: check the real state before acting.',
  ].join(' ')
