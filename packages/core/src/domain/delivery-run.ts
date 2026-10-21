/**
 * The delivery run (S1): from Ship to Done, a mission's repositories leave in waves, each through
 * the steps its copy of the waves gives it. Here are its pure rules: which repositories take part,
 * the wave each leaves in, and how the steps' states add up to a repository's status and the
 * delivery's. The engine stores the plan, runs the steps and watches the waits.
 *
 * - A repository **takes part** when its tree frozen at Ship differs from its base. One that
 *   depends on a participating repository that publishes in this mission (its steps hold a Version
 *   published step) takes part too, as **bump only**; transitively. Every other one is skipped.
 * - The **waves** are the levels of the dependency order among the participating repositories: a
 *   repository leaves once every participating repository it depends on has delivered, which is
 *   its last step done (CT-51: the Version published step when it has one, the merge and its CI
 *   otherwise). A dependency that does not take part sets no wave.
 */

import { Schema } from 'effect'

import { type DeliveryAction, type WavesCopy, partsOf } from './delivery.ts'

/**
 * Where a step stands: waiting its turn, waiting for the user's click (a decision need is open),
 * running, waiting on the world (a watched wait), done (with its outcome), failed (with the
 * message), indeterminate (an action cut off midway: a decision need is open), or stopped.
 */
export const DELIVERY_STEP_STATES = [
  'pending',
  'needs-click',
  'running',
  'waiting',
  'done',
  'failed',
  'indeterminate',
  'stopped',
] as const
export const DeliveryStepState = Schema.Literals(DELIVERY_STEP_STATES)
export type DeliveryStepState = typeof DeliveryStepState.Type

/** Where a participating repository stands, from its steps. */
export const REPOSITORY_DELIVERY_STATUSES = [
  'not-started',
  'running',
  'waiting',
  'needs-you',
  'failed',
  'stopped',
  'delivered',
] as const
export const RepositoryDeliveryStatus = Schema.Literals(REPOSITORY_DELIVERY_STATUSES)
export type RepositoryDeliveryStatus = typeof RepositoryDeliveryStatus.Type

/** Where the delivery stands, from its repositories. */
export const DELIVERY_STATUSES = ['running', 'stopped', 'delivered', 'partially-delivered'] as const
export const DeliveryStatus = Schema.Literals(DELIVERY_STATUSES)
export type DeliveryStatus = typeof DeliveryStatus.Type

/** One participating repository of the plan: its wave, whether it takes part for a bump only. */
export interface PlannedRepository {
  readonly repositoryId: string
  readonly name: string
  readonly wave: number
  readonly bumpOnly: boolean
  /** Its steps, in their order, as the copy of the waves gives them. */
  readonly steps: ReadonlyArray<DeliveryAction>
}

export interface DeliveryPlan {
  /** The participating repositories, by wave, then in the copy's order. */
  readonly repositories: ReadonlyArray<PlannedRepository>
}

/** Whether a repository's steps publish a version. */
export const publishes = (steps: ReadonlyArray<DeliveryAction>): boolean =>
  steps.some((step) => step.kind === 'published-version')

/**
 * The plan of a delivery: the repositories of the copy that take part, `changed` (by id) those
 * whose frozen tree differs from their base, with the wave each leaves in.
 */
export function planDelivery(waves: WavesCopy, changed: ReadonlyArray<string>): DeliveryPlan {
  const all = waves.repositories
  const taking = new Map<string, boolean>()
  for (const one of all) if (changed.includes(one.repositoryId)) taking.set(one.repositoryId, false)
  // Bump only: each repository that depends on one taking part and publishing, until none is new.
  for (let added = true; added;) {
    added = false
    for (const one of all) {
      if (taking.has(one.repositoryId)) continue
      const fed = one.deliversAfter.some((id) => {
        const upstream = all.find((other) => other.repositoryId === id)
        return upstream !== undefined && taking.has(id) && publishes(upstream.steps)
      })
      if (fed) {
        taking.set(one.repositoryId, true)
        added = true
      }
    }
  }
  const waveOf = new Map<string, number>()
  // A cycle is refused by the rules; one met here is broken where it is met.
  const visiting = new Set<string>()
  const levelOf = (id: string): number => {
    const known = waveOf.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    const one = all.find((repository) => repository.repositoryId === id)
    const level = Math.max(
      0,
      ...(one?.deliversAfter ?? [])
        .filter((upstream) => taking.has(upstream))
        .map((upstream) => levelOf(upstream) + 1),
    )
    waveOf.set(id, level)
    return level
  }
  const repositories = all
    .filter((one) => taking.has(one.repositoryId))
    .map((one) => ({
      repositoryId: one.repositoryId,
      name: one.name,
      wave: levelOf(one.repositoryId),
      bumpOnly: taking.get(one.repositoryId) === true,
      steps: one.steps,
    }))
  return { repositories: repositories.toSorted((a, b) => a.wave - b.wave) }
}

/** What a repository's status reads of each of its steps. */
export interface StepStanding {
  readonly state: DeliveryStepState
}

/** A repository's status: delivered once its last step is done, else as its first step not done. */
export function repositoryStatus(steps: ReadonlyArray<StepStanding>): RepositoryDeliveryStatus {
  if (steps.every((step) => step.state === 'done')) return 'delivered'
  if (steps.every((step) => step.state === 'pending')) return 'not-started'
  const first = steps.find((step) => step.state !== 'done')
  switch (first?.state) {
    case 'failed':
      return 'failed'
    case 'stopped':
      return 'stopped'
    case 'waiting':
      return 'waiting'
    case 'needs-click':
    case 'indeterminate':
      return 'needs-you'
    default:
      return 'running'
  }
}

/**
 * The delivery's status: delivered when every participating repository is; partially delivered
 * when it is stopped, or a repository failed, with at least one delivered; stopped; running.
 */
export function deliveryStatus(standing: {
  readonly stopped: boolean
  readonly repositories: ReadonlyArray<RepositoryDeliveryStatus>
}): DeliveryStatus {
  const { repositories } = standing
  if (repositories.every((one) => one === 'delivered')) return 'delivered'
  const delivered = repositories.some((one) => one === 'delivered')
  const failed = repositories.some((one) => one === 'failed')
  if (delivered && (standing.stopped || failed)) return 'partially-delivered'
  return standing.stopped ? 'stopped' : 'running'
}

/** What a step will do, as the need that asks for its click says it. */
export const stepSaid = (step: DeliveryAction, repository: string): string => {
  const { what, on } = partsOf(step)
  return `${what} ${on} in ${repository}`
}

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

/** What `delivery_step_report` carries: how the Delivery agent's step ended. */
export const DeliveryStepReport = Schema.Struct({
  outcome: Schema.Literals(['done', 'failed']).annotate({
    description: '`done` when the task is done, `failed` when something blocked it.',
  }),
  summary: Bounded(
    4000,
    'What you did, or what blocked you and what you tried. Say "not verified" for what you could not check.',
  ),
  changed: Schema.optionalKey(
    Schema.Array(Bounded(1000, 'A file you changed, by its path in your repository.')).annotate({
      description: 'The files you changed, when your task said to change some.',
    }),
  ),
}).annotate({
  description:
    'End your delivery step: done with what you did, or failed with what blocked you. Hemera compares the repository with the frozen tree once you report.',
})
export type DeliveryStepReport = typeof DeliveryStepReport.Type
