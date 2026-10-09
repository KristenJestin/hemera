/**
 * The Freeze of Planning (#92): the user's gesture that freezes the Spec and its tasks and moves
 * the mission to Ready, the return to Planning that unfreezes it, the dependencies between
 * missions, and the outdated mark.
 *
 * Here are the values they are made of, the Planner's two tools' arguments, and the rules that need
 * nothing but those values: whether a new dependency closes a cycle, why the Freeze is not offered
 * yet, each in words, and what the Planner is handed when the Freeze is refused or the mission
 * comes back to Planning.
 */

import { Schema } from 'effect'

import type { OutdatedReason } from './mission.ts'

/** A dependency is proposed by the Planner, then accepted or rejected by the user. */
export const DEPENDENCY_STATES = ['proposed', 'accepted', 'rejected'] as const
export const DependencyState = Schema.Literals(DEPENDENCY_STATES)
export type DependencyState = typeof DependencyState.Type

/** How a file of a main checkout differs from its commit when the Spec is frozen (CT-23). */
export const DIRTY_STATUSES = ['modified', 'added', 'deleted', 'untracked'] as const
export const DirtyStatus = Schema.Literals(DIRTY_STATUSES)
export type DirtyStatus = typeof DirtyStatus.Type

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

/** What `dependency_propose` carries. */
export const DependencyPropose = Schema.Struct({
  mission: Bounded(
    40,
    'The key of the mission yours cannot be built before (`ACME-9`), a mission of the same Project.',
  ),
  reason: Bounded(2000, 'Why, in the language of the user: what this mission needs from it.'),
}).annotate({
  description:
    'Propose that this mission depends on another mission of the Project: it cannot be built before that one is delivered. The user accepts or rejects it.',
})
export type DependencyPropose = typeof DependencyPropose.Type

/** What `relies_on_write` carries. */
export const ReliesOnWrite = Schema.Struct({
  requirement: Bounded(20, 'The requirement of this Spec that relies on the dependency (`R2`).'),
  dependency: Bounded(40, 'The key of an accepted dependency of this mission (`ACME-9`).'),
  their_requirement: Bounded(
    20,
    'The requirement of the dependency’s Spec it relies on, its pending delta (`R4`).',
  ),
  their_version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: 'The version of that requirement you read.',
  }),
  base_version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: 'The version of your requirement as you read it.',
  }),
}).annotate({
  description:
    'Mark a requirement of this Spec as relying on a requirement of a dependency not delivered yet. When the dependency is delivered, the pre-launch check reads it again.',
})
export type ReliesOnWrite = typeof ReliesOnWrite.Type

/** What a requirement relies on, in a dependency not delivered yet. */
export interface ReliedOn {
  /** The dependency's key: `ACME-9`. */
  readonly dependency: string
  readonly requirement: string
  readonly version: number
}

/** One dependency between two missions: `from` cannot be built before `to` is delivered. */
export interface DependencyEdge {
  readonly from: string
  readonly to: string
}

/**
 * The cycle a new dependency `from` → `to` would close, as the keys it goes through, from `from`
 * back to it (`ACME-1 → ACME-2 → ACME-1`); null when it closes none.
 */
export function dependencyCycle(
  edges: ReadonlyArray<DependencyEdge>,
  from: string,
  to: string,
): ReadonlyArray<string> | null {
  const next = new Map<string, ReadonlyArray<string>>()
  for (const edge of edges) next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to])
  const seen = new Set<string>()
  // Depth first from `to`: a way back to `from` is the cycle.
  const walk = (at: string, path: ReadonlyArray<string>): ReadonlyArray<string> | null => {
    if (at === from) return path
    if (seen.has(at)) return null
    seen.add(at)
    for (const one of next.get(at) ?? []) {
      const found = walk(one, [...path, one])
      if (found !== null) return found
    }
    return null
  }
  return walk(to, [from, to])
}

/** A cycle of dependencies in words. */
export const dependencyCycleSaid = (keys: ReadonlyArray<string>): string => keys.join(' → ')

/**
 * Why the Planner's latest declaration of completeness does not hold for the Freeze: none was
 * made, or the Spec was written since; null when it was made on the current version.
 */
export function declarationUnsettled(
  key: string,
  declared: number | null,
  version: number,
): string | null {
  if (declared === version) return null
  if (declared === null) return `The Planner has not declared the Spec of ${key} complete yet.`
  return `The Spec changed since the Planner declared it complete at version ${String(declared)}: it is at version ${String(version)}, and the Planner declares it again.`
}

/** Why a dependency the Planner proposed holds the Freeze: the user has not decided it yet. */
export const dependencyUndecidedSaid = (key: string, onKey: string): string =>
  `${key}’s dependency on ${onKey} waits on your decision.`

/** A Probe as the Freeze reads it: its label, its state and its question. */
export interface ProbeStanding {
  readonly label: string
  readonly state: string
  readonly question: string
}

/** Why a Probe holds the Freeze, or null when it is over: one prepared, running, or to run again. */
export function probeUnsettled(probe: ProbeStanding): string | null {
  switch (probe.state) {
    case 'preparing':
      return `Probe ${probe.label} is being prepared: ${probe.question}`
    case 'running':
      return `Probe ${probe.label} runs: ${probe.question}`
    case 'interrupted':
      return `Probe ${probe.label} was interrupted and runs again: ${probe.question}`
    default:
      return null
  }
}

/** What the user is answered when the Spec changed since the version they read. */
export const SPEC_CHANGED_SINCE_READ =
  'The Spec changed since you read it: read what changed, then freeze.'

/** What `[hemera:freeze-refused]` hands the Planner: what Hemera refused, and what to do. */
export function freezeRefusedDelivery(failures: ReadonlyArray<string>): string {
  return [
    'The user tried to freeze the Spec, and Hemera refused it at the base commit it would record:',
    ...failures.map((failure) => `- ${failure}`),
    'Fix each, then declare complete again.',
  ].join('\n')
}

/** What moved since the Freeze, as the outdated mark keeps it. */
export interface OutdatedSeen {
  readonly reason: OutdatedReason
  readonly difference: string
}

/** An outdated mark's reason in words. */
const OUTDATED_SAID: Readonly<Record<OutdatedReason, string>> = {
  'ticket-changed': 'the ticket changed',
  'target-moved': 'the code moved',
  'dependency-merged': 'a dependency was delivered',
  'dependency-cancelled': 'a dependency was cancelled',
}

export function outdatedReasonSaid(reason: OutdatedReason): string {
  return OUTDATED_SAID[reason]
}

/** What `[hemera:update]` hands a fresh Planner when the user sends the mission back. */
export function updateDelivery(update: {
  readonly key: string
  readonly version: number
  readonly reason: string | null
  readonly outdated: ReadonlyArray<OutdatedSeen>
}): string {
  const moved = update.outdated.map(
    (one) => `- ${outdatedReasonSaid(one.reason)}: ${one.difference}`,
  )
  return [
    `The user sent ${update.key} back to Planning: its Spec is no longer frozen (version ${String(update.version)}), and you have a free hand on everything in it.`,
    ...(update.reason === null && moved.length === 0
      ? ['They gave no reason, and nothing is marked outdated.']
      : [
          ...(update.reason === null ? [] : [`Their reason: ${update.reason}`]),
          ...(moved.length === 0 ? [] : ['What moved since the Freeze:', ...moved]),
        ]),
    'Read what moved, update the Spec, ask what it raises, then declare complete again.',
  ].join('\n')
}
