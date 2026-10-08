/**
 * The living spec of a Project (#93): its domains and requirements as the living spec page reads
 * them (#104), each with its state, its uncertainty and its origin; one requirement with its
 * history; the bootstrap runs; and the user's validation, rejection and drop. Nobody types a
 * requirement here: the bootstrap agent proposes, the user validates, rejects or drops.
 *
 * Hemera does not detect behaviour changed outside Hemera in 1.0: the user re-runs the bootstrap
 * of one domain when a gap is reported.
 */

import { BootstrapRunState, LivingScenario, LivingState } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

/** The mission a requirement comes from, its key read from the mission; null for the bootstrap. */
export const LivingOrigin = Schema.NullOr(
  Schema.Struct({
    missionId: Schema.String,
    /** `ACME-12`; null once the mission is gone. */
    key: Schema.NullOr(Schema.String),
    /** The Review round that changed it, or null for the mission's Spec. */
    round: Schema.NullOr(Schema.Number),
  }),
)
export type LivingOrigin = typeof LivingOrigin.Type

/** A replacement a re-run of a domain proposes on an existing requirement. */
export const LivingReplace = Schema.TaggedStruct('Replace', {
  text: Schema.String,
  scenarios: Schema.Array(LivingScenario),
  uncertainty: Schema.String,
})

/** A removal a re-run of a domain proposes on an existing requirement. */
export const LivingObsolete = Schema.TaggedStruct('Obsolete', { reason: Schema.String })

/** What a re-run of a domain proposes on an existing requirement, applied at validation. */
export const LivingPending = Schema.Union([LivingReplace, LivingObsolete])
export type LivingPending = typeof LivingPending.Type

export const LivingRequirement = Schema.Struct({
  /** `LR12`: never reused. */
  id: Schema.String,
  domainId: Schema.String,
  text: Schema.String,
  scenarios: Schema.Array(LivingScenario),
  origin: LivingOrigin,
  state: LivingState,
  /** What the agent was not sure of; empty when it was. */
  uncertainty: Schema.String,
  /** From 1, bumped by each change of its text, its scenarios, or its removal. */
  version: Schema.Number,
  /** A removed requirement stays readable, with its history. */
  removed: Schema.Boolean,
  pending: Schema.NullOr(LivingPending),
})
export type LivingRequirement = typeof LivingRequirement.Type

/**
 * A requirement waiting on the user as the living spec page showed it: proposed, or with a change
 * proposed on it. Validating or rejecting a domain names what was shown, and is refused when the
 * domain's waiting requirements differ from it.
 */
export const LivingSeen = Schema.Struct({
  id: Schema.String,
  version: Schema.Number,
  pending: Schema.NullOr(LivingPending),
})
export type LivingSeen = typeof LivingSeen.Type

/** What a validation or a rejection names of a domain: its requirements that wait on the user. */
export const livingSeen = (
  requirements: ReadonlyArray<LivingRequirement>,
): ReadonlyArray<LivingSeen> =>
  requirements
    .filter((one) => !one.removed && (one.state === 'proposed' || one.pending !== null))
    .map((one) => ({ id: one.id, version: one.version, pending: one.pending }))

/** Who changed a living requirement. */
export const LivingAuthor = Schema.Literals(['bootstrap', 'mission', 'user'])
export type LivingAuthor = typeof LivingAuthor.Type

/** One change of a living requirement. */
export const LivingChange = Schema.Struct({
  what: Schema.Literals([
    'proposed',
    'validated',
    'rejected',
    'dropped',
    'added',
    'modified',
    'removed',
  ]),
  /** Null when it was proposed or added. */
  versionBefore: Schema.NullOr(Schema.Number),
  versionAfter: Schema.Number,
  textBefore: Schema.NullOr(Schema.String),
  textAfter: Schema.NullOr(Schema.String),
  scenariosBefore: Schema.NullOr(Schema.Array(LivingScenario)),
  scenariosAfter: Schema.NullOr(Schema.Array(LivingScenario)),
  by: LivingAuthor,
  /** The mission, for a change by a mission. */
  byMission: LivingOrigin,
  at: Schema.String,
})
export type LivingChange = typeof LivingChange.Type

export const LivingRequirementDetail = Schema.Struct({
  ...LivingRequirement.fields,
  domain: Schema.String,
  /** The oldest first. */
  history: Schema.Array(LivingChange),
})
export type LivingRequirementDetail = typeof LivingRequirementDetail.Type

export const LivingDomain = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  summary: Schema.String,
  uncertainty: Schema.String,
  /** Proposed until the user validates it, and again while a re-run's proposals wait. */
  state: LivingState,
  validatedAt: Schema.NullOr(Schema.String),
  /** Its live requirements, by state, and the changes a re-run proposes on validated ones. */
  proposed: Schema.Number,
  validated: Schema.Number,
  pending: Schema.Number,
  /** When something of it last changed. */
  lastChange: Schema.String,
})
export type LivingDomain = typeof LivingDomain.Type

/** The commit of one repository's main checkout when a run started; null with no commit. */
export const RunCommit = Schema.Struct({
  repository: Schema.String,
  commit: Schema.NullOr(Schema.String),
})
export type RunCommit = typeof RunCommit.Type

export const BootstrapRun = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  /** The domain of a run on one domain; null for the whole living spec. */
  domainId: Schema.NullOr(Schema.String),
  state: BootstrapRunState,
  /** The cap's wait while it waits for a slot, or why it failed; null otherwise. */
  sentence: Schema.NullOr(Schema.String),
  commits: Schema.Array(RunCommit),
  summary: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
})
export type BootstrapRun = typeof BootstrapRun.Type

/** A Project's living spec as its page follows it: its domains and its runs, the newest first. */
export const LivingSpecState = Schema.Struct({
  domains: Schema.Array(LivingDomain),
  runs: Schema.Array(BootstrapRun),
})
export type LivingSpecState = typeof LivingSpecState.Type

/** A gesture on the living spec refused, in the sentence the user reads. */
export class LivingSpecRefused extends Schema.TaggedError<LivingSpecRefused>()(
  'LivingSpecRefused',
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason
  }
}

const always = [StorageFailed, EngineGone] as const

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const ofProject = { projectId: Schema.String }

export const LivingSpecRpcs = RpcGroup.make(
  Rpc.make('livingSpec.domains', {
    payload: ofProject,
    success: Schema.Array(LivingDomain),
    error: failing(...always, UnknownProject),
  }),
  /** A domain's requirements, removed ones included and marked. */
  Rpc.make('livingSpec.requirements', {
    payload: { ...ofProject, domainId: Schema.String },
    success: Schema.Array(LivingRequirement),
    error: failing(...always, UnknownProject, LivingSpecRefused),
  }),
  Rpc.make('livingSpec.requirement', {
    payload: { id: Schema.String },
    success: LivingRequirementDetail,
    error: failing(...always, LivingSpecRefused),
  }),
  /** The bootstrap runs, the newest first: a running one is shown as a LiveChip. */
  Rpc.make('livingSpec.runs', {
    payload: ofProject,
    success: Schema.Array(BootstrapRun),
    error: failing(...always, UnknownProject),
  }),
  /**
   * The domain and its proposals become validated; any time, any order. `seen` is what the user
   * saw waiting in it (`livingSeen`): refused, in words, when that is not what waits now.
   */
  Rpc.make('livingSpec.validateDomain', {
    payload: { domainId: Schema.String, seen: Schema.Array(LivingSeen) },
    success: Schema.Void,
    error: failing(...always, LivingSpecRefused),
  }),
  /**
   * The domain's proposals go, history kept; a validated requirement is never removed so. `seen`
   * as for a validation.
   */
  Rpc.make('livingSpec.rejectDomain', {
    payload: { domainId: Schema.String, seen: Schema.Array(LivingSeen) },
    success: Schema.Void,
    error: failing(...always, LivingSpecRefused),
  }),
  /** One proposed requirement goes, before its domain is validated. */
  Rpc.make('livingSpec.dropRequirement', {
    payload: { requirementId: Schema.String },
    success: Schema.Void,
    error: failing(...always, LivingSpecRefused),
  }),
  /** Reads the living spec again: all of it, or one domain; refused while a run waits or runs. */
  Rpc.make('livingSpec.bootstrap', {
    payload: { ...ofProject, domainId: Schema.optionalKey(Schema.String) },
    success: BootstrapRun,
    error: failing(...always, UnknownProject, LivingSpecRefused),
  }),
  /** The living spec now, then again after each change of it or of its runs. */
  Rpc.make('livingSpec.changed', {
    payload: ofProject,
    success: LivingSpecState,
    error: failing(...always, UnknownProject),
    stream: true,
  }),
)
