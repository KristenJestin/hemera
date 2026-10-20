/**
 * A Project's delivery rules (#340), as they cross the links: the rules with each repository's
 * effective recipe and the dependencies proposed from its `package.json` (never saved until
 * accepted), a draft checked or saved on the version it was edited from, and the sections a
 * mission copied.
 *
 * The remote and the base branch of each repository stay the Project's fields (`projects.*`).
 */

import {
  DeliveryDependency,
  DeliveryProblem,
  DeliveryRules,
  DeliveryRulesDraft,
  DeliverySection,
  EffectiveRepository,
  PreparationDifference,
  SectionCopy,
} from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { ForgeCli, ForgeName } from './forge.ts'
import { EngineGone } from './gone.ts'
import { UnknownEvidence } from './memory.ts'
import { UnknownMission } from './missions.ts'
import { StaleVersion, StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

export {
  DeliveryDependency,
  DeliveryProblem,
  DeliveryRules,
  DeliveryRulesDraft,
  EffectiveRepository,
  PreparationDifference,
  SectionCopy,
}

/** The rules of a Project, each repository resolved, and the dependencies its manifests propose. */
export const DeliveryRulesView = Schema.Struct({
  rules: DeliveryRules,
  /** In the Project's order. */
  repositories: Schema.Array(EffectiveRepository),
  /** Proposed from the repositories' `package.json` files; saved only once accepted. */
  proposedDependencies: Schema.Array(DeliveryDependency),
})
export type DeliveryRulesView = typeof DeliveryRulesView.Type

/** What changed in the Project's preparation since a mission copied it, for the Ship confirmation. */
export const PreparationChange = Schema.Struct({
  copiedVersion: Schema.Number,
  currentVersion: Schema.Number,
  /** None when the preparation reads the same, whatever its version. */
  differences: Schema.Array(PreparationDifference),
})
export type PreparationChange = typeof PreparationChange.Type

/** Rules refused at saving, with every reason. */
export class DeliveryRulesRefused extends Schema.TaggedError<DeliveryRulesRefused>()(
  'DeliveryRulesRefused',
  { problems: Schema.Array(DeliveryProblem) },
) {
  override get message(): string {
    return this.problems.map((problem) => problem.sentence).join(' ')
  }
}

/**
 * A stored document of the delivery rules that no longer reads (a later release changed a field):
 * which Project, which document, at which version. Nothing is lost: the document stays as it was,
 * and a save of the rules replaces it.
 */
export class DeliveryRulesUnreadable extends Schema.TaggedError<DeliveryRulesUnreadable>()(
  'DeliveryRulesUnreadable',
  {
    projectId: Schema.String,
    document: Schema.Literals(['rules', 'copy']),
    /** The mission whose copy it is; null for the Project's rules. */
    missionId: Schema.NullOr(Schema.String),
    section: Schema.NullOr(DeliverySection),
    version: Schema.Number,
  },
) {
  override get message(): string {
    return this.document === 'rules'
      ? `This Project’s delivery rules, saved at version ${String(this.version)}, can no longer be read: save them again to replace them.`
      : `This mission’s copy of the ${this.section ?? ''} section, taken at version ${String(this.version)}, can no longer be read.`
  }
}

const failing = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union(errors)

const always = [StorageFailed, EngineGone] as const

export const DeliveryRulesRpcs = RpcGroup.make(
  /** The Project's rules (its defaults when it never saved any), resolved per repository. */
  Rpc.make('deliveryRules.read', {
    payload: { projectId: Schema.String },
    success: DeliveryRulesView,
    error: failing(...always, UnknownProject, DeliveryRulesUnreadable),
  }),
  /** Every reason a draft would be refused; none when it can be saved. */
  Rpc.make('deliveryRules.validate', {
    payload: { projectId: Schema.String, draft: DeliveryRulesDraft },
    success: Schema.Array(DeliveryProblem),
    error: failing(...always, UnknownProject),
  }),
  /** Saves a draft edited from `version`: refused on a stale version, or with its reasons. */
  Rpc.make('deliveryRules.save', {
    payload: { projectId: Schema.String, draft: DeliveryRulesDraft, version: Schema.Number },
    success: DeliveryRulesView,
    error: failing(...always, UnknownProject, StaleVersion, DeliveryRulesRefused),
  }),
  /** Saves the dependencies the user accepted, each into its repository's delivers-after. */
  Rpc.make('deliveryRules.acceptDependencies', {
    payload: { projectId: Schema.String, edges: Schema.Array(DeliveryDependency) },
    success: DeliveryRulesView,
    error: failing(...always, UnknownProject, DeliveryRulesRefused, DeliveryRulesUnreadable),
  }),
  /** The sections a mission copied, each with the version of the rules it was copied at. */
  Rpc.make('deliveryRules.missionCopies', {
    payload: { missionId: Schema.String },
    success: Schema.Array(SectionCopy),
    error: failing(...always, UnknownMission, DeliveryRulesUnreadable),
  }),
  /**
   * Whether the Project's preparation differs from the mission's copy, with the differences; null
   * when the mission has not copied it yet.
   */
  Rpc.make('deliveryRules.preparationChangedSinceCopy', {
    payload: { missionId: Schema.String },
    success: Schema.NullOr(PreparationChange),
    error: failing(...always, UnknownMission, UnknownProject, DeliveryRulesUnreadable),
  }),
)

// ——— The pushes and the pull requests (R6) ———

/** Where a pull request stands on its forge, as Hemera last read it. */
export const PullRequestState = Schema.Literals(['open', 'merged', 'closed'])
export type PullRequestState = typeof PullRequestState.Type

/** A team member's approval of a pull request, as the forge names them. */
export const PullRequestApproval = Schema.Struct({ login: Schema.String })

/**
 * A pull request as the port reads it (`pullRequest.status`): its state, its head commit, the
 * forge's review decision (GitHub's; null where the forge has none) and the approvals.
 */
export const PullRequestStatus = Schema.Struct({
  forge: ForgeName,
  host: Schema.String,
  number: Schema.Number,
  url: Schema.String,
  state: PullRequestState,
  head: Schema.String,
  reviewDecision: Schema.NullOr(Schema.String),
  approvals: Schema.Array(PullRequestApproval),
})
export type PullRequestStatus = typeof PullRequestStatus.Type

/**
 * Where a repository's push and pull request stand: waiting for the user's click, running,
 * done, failed (with Git's or the forge's message), indeterminate (an outcome Hemera could not
 * read, never shown as done), waiting for a forge CLI to be ready, or declined ("not now").
 */
export const PushState = Schema.Literals([
  'waiting-for-click',
  'running',
  'done',
  'failed',
  'indeterminate',
  'waiting-for-cli',
  'declined',
])
export type PushState = typeof PushState.Type

/**
 * Where an image of the mission stands in a repository's pull request (R7): published (its copy's
 * URL), listed by name (the forge cannot host it, or the user chose the list), not published (the
 * CLI's message, masked; a Retry sends it), waiting to be sent, or not in the pull request (added
 * after it opened, whose description is never rewritten for it).
 */
export const PushImageState = Schema.Literals([
  'pending',
  'published',
  'listed',
  'not-published',
  'not-in-pull-request',
])
export type PushImageState = typeof PushImageState.Type

/** An image of a mission and its copy in a repository's pull request (CT-54). */
export const PushImage = Schema.Struct({
  evidenceId: Schema.String,
  /** Its evidence's name, as the list of file names shows it. */
  name: Schema.String,
  /** Its feedback's first line, or its name. */
  alt: Schema.String,
  state: PushImageState,
  /** The published copy's address on the forge. */
  url: Schema.NullOr(Schema.String),
  /** Why it was not published, verbatim and masked. */
  message: Schema.NullOr(Schema.String),
})
export type PushImage = typeof PushImage.Type

/** One repository of a mission, as its pushes stand. */
export const RepositoryPush = Schema.Struct({
  repositoryId: Schema.String,
  /** Its path in the Workspace. */
  repository: Schema.String,
  state: PushState,
  /** The action of the stack it stands at, by id; null before it started. */
  step: Schema.NullOr(Schema.String),
  /** What failed or could not be read, verbatim and masked. */
  message: Schema.NullOr(Schema.String),
  /** The CLI the pull request waits for, when it waits for one. */
  waitingFor: Schema.NullOr(ForgeCli),
  /** The last commit pushed, and when. */
  commit: Schema.NullOr(Schema.String),
  pushedAt: Schema.NullOr(Schema.String),
  pullRequest: Schema.NullOr(PullRequestStatus),
  /** The mission's images and their copies in the pull request, in the order they were added. */
  images: Schema.Array(PushImage),
  /** Why the images are listed by name rather than shown, in words; null when they are shown. */
  imagesReason: Schema.NullOr(Schema.String),
})
export type RepositoryPush = typeof RepositoryPush.Type

/** A mission's pushes, with the version of the preparation it copied (null before its first). */
export const MissionPushes = Schema.Struct({
  missionId: Schema.String,
  rulesVersion: Schema.NullOr(Schema.Number),
  repositories: Schema.Array(RepositoryPush),
})
export type MissionPushes = typeof MissionPushes.Type

/** A Retry of a repository that has nothing to retry: it is neither failed nor indeterminate. */
export class NothingToRetry extends Schema.TaggedError<NothingToRetry>()('NothingToRetry', {
  repository: Schema.String,
}) {
  override get message(): string {
    return `${this.repository} has nothing to retry.`
  }
}

/** A mark of publishable on an evidence that is no image: only an image can be published. */
export class NotPublishable extends Schema.TaggedError<NotPublishable>()('NotPublishable', {
  evidenceId: Schema.String,
}) {
  override get message(): string {
    return 'Only an image (PNG, JPEG or WebP) can be published.'
  }
}

export const DeliveryRpcs = RpcGroup.make(
  /** Per repository of the mission: its last push, its pull request and where its step stands. */
  Rpc.make('delivery.pushes', {
    payload: { missionId: Schema.String },
    success: MissionPushes,
    error: failing(...always, UnknownMission, DeliveryRulesUnreadable),
  }),
  /** Runs a failed or indeterminate repository again, doing only what is not already true. */
  Rpc.make('delivery.retry', {
    payload: { missionId: Schema.String, repository: Schema.String },
    success: MissionPushes,
    error: failing(...always, UnknownMission, NothingToRetry, DeliveryRulesUnreadable),
  }),
  /** The mission's pushes now, then after each change, for as long as the caller listens. */
  Rpc.make('delivery.changes', {
    payload: { missionId: Schema.String },
    success: MissionPushes,
    error: failing(...always, UnknownMission, DeliveryRulesUnreadable),
    stream: true,
  }),
  /**
   * The user's mark on an image of a mission's evidence (R7): published in its pull requests, or
   * not. A feedback image is publishable unless unmarked; any other only once marked.
   */
  Rpc.make('evidence.setPublishable', {
    payload: { evidenceId: Schema.String, publishable: Schema.Boolean },
    success: Schema.Void,
    error: failing(...always, UnknownEvidence, NotPublishable),
  }),
)
