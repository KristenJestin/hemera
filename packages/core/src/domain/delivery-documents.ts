/**
 * The stored documents of the delivery rules, read (#422): the rules of a Project and the sections
 * a mission copied, of today's shape or of the shape #340 stored before the moments held any
 * action. A document of that shape is upgraded as it is read; its bytes stay as they were until
 * the rules are saved again, and a copy, never rewritten, is upgraded at each read.
 *
 * #340 kept who commits apart, as `commitRule`, and placed each push step in Review or in the
 * waves. Now the moment holds the action, and committing is one:
 *
 * - `at-push` becomes "Hemera commits" right before each push, in the push's moment; Local, which
 *   has no push, commits right before its local merge;
 * - `after-each-task` becomes "Hemera commits" in "After each task", in every preset.
 *
 * A push step a repository moved or added stays in its moment, with Hemera's commit before it
 * under `at-push`. A repository with no waves of its own whose push moves to the waves takes
 * Application, the preset of a repository with a forge. A mission's copy of the preparation cannot
 * tell which value was stored: it reads as `at-push` did, Hemera committing what is left at the
 * push (CT-46), and its pushes after Ship go to the front of the mission's waves copy.
 */

import { Option, Result, Schema } from 'effect'

import {
  CLOSING,
  DeliveryAction,
  type DeliveryRules,
  DeliveryRulesJson,
  type Overrides,
  PresetStacks,
  RepositoryWaves,
  type SectionCopy,
  SectionCopyJson,
  StepMode,
} from './delivery.ts'

const strict = { onExcessProperty: 'error', errors: 'all' } as const

// ——— The shape before ———

const PushStepBefore = Schema.Struct({
  id: Schema.String,
  mode: StepMode,
  kind: Schema.Literals(['push', 'pull-request']),
  placement: Schema.Literals(['review', 'waves']),
})
type PushStepBefore = typeof PushStepBefore.Type

const RulesBefore = Schema.Struct({
  version: Schema.Number,
  savedAt: Schema.NullOr(Schema.String),
  commitRule: Schema.Literals(['at-push', 'after-each-task']),
  preparation: Schema.Struct({
    reviewDrafts: Schema.Boolean,
    pushSteps: Schema.Array(PushStepBefore),
    repositories: Schema.Array(
      Schema.Struct({
        repositoryId: Schema.String,
        commitTemplate: Schema.String,
        pullRequestTitle: Schema.String,
        pullRequestBody: Schema.String,
        reviewers: Schema.Array(Schema.String),
        requireApproval: Schema.Boolean,
        pushSteps: Schema.Struct({
          off: Schema.Array(Schema.String),
          changed: Schema.Array(PushStepBefore),
          added: Schema.Array(
            Schema.Struct({ after: Schema.NullOr(Schema.String), step: PushStepBefore }),
          ),
        }),
      }),
    ),
  }),
  waves: Schema.Struct({ presets: PresetStacks, repositories: Schema.Array(RepositoryWaves) }),
  end: Schema.Struct({
    closing: Schema.Literal(CLOSING),
    cleanup: Schema.Array(DeliveryAction),
  }),
})
type RulesBefore = typeof RulesBefore.Type

const PreparationCopyBefore = Schema.Struct({
  section: Schema.Literal('preparation'),
  version: Schema.Number,
  copiedAt: Schema.String,
  reviewDrafts: Schema.Boolean,
  repositories: Schema.Array(
    Schema.Struct({
      repositoryId: Schema.String,
      name: Schema.String,
      commitTemplate: Schema.String,
      pullRequestTitle: Schema.String,
      pullRequestBody: Schema.String,
      reviewers: Schema.Array(Schema.String),
      requireApproval: Schema.Boolean,
      pushSteps: Schema.Array(PushStepBefore),
    }),
  ),
})

const readRulesBefore = Schema.decodeUnknownResult(Schema.fromJsonString(RulesBefore))
const readPreparationBefore = Schema.decodeUnknownResult(
  Schema.fromJsonString(PreparationCopyBefore),
)
const readRules = Schema.decodeUnknownResult(DeliveryRulesJson)
const readCopy = Schema.decodeUnknownResult(SectionCopyJson)

// ——— The upgrade ———

/** A push step without its placement: the moment that holds it says where it runs. */
const placed = (step: PushStepBefore): DeliveryAction => ({
  id: step.id,
  kind: step.kind,
  mode: step.mode,
})

const commitAction = (id: string): DeliveryAction => ({
  id,
  kind: 'commit-by-hemera',
  mode: 'auto',
})

/** What Hemera committed for under `at-push`: a push, or the local merge of Local. */
const delivers = (step: DeliveryAction) =>
  step.kind === 'push' || (step.kind === 'merge' && step.method === 'local')

/** An id for the commit before `step`, of its own among those taken, and now taken. */
function commitIdFor(step: { readonly id: string }, taken: Set<string>): string {
  const wanted = taken.has('commit') ? `commit-${step.id}` : 'commit'
  let id = wanted
  for (let count = 2; taken.has(id); count += 1) id = `${wanted}-${String(count)}`
  taken.add(id)
  return id
}

/** Each action that delivers, preceded by Hemera's commit; a push of the base by its own. */
const committedBefore = (
  steps: ReadonlyArray<DeliveryAction>,
  taken: Set<string>,
  pairs: ReadonlyMap<string, string>,
): DeliveryAction[] =>
  steps.flatMap((step) =>
    delivers(step) ? [commitAction(pairs.get(step.id) ?? commitIdFor(step, taken)), step] : [step],
  )

interface Changes {
  off: string[]
  changed: DeliveryAction[]
  added: Array<{ after: string | null; step: DeliveryAction }>
}

const noChanges = (): Changes => ({ off: [], changed: [], added: [] })

/** The rules of the shape before, as they read today. */
function upgradeRules(before: RulesBefore): DeliveryRules {
  const atPush = before.commitRule === 'at-push'
  const base = before.preparation.pushSteps
  const presets = before.waves.presets
  const shared = new Set([
    ...base.map((step) => step.id),
    ...presets.library.map((step) => step.id),
    ...presets.application.map((step) => step.id),
  ])
  // The commit before each push of the base: one id, whichever preset holds it.
  const pairs = new Map(
    base.flatMap((step) =>
      atPush && step.kind === 'push' ? [[step.id, commitIdFor(step, shared)] as const] : [],
    ),
  )
  const review = base.filter((step) => step.placement === 'review').map(placed)
  const late = base.filter((step) => step.placement === 'waves').map(placed)
  const commits = (steps: ReadonlyArray<DeliveryAction>, taken: Set<string>) =>
    atPush ? committedBefore(steps, taken, pairs) : [...steps]
  const local = new Set(presets.local.map((step) => step.id))
  const afterEachTask = (ids: ReadonlyArray<string>): DeliveryAction[] =>
    atPush ? [] : [commitAction(commitIdFor({ id: 'task' }, new Set(ids)))]
  const ids = (steps: ReadonlyArray<{ readonly id: string }>) => steps.map((step) => step.id)
  const tasks: PresetStacks = {
    library: afterEachTask([...ids(base), ...ids(presets.library)]),
    application: afterEachTask([...ids(base), ...ids(presets.application)]),
    local: afterEachTask(ids(presets.local)),
  }
  const preparation: PresetStacks = {
    library: commits(review, shared),
    application: commits(review, shared),
    local: [],
  }
  const waves: PresetStacks = {
    library: commits([...late, ...presets.library], shared),
    application: commits([...late, ...presets.application], shared),
    local: commits(presets.local, local),
  }

  const repositoryWaves = [...before.waves.repositories]
  const repositories = before.preparation.repositories.map(({ pushSteps, ...fields }) => {
    const known = repositoryWaves.findIndex((one) => one.repositoryId === fields.repositoryId)
    // Under Local the push steps of the base never applied: only what the repository added did.
    const isLocal = repositoryWaves[known]?.preset === 'local'
    const inReview = noChanges()
    const inWaves = noChanges()
    const into = (placement: PushStepBefore['placement']) =>
      placement === 'review' ? inReview : inWaves
    const placementOf = new Map<string, PushStepBefore['placement']>([
      ...base.map((step) => [step.id, step.placement] as const),
      ...pushSteps.changed.map((step) => [step.id, step.placement] as const),
      ...pushSteps.added.map((one) => [one.step.id, one.step.placement] as const),
    ])
    const lastInReview = review.at(-1)?.id ?? null
    const taken = new Set([...shared, ...pairs.values(), ...placementOf.keys()])
    const leaveOut = (step: PushStepBefore) => {
      const changes = into(step.placement)
      changes.off.push(step.id)
      const pair = pairs.get(step.id)
      if (pair !== undefined) changes.off.push(pair)
    }
    const add = (step: PushStepBefore, anchor: string | null) => {
      const changes = into(step.placement)
      let after =
        anchor === null || placementOf.get(anchor) === step.placement
          ? anchor
          : step.placement === 'review'
            ? lastInReview
            : null
      if (atPush && step.kind === 'push') {
        const id = commitIdFor(step, taken)
        changes.added.push({ after, step: commitAction(id) })
        after = id
      }
      changes.added.push({ after, step: placed(step) })
    }
    for (const id of isLocal ? [] : pushSteps.off) {
      const step = base.find((one) => one.id === id)
      if (step !== undefined) leaveOut(step)
    }
    for (const step of isLocal ? [] : pushSteps.changed) {
      const from = base.find((one) => one.id === step.id)
      if (from === undefined) continue
      if (from.placement === step.placement) {
        into(step.placement).changed.push(placed(step))
        continue
      }
      leaveOut(from)
      add(step, null)
    }
    for (const one of pushSteps.added) add(one.step, one.after)

    if (inWaves.off.length + inWaves.changed.length + inWaves.added.length > 0) {
      const own = repositoryWaves[known]
      const merged: Overrides<DeliveryAction> = {
        off: [...inWaves.off, ...(own?.steps.off ?? [])],
        changed: [...inWaves.changed, ...(own?.steps.changed ?? [])],
        added: [...inWaves.added, ...(own?.steps.added ?? [])],
      }
      const next = {
        repositoryId: fields.repositoryId,
        preset: own?.preset ?? 'application',
        steps: merged,
        deliversAfter: own?.deliversAfter ?? [],
      }
      if (own === undefined) repositoryWaves.push(next)
      else repositoryWaves[known] = next
    }
    return { ...fields, steps: inReview }
  })

  return {
    version: before.version,
    savedAt: before.savedAt,
    tasks: { presets: tasks, repositories: [] },
    preparation: {
      reviewDrafts: before.preparation.reviewDrafts,
      presets: preparation,
      repositories,
    },
    waves: { presets: waves, repositories: repositoryWaves },
    end: before.end,
  }
}

// ——— Reading ———

/**
 * Rules read from their document, of today's shape or of the shape before (upgraded as read): a
 * key the model does not have (one trying to remove Closing) is refused, not dropped.
 */
export const decodeDeliveryRules = (document: string) => {
  const read = readRules(document, strict)
  if (Result.isSuccess(read)) return read
  const before = readRulesBefore(document, strict)
  return Result.isSuccess(before) ? Result.succeed(upgradeRules(before.success)) : read
}

/**
 * The copies of one mission read from their documents, in the order given; none where one does
 * not read. A preparation copy of the shape before reads with Hemera's commit before each push;
 * its pushes after Ship go to the front of the waves copy given beside it.
 */
export function decodeSectionCopies(
  documents: ReadonlyArray<string>,
): Array<Option.Option<SectionCopy>> {
  const lateSteps = new Map<string, DeliveryAction[]>()
  const read = documents.map((document): Option.Option<SectionCopy> => {
    const now = readCopy(document, strict)
    if (Result.isSuccess(now)) return Option.some(now.success)
    const before = readPreparationBefore(document, strict)
    if (Result.isFailure(before)) return Option.none()
    const copy = before.success
    return Option.some({
      ...copy,
      repositories: copy.repositories.map((repository) => {
        const taken = new Set(repository.pushSteps.map((step) => step.id))
        const inPlace = (placement: PushStepBefore['placement']) =>
          committedBefore(
            repository.pushSteps.filter((step) => step.placement === placement).map(placed),
            taken,
            new Map(),
          )
        lateSteps.set(repository.repositoryId, inPlace('waves'))
        return {
          repositoryId: repository.repositoryId,
          name: repository.name,
          commitTemplate: repository.commitTemplate,
          pullRequestTitle: repository.pullRequestTitle,
          pullRequestBody: repository.pullRequestBody,
          reviewers: repository.reviewers,
          requireApproval: repository.requireApproval,
          steps: inPlace('review'),
        }
      }),
    })
  })
  return read.map((one) =>
    Option.map(one, (copy) =>
      copy.section === 'waves'
        ? {
            ...copy,
            repositories: copy.repositories.map((repository) => ({
              ...repository,
              steps: [...(lateSteps.get(repository.repositoryId) ?? []), ...repository.steps],
            })),
          }
        : copy,
    ),
  )
}
