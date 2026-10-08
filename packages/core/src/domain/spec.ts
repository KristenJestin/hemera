/**
 * A mission's Spec (#85): what is wanted, the decisions and the end state, written by the Planner
 * through Hemera's tools and never by hand.
 *
 * A Spec has eight sections: seven of prose, and the requirements (a delta against the Project's
 * living spec, each with its scenarios) in fourth place. Every write names the version of the item
 * it changes; one rule says who may write at all; Hemera checks completeness mechanically when the
 * Planner declares it; and its readable file is rendered from it, never read back.
 */

import { Schema } from 'effect'

import { type LivingDrift, driftSaid } from './living-spec.ts'
import { type MissionType, type Stage, isFrozen } from './mission.ts'
import { type InputKind, inputAbout } from './questions.ts'

/** The seven prose sections, in their order; the requirements come after the impact. */
export const SPEC_SECTIONS = [
  'why',
  'goals',
  'impact',
  'decisions',
  'risks',
  'migration',
  'open_questions',
] as const
export const SpecSectionName = Schema.Literals(SPEC_SECTIONS)
export type SpecSectionName = typeof SpecSectionName.Type

/** What the file and the screen call each section. */
export const SECTION_TITLES: Readonly<Record<SpecSectionName, string>> = {
  why: 'Why',
  goals: 'Goals / Non-goals',
  impact: 'Impact',
  decisions: 'Decisions',
  risks: 'Risks & trade-offs',
  migration: 'Migration plan',
  open_questions: 'Open questions',
}

/** Where the requirements sit among the sections: after the impact. */
const REQUIREMENTS_AFTER: SpecSectionName = 'impact'

/** What a requirement does to the living spec. */
export const DELTAS = ['added', 'modified', 'removed'] as const
export const Delta = Schema.Literals(DELTAS)
export type Delta = typeof Delta.Type

/** The Planner's answer when the input is not new work. */
export const TRIAGE_KINDS = ['existing_mission', 'delivered', 'too_small'] as const
export const TriageKind = Schema.Literals(TRIAGE_KINDS)
export type TriageKind = typeof TriageKind.Type

/** The most a `spec_read` answers in one page. */
export const SPEC_PAGE_BYTES = 64 * 1024

export interface SpecSectionText {
  readonly name: SpecSectionName
  /** Empty until written. */
  readonly body: string
  /** 0 until written. */
  readonly version: number
}

export interface SpecScenarioText {
  readonly id: string
  readonly when: string
  readonly then: string
  readonly version: number
}

export interface SpecRequirementText {
  readonly id: string
  readonly domain: string
  readonly delta: Delta
  readonly livingRef: string | null
  readonly livingVersion: number | null
  readonly text: string
  readonly version: number
  readonly removed: boolean
  /** Its live scenarios, in their order. */
  readonly scenarios: ReadonlyArray<SpecScenarioText>
}

/** A Spec as its file and its checks read it. */
export interface SpecText {
  readonly key: string
  readonly title: string
  readonly type: MissionType
  /** The Spec language, a BCP 47 tag. */
  readonly language: string
  readonly version: number
  /** The seven prose sections, each once. */
  readonly sections: ReadonlyArray<SpecSectionText>
  /** In their order, removed ones included. */
  readonly requirements: ReadonlyArray<SpecRequirementText>
}

/** Where a write would land: the mission's stage, whether its Spec is frozen, the writer's role. */
export interface WriteStanding {
  readonly key: string
  readonly stage: Stage
  readonly frozen: boolean
  readonly role: string
}

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/**
 * The one write rule: the mission is in Planning, its Spec is not frozen, and the writer is the
 * Planner (the mission is the one its session works for, never one an argument names). Null when
 * the write may go ahead; otherwise the sentence the agent is answered with.
 */
export function specWriteRefusal(standing: WriteStanding): string | null {
  const { key, stage } = standing
  if (standing.role !== 'planner') return `Only the Planner of ${key} writes its Spec.`
  if (isFrozen(stage)) {
    return `${key} is ${capitalised(stage)}: the Spec is frozen and nothing writes it.`
  }
  if (stage !== 'planning') return `${key} is ${capitalised(stage)}: nothing writes its Spec.`
  if (standing.frozen) {
    return `The Spec of ${key} is frozen: nothing writes it until the user sends it back to Planning.`
  }
  return null
}

/**
 * A write on a version that is no longer the item's: refused, naming the current version and its
 * text, and nothing is written.
 */
export const staleSaid = (item: string, base: number, current: number, text: string): string =>
  [
    `refused: ${item} changed since version ${String(base)}: it is at version ${String(current)}. Nothing was written.`,
    text.trim() === '' ? 'It is empty.' : `Its text now:\n\n${text}`,
  ].join(' ')

/** One thing the completeness check found: what it is about, and what to do, in a sentence. */
export interface CompletenessFailure {
  readonly target: string
  readonly sentence: string
}

/** What the completeness check reads beside the Spec. */
export interface CompletenessContext {
  /** Whether the Planner set the mission's title and type with `mission_describe`. */
  readonly described: boolean
  /** Whether a triage answer still waits on the user. */
  readonly triagePending: boolean
  /** The inputs received or delivered and not integrated yet (CT-26). */
  readonly pendingInputs: ReadonlyArray<{
    readonly id: string
    readonly kind: InputKind
    readonly item: string
    readonly version: number | null
    readonly state: 'received' | 'delivered'
  }>
  /** The questions open or waiting on someone. */
  readonly openQuestions: ReadonlyArray<{ readonly id: string; readonly state: 'open' | 'waiting' }>
  /** The deltas whose living requirement changed after they were written (#93). */
  readonly livingChanged: ReadonlyArray<LivingDrift>
}

const blank = (text: string): boolean => text.trim() === ''

/**
 * Hemera's mechanical check of a Spec the Planner declares complete: every failure, each with its
 * target and its sentence; none when it is complete. Later tickets add their checks here.
 */
export function completeness(
  spec: SpecText,
  context: CompletenessContext,
): ReadonlyArray<CompletenessFailure> {
  const failures: CompletenessFailure[] = []
  for (const name of SPEC_SECTIONS) {
    const section = spec.sections.find((one) => one.name === name)
    if (section === undefined || blank(section.body)) {
      failures.push({
        target: name,
        sentence: `${SECTION_TITLES[name]} holds no text: write it, or "None."`,
      })
    }
  }
  const live = spec.requirements.filter((one) => !one.removed)
  if (live.length === 0) {
    failures.push({ target: 'requirements', sentence: 'The Spec has no requirement.' })
  }
  for (const requirement of live) {
    if (blank(requirement.domain)) {
      failures.push({ target: requirement.id, sentence: `${requirement.id} has no domain.` })
    }
    if (blank(requirement.text)) {
      failures.push({ target: requirement.id, sentence: `${requirement.id} has no text.` })
    }
    if (requirement.scenarios.length === 0) {
      failures.push({ target: requirement.id, sentence: `${requirement.id} has no scenario.` })
    }
    for (const scenario of requirement.scenarios) {
      if (blank(scenario.when)) {
        failures.push({ target: scenario.id, sentence: `${scenario.id} has no WHEN.` })
      }
      if (blank(scenario.then)) {
        failures.push({ target: scenario.id, sentence: `${scenario.id} has no THEN.` })
      }
    }
  }
  for (const drift of context.livingChanged) {
    failures.push({ target: drift.requirement, sentence: driftSaid(drift) })
  }
  if (!context.described) {
    failures.push({
      target: 'mission',
      sentence: 'The mission has no title and type of yours: set them with mission_describe.',
    })
  }
  if (context.triagePending) {
    failures.push({
      target: 'triage',
      sentence:
        'Your triage answer waits on the user: the Spec is complete only once they keep the mission.',
    })
  }
  for (const input of context.pendingInputs) {
    const named = `Input ${input.id} (${inputAbout(input.kind, input.item, input.version)})`
    failures.push({
      target: input.id,
      sentence:
        input.state === 'received'
          ? `${named} has not reached you yet: it comes with your next delivery.`
          : `${named} is not integrated: integrate it, then call input_integrated.`,
    })
  }
  for (const question of context.openQuestions) {
    failures.push({
      target: question.id,
      sentence:
        question.state === 'open'
          ? `${question.id} is open: it waits for the user's answer.`
          : `${question.id} waits on someone: a complete Spec has no open question.`,
    })
  }
  return failures
}

/** A requirement's heading: its id, its delta, its domain, and the living requirement it changes. */
const requirementHeading = (requirement: SpecRequirementText, versions: boolean): string => {
  const living =
    requirement.livingRef === null
      ? []
      : [
          requirement.livingVersion === null
            ? requirement.livingRef
            : `${requirement.livingRef} at version ${String(requirement.livingVersion)}`,
        ]
  const heading = [requirement.id, requirement.delta, requirement.domain, ...living].join(' · ')
  return versions ? `${heading} (version ${String(requirement.version)})` : heading
}

const requirementsText = (spec: SpecText, versions: boolean): string => {
  const live = spec.requirements.filter((one) => !one.removed)
  if (live.length === 0) return '_Not written yet._'
  return live
    .map((requirement) =>
      [
        `### ${requirementHeading(requirement, versions)}`,
        '',
        requirement.text,
        '',
        ...requirement.scenarios.map(
          (scenario) =>
            `- ${scenario.id}${versions ? ` (version ${String(scenario.version)})` : ''}: WHEN ${scenario.when} THEN ${scenario.then}`,
        ),
      ].join('\n'),
    )
    .join('\n\n')
}

/** One section as the file writes it: its title, then its body or that it is empty. */
const sectionText = (spec: SpecText, name: SpecSectionName, versions: boolean): string => {
  const section = spec.sections.find((one) => one.name === name)
  const version = versions ? ` (version ${String(section?.version ?? 0)})` : ''
  const body =
    section === undefined || blank(section.body) ? '_Not written yet._' : section.body.trim()
  return `## ${SECTION_TITLES[name]}${version}\n\n${body}`
}

/**
 * The Spec as Markdown: its key and title, then the eight sections in order, the requirements with
 * their scenarios in fourth place. With `versions`, every item says its own version, as the
 * Planner reads it to write on it.
 */
export function renderSpecMarkdown(
  spec: SpecText,
  options: { readonly versions?: boolean } = {},
): string {
  const versions = options.versions ?? false
  const parts = [
    `# ${spec.key} · ${spec.title}`,
    `Type: ${spec.type} · Spec language: ${spec.language} · Version: ${String(spec.version)}`,
  ]
  for (const name of SPEC_SECTIONS) {
    parts.push(sectionText(spec, name, versions))
    if (name === REQUIREMENTS_AFTER)
      parts.push(`## Requirements\n\n${requirementsText(spec, versions)}`)
  }
  return `${parts.join('\n\n')}\n`
}

/** One part of the Spec as Markdown, with every item's version: what `spec_read` gives of it. */
export const specPartMarkdown = (spec: SpecText, part: SpecSectionName | 'requirements'): string =>
  part === 'requirements'
    ? `## Requirements\n\n${requirementsText(spec, true)}\n`
    : `${sectionText(spec, part, true)}\n`

/** A language tag in its canonical BCP 47 spelling (`en-GB`), or null when it is not one. */
export function canonicalLanguage(tag: string): string | null {
  const trimmed = tag.trim()
  if (trimmed === '' || !/^[A-Za-z0-9-]+$/.test(trimmed)) return null
  try {
    return Intl.getCanonicalLocales(trimmed)[0] ?? null
  } catch {
    return null
  }
}

/** The Project's Spec language: a BCP 47 tag. */
export const SpecLanguageTag = Schema.String.check(
  Schema.makeFilter((tag) => canonicalLanguage(tag) !== null, {
    expected: 'a BCP 47 language tag, such as en or pt-BR',
  }),
)
