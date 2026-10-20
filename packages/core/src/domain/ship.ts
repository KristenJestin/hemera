/**
 * Ship (R9): the user's stamp "this mission is good". It ends Review, freezes what each repository
 * holds and hands the mission to Shipping. Here is its guard as one rule that needs nothing but
 * values: every reason Ship is refused now, each in words naming what it is about, all of them at
 * once. A change made outside Hemera never refuses it: what it touched is run again before anything
 * is frozen. Nothing here touches the database or Git: the engine does.
 */

import { type FeedbackStanding, type RoundState, waitsForFix } from './feedback.ts'
import { type Stage } from './mission.ts'
import type { NeedKind } from './need.ts'
import { roundLabel } from './rounds.ts'

/** What Ship's guard reads of a mission. */
export interface ShipStanding {
  readonly stage: Stage
  readonly round: number
  readonly rounds: ReadonlyArray<{ readonly number: number; readonly state: RoundState }>
  readonly feedback: ReadonlyArray<FeedbackStanding>
  /** The final checks red on the current trees: their name, and where they ran ('' at the root). */
  readonly redChecks: ReadonlyArray<{ readonly name: string; readonly place: string }>
  /** Every open need of the mission, permission requests included, in a sentence of its own. */
  readonly needs: ReadonlyArray<{ readonly kind: NeedKind; readonly said: string }>
  /** The repositories whose rules require a team approval before Ship, and where they stand. */
  readonly approvals: ReadonlyArray<{
    readonly repository: string
    readonly pullRequest: boolean
    readonly approved: boolean
  }>
}

/** A confirmation sent on a preview the situation no longer matches. */
export const SHIP_CHANGED = 'Something changed since you opened Ship: look again.'

/** A repository whose tree moved while Ship ran its checks again. */
export const shipMovedSaid = (repository: string): string =>
  `${repository} changed while Ship was checking it.`

/** How a stage is named in Ship's refusal. */
const stageSaid = (stage: Stage, round: number): string => {
  if (stage === 'building' && round > 0) return roundLabel(round)
  return `${stage.charAt(0).toUpperCase()}${stage.slice(1)}`
}

/** How each kind of need opens its sentence. */
const NEED_WORDS: Readonly<Record<NeedKind, string>> = {
  Decision: 'A decision waits for you',
  Permission: 'A permission request waits for you',
  Error: 'An error waits for you',
  Environment: 'Something to set up waits for you',
}

/**
 * Every reason Ship is refused now, none when it may be confirmed: feedback waiting for a fix (a
 * question or a withdrawn remark never does), a round being worked on, a red final check, anything
 * waiting for the user, and a team approval the rules require and the pull request lacks.
 */
export function shipRefusals(standing: ShipStanding): string[] {
  if (standing.stage !== 'review') {
    return [
      `Ship is offered in Review: the mission is in ${stageSaid(standing.stage, standing.round)}.`,
    ]
  }
  const reasons: string[] = []
  if (waitsForFix(standing.feedback)) {
    const count = standing.feedback.filter(
      (one) => one.state === 'waiting' && one.kind !== 'question',
    ).length
    reasons.push(
      count === 1 ? '1 remark waits for a fix.' : `${String(count)} remarks wait for a fix.`,
    )
  }
  for (const round of standing.rounds) {
    if (round.state === 'grilling' || round.state === 'building') {
      reasons.push(`Round ${String(round.number)} is being worked on.`)
    }
  }
  for (const check of standing.redChecks) {
    reasons.push(
      `The final check \`${check.name}\` is red${check.place === '' ? '' : ` in ${check.place}`}.`,
    )
  }
  for (const need of standing.needs) reasons.push(`${NEED_WORDS[need.kind]}: ${need.said}`)
  for (const one of standing.approvals) {
    if (one.approved) continue
    reasons.push(
      one.pullRequest
        ? `${one.repository}’s pull request has no approval yet.`
        : `${one.repository} has no pull request to approve yet.`,
    )
  }
  return reasons
}
