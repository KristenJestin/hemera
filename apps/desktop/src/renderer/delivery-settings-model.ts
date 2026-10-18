/**
 * The delivery rules of a Project's settings (#465), between the engine's model (#340, #429) and
 * the section #250 drew: the rules the engine keeps, drawn moment by moment with where each step
 * comes from, and each edit of the section written back into those rules, as plain functions.
 *
 * What the section shows once for the Project (the templates, the reviewers, the approval) the
 * engine keeps per repository: it is read from the first repository and written to every one. The
 * effective stacks are the engine's own (`effectiveRepositories`); this file only adds where each
 * step comes from. No Effect, no React.
 */

import {
  CLEANUP_KINDS,
  DEFAULT_COMMIT_TEMPLATE,
  DEFAULT_PULL_REQUEST_BODY,
  DEFAULT_PULL_REQUEST_TITLE,
  DELIVERY_MOMENTS,
  DeliveryAction,
  ROOT_REPOSITORY,
  effectiveRepositories,
  type DeliveryDependency,
  type DeliveryMoment,
  type DeliveryPreset,
  type DeliveryProblem,
  type DeliveryProject,
  type DeliveryRulesDraft,
  type EffectiveRepository,
  type RepositoryPreparation,
  type RepositoryWaves,
} from '@hemera/core/domain'
import {
  DeliveryRulesRefused,
  type Command,
  type DeliveryRulesView,
  type ForgeName,
  type ForgeRepositoryStatus,
  type Project,
} from '@hemera/ipc'
import { Schema } from 'effect'
import {
  STEP_WORDS,
  type CleanupStep,
  type DeliveryDependencyShown,
  type DeliveryRecipeStep,
  type DeliveryRefusals,
  type DeliveryRepositoryShown,
  type DeliveryRulesShown,
  type DeliveryStep,
  type ForgeKind,
  type ForgeView,
  type Moment,
  type PullRequestRules,
  type StepConfig,
} from '@hemera/ui'

import type { Link } from './link.ts'

/** What the section is drawn from: the engine's answers, and the rules being edited. */
export interface DeliveryWorld {
  readonly project: Project
  /** The rules as edited: the engine's, or a draft it refused, kept to be mended. */
  readonly draft: DeliveryRulesDraft
  /** Proposed from the manifests, never saved until accepted. */
  readonly proposed: ReadonlyArray<DeliveryDependency>
  /** Null while the forges are being read. */
  readonly forges: ReadonlyArray<ForgeRepositoryStatus> | null
  /** Each repository's remotes, by id, once read. */
  readonly remotes: ReadonlyMap<string, ReadonlyArray<string>>
  readonly commands: ReadonlyArray<Command>
  /** Why the engine refuses the draft; none when it can be saved. */
  readonly problems: ReadonlyArray<DeliveryProblem>
}

/** The section as it is drawn, and the refusals that have no place of their own. */
export interface DeliveryShown {
  readonly rules: DeliveryRulesShown
  readonly refusals: DeliveryRefusals
  /** Said under the section's head: a refusal of a cleanup step, a template, a dependency. */
  readonly elsewhere: string | undefined
}

type Overrides = RepositoryWaves['steps']
type PreparationPart = Partial<
  Pick<
    RepositoryPreparation,
    'commitTemplate' | 'pullRequestTitle' | 'pullRequestBody' | 'reviewers' | 'requireApproval'
  >
>

const NO_OVERRIDES: Overrides = { off: [], changed: [], added: [] }

const MOMENT_SHOWN: Readonly<Record<DeliveryMoment, Moment>> = {
  tasks: 'tasks',
  preparation: 'review',
  waves: 'waves',
}

const FORGE_KINDS: Readonly<Record<ForgeName, ForgeKind>> = {
  github: 'github',
  'bitbucket-cloud': 'bitbucket-cloud',
  'bitbucket-datacenter': 'bitbucket-dc',
  none: 'none',
  // A host no forge was read on: nothing to reach, as the section can say it.
  unknown: 'none',
}

/** The steps Push and open moves: Hemera's commit, the push and the pull request. */
const PUSHED_KINDS: ReadonlySet<string> = new Set(['commit-by-hemera', 'push', 'pull-request'])

/** The presets that push and open pull requests; Local merges on this machine. */
const PUSHING_PRESETS: ReadonlyArray<DeliveryPreset> = ['library', 'application']

/** The same action, whatever order its fields were written in. */
const sameValue = Schema.toEquivalence(DeliveryAction)

/** The Project as the rules are resolved against it: each repository's forge, the commands. */
export function deliveryProjectOf(
  world: Pick<DeliveryWorld, 'project' | 'forges' | 'commands'>,
): DeliveryProject {
  return {
    repositories: world.project.repositories.map((repository) => ({
      id: repository.id,
      name: repository.path === ROOT_REPOSITORY ? world.project.name : repository.path,
      forge: world.forges?.find((one) => one.repositoryId === repository.id)?.forge ?? 'unknown',
      capabilities: { runWorkflow: false, approveManualStep: false },
    })),
    commandIds: world.commands.map((command) => command.id),
  }
}

// ——— Reading ———

const preparationIn = (draft: DeliveryRulesDraft, repositoryId: string): RepositoryPreparation =>
  draft.preparation.repositories.find((one) => one.repositoryId === repositoryId) ?? {
    repositoryId,
    commitTemplate: DEFAULT_COMMIT_TEMPLATE,
    pullRequestTitle: DEFAULT_PULL_REQUEST_TITLE,
    pullRequestBody: DEFAULT_PULL_REQUEST_BODY,
    reviewers: [],
    requireApproval: false,
    steps: NO_OVERRIDES,
  }

const wavesIn = (
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  repositoryId: string,
): RepositoryWaves =>
  draft.waves.repositories.find((one) => one.repositoryId === repositoryId) ?? {
    repositoryId,
    // The engine's default: Local without a forge, Application otherwise.
    preset:
      project.repositories.find((one) => one.id === repositoryId)?.forge === 'none'
        ? 'local'
        : 'application',
    steps: NO_OVERRIDES,
    deliversAfter: [],
  }

const overridesIn = (
  draft: DeliveryRulesDraft,
  moment: DeliveryMoment,
  repositoryId: string,
): Overrides =>
  draft[moment].repositories.find((one) => one.repositoryId === repositoryId)?.steps ?? NO_OVERRIDES

/** A command of the catalogue by its id, as the section names it. */
const nameOf = (commands: ReadonlyArray<Command>, id: string): string =>
  commands.find((one) => one.id === id)?.name ?? id

const idOf = (commands: ReadonlyArray<Command>, name: string): string =>
  commands.find((one) => one.name === name)?.id ?? name

/** What a step does, as the section's forms hold it. */
export function configOf(action: DeliveryAction, commands: ReadonlyArray<Command>): StepConfig {
  switch (action.kind) {
    case 'bump':
      return action.how.by === 'command'
        ? { kind: 'bump', how: 'command', command: nameOf(commands, action.how.commandId) }
        : { kind: 'bump', how: 'agent', command: null }
    case 'merge':
      return action.method === 'local'
        ? { kind: 'local-merge' }
        : { kind: 'merge', method: action.method }
    case 'remote-action': {
      const { action: remote } = action
      switch (remote.type) {
        case 'run-workflow':
          return { kind: 'remote-action', action: remote.workflow }
        case 'run-pipeline':
          return { kind: 'remote-action', action: remote.pipeline }
        case 'approve-deployment':
          return { kind: 'remote-action', action: remote.environment }
      }
      break
    }
    case 'published-version': {
      const { detect } = action
      switch (detect.by) {
        case 'tag':
          return { kind: 'published', by: 'tag', pattern: detect.pattern }
        case 'registry':
          return { kind: 'published', by: 'registry', pattern: detect.packageName ?? '' }
        case 'confirm':
          return { kind: 'published', by: 'confirm', pattern: '' }
      }
      break
    }
    case 'command':
      return { kind: 'command', command: nameOf(commands, action.commandId) }
    case 'agent':
      return { kind: 'agent', task: action.task }
    case 'confirm':
      return { kind: 'confirm', what: action.what }
    default:
      return { kind: action.kind }
  }
}

/** What an action is written as, from what a form holds. */
export interface ActionContext {
  readonly commands: ReadonlyArray<Command>
  /** The forge of the repository it runs in: an action on the remote is its forge's own. */
  readonly forge: ForgeName
  /** The action it was before the form changed it, if it was one. */
  readonly before: DeliveryAction | undefined
}

/** A step of a form written as the engine keeps it. */
export function actionOf(
  config: StepConfig,
  start: DeliveryAction['mode'],
  id: string,
  context: ActionContext,
): DeliveryAction {
  const fields = { id, mode: start }
  switch (config.kind) {
    case 'bump':
      return {
        ...fields,
        kind: 'bump',
        how:
          config.how === 'command'
            ? { by: 'command', commandId: idOf(context.commands, config.command ?? '') }
            : { by: 'agent' },
      }
    case 'merge':
      return { ...fields, kind: 'merge', method: config.method }
    case 'local-merge':
      return { ...fields, kind: 'merge', method: 'local' }
    case 'remote-action': {
      const { before } = context
      if (before?.kind === 'remote-action') {
        const { action } = before
        switch (action.type) {
          case 'run-workflow':
            return {
              ...fields,
              kind: 'remote-action',
              action: { ...action, workflow: config.action },
            }
          case 'run-pipeline':
            return {
              ...fields,
              kind: 'remote-action',
              action: { ...action, pipeline: config.action },
            }
          case 'approve-deployment':
            return {
              ...fields,
              kind: 'remote-action',
              action: { ...action, environment: config.action },
            }
        }
      }
      return context.forge === 'bitbucket-cloud'
        ? {
            ...fields,
            kind: 'remote-action',
            action: { type: 'run-pipeline', pipeline: config.action },
          }
        : {
            ...fields,
            kind: 'remote-action',
            action: { type: 'run-workflow', workflow: config.action, inputs: {} },
          }
    }
    case 'published':
      switch (config.by) {
        case 'tag':
          return {
            ...fields,
            kind: 'published-version',
            detect: { by: 'tag', pattern: config.pattern },
          }
        case 'registry':
          return {
            ...fields,
            kind: 'published-version',
            detect: {
              by: 'registry',
              packageName: config.pattern.trim() === '' ? null : config.pattern.trim(),
            },
          }
        case 'confirm':
          return { ...fields, kind: 'published-version', detect: { by: 'confirm' } }
      }
      break
    case 'command':
      return { ...fields, kind: 'command', commandId: idOf(context.commands, config.command) }
    case 'agent':
      return { ...fields, kind: 'agent', task: config.task }
    case 'confirm':
      return { ...fields, kind: 'confirm', what: config.what }
    default:
      return { ...fields, kind: config.kind }
  }
}

const stepOf = (action: DeliveryAction, commands: ReadonlyArray<Command>): DeliveryStep => ({
  id: action.id,
  start: action.mode,
  config: configOf(action, commands),
})

interface Placed {
  readonly action: DeliveryAction
  readonly origin: DeliveryRecipeStep['origin']
  readonly moment: DeliveryMoment
}

/**
 * One moment of a repository as the engine resolves it (`applyOverrides`), with each step's origin
 * and the steps left out in their place.
 */
function placedIn(
  base: ReadonlyArray<DeliveryAction>,
  overrides: Overrides,
  moment: DeliveryMoment,
): Placed[] {
  const known = new Set([
    ...base.map((step) => step.id),
    ...overrides.added.map((one) => one.step.id),
  ])
  const placed = new Set<number>()
  const after = (anchor: string | null): Placed[] => {
    const steps: Placed[] = []
    for (const [index, one] of overrides.added.entries()) {
      if (one.after !== anchor || placed.has(index)) continue
      placed.add(index)
      steps.push({ action: one.step, origin: 'added', moment }, ...after(one.step.id))
    }
    return steps
  }
  const steps = after(null)
  const changedById = new Map(overrides.changed.map((one) => [one.id, one]))
  const off = new Set(overrides.off)
  for (const step of base) {
    const changed = changedById.get(step.id)
    if (off.has(step.id)) steps.push({ action: step, origin: 'omitted', moment })
    else if (changed === undefined) steps.push({ action: step, origin: 'preset', moment })
    else steps.push({ action: changed, origin: 'changed', moment })
    steps.push(...after(step.id))
  }
  for (const one of overrides.added) {
    if (one.after !== null && !known.has(one.after)) steps.push(...after(one.after))
  }
  return steps
}

/** Every step of a repository, moment by moment, as the section shows them. */
function placedOf(
  draft: DeliveryRulesDraft,
  effective: EffectiveRepository,
  fed: boolean,
): Placed[] {
  return DELIVERY_MOMENTS.flatMap((moment) => {
    const kept = new Set(effective.stacks[moment].map((step) => step.id))
    return placedIn(
      draft[moment].presets[effective.preset],
      overridesIn(draft, moment, effective.repositoryId),
      moment,
    ).filter((one) =>
      // A preset's bump left out stays out of sight where nothing upstream publishes, as it does
      // when it is kept.
      one.origin === 'omitted' ? fed || one.action.kind !== 'bump' : kept.has(one.action.id),
    )
  })
}

function forgeViewOf(
  status: ForgeRepositoryStatus | undefined,
  reading: boolean,
  remote: string | null,
): ForgeView {
  if (status === undefined) {
    return { kind: remote === null ? 'none' : 'github', host: '', forced: false, cli: null }
  }
  return {
    kind: FORGE_KINDS[status.forge],
    host: status.host ?? '',
    forced: status.forced,
    cli: reading ? null : status.state === 'not-needed' ? 'ready' : status.state,
    fix: status.fix ?? undefined,
    sentence: undefined,
  }
}

/** The repositories by wave, in the order they deliver; null when a cycle leaves no order. */
function wavesOf(
  paths: ReadonlyArray<string>,
  dependencies: ReadonlyArray<DeliveryDependencyShown>,
): string[][] | null {
  const kept = dependencies.filter((one) => !one.proposed)
  const placed = new Set<string>()
  const waves: string[][] = []
  while (placed.size < paths.length) {
    const wave = paths.filter(
      (path) =>
        !placed.has(path) &&
        kept.filter((one) => one.repository === path).every((one) => placed.has(one.on)),
    )
    if (wave.length === 0) return null
    for (const path of wave) placed.add(path)
    waves.push(wave)
  }
  return waves
}

/** Where Push and open stands, read from the presets that push; how it starts, from its push. */
function pushOf(draft: DeliveryRulesDraft): Pick<PullRequestRules, 'placement' | 'start'> {
  for (const preset of PUSHING_PRESETS.toReversed()) {
    for (const moment of ['preparation', 'waves'] as const) {
      const push = draft[moment].presets[preset].find((step) => step.kind === 'push')
      if (push !== undefined) {
        return { placement: moment === 'preparation' ? 'review' : 'waves', start: push.mode }
      }
    }
  }
  return { placement: 'review', start: 'click' }
}

const joined = (sentences: ReadonlyArray<string>): string | undefined =>
  sentences.length === 0 ? undefined : [...new Set(sentences)].join(' ')

/** The section drawn from the engine's rules, each refusal at its place. */
export function shownOf(world: DeliveryWorld): DeliveryShown {
  const { project, draft, commands, problems } = world
  const delivery = deliveryProjectOf(world)
  const effective = effectiveRepositories(draft, delivery)
  const publishes = (id: string) =>
    effective.some(
      (one) =>
        one.repositoryId === id &&
        DELIVERY_MOMENTS.some((moment) =>
          one.stacks[moment].some((step) => step.kind === 'published-version'),
        ),
    )
  const pathOf = (id: string) => project.repositories.find((one) => one.id === id)?.path ?? id
  const placedRefusals = new Set<DeliveryProblem>()
  const repositories = project.repositories.flatMap((repository): DeliveryRepositoryShown[] => {
    const resolved = effective.find((one) => one.repositoryId === repository.id)
    if (resolved === undefined) return []
    const status = world.forges?.find((one) => one.repositoryId === repository.id)
    const steps = placedOf(draft, resolved, resolved.deliversAfter.some(publishes)).map(
      (one): DeliveryRecipeStep => {
        const refusals = problems.filter(
          (problem) =>
            problem.repositoryId === repository.id &&
            problem.stepId === one.action.id &&
            one.origin !== 'omitted',
        )
        for (const problem of refusals) placedRefusals.add(problem)
        return {
          step: stepOf(one.action, commands),
          origin: one.origin,
          moment: MOMENT_SHOWN[one.moment],
          refused: joined(refusals.map((problem) => problem.sentence)),
        }
      },
    )
    return [
      {
        path: repository.path,
        preset: resolved.preset,
        remote: repository.remote ?? '',
        remotes:
          world.remotes.get(repository.id) ??
          (repository.remote === null ? [] : [repository.remote]),
        base: repository.baseBranch,
        forge: forgeViewOf(status, world.forges === null, repository.remote),
        steps,
      },
    ]
  })
  const accepted = effective.flatMap((one) =>
    one.deliversAfter.map((id): DeliveryDependencyShown => ({
      repository: pathOf(one.repositoryId),
      on: pathOf(id),
      proposed: false,
    })),
  )
  const proposed = world.proposed
    .map((one): DeliveryDependencyShown => ({
      repository: pathOf(one.repositoryId),
      on: pathOf(one.deliversAfter),
      proposed: true,
    }))
    .filter(
      (one) =>
        !accepted.some((other) => other.repository === one.repository && other.on === one.on),
    )
  const dependencies = [...accepted, ...proposed]
  const first = project.repositories[0]
  const preparation = preparationIn(draft, first?.id ?? '')
  const of = (code: DeliveryProblem['code']) => problems.filter((one) => one.code === code)
  const cycle = of('dependency-cycle')
  const approval = of('approval-after-ship')
  for (const problem of [...cycle, ...approval]) placedRefusals.add(problem)
  return {
    rules: {
      pullRequests: {
        ...pushOf(draft),
        commit: preparation.commitTemplate,
        title: preparation.pullRequestTitle,
        body: preparation.pullRequestBody,
        reviewers: preparation.reviewers.map((handle) => ({ handle })),
        requireApproval: preparation.requireApproval,
        reviewDrafts: draft.preparation.reviewDrafts,
      },
      repositories,
      dependencies,
      waves:
        wavesOf(
          repositories.map((one) => one.path),
          dependencies,
        ) ?? [],
      cleanup: draft.end.cleanup.map((action): CleanupStep => {
        const config = configOf(action, commands)
        return {
          id: action.id,
          label: STEP_WORDS[config.kind],
          config: CLEANUP_KINDS.some((kind) => kind === action.kind) ? undefined : config,
        }
      }),
    },
    refusals: {
      dependencies: joined(cycle.map((one) => one.sentence)),
      approval: joined(approval.map((one) => one.sentence)),
    },
    elsewhere: joined(
      problems.filter((one) => !placedRefusals.has(one)).map((one) => one.sentence),
    ),
  }
}

// ——— Editing ———

/** The rules with one repository's part of a moment written, made from its defaults if needed. */
function withRepository(
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  moment: DeliveryMoment,
  repositoryId: string,
  change: (overrides: Overrides) => Overrides,
): DeliveryRulesDraft {
  const upsert = <R extends { readonly repositoryId: string }>(
    list: ReadonlyArray<R>,
    made: R,
  ): R[] =>
    list.some((one) => one.repositoryId === repositoryId)
      ? list.map((one) => (one.repositoryId === repositoryId ? made : one))
      : [...list, made]
  const steps = change(overridesIn(draft, moment, repositoryId))
  switch (moment) {
    case 'tasks':
      return {
        ...draft,
        tasks: {
          ...draft.tasks,
          repositories: upsert(draft.tasks.repositories, { repositoryId, steps }),
        },
      }
    case 'preparation':
      return {
        ...draft,
        preparation: {
          ...draft.preparation,
          repositories: upsert(draft.preparation.repositories, {
            ...preparationIn(draft, repositoryId),
            steps,
          }),
        },
      }
    case 'waves':
      return {
        ...draft,
        waves: {
          ...draft.waves,
          repositories: upsert(draft.waves.repositories, {
            ...wavesIn(draft, project, repositoryId),
            steps,
          }),
        },
      }
  }
}

/** Every repository part of every moment, changed where the repository has one. */
function withEveryPart(
  draft: DeliveryRulesDraft,
  repositoryId: string,
  change: (overrides: Overrides) => Overrides,
): DeliveryRulesDraft {
  const mapped = <R extends { readonly repositoryId: string; readonly steps: Overrides }>(
    list: ReadonlyArray<R>,
  ): R[] =>
    list.map((one) =>
      one.repositoryId === repositoryId ? { ...one, steps: change(one.steps) } : one,
    )
  return {
    ...draft,
    tasks: { ...draft.tasks, repositories: mapped(draft.tasks.repositories) },
    preparation: { ...draft.preparation, repositories: mapped(draft.preparation.repositories) },
    waves: { ...draft.waves, repositories: mapped(draft.waves.repositories) },
  }
}

/** The moment a step of a repository stands in, from its preset or its own. */
function momentOf(
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  repositoryId: string,
  stepId: string,
): DeliveryMoment | undefined {
  const { preset } = wavesIn(draft, project, repositoryId)
  return DELIVERY_MOMENTS.find(
    (moment) =>
      draft[moment].presets[preset].some((step) => step.id === stepId) ||
      overridesIn(draft, moment, repositoryId).added.some((one) => one.step.id === stepId),
  )
}

/** A step of a repository as it runs there: its own, changed, or its preset's. */
export function actionIn(
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  repositoryId: string,
  stepId: string,
): DeliveryAction | undefined {
  const moment = momentOf(draft, project, repositoryId, stepId)
  if (moment === undefined) return undefined
  const overrides = overridesIn(draft, moment, repositoryId)
  return (
    overrides.added.find((one) => one.step.id === stepId)?.step ??
    overrides.changed.find((one) => one.id === stepId) ??
    draft[moment].presets[wavesIn(draft, project, repositoryId).preset].find(
      (one) => one.id === stepId,
    )
  )
}

/** A repository takes a preset: its recipe is the preset's again, every change of it dropped. */
export function withPreset(
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  repositoryId: string,
  preset: DeliveryPreset,
): DeliveryRulesDraft {
  const cleared = withEveryPart(draft, repositoryId, () => NO_OVERRIDES)
  const waves = { ...wavesIn(cleared, project, repositoryId), preset, steps: NO_OVERRIDES }
  return {
    ...cleared,
    waves: {
      ...cleared.waves,
      repositories: cleared.waves.repositories.some((one) => one.repositoryId === repositoryId)
        ? cleared.waves.repositories.map((one) => (one.repositoryId === repositoryId ? waves : one))
        : [...cleared.waves.repositories, waves],
    },
  }
}

/** A step left out is the preset's again. */
export const withStepPutBack = (
  draft: DeliveryRulesDraft,
  repositoryId: string,
  stepId: string,
): DeliveryRulesDraft =>
  withEveryPart(draft, repositoryId, (overrides) => ({
    ...overrides,
    off: overrides.off.filter((id) => id !== stepId),
  }))

/** A step changed is the preset's again. */
export const withStepReset = (
  draft: DeliveryRulesDraft,
  repositoryId: string,
  stepId: string,
): DeliveryRulesDraft =>
  withEveryPart(draft, repositoryId, (overrides) => ({
    ...overrides,
    changed: overrides.changed.filter((one) => one.id !== stepId),
  }))

/** A step written: a step of its own replaced, a preset's kept as a change only where it differs. */
export function withStepSaved(
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  repositoryId: string,
  step: DeliveryAction,
): DeliveryRulesDraft {
  const moment = momentOf(draft, project, repositoryId, step.id)
  if (moment === undefined) return draft
  const { preset } = wavesIn(draft, project, repositoryId)
  const base = draft[moment].presets[preset].find((one) => one.id === step.id)
  return withRepository(draft, project, moment, repositoryId, (overrides) => {
    if (base === undefined) {
      return {
        ...overrides,
        added: overrides.added.map((one) => (one.step.id === step.id ? { ...one, step } : one)),
      }
    }
    const others = overrides.changed.filter((one) => one.id !== step.id)
    return { ...overrides, changed: sameValue(base, step) ? others : [...others, step] }
  })
}

/** A step removed: a preset's left out in this repository, its own taken away. */
export function withStepRemoved(
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  repositoryId: string,
  stepId: string,
): DeliveryRulesDraft {
  const moment = momentOf(draft, project, repositoryId, stepId)
  if (moment === undefined) return draft
  return withRepository(draft, project, moment, repositoryId, (overrides) => {
    const own = overrides.added.find((one) => one.step.id === stepId)
    if (own === undefined) {
      return {
        ...overrides,
        off: overrides.off.includes(stepId) ? overrides.off : [...overrides.off, stepId],
        changed: overrides.changed.filter((one) => one.id !== stepId),
      }
    }
    // What came after it keeps its place: after what it came after.
    return {
      ...overrides,
      added: overrides.added
        .filter((one) => one !== own)
        .map((one) => (one.after === stepId ? Object.assign({}, one, { after: own.after }) : one)),
    }
  })
}

/** An id of the step's kind that no other step of the repository holds. */
function freshId(kind: string, taken: ReadonlySet<string>): string {
  if (!taken.has(kind)) return kind
  let count = 2
  while (taken.has(`${kind}-${String(count)}`)) count += 1
  return `${kind}-${String(count)}`
}

/**
 * A step of the repository's own added to a moment: after a step (null: first), or last when no
 * place is named; its id its own, unless another step of the repository holds it.
 */
export function withStepAdded(
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  repositoryId: string,
  moment: DeliveryMoment,
  after: string | null | undefined,
  step: DeliveryAction,
): DeliveryRulesDraft {
  const { preset } = wavesIn(draft, project, repositoryId)
  const taken = new Set(
    DELIVERY_MOMENTS.flatMap((one) =>
      draft[one].presets[preset]
        .map((base) => base.id)
        .concat(overridesIn(draft, one, repositoryId).added.map((own) => own.step.id)),
    ),
  )
  const id = step.id !== '' && !taken.has(step.id) ? step.id : freshId(step.kind, taken)
  const last =
    placedIn(draft[moment].presets[preset], overridesIn(draft, moment, repositoryId), moment).at(-1)
      ?.action.id ?? null
  return withRepository(draft, project, moment, repositoryId, (overrides) => ({
    ...overrides,
    added: [
      ...overrides.added,
      { after: after === undefined ? last : after, step: { ...step, id } },
    ],
  }))
}

/** The templates, the reviewers or the approval, the same for every repository. */
export function withPreparation(
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  part: PreparationPart,
): DeliveryRulesDraft {
  const ids = project.repositories.map((one) => one.id)
  const named = new Set(ids)
  const others = draft.preparation.repositories.filter((one) => !named.has(one.repositoryId))
  return {
    ...draft,
    preparation: {
      ...draft.preparation,
      repositories: [
        ...ids.map((id) => Object.assign({}, preparationIn(draft, id), part)),
        ...others,
      ],
    },
  }
}

/** A template of the pull requests' part, the same for every repository. */
export function withTemplate(
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  kind: 'commit' | 'title' | 'body',
  value: string,
): DeliveryRulesDraft {
  switch (kind) {
    case 'commit':
      return withPreparation(draft, project, { commitTemplate: value })
    case 'title':
      return withPreparation(draft, project, { pullRequestTitle: value })
    case 'body':
      return withPreparation(draft, project, { pullRequestBody: value })
  }
}

export const withReviewDrafts = (draft: DeliveryRulesDraft, on: boolean): DeliveryRulesDraft => ({
  ...draft,
  preparation: { ...draft.preparation, reviewDrafts: on },
})

/**
 * Push and open moved to a moment, starting as said: Hemera's commit, the push and the pull
 * request of each preset that pushes, and what each repository changed of them, go with it.
 */
export function withPushIn(
  draft: DeliveryRulesDraft,
  project: DeliveryProject,
  placement: PullRequestRules['placement'],
  start: DeliveryAction['mode'],
): DeliveryRulesDraft {
  const from: DeliveryMoment = placement === 'waves' ? 'preparation' : 'waves'
  const to: DeliveryMoment = placement === 'waves' ? 'waves' : 'preparation'
  const started = (step: DeliveryAction): DeliveryAction =>
    step.kind === 'push' || step.kind === 'pull-request' ? { ...step, mode: start } : step
  const leaving: Record<DeliveryPreset, ReadonlyArray<DeliveryAction>> = { ...draft[from].presets }
  const arriving: Record<DeliveryPreset, ReadonlyArray<DeliveryAction>> = { ...draft[to].presets }
  const movedIds = new Set<string>()
  for (const preset of PUSHING_PRESETS) {
    const moving = leaving[preset].filter((step) => PUSHED_KINDS.has(step.kind))
    const there = arriving[preset].map(started)
    leaving[preset] = leaving[preset].filter((step) => !PUSHED_KINDS.has(step.kind))
    arriving[preset] =
      to === 'waves' ? moving.map(started).concat(there) : there.concat(moving.map(started))
    for (const step of moving) movedIds.add(step.id)
  }
  let next: DeliveryRulesDraft = {
    ...draft,
    [from]: { ...draft[from], presets: leaving },
    [to]: { ...draft[to], presets: arriving },
  }
  for (const repository of project.repositories) {
    const { preset } = wavesIn(next, project, repository.id)
    if (!PUSHING_PRESETS.includes(preset)) continue
    const left = overridesIn(next, from, repository.id)
    const moves = (id: string) => movedIds.has(id)
    const carried: Overrides = {
      off: left.off.filter(moves),
      changed: left.changed.filter((step) => moves(step.id)).map(started),
      added: left.added.filter((one) => one.after !== null && moves(one.after)),
    }
    if (carried.off.length + carried.changed.length + carried.added.length === 0) continue
    const carriedAdded = new Set(carried.added)
    next = withRepository(next, project, from, repository.id, (overrides) => ({
      off: overrides.off.filter((id) => !moves(id)),
      changed: overrides.changed.filter((step) => !moves(step.id)),
      added: overrides.added.filter((one) => !carriedAdded.has(one)),
    }))
    next = withRepository(next, project, to, repository.id, (overrides) => ({
      off: [...overrides.off, ...carried.off],
      changed: [...overrides.changed, ...carried.changed],
      added: [...overrides.added, ...carried.added],
    }))
  }
  return next
}

/** A cleanup step added after the others, under an id no other cleanup step holds. */
export function withCleanupAdded(
  draft: DeliveryRulesDraft,
  step: DeliveryAction,
): DeliveryRulesDraft {
  const taken = new Set(draft.end.cleanup.map((one) => one.id))
  const id = step.id !== '' && !taken.has(step.id) ? step.id : freshId(step.kind, taken)
  return { ...draft, end: { ...draft.end, cleanup: [...draft.end.cleanup, { ...step, id }] } }
}

export const withCleanupSaved = (
  draft: DeliveryRulesDraft,
  step: DeliveryAction,
): DeliveryRulesDraft => ({
  ...draft,
  end: {
    ...draft.end,
    cleanup: draft.end.cleanup.map((one) => (one.id === step.id ? step : one)),
  },
})

export const withCleanupRemoved = (draft: DeliveryRulesDraft, id: string): DeliveryRulesDraft => ({
  ...draft,
  end: { ...draft.end, cleanup: draft.end.cleanup.filter((one) => one.id !== id) },
})

// ——— Writing ———

/** The rules as they are edited: the engine's, or a change it refused, with its reasons. */
export interface Working {
  readonly draft: DeliveryRulesDraft
  /** The version of the rules the change is made on. */
  readonly version: number
  readonly problems: ReadonlyArray<DeliveryProblem>
  /** Whether it holds a change the engine has not saved. */
  readonly edited: boolean
}

/** The rules read, as the editor starts from them: without what a save gives them. */
export const workingOf = ({ rules }: DeliveryRulesView): Working => ({
  draft: { tasks: rules.tasks, preparation: rules.preparation, waves: rules.waves, end: rules.end },
  version: rules.version,
  problems: [],
  edited: false,
})

/** A change saved, or kept with the reasons it was refused for. */
export type Written =
  | { readonly kind: 'saved'; readonly view: DeliveryRulesView }
  | { readonly kind: 'kept'; readonly working: Working }

/**
 * A change checked by the engine, then saved on the version it was edited from; refused, at the
 * check or at the save, it is kept with every reason. Any other refusal rejects.
 */
export function writeRules(
  link: Pick<Link, 'validateDeliveryRules' | 'saveDeliveryRules'>,
  projectId: string,
  before: Working,
  draft: DeliveryRulesDraft,
): Promise<Written> {
  const kept = (problems: ReadonlyArray<DeliveryProblem>): Written => ({
    kind: 'kept',
    working: { draft, version: before.version, problems, edited: true },
  })
  return link.validateDeliveryRules(projectId, draft).then((problems) =>
    problems.length > 0
      ? kept(problems)
      : link.saveDeliveryRules(projectId, draft, before.version).then(
          (view): Written => ({ kind: 'saved', view }),
          (failure: Error) => {
            if (failure instanceof DeliveryRulesRefused) return kept(failure.problems)
            throw failure
          },
        ),
  )
}
