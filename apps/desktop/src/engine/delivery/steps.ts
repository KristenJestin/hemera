/**
 * The step types of the delivery (S1): each kind of the rules' catalogue the delivery runs plugs in
 * here, the generic ones (Command, Agent, Confirm, and #464's push and pull request) with this
 * ticket, the forge ones with theirs (Merge, CI and Version published with S2, Bump with S3, the
 * action on the remote with S4).
 *
 * A type says how its step is done (`run`, which may be long), whether its result is already true
 * (`check`: before every run, at a Retry and at a restart), and, for a step that waits on the
 * world, one poll of that wait (`watch`). It says whether `check` is a post-condition a step cut
 * off midway can be judged by (CT-09), whether running it acts outside the database (its intent is
 * written first), and whether it waits for the repository's forge CLI while that CLI is not ready.
 * A step of a kind no type is registered for waits, saying so: it is never done.
 */

import type { DeliveryAction } from '@hemera/core/domain'
import { Context, Effect, Layer, Schema } from 'effect'

/** Where a step runs: its mission, its repository and that repository's worktree. */
export interface StepAt {
  readonly missionId: string
  readonly projectId: string
  readonly repositoryId: string
  /** The repository's path in the Workspace. */
  readonly repository: string
  readonly step: DeliveryAction
  /** The repository's worktree in the mission's Workspace; null when it is not on the disk. */
  readonly folder: string | null
  /** The mission's Workspace; null when it has none. */
  readonly workspaceId: string | null
}

/** The step's result is there: what was found or done, as the step shows it (`#41`, `2.4.0`). */
export const StepDone = Schema.TaggedStruct('Done', { outcome: Schema.String })
/** The step failed: the remote's or Git's message, verbatim (masked before it is kept). */
export const StepFailed = Schema.TaggedStruct('Failed', { message: Schema.String })
/** The step waits on the world, or its result could not be read: why, in words. Never done. */
export const StepWaiting = Schema.TaggedStruct('Waiting', { reason: Schema.String })
/** `check` only: the step's result is not there yet, and it is to run. */
export const StepNotDone = Schema.TaggedStruct('NotDone', {})
/**
 * The step asks the user before it can end (an Agent step that changed the frozen tree): a
 * decision need with these options, and what the type keeps to take the answer (`answered`).
 */
export const StepAsks = Schema.TaggedStruct('Asks', {
  question: Schema.String,
  options: Schema.Array(Schema.String),
  recommended: Schema.NullOr(Schema.Struct({ option: Schema.String, reason: Schema.String })),
  kept: Schema.Json,
})

export const StepAnswer = Schema.Union([StepDone, StepFailed, StepWaiting, StepNotDone, StepAsks])
export type StepAnswer = typeof StepAnswer.Type

export const done = (outcome: string): StepAnswer => StepDone.make({ outcome })
export const failed = (message: string): StepAnswer => StepFailed.make({ message })
export const waiting = (reason: string): StepAnswer => StepWaiting.make({ reason })
export const notDone: StepAnswer = StepNotDone.make({})

/** How a click step's need says what it will do, and what its Go is called. */
export interface ClickWords {
  readonly question: string
  readonly go: string
}

export interface StepType {
  /** Whether its `check` judges a step cut off midway (CT-09): checked, never asked. */
  readonly postCondition: boolean
  /** Whether running it acts outside the database: its intent is written first. */
  readonly acts: boolean
  /** Whether it waits, and says so, while the repository's forge CLI is missing or signed out. */
  readonly forge: boolean
  /** Whether it always waits for the user's click, whatever its mode says (Confirm). */
  readonly alwaysClick?: boolean
  /** What the need of its click says, and its Go; the step said in a few words otherwise. */
  readonly click?: (at: StepAt) => ClickWords
  /** Whether its result is already true: `Done`, `NotDone`, `Failed`, or `Waiting` unread. */
  readonly check: (at: StepAt) => Effect.Effect<StepAnswer>
  /** Does the step: `Done`, `Failed`, `Waiting` (its wait is then watched), or `Asks`. */
  readonly run: (at: StepAt) => Effect.Effect<StepAnswer>
  /** One poll of the step's wait; `check` when it has none. */
  readonly watch?: (at: StepAt) => Effect.Effect<StepAnswer>
  /** Takes the user's answer to what the step asked, with what it kept then. */
  readonly answered?: (at: StepAt, option: string, kept: Schema.Json) => Effect.Effect<StepAnswer>
  /** The last output it recorded, shown when it was cut off midway without a post-condition. */
  readonly lastOutput?: (at: StepAt) => Effect.Effect<string | null>
  /** What it leaves behind once cut off midway (its session), ended as it becomes indeterminate. */
  readonly cut?: (at: StepAt) => Effect.Effect<void>
}

/** The step types the delivery runs, by kind of the catalogue. */
export class DeliveryStepTypes extends Context.Service<
  DeliveryStepTypes,
  ReadonlyMap<string, StepType>
>()('DeliveryStepTypes') {}

export const stepTypesLayer = (types: ReadonlyMap<string, StepType>) =>
  Layer.succeed(DeliveryStepTypes, types)

/**
 * A kind no type is registered for yet (Merge, CI, Version published, Bump and the action on the
 * remote come with S2 to S4): its step waits and says so, never done, never failed.
 */
export const notYetRun = (kind: string): StepType => {
  const said = waiting(`Hemera does not run “${kind}” steps yet.`)
  return {
    postCondition: true,
    acts: false,
    forge: false,
    check: () => Effect.succeed(said),
    run: () => Effect.succeed(said),
  }
}
