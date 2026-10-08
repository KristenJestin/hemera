/**
 * The living spec of a Project (#93): what it does today, as requirements grouped by domain, each
 * with its scenarios, its origin (the bootstrap, or the mission it came from) and its state. A
 * proposed requirement is a hint, never a fact: every text an agent reads labels it so.
 *
 * Hemera does not detect behaviour changed outside Hemera in 1.0: the living spec changes only
 * through the bootstrap, the user's validation, and the versioned writes of the engine.
 */

import { Schema } from 'effect'

import type { Delta } from './spec.ts'

/** A domain or a requirement is proposed (by the bootstrap) until the user validates it. */
export const LIVING_STATES = ['proposed', 'validated'] as const
export const LivingState = Schema.Literals(LIVING_STATES)
export type LivingState = typeof LivingState.Type

/** Where a bootstrap run stands. */
export const BOOTSTRAP_RUN_STATES = [
  'waiting_for_slot',
  'running',
  'done',
  'failed',
  'stopped',
] as const
export const BootstrapRunState = Schema.Literals(BOOTSTRAP_RUN_STATES)
export type BootstrapRunState = typeof BootstrapRunState.Type

export const LivingScenario = Schema.Struct({ when: Schema.String, then: Schema.String })
export type LivingScenario = typeof LivingScenario.Type

/** How many domains one page of `living_spec_read` holds. */
export const LIVING_PAGE_DOMAINS = 5

/** A change proposed on an existing requirement, applied only when the user validates its domain. */
export type LivingPendingText =
  | {
      readonly kind: 'replace'
      readonly text: string
      readonly scenarios: ReadonlyArray<LivingScenario>
      readonly uncertainty: string
    }
  | { readonly kind: 'obsolete'; readonly reason: string }

export interface LivingRequirementText {
  readonly id: string
  readonly version: number
  readonly state: LivingState
  /** As `originSaid` says it. */
  readonly origin: string
  /** Empty when the agent was sure. */
  readonly uncertainty: string
  readonly text: string
  readonly scenarios: ReadonlyArray<LivingScenario>
  readonly pending: LivingPendingText | null
}

export interface LivingDomainText {
  readonly name: string
  readonly summary: string
  readonly state: LivingState
  readonly uncertainty: string
  /** Its live requirements, in their order. */
  readonly requirements: ReadonlyArray<LivingRequirementText>
}

/** Where a requirement comes from: the bootstrap, a mission (its key), or a round of it. */
export const originSaid = (
  mission: { readonly key: string; readonly round: number | null } | null,
): string => {
  if (mission === null) return 'bootstrap'
  return mission.round === null ? mission.key : `${mission.key}, round ${String(mission.round)}`
}

const PROPOSED = '[proposed]'

/** A text an agent wrote kept to one line: its line breaks become spaces. */
const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' ').trim()

/**
 * A body an agent wrote, every line quoted: whatever it holds, it never starts a line of the text
 * with a heading or a label of Hemera's.
 */
const quoted = (text: string): string =>
  text
    .trim()
    .split(/\r\n|\r|\n/)
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n')

const scenariosText = (scenarios: ReadonlyArray<LivingScenario>): string =>
  scenarios.map((one) => `- WHEN ${oneLine(one.when)} THEN ${oneLine(one.then)}`).join('\n')

const uncertain = (text: string): ReadonlyArray<string> =>
  text.trim() === '' ? [] : [`Uncertain:\n${quoted(text)}`]

const pendingText = (pending: LivingPendingText): string =>
  pending.kind === 'obsolete'
    ? `${PROPOSED} Obsolete, because:\n${quoted(pending.reason)}`
    : `${PROPOSED} Replaced by:\n${quoted(
        [
          pending.text,
          scenariosText(pending.scenarios),
          ...(pending.uncertainty.trim() === '' ? [] : [`Uncertain: ${pending.uncertainty}`]),
        ].join('\n\n'),
      )}`

const requirementText = (requirement: LivingRequirementText, level: number): string => {
  const label = requirement.state === 'proposed' ? ` ${PROPOSED}` : ''
  return [
    `${'#'.repeat(level)} ${requirement.id} (version ${String(requirement.version)})${label} · from ${requirement.origin}`,
    quoted(requirement.text),
    ...uncertain(requirement.uncertainty),
    scenariosText(requirement.scenarios),
    ...(requirement.pending === null ? [] : [pendingText(requirement.pending)]),
    `End of ${requirement.id}${label}.`,
  ].join('\n\n')
}

/**
 * Domains and their requirements as an agent reads them: every proposed domain, requirement and
 * pending change labelled `[proposed]` with its uncertainty, so that none reads as a fact. What
 * the agent wrote is quoted (`> `) or kept to one line, so it never opens a heading or a label of
 * its own; each requirement ends with its marker. `level` is the heading level of the domains: 2
 * on its own, deeper when nested under a brief's field.
 */
export function livingSpecText(domains: ReadonlyArray<LivingDomainText>, level = 2): string {
  return domains
    .map((domain) =>
      [
        `${'#'.repeat(level)} ${oneLine(domain.name)}${domain.state === 'proposed' ? ` ${PROPOSED}` : ''}`,
        quoted(domain.summary),
        ...uncertain(domain.uncertainty),
        ...(domain.requirements.length === 0
          ? ['_No requirement yet._']
          : domain.requirements.map((one) => requirementText(one, level + 1))),
      ].join('\n\n'),
    )
    .join('\n\n')
}

/** What a requirement of a Spec asks of the living spec. */
export interface DeltaAsked {
  readonly delta: Delta
  /** The domain the Spec's requirement is written in. */
  readonly domain: string
  readonly livingRef?: string | undefined
  readonly livingVersion?: number | undefined
}

/** The living requirement a delta names, as it stands now; null when there is none. */
export interface LivingStanding {
  readonly id: string
  readonly version: number
  readonly removed: boolean
  /** The name of its domain. */
  readonly domain: string
}

const sameName = (one: string, other: string): boolean =>
  one.trim().toLocaleLowerCase() === other.trim().toLocaleLowerCase()

/**
 * The delta rules of a Spec's requirement (CT-57): an added one names no living requirement; a
 * modified or removed one names an existing, live one of its own domain, and the version the
 * Planner read, which is still its version. Null when the write may go ahead; the sentence the agent reads otherwise.
 */
export function livingDeltaRefusal(
  asked: DeltaAsked,
  living: LivingStanding | null,
): string | null {
  if (asked.delta === 'added') {
    return asked.livingRef === undefined && asked.livingVersion === undefined
      ? null
      : 'refused: an added requirement changes no living requirement: leave living_ref and living_version out.'
  }
  if (asked.livingRef === undefined || asked.livingVersion === undefined) {
    return `refused: a ${asked.delta} requirement names the living requirement it changes (living_ref) and its version as you read it (living_version), from living_spec_read.`
  }
  if (living === null) {
    return `refused: the living spec has no requirement ${asked.livingRef}: read it with living_spec_read.`
  }
  if (living.removed) {
    return `refused: ${living.id} was removed from the living spec: nothing can change it any more.`
  }
  if (living.version !== asked.livingVersion) {
    return `refused: ${living.id} changed since you read it (version ${String(asked.livingVersion)}): it is at version ${String(living.version)}. Read it again with living_spec_read.`
  }
  if (!sameName(living.domain, asked.domain)) {
    return `refused: ${living.id} belongs to the domain “${living.domain}”, not “${asked.domain.trim()}”: write this requirement in ${living.domain}.`
  }
  return null
}

/**
 * A requirement of a Spec whose living requirement moved after the delta was written: its version
 * now, or null when it was removed since.
 */
export interface LivingDrift {
  readonly requirement: string
  readonly livingRef: string
  readonly recorded: number
  readonly current: number | null
}

/** What completeness says of a drift: read the living requirement again before Freeze. */
export const driftSaid = (drift: LivingDrift): string =>
  drift.current === null
    ? `${drift.requirement} was written against ${drift.livingRef} at version ${String(drift.recorded)}, which was removed since: read the living spec again and write ${drift.requirement} on what it is now.`
    : `${drift.requirement} was written against ${drift.livingRef} at version ${String(drift.recorded)}, which is now at version ${String(drift.current)}: read it again with living_spec_read and write ${drift.requirement} on it.`
