/**
 * A Project's delivery rules (#340, #422): how a mission's work leaves its Workspace and how a
 * mission ends, as data. Running them is other tickets' work; this is the model, its presets, the
 * checks that refuse inconsistent rules, the templates, and the sections a mission copies when
 * they start acting.
 *
 * The rules come in moments, each a free stack of actions taken from one catalogue, or nothing:
 *
 * - **after each task**, during Building;
 * - **the preparation**, in Review, before Ship; with it, per repository, the templates of the
 *   commit and of the pull request, its reviewers and whether team approval is required before
 *   Ship, and whether the drafts are reviewed;
 * - **the waves**, per repository, after Ship, in the order the dependencies give: its preset and
 *   the repositories it delivers after;
 * - **the End**: Closing, fixed (the model has no way to remove it), then Cleanup, a stack.
 *
 * Every moment accepts every action of the catalogue, committing included: "Hemera commits", "I
 * commit myself" and "an agent commits" are three actions, placed where the user wants them. The
 * checks explain what does not hold (a pull request with no push before it, a merge with no pull
 * request); they never take an action away from the catalogue.
 *
 * The Project keeps a starting stack per preset in each moment of a repository; a repository takes
 * a preset and keeps only what it changes in each moment: an action left out (`off`), an action
 * changed (`changed`), an action of its own inserted after another (`added`). Cleanup is the
 * Project's, for every repository. The effective stacks of a repository are computed, never stored
 * twice. A repository the rules do not name yet takes the defaults: Local when it has no forge,
 * Application otherwise.
 *
 * Pure rules: the engine stores them, reads the forges and the catalogue, and copies the sections.
 *
 * The rules and the copies are stored documents, read strictly: a field added later (S2's manifest
 * path, S4's ref and variables) is a `Schema.optionalKey` with a default, so what was stored still
 * reads; a document of another shape is refused, never guessed. #340's shape, with who commits
 * apart and the push steps placed, was never released, so no profile holds it and there is no
 * migration from it. From now on, a change of shape ships a migration of both tables.
 */

import { Option, Schema } from 'effect'

// ——— The values ———

/** How an action starts: by itself, or on a click, which is then a decision need. */
export const STEP_MODES = ['auto', 'click'] as const
export const StepMode = Schema.Literals(STEP_MODES)
export type StepMode = typeof StepMode.Type

/** What a repository delivers as: a library others depend on, an application, or local work. */
export const DELIVERY_PRESETS = ['library', 'application', 'local'] as const
export const DeliveryPreset = Schema.Literals(DELIVERY_PRESETS)
export type DeliveryPreset = typeof DeliveryPreset.Type

/** The moments of a repository, in the order they happen; the End follows, the Project's. */
export const DELIVERY_MOMENTS = ['tasks', 'preparation', 'waves'] as const
export type DeliveryMoment = (typeof DELIVERY_MOMENTS)[number]

/** How a merge is made: through the pull request, or `local` (the Local preset only). */
export const MERGE_METHODS = ['squash', 'merge', 'rebase', 'local'] as const
export const MergeMethod = Schema.Literals(MERGE_METHODS)
export type MergeMethod = typeof MergeMethod.Type

/** The variables a template may use. `{images}` is a slot the pull request's writer fills. */
export const TEMPLATE_VARIABLES = ['key', 'title', 'slug', 'branch', 'summary', 'images'] as const
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]

/** The slot `{images}` stays as in a rendered template. */
export const IMAGES_SLOT = '{images}'

/** Closing: the Spec and its rounds merged into the living spec. Fixed, never removed. */
export const CLOSING = 'merge-spec'

/** The sections of the rules, each copied into a mission when it starts acting (CT-47). */
export const DELIVERY_SECTIONS = ['tasks', 'preparation', 'waves', 'end'] as const
export const DeliverySection = Schema.Literals(DELIVERY_SECTIONS)
export type DeliverySection = typeof DeliverySection.Type

/** The forges of R4 (#253), as the rules read them: `none` has no forge, `unknown` an unread one. */
export const DELIVERY_FORGES = [
  'github',
  'bitbucket-cloud',
  'bitbucket-datacenter',
  'none',
  'unknown',
] as const
export type DeliveryForge = (typeof DELIVERY_FORGES)[number]

const FORGE_NAMES: Readonly<Record<DeliveryForge, string>> = {
  github: 'GitHub',
  'bitbucket-cloud': 'Bitbucket Cloud',
  'bitbucket-datacenter': 'Bitbucket Data Center',
  none: 'none',
  unknown: 'an unknown forge',
}

// ——— The catalogue ———

const stepFields = { id: Schema.String, mode: StepMode }

/** The actions with nothing to configure but how they start. */
const PLAIN_KINDS = [
  /** Hemera commits what the Workspace holds, with the repository's commit template. */
  'commit-by-hemera',
  /** Hemera waits for the user's click, then checks that a new commit exists on the branch. */
  'commit-by-me',
  /**
   * An agent step allowed to run `git commit` in the mission's Workspace, under the permission
   * rules, with the repository's commit template.
   */
  'commit-by-agent',
  /** Pushes the mission's branch to the repository's delivery remote. */
  'push',
  /**
   * Opens the pull request, into the repository's base branch, with the templates and reviewers
   * of the preparation.
   */
  'pull-request',
  /** Waits for the checks of the pushed commit. */
  'ci',
  'pull-main-checkout',
  'stop-services',
  'remove-worktrees',
  'remove-workspace',
] as const

const PlainAction = Schema.Struct({ ...stepFields, kind: Schema.Literals(PLAIN_KINDS) })

/** How dependency versions are moved: by a catalogue command, or by the agent. */
export const BumpHow = Schema.Union([
  Schema.Struct({ by: Schema.Literal('command'), commandId: Schema.String }),
  Schema.Struct({ by: Schema.Literal('agent') }),
])
export type BumpHow = typeof BumpHow.Type

/**
 * Dependency versions updated to what an upstream repository published, pushed on the pull request
 * without a new review; after Ship it may change only dependency manifests and the lockfile.
 */
export const BumpStep = Schema.Struct({ ...stepFields, kind: Schema.Literal('bump'), how: BumpHow })

/** A merge: through the pull request when there is one, after its CI passed; `local` otherwise. */
export const MergeStep = Schema.Struct({
  ...stepFields,
  kind: Schema.Literal('merge'),
  method: MergeMethod,
})

/** What Hemera triggers on the remote, through the forge's CLI, when the forge allows it. */
export const RemoteAction = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('run-workflow'),
    workflow: Schema.String,
    inputs: Schema.Record(Schema.String, Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal('run-pipeline'), pipeline: Schema.String }),
  Schema.Struct({ type: Schema.Literal('approve-deployment'), environment: Schema.String }),
])
export type RemoteAction = typeof RemoteAction.Type

export const RemoteActionStep = Schema.Struct({
  ...stepFields,
  kind: Schema.Literal('remote-action'),
  action: RemoteAction,
})

/**
 * How a published version is seen: a tag matching a pattern, a version on a registry (the package
 * named, or the one the repository's manifest declares when null), or the user's confirmation.
 */
export const PublishedVersionDetect = Schema.Union([
  Schema.Struct({ by: Schema.Literal('tag'), pattern: Schema.String }),
  Schema.Struct({ by: Schema.Literal('registry'), packageName: Schema.NullOr(Schema.String) }),
  Schema.Struct({ by: Schema.Literal('confirm') }),
])

export const PublishedVersionStep = Schema.Struct({
  ...stepFields,
  kind: Schema.Literal('published-version'),
  detect: PublishedVersionDetect,
})

/** A command of the Project's catalogue. It may write to the network (CT-50). */
export const CommandStep = Schema.Struct({
  ...stepFields,
  kind: Schema.Literal('command'),
  commandId: Schema.String,
})

/** A task given to an agent. It may write to the network. */
export const AgentStep = Schema.Struct({
  ...stepFields,
  kind: Schema.Literal('agent'),
  task: Schema.String,
})

/** "I did it", for what Hemera can neither see nor trigger. */
export const ConfirmStep = Schema.Struct({
  ...stepFields,
  kind: Schema.Literal('confirm'),
  what: Schema.String,
})

/** An action of the catalogue: any of them stands in any moment. */
export const DeliveryAction = Schema.Union([
  PlainAction,
  BumpStep,
  MergeStep,
  RemoteActionStep,
  PublishedVersionStep,
  CommandStep,
  AgentStep,
  ConfirmStep,
])
export type DeliveryAction = typeof DeliveryAction.Type
export type ActionKind = DeliveryAction['kind']

/** Every action of the catalogue, by kind, in the order the catalogue offers them. */
export const ACTION_KINDS: ReadonlyArray<ActionKind> = [
  'commit-by-hemera',
  'commit-by-me',
  'commit-by-agent',
  'push',
  'pull-request',
  'bump',
  'merge',
  'ci',
  'remote-action',
  'published-version',
  'command',
  'agent',
  'confirm',
  'pull-main-checkout',
  'stop-services',
  'remove-worktrees',
  'remove-workspace',
]

/** The actions that commit, whoever commits. */
export const COMMIT_KINDS: ReadonlyArray<ActionKind> = [
  'commit-by-hemera',
  'commit-by-me',
  'commit-by-agent',
]

/** The Cleanup actions Hemera knows, beside a catalogue command. */
export const CLEANUP_KINDS = [
  'pull-main-checkout',
  'stop-services',
  'remove-worktrees',
  'remove-workspace',
] as const

/** Whether an action may write to the network whatever it is told: a command, an agent (CT-50). */
export const mayWriteToNetwork = (step: DeliveryAction): boolean =>
  step.kind === 'command' || step.kind === 'agent' || step.kind === 'commit-by-agent'

/**
 * Whether an action is safe to run again after a stop halfway, and the post-condition that says it
 * is done, null when Hemera cannot check it. On a restart, an action with no outcome is checked
 * against its post-condition; one neither safe to run again nor checkable comes back to the user as
 * a decision, never as a blind retry. Running this is the delivery tickets' work.
 *
 * The declaration is per kind, not per variant: a local merge and a squash merge, a bump by command
 * and one by an agent, declare the same, the most careful of their variants. "A new commit since
 * the action started" needs the head at the start recorded with the action.
 */
export interface RetryDeclaration {
  readonly safeToRunAgain: boolean
  readonly postCondition: string | null
}

export const ACTION_RETRIES: Readonly<Record<ActionKind, RetryDeclaration>> = {
  'commit-by-hemera': {
    safeToRunAgain: true,
    postCondition: 'The Workspace has no uncommitted change.',
  },
  'commit-by-me': {
    safeToRunAgain: true,
    postCondition: 'A new commit exists on the branch since the action started.',
  },
  // An agent does more than commit: run again, it may do it twice.
  'commit-by-agent': {
    safeToRunAgain: false,
    postCondition: 'A new commit exists on the branch since the action started.',
  },
  push: { safeToRunAgain: true, postCondition: 'The remote head equals the local head.' },
  'pull-request': {
    safeToRunAgain: false,
    postCondition: 'A pull request from the branch into the base branch is open.',
  },
  bump: {
    safeToRunAgain: false,
    postCondition: 'The manifests name the versions the upstream repositories published.',
  },
  merge: { safeToRunAgain: false, postCondition: 'The branch is merged into the base branch.' },
  ci: { safeToRunAgain: true, postCondition: 'The checks of the pushed commit are green.' },
  'remote-action': { safeToRunAgain: false, postCondition: null },
  'published-version': { safeToRunAgain: true, postCondition: 'The version is seen published.' },
  command: { safeToRunAgain: false, postCondition: null },
  agent: { safeToRunAgain: false, postCondition: null },
  confirm: { safeToRunAgain: true, postCondition: 'The user confirmed it.' },
  'pull-main-checkout': {
    safeToRunAgain: true,
    postCondition: 'The main checkout’s base branch equals its remote’s.',
  },
  'stop-services': { safeToRunAgain: true, postCondition: 'No service of the mission runs.' },
  'remove-worktrees': {
    safeToRunAgain: true,
    postCondition: 'The mission’s worktrees are gone.',
  },
  'remove-workspace': { safeToRunAgain: true, postCondition: 'The mission’s Workspace is gone.' },
}

// ——— Base and overrides ———

/** What a repository changes of a moment's starting stack. */
export const ActionOverrides = Schema.Struct({
  /** The actions of the base it leaves out, by id. */
  off: Schema.Array(Schema.String),
  /** The actions of the base it changes, each as it is here, by id. */
  changed: Schema.Array(DeliveryAction),
  /** Its own actions, each after the one it follows (of the base or its own), null for first. */
  added: Schema.Array(Schema.Struct({ after: Schema.NullOr(Schema.String), step: DeliveryAction })),
})

/** What a repository changes, whatever the steps. */
export interface Overrides<S extends { readonly id: string }> {
  readonly off: ReadonlyArray<string>
  readonly changed: ReadonlyArray<S>
  readonly added: ReadonlyArray<{ readonly after: string | null; readonly step: S }>
}

const NO_OVERRIDES = { off: [], changed: [], added: [] }

/** The starting stack of each preset, in one moment. */
export const PresetStacks = Schema.Struct({
  library: Schema.Array(DeliveryAction),
  application: Schema.Array(DeliveryAction),
  local: Schema.Array(DeliveryAction),
})
export type PresetStacks = typeof PresetStacks.Type

/** What one repository changes after each task. */
export const RepositoryTasks = Schema.Struct({
  repositoryId: Schema.String,
  steps: ActionOverrides,
})
export type RepositoryTasks = typeof RepositoryTasks.Type

/** The preparation of one repository. */
export const RepositoryPreparation = Schema.Struct({
  repositoryId: Schema.String,
  commitTemplate: Schema.String,
  pullRequestTitle: Schema.String,
  pullRequestBody: Schema.String,
  /** Forge users or teams, as the forge names them. */
  reviewers: Schema.Array(Schema.String),
  /** Whether team approval is required before Ship. */
  requireApproval: Schema.Boolean,
  /** What it changes of its preset's preparation. */
  steps: ActionOverrides,
})
export type RepositoryPreparation = typeof RepositoryPreparation.Type

/** The waves of one repository: its preset, what it changes of it, and what it delivers after. */
export const RepositoryWaves = Schema.Struct({
  repositoryId: Schema.String,
  /** The preset of every moment of the repository. */
  preset: DeliveryPreset,
  steps: ActionOverrides,
  /** The repositories it depends on, by id: it leaves only once they have published. */
  deliversAfter: Schema.Array(Schema.String),
})
export type RepositoryWaves = typeof RepositoryWaves.Type

const draftFields = {
  tasks: Schema.Struct({
    presets: PresetStacks,
    repositories: Schema.Array(RepositoryTasks),
  }),
  preparation: Schema.Struct({
    /** When on, the pushes wait for a click that shows the rendered pull requests. */
    reviewDrafts: Schema.Boolean,
    presets: PresetStacks,
    repositories: Schema.Array(RepositoryPreparation),
  }),
  waves: Schema.Struct({
    presets: PresetStacks,
    repositories: Schema.Array(RepositoryWaves),
  }),
  end: Schema.Struct({
    /** Fixed: the model has no way to remove it. */
    closing: Schema.Literal(CLOSING),
    cleanup: Schema.Array(DeliveryAction),
  }),
}

/** The rules as an editor writes them, before a save gives them a version. */
export const DeliveryRulesDraft = Schema.Struct(draftFields)
export type DeliveryRulesDraft = typeof DeliveryRulesDraft.Type

/** A Project's delivery rules: one document, its version incremented at each save. */
export const DeliveryRules = Schema.Struct({
  /** 0 for rules never saved: the defaults. */
  version: Schema.Number,
  savedAt: Schema.NullOr(Schema.String),
  ...draftFields,
})
export type DeliveryRules = typeof DeliveryRules.Type

// ——— The presets ———

/** Hemera's commit, as the presets place it before a push or a local merge. */
const COMMIT: DeliveryAction = { id: 'commit', kind: 'commit-by-hemera', mode: 'auto' }

const PUSH_STEPS: ReadonlyArray<DeliveryAction> = [
  COMMIT,
  { id: 'push', kind: 'push', mode: 'click' },
  { id: 'pull-request', kind: 'pull-request', mode: 'click' },
]

const BUMP: DeliveryAction = { id: 'bump', kind: 'bump', mode: 'auto', how: { by: 'agent' } }
const SQUASH: DeliveryAction = { id: 'merge', kind: 'merge', mode: 'auto', method: 'squash' }
const CI: DeliveryAction = { id: 'ci', kind: 'ci', mode: 'auto' }

/** The template defaults. */
export const DEFAULT_COMMIT_TEMPLATE = '{key}: {title}'
export const DEFAULT_PULL_REQUEST_TITLE = '{key}: {title}'
export const DEFAULT_PULL_REQUEST_BODY = '{summary}\n\n{images}'

/** The rules of a Project that never saved any. */
export function defaultDeliveryRules(): DeliveryRulesDraft {
  return {
    tasks: { presets: { library: [], application: [], local: [] }, repositories: [] },
    preparation: {
      reviewDrafts: false,
      presets: { library: PUSH_STEPS, application: PUSH_STEPS, local: [] },
      repositories: [],
    },
    waves: {
      presets: {
        library: [
          BUMP,
          SQUASH,
          CI,
          {
            id: 'published-version',
            kind: 'published-version',
            mode: 'auto',
            detect: { by: 'registry', packageName: null },
          },
        ],
        application: [BUMP, SQUASH, CI],
        local: [COMMIT, { id: 'merge', kind: 'merge', mode: 'auto', method: 'local' }],
      },
      repositories: [],
    },
    end: {
      closing: CLOSING,
      cleanup: CLEANUP_KINDS.map((kind) => ({ id: kind, kind, mode: 'auto' })),
    },
  }
}

// ——— The effective stacks ———

/** A repository of the Project, as the rules read it: its forge and what the forge allows. */
export interface DeliveryRepository {
  readonly id: string
  /** As the sentences name it: its path, or the Project's name for the main checkout. */
  readonly name: string
  readonly forge: DeliveryForge
  readonly capabilities: { readonly runWorkflow: boolean; readonly approveManualStep: boolean }
}

/** What the rules are checked against: the repositories in order, the catalogue's commands. */
export interface DeliveryProject {
  readonly repositories: ReadonlyArray<DeliveryRepository>
  readonly commandIds: ReadonlyArray<string>
}

/** A base list with a repository's changes applied, in order. */
export function applyOverrides<S extends { readonly id: string }>(
  base: ReadonlyArray<S>,
  overrides: Overrides<S>,
): S[] {
  const known = new Set([
    ...base.map((step) => step.id),
    ...overrides.added.map((one) => one.step.id),
  ])
  // Each added step is placed once: one anchored on itself, or on a step of its own id, cannot
  // loop (the validation refuses both).
  const placed = new Set<number>()
  const after = (anchor: string | null): S[] => {
    const steps: S[] = []
    for (const [index, one] of overrides.added.entries()) {
      if (one.after !== anchor || placed.has(index)) continue
      placed.add(index)
      steps.push(one.step)
      steps.push(...after(one.step.id))
    }
    return steps
  }
  const steps = after(null)
  for (const step of base) {
    if (!overrides.off.includes(step.id)) {
      steps.push(overrides.changed.find((one) => one.id === step.id) ?? step)
    }
    // A step after a base step left out still follows its place.
    steps.push(...after(step.id))
  }
  // A step whose anchor is gone, with a new preset, goes last rather than nowhere.
  const lost = new Set(
    overrides.added.flatMap((one) =>
      one.after !== null && !known.has(one.after) ? [one.after] : [],
    ),
  )
  for (const anchor of lost) steps.push(...after(anchor))
  return steps
}

/** How many things a repository changes of its base. */
export const changesOf = <S extends { readonly id: string }>(overrides: Overrides<S>): number =>
  overrides.off.length + overrides.changed.length + overrides.added.length

/** A repository's stack in each of its moments. */
export const MomentStacks = Schema.Struct({
  tasks: Schema.Array(DeliveryAction),
  preparation: Schema.Array(DeliveryAction),
  waves: Schema.Array(DeliveryAction),
})
export type MomentStacks = typeof MomentStacks.Type

/** One repository's rules, resolved: what a section copies and what an executor reads. */
export const EffectiveRepository = Schema.Struct({
  repositoryId: Schema.String,
  name: Schema.String,
  preset: DeliveryPreset,
  preparation: Schema.Struct({
    commitTemplate: Schema.String,
    pullRequestTitle: Schema.String,
    pullRequestBody: Schema.String,
    reviewers: Schema.Array(Schema.String),
    requireApproval: Schema.Boolean,
  }),
  /** Its stack in each moment, in order. */
  stacks: MomentStacks,
  deliversAfter: Schema.Array(Schema.String),
  /** What it changes of its preset, in every moment. */
  changes: Schema.Number,
})
export type EffectiveRepository = typeof EffectiveRepository.Type

const defaultPreset = (repository: DeliveryRepository): DeliveryPreset =>
  repository.forge === 'none' ? 'local' : 'application'

const wavesOf = (rules: DeliveryRulesDraft, repository: DeliveryRepository): RepositoryWaves =>
  rules.waves.repositories.find((one) => one.repositoryId === repository.id) ?? {
    repositoryId: repository.id,
    preset: defaultPreset(repository),
    steps: NO_OVERRIDES,
    deliversAfter: [],
  }

const preparationOf = (rules: DeliveryRulesDraft, repositoryId: string): RepositoryPreparation =>
  rules.preparation.repositories.find((one) => one.repositoryId === repositoryId) ?? {
    repositoryId,
    commitTemplate: DEFAULT_COMMIT_TEMPLATE,
    pullRequestTitle: DEFAULT_PULL_REQUEST_TITLE,
    pullRequestBody: DEFAULT_PULL_REQUEST_BODY,
    reviewers: [],
    requireApproval: false,
    steps: NO_OVERRIDES,
  }

/** What a repository changes of its preset in each moment. */
const overridesOf = (
  rules: DeliveryRulesDraft,
  repository: DeliveryRepository,
): Record<DeliveryMoment, Overrides<DeliveryAction>> => ({
  tasks:
    rules.tasks.repositories.find((one) => one.repositoryId === repository.id)?.steps ??
    NO_OVERRIDES,
  preparation: preparationOf(rules, repository.id).steps,
  waves: wavesOf(rules, repository).steps,
})

const stacksOf = (rules: DeliveryRulesDraft, repository: DeliveryRepository): MomentStacks => {
  const { preset } = wavesOf(rules, repository)
  const overrides = overridesOf(rules, repository)
  return {
    tasks: applyOverrides(rules.tasks.presets[preset], overrides.tasks),
    preparation: applyOverrides(rules.preparation.presets[preset], overrides.preparation),
    waves: applyOverrides(rules.waves.presets[preset], overrides.waves),
  }
}

/** A repository's actions in the order its moments happen. */
const inSequence = (stacks: MomentStacks): DeliveryAction[] => [
  ...stacks.tasks,
  ...stacks.preparation,
  ...stacks.waves,
]

/**
 * Every repository of the Project, resolved, in the Project's order. A preset's bump stays only
 * where an upstream repository publishes a version ("only when an upstream publishes"); a bump the
 * repository changed or added stays, and the validation says when nothing feeds it.
 */
export function effectiveRepositories(
  rules: DeliveryRulesDraft,
  project: DeliveryProject,
): EffectiveRepository[] {
  const stacks = new Map(
    project.repositories.map((repository) => [repository.id, stacksOf(rules, repository)]),
  )
  const publishes = (id: string) => {
    const found = stacks.get(id)
    return (
      found !== undefined && inSequence(found).some((step) => step.kind === 'published-version')
    )
  }
  return project.repositories.map((repository) => {
    const waves = wavesOf(rules, repository)
    const preparation = preparationOf(rules, repository.id)
    const overrides = overridesOf(rules, repository)
    const fed = waves.deliversAfter.some(publishes)
    const own = new Set(
      DELIVERY_MOMENTS.flatMap((moment) => [
        ...overrides[moment].changed.map((step) => step.id),
        ...overrides[moment].added.map((one) => one.step.id),
      ]),
    )
    const kept = (steps: ReadonlyArray<DeliveryAction>) =>
      steps.filter((step) => fed || step.kind !== 'bump' || own.has(step.id))
    const resolved = stacks.get(repository.id) ?? { tasks: [], preparation: [], waves: [] }
    return {
      repositoryId: repository.id,
      name: repository.name,
      preset: waves.preset,
      preparation: {
        commitTemplate: preparation.commitTemplate,
        pullRequestTitle: preparation.pullRequestTitle,
        pullRequestBody: preparation.pullRequestBody,
        reviewers: preparation.reviewers,
        requireApproval: preparation.requireApproval,
      },
      stacks: {
        tasks: kept(resolved.tasks),
        preparation: kept(resolved.preparation),
        waves: kept(resolved.waves),
      },
      deliversAfter: waves.deliversAfter,
      changes: DELIVERY_MOMENTS.reduce((sum, moment) => sum + changesOf(overrides[moment]), 0),
    }
  })
}

/** The actions one repository runs, in order: after each task, the preparation, the waves. */
export const stepsOfRepository = (repository: EffectiveRepository): ReadonlyArray<DeliveryAction> =>
  inSequence(repository.stacks)

/**
 * The repositories in the order they deliver: each after those it delivers after, otherwise in
 * the Project's order. A cycle (refused by the validation) is broken where it is met.
 */
export function inOrder<
  R extends { readonly repositoryId: string; readonly deliversAfter: ReadonlyArray<string> },
>(repositories: ReadonlyArray<R>): R[] {
  const placed: R[] = []
  const visiting = new Set<string>()
  const place = (repository: R) => {
    if (placed.includes(repository) || visiting.has(repository.repositoryId)) return
    visiting.add(repository.repositoryId)
    for (const id of repository.deliversAfter) {
      const first = repositories.find((one) => one.repositoryId === id)
      if (first !== undefined) place(first)
    }
    placed.push(repository)
  }
  for (const repository of repositories) place(repository)
  return placed
}

/** One row of the table of a preset's stack: an action, and where it stands in each repository. */
export interface RuleRow {
  readonly step: DeliveryAction
  /** The repository whose own action it is, or null for an action of the preset's base. */
  readonly owner: string | null
  readonly cells: ReadonlyArray<{
    readonly repositoryId: string
    /** Where it comes from there, or null where it is not. */
    readonly origin: 'inherited' | 'changed' | 'added' | 'off' | null
    readonly step: DeliveryAction | null
  }>
}

/**
 * The base of a preset in one moment and the actions of each repository taking it, as one table,
 * its columns in delivery order.
 */
export function rowsOf(
  rules: DeliveryRulesDraft,
  project: DeliveryProject,
  preset: DeliveryPreset,
  moment: DeliveryMoment,
): RuleRow[] {
  const repositories = inOrder(
    project.repositories.map((repository) => ({
      ...wavesOf(rules, repository),
      steps: overridesOf(rules, repository)[moment],
    })),
  ).filter((one) => one.preset === preset)
  const base = rules[moment].presets[preset]
  const ownRows = (anchor: string | null): RuleRow[] => {
    const rows: RuleRow[] = []
    for (const owner of repositories) {
      for (const one of owner.steps.added) {
        if (one.after !== anchor) continue
        rows.push({
          step: one.step,
          owner: owner.repositoryId,
          cells: repositories.map((repository) =>
            repository === owner
              ? { repositoryId: repository.repositoryId, origin: 'added' as const, step: one.step }
              : { repositoryId: repository.repositoryId, origin: null, step: null },
          ),
        })
        rows.push(...ownRows(one.step.id))
      }
    }
    return rows
  }
  const rows = ownRows(null)
  for (const step of base) {
    rows.push({
      step,
      owner: null,
      cells: repositories.map((repository) => {
        if (repository.steps.off.includes(step.id)) {
          return { repositoryId: repository.repositoryId, origin: 'off' as const, step: null }
        }
        const changed = repository.steps.changed.find((one) => one.id === step.id)
        return changed === undefined
          ? { repositoryId: repository.repositoryId, origin: 'inherited' as const, step }
          : { repositoryId: repository.repositoryId, origin: 'changed' as const, step: changed }
      }),
    })
    rows.push(...ownRows(step.id))
  }
  return rows
}

/** A step read as its two halves: what it is, and what it acts on. */
export interface StepParts {
  readonly what: string
  readonly on: string
}

export function partsOf(step: DeliveryAction): StepParts {
  switch (step.kind) {
    case 'commit-by-hemera':
      return { what: 'Commit', on: 'by Hemera' }
    case 'commit-by-me':
      return { what: 'Commit', on: 'by me' }
    case 'commit-by-agent':
      return { what: 'Commit', on: 'by an agent' }
    case 'push':
      return { what: 'Push', on: 'the branch' }
    case 'pull-request':
      return { what: 'Pull request', on: 'into the base branch' }
    case 'bump':
      return { what: 'Bump', on: step.how.by === 'command' ? step.how.commandId : 'agent' }
    case 'merge':
      return { what: 'Merge', on: step.method }
    case 'ci':
      return { what: 'CI', on: 'checks green' }
    case 'remote-action':
      switch (step.action.type) {
        case 'run-workflow':
          return { what: 'Run workflow', on: step.action.workflow }
        case 'run-pipeline':
          return { what: 'Run pipeline', on: step.action.pipeline }
        case 'approve-deployment':
          return { what: 'Approve deployment', on: step.action.environment }
      }
      break
    case 'published-version':
      switch (step.detect.by) {
        case 'tag':
          return { what: 'Published version', on: `tag ${step.detect.pattern}` }
        case 'registry':
          return { what: 'Published version', on: step.detect.packageName ?? 'registry' }
        case 'confirm':
          return { what: 'Published version', on: 'confirmed' }
      }
      break
    case 'command':
      return { what: 'Run', on: step.commandId }
    case 'agent':
      return { what: 'Agent', on: step.task }
    case 'confirm':
      return { what: 'Confirm', on: step.what }
    case 'pull-main-checkout':
      return { what: 'Pull', on: 'main checkout' }
    case 'stop-services':
      return { what: 'Stop', on: 'services' }
    case 'remove-worktrees':
      return { what: 'Remove', on: 'worktrees' }
    case 'remove-workspace':
      return { what: 'Remove', on: 'Workspace' }
  }
}

// ——— Templates ———

const VARIABLE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

const isVariable = (name: string): name is TemplateVariable =>
  TEMPLATE_VARIABLES.some((known) => known === name)

/** The variables a template uses that the model does not know, each once, in order. */
export function unknownVariables(template: string): string[] {
  const names = [...template.matchAll(VARIABLE)].map((match) => match[1] ?? '')
  return [...new Set(names.filter((name) => !isVariable(name)))]
}

/** What a template is rendered with; `{images}` is never a value: it stays a slot. */
export type TemplateFields = Partial<Record<Exclude<TemplateVariable, 'images'>, string>>

/**
 * A template rendered: each variable replaced, `{images}` kept as the slot the pull request's
 * writer fills. A missing value renders as empty and is reported, each once.
 */
export interface RenderedTemplate {
  readonly text: string
  /** The variables that had no value, each once, in order. */
  readonly missing: ReadonlyArray<string>
}

export function renderTemplate(template: string, values: TemplateFields): RenderedTemplate {
  const missing: string[] = []
  const text = template.replaceAll(VARIABLE, (whole, name: string) => {
    if (!isVariable(name) || name === 'images') return whole
    const value = values[name]
    if (value === undefined) {
      if (!missing.includes(name)) missing.push(name)
      return ''
    }
    return value
  })
  return { text, missing }
}

// ——— Dependencies ———

/** A repository that delivers after another: it depends on a package the other declares. */
export const DeliveryDependency = Schema.Struct({
  repositoryId: Schema.String,
  deliversAfter: Schema.String,
})
export type DeliveryDependency = typeof DeliveryDependency.Type

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.optionalKey(Schema.String),
    dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    optionalDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  }),
)
const readManifest = Schema.decodeUnknownOption(Manifest)

/**
 * The dependencies proposed from each repository's `package.json` (null when it has none): a
 * repository delivers after another when it depends on the package that other one declares. Only
 * proposed: nothing is saved until the user accepts. Other ecosystems are set by hand.
 */
export function proposeDependencies(
  manifests: ReadonlyArray<{ readonly repositoryId: string; readonly manifest: string | null }>,
): DeliveryDependency[] {
  const read = manifests.flatMap((one) =>
    one.manifest === null
      ? []
      : Option.match(readManifest(one.manifest), {
          onNone: () => [],
          onSome: (manifest) => [{ repositoryId: one.repositoryId, manifest }],
        }),
  )
  const edges: DeliveryDependency[] = []
  for (const { repositoryId, manifest } of read) {
    const needs = new Set(
      [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.peerDependencies,
        manifest.optionalDependencies,
      ].flatMap((list) => Object.keys(list ?? {})),
    )
    for (const other of read) {
      const name = other.manifest.name
      if (other.repositoryId === repositoryId || name === undefined || !needs.has(name)) continue
      edges.push({ repositoryId, deliversAfter: other.repositoryId })
    }
  }
  return edges
}

/** The rules with dependencies accepted: each edge added to its repository's delivers-after. */
export function withDependencies(
  rules: DeliveryRulesDraft,
  project: DeliveryProject,
  edges: ReadonlyArray<DeliveryDependency>,
): DeliveryRulesDraft {
  const repositories = project.repositories.flatMap((repository) => {
    const added = edges
      .filter((edge) => edge.repositoryId === repository.id)
      .map((edge) => edge.deliversAfter)
    const known = rules.waves.repositories.find((one) => one.repositoryId === repository.id)
    if (added.length === 0) return known === undefined ? [] : [known]
    const waves = wavesOf(rules, repository)
    return [{ ...waves, deliversAfter: [...new Set([...waves.deliversAfter, ...added])] }]
  })
  const others = rules.waves.repositories.filter(
    (one) => !project.repositories.some((repository) => repository.id === one.repositoryId),
  )
  return { ...rules, waves: { ...rules.waves, repositories: [...repositories, ...others] } }
}

// ——— Validation ———

/** What each refusal is about. */
export const DELIVERY_PROBLEM_CODES = [
  'merge-without-pull-request',
  'pull-request-without-push',
  'push-without-commit',
  'dependency-cycle',
  'bump-without-publisher',
  'bump-before-publisher',
  'approval-after-ship',
  'merge-before-approval',
  'forge-step-without-forge',
  'remote-action-not-allowed',
  'unknown-template-variable',
  'unknown-command',
  'local-merge-outside-local',
  'once-per-delivery-after-each-task',
  'step-after-workspace-removed',
  'duplicate-step-id',
  'step-placed-after-itself',
  'unknown-repository',
] as const

/** The templates of a repository's preparation, which a problem may be about. */
export const TEMPLATE_FIELDS = ['commitTemplate', 'pullRequestTitle', 'pullRequestBody'] as const

/** One reason the rules cannot be saved: the repository and the step it is about, its sentence. */
export const DeliveryProblem = Schema.Struct({
  code: Schema.Literals(DELIVERY_PROBLEM_CODES),
  repositoryId: Schema.NullOr(Schema.String),
  stepId: Schema.NullOr(Schema.String),
  /** The template it is about, so an editor shows it beside that field. */
  field: Schema.optionalKey(Schema.Literals(TEMPLATE_FIELDS)),
  sentence: Schema.String,
})
export type DeliveryProblem = typeof DeliveryProblem.Type

const TEMPLATES = [
  ['commitTemplate', 'commit template'],
  ['pullRequestTitle', 'pull request title'],
  ['pullRequestBody', 'pull request body'],
] as const

/** The cycles of the delivers-after graph, each named from its first repository in order. */
function cyclesOf(repositories: ReadonlyArray<EffectiveRepository>): string[][] {
  const byId = new Map(repositories.map((one) => [one.repositoryId, one]))
  const cycles: string[][] = []
  const seen = new Set<string>()
  const done = new Set<string>()
  const walk = (id: string, path: string[]) => {
    if (done.has(id)) return
    const at = path.indexOf(id)
    if (at !== -1) {
      const cycle = path.slice(at)
      const key = [...cycle].toSorted().join('\u0000')
      if (!seen.has(key)) {
        seen.add(key)
        cycles.push(cycle)
      }
      return
    }
    for (const next of byId.get(id)?.deliversAfter ?? []) {
      if (byId.has(next)) walk(next, [...path, id])
    }
  }
  for (const repository of repositories) {
    walk(repository.repositoryId, [])
    done.add(repository.repositoryId)
  }
  return cycles
}

const REMOTE_ACTIONS: Readonly<
  Record<
    RemoteAction['type'],
    { readonly words: string; readonly allowed: (repository: DeliveryRepository) => boolean }
  >
> = {
  'run-workflow': {
    words: 'run a workflow',
    allowed: (one) => one.forge === 'github' && one.capabilities.runWorkflow,
  },
  'run-pipeline': {
    words: 'run a pipeline',
    allowed: (one) => one.forge === 'bitbucket-cloud' && one.capabilities.runWorkflow,
  },
  'approve-deployment': {
    words: 'approve a deployment',
    allowed: (one) => one.capabilities.approveManualStep,
  },
}

/** The refusals of one repository's sequence, apart, so each list keeps the order of the refusals. */
interface SequenceProblems {
  readonly merge: DeliveryProblem[]
  readonly push: DeliveryProblem[]
  readonly commit: DeliveryProblem[]
}

/**
 * A merge through a pull request needs one before it, a pull request a push before it, and a push
 * a commit before it, in the order the actions run, wherever they were read from. Each check looks
 * at the first action of its kind: a later one finds what the first one found before it.
 */
function sequenceProblems(
  repositoryId: string,
  name: string,
  all: ReadonlyArray<DeliveryAction>,
): SequenceProblems {
  const merging = all.findIndex((step) => step.kind === 'merge' && step.method !== 'local')
  const pullRequest = all.findIndex((step) => step.kind === 'pull-request')
  const pushed = all.findIndex((step) => step.kind === 'push')
  const committed = all.findIndex((step) => COMMIT_KINDS.includes(step.kind))
  const merge: DeliveryProblem[] = []
  const push: DeliveryProblem[] = []
  const commit: DeliveryProblem[] = []
  if (merging !== -1 && (pullRequest === -1 || pullRequest > merging)) {
    merge.push({
      code: 'merge-without-pull-request',
      repositoryId,
      stepId: all[merging]?.id ?? null,
      sentence: `Merge needs a pull request: ${name} has no pull request step.`,
    })
  }
  if (pullRequest !== -1 && (pushed === -1 || pushed > pullRequest)) {
    push.push({
      code: 'pull-request-without-push',
      repositoryId,
      stepId: all[pullRequest]?.id ?? null,
      sentence: `A pull request needs a push: ${name} has no push step before its pull request step.`,
    })
  }
  if (pushed !== -1 && (committed === -1 || committed > pushed)) {
    commit.push({
      code: 'push-without-commit',
      repositoryId,
      stepId: all[pushed]?.id ?? null,
      sentence: `A push needs a commit: ${name} has no commit action before its push.`,
    })
  }
  return { merge, push, commit }
}

/** The ids met more than once, each once, in the order first met. */
const duplicated = (ids: ReadonlyArray<string>): string[] => [
  ...new Set(ids.filter((id, index) => ids.indexOf(id) !== index)),
]

/**
 * The added steps placed after themselves, through added steps only (a step of the base ends a
 * chain), each loop once, named from its first step: `a → b → a`.
 */
function anchorLoops<S extends { readonly id: string }>(
  base: ReadonlyArray<S>,
  overrides: Overrides<S>,
): string[][] {
  const baseIds = new Set(base.map((step) => step.id))
  const loops: string[][] = []
  const seen = new Set<string>()
  for (const one of overrides.added) {
    const chain = [one.step.id]
    let anchor = one.after
    while (anchor !== null && !baseIds.has(anchor)) {
      if (anchor === one.step.id) {
        const key = [...chain].toSorted().join('\u0000')
        if (!seen.has(key)) {
          seen.add(key)
          loops.push([...chain, anchor])
        }
        break
      }
      const next = overrides.added.find((other) => other.step.id === anchor)
      if (next === undefined || chain.includes(anchor)) break
      chain.push(anchor)
      anchor = next.after
    }
  }
  return loops
}

/** What is done once per delivery, so never after each task: the kind, what it does, why. */
const ONCE_PER_DELIVERY = [
  ['pull-request', 'opens a pull request', 'a pull request is opened once per delivery'],
  ['merge', 'merges', 'a branch is merged once per delivery'],
  ['ci', 'waits for CI', 'CI checks a delivery once, after it is pushed'],
] as const

const PRESET_NAMES: Readonly<Record<DeliveryPreset, string>> = {
  library: 'Library',
  application: 'Application',
  local: 'Local',
}

/** The command an action names, null when it names none. */
const commandOf = (step: DeliveryAction): string | null =>
  step.kind === 'command'
    ? step.commandId
    : step.kind === 'bump' && step.how.by === 'command'
      ? step.how.commandId
      : null

/**
 * Every reason the rules cannot be saved, by refusal in the order of the ticket, then by
 * repository in the Project's order. Pure: the forges and the catalogue come with the Project.
 * Cleanup is the Project's: its actions are checked in every repository's sequence, after the
 * waves, except a bump, which, as a preset's, acts only where an upstream published.
 */
export function validateRules(
  rules: DeliveryRulesDraft,
  project: DeliveryProject,
): DeliveryProblem[] {
  const effective = effectiveRepositories(rules, project)
  const cleanup = rules.end.cleanup
  const facts = project.repositories.flatMap((repository) => {
    const resolved = effective.find((one) => one.repositoryId === repository.id)
    if (resolved === undefined) return []
    const own = stepsOfRepository(resolved)
    return [{ repository, resolved, own, all: [...own, ...cleanup] }]
  })
  const problem = (
    code: DeliveryProblem['code'],
    repositoryId: string | null,
    stepId: string | null,
    sentence: string,
  ): DeliveryProblem => ({ code, repositoryId, stepId, sentence })
  const publishes = (id: string) =>
    facts
      .find((one) => one.repository.id === id)
      ?.own.some((step) => step.kind === 'published-version') ?? false
  const beforeShipOf = (resolved: EffectiveRepository) => [
    ...resolved.stacks.tasks,
    ...resolved.stacks.preparation,
  ]
  const publishesBeforeShip = (id: string) => {
    const resolved = facts.find((one) => one.repository.id === id)?.resolved
    return (
      resolved !== undefined &&
      beforeShipOf(resolved).some((step) => step.kind === 'published-version')
    )
  }
  const known = (commandId: string) => project.commandIds.includes(commandId)

  const problems: DeliveryProblem[] = []
  // 1 and 2. A merge through a pull request needs one, a pull request a push, a push a commit.
  const sequences = facts.map(({ repository, all }) =>
    sequenceProblems(repository.id, repository.name, all),
  )
  problems.push(...sequences.flatMap((one) => one.merge))
  problems.push(...sequences.flatMap((one) => one.push))
  problems.push(...sequences.flatMap((one) => one.commit))
  // 3. No cycle between repositories.
  const names = new Map(project.repositories.map((one) => [one.id, one.name]))
  for (const cycle of cyclesOf(effective)) {
    const named = [...cycle, cycle[0] ?? ''].map((id) => names.get(id) ?? id)
    problems.push(
      problem(
        'dependency-cycle',
        cycle[0] ?? null,
        null,
        `These repositories deliver after each other in a cycle: ${named.join(' → ')}.`,
      ),
    )
  }
  // 4. A bump needs an upstream that publishes.
  for (const { repository, resolved, own } of facts) {
    const bump = own.find((step) => step.kind === 'bump')
    if (bump === undefined || resolved.deliversAfter.some(publishes)) continue
    problems.push(
      problem(
        'bump-without-publisher',
        repository.id,
        bump.id,
        `${repository.name} bumps its dependencies, but nothing it depends on publishes a version.`,
      ),
    )
  }
  // 4b. A bump before Ship needs an upstream that publishes before Ship: the waves come after.
  for (const { repository, resolved } of facts) {
    const bump = beforeShipOf(resolved).find((step) => step.kind === 'bump')
    if (bump === undefined || !resolved.deliversAfter.some(publishes)) continue
    if (resolved.deliversAfter.some(publishesBeforeShip)) continue
    problems.push(
      problem(
        'bump-before-publisher',
        repository.id,
        bump.id,
        `${repository.name} bumps its dependencies before Ship, but what it depends on publishes only after Ship.`,
      ),
    )
  }
  // 5. Approvals before Ship need the pull request opened before Ship (CT-56).
  for (const { repository, resolved, all } of facts) {
    if (!resolved.preparation.requireApproval) continue
    if (beforeShipOf(resolved).some((step) => step.kind === 'pull-request')) continue
    const pullRequest = all.find((step) => step.kind === 'pull-request')
    if (pullRequest === undefined) continue
    problems.push(
      problem(
        'approval-after-ship',
        repository.id,
        pullRequest.id,
        `${repository.name} requires team approval before Ship, but its pull request is opened after Ship.`,
      ),
    )
  }
  // 5b. And no merge before Ship: it would merge before the pull request can be approved.
  for (const { repository, resolved } of facts) {
    if (!resolved.preparation.requireApproval) continue
    const merge = beforeShipOf(resolved).find((step) => step.kind === 'merge')
    if (merge === undefined) continue
    problems.push(
      problem(
        'merge-before-approval',
        repository.id,
        merge.id,
        `${repository.name} requires team approval before Ship, but merges before Ship, before its pull request can be approved.`,
      ),
    )
  }
  // 6. A forge step needs a forge.
  for (const { repository, all } of facts) {
    if (repository.forge !== 'none') continue
    for (const step of all) {
      const what =
        step.kind === 'pull-request'
          ? 'have a pull request step'
          : step.kind === 'merge' && step.method !== 'local'
            ? 'merge through a pull request'
            : step.kind === 'remote-action'
              ? 'act on a remote'
              : null
      if (what === null) continue
      problems.push(
        problem(
          'forge-step-without-forge',
          repository.id,
          step.id,
          `${repository.name} has no forge, so it cannot ${what}.`,
        ),
      )
    }
  }
  // 7. A remote action the forge can do.
  for (const { repository, all } of facts) {
    if (repository.forge === 'none') continue
    for (const step of all) {
      if (step.kind !== 'remote-action') continue
      const action = REMOTE_ACTIONS[step.action.type]
      if (action.allowed(repository)) continue
      problems.push(
        problem(
          'remote-action-not-allowed',
          repository.id,
          step.id,
          `${repository.name}’s forge, ${FORGE_NAMES[repository.forge]}, cannot ${action.words}.`,
        ),
      )
    }
  }
  // 8. Templates use known variables.
  for (const { repository, resolved } of facts) {
    for (const [field, words] of TEMPLATES) {
      for (const name of unknownVariables(resolved.preparation[field])) {
        problems.push({
          code: 'unknown-template-variable',
          repositoryId: repository.id,
          stepId: null,
          field,
          sentence: `The ${words} of ${repository.name} uses an unknown variable: {${name}}.`,
        })
      }
    }
  }
  // 9. A command named exists in the catalogue.
  for (const { repository, own } of facts) {
    for (const step of own) {
      const commandId = commandOf(step)
      if (commandId === null || known(commandId)) continue
      problems.push(
        problem(
          'unknown-command',
          repository.id,
          step.id,
          `${repository.name}’s step “${step.id}” names a command that is not in the catalogue.`,
        ),
      )
    }
  }
  for (const step of cleanup) {
    const commandId = commandOf(step)
    if (commandId === null || known(commandId)) continue
    problems.push(
      problem(
        'unknown-command',
        null,
        step.id,
        `The Cleanup step “${step.id}” names a command that is not in the catalogue.`,
      ),
    )
  }
  // 10. A local merge only under the Local preset.
  for (const { repository, resolved, all } of facts) {
    if (resolved.preset === 'local') continue
    const local = all.find((step) => step.kind === 'merge' && step.method === 'local')
    if (local === undefined) continue
    problems.push(
      problem(
        'local-merge-outside-local',
        repository.id,
        local.id,
        `${repository.name} merges locally, but only a repository with the Local preset can.`,
      ),
    )
  }
  // 10b. After each task runs once per task: what is done once per delivery cannot run there.
  for (const { repository, resolved } of facts) {
    for (const step of resolved.stacks.tasks) {
      const once = ONCE_PER_DELIVERY.find(([kind]) => kind === step.kind)
      if (once === undefined) continue
      problems.push(
        problem(
          'once-per-delivery-after-each-task',
          repository.id,
          step.id,
          `${repository.name} ${once[1]} after each task, but ${once[2]}.`,
        ),
      )
    }
  }
  // 10c. Nothing runs in Cleanup once the Workspace is removed.
  const removed = cleanup.findIndex((step) => step.kind === 'remove-workspace')
  for (const step of removed === -1 ? [] : cleanup.slice(removed + 1)) {
    problems.push(
      problem(
        'step-after-workspace-removed',
        null,
        step.id,
        `Cleanup runs “${step.id}” after removing the Workspace, but nothing runs once it is gone.`,
      ),
    )
  }
  // 11. Each step has an id of its own: overrides and plans address steps by id.
  const twice = (where: string, id: string) =>
    `${where} two steps with the id “${id}”: each step needs its own.`
  for (const preset of DELIVERY_PRESETS) {
    const ids = DELIVERY_MOMENTS.flatMap((moment) =>
      rules[moment].presets[preset].map((step) => step.id),
    )
    for (const id of duplicated(ids)) {
      problems.push(
        problem('duplicate-step-id', null, id, twice(`The ${PRESET_NAMES[preset]} preset has`, id)),
      )
    }
  }
  for (const { repository, resolved } of facts) {
    const overrides = overridesOf(rules, repository)
    // A preset's own duplicates are said once, above; here what the repository adds meets.
    const ids = [
      ...new Set(
        DELIVERY_MOMENTS.flatMap((moment) =>
          rules[moment].presets[resolved.preset].map((step) => step.id),
        ),
      ),
      ...DELIVERY_MOMENTS.flatMap((moment) => overrides[moment].added.map((one) => one.step.id)),
    ]
    for (const id of duplicated(ids)) {
      problems.push(
        problem('duplicate-step-id', repository.id, id, twice(`${repository.name} has`, id)),
      )
    }
  }
  for (const id of duplicated(cleanup.map((step) => step.id))) {
    problems.push(problem('duplicate-step-id', null, id, twice('Cleanup has', id)))
  }
  // 12. An added step is placed after something that is not itself.
  for (const { repository, resolved } of facts) {
    const overrides = overridesOf(rules, repository)
    const loops = DELIVERY_MOMENTS.flatMap((moment) =>
      anchorLoops(rules[moment].presets[resolved.preset], overrides[moment]),
    )
    for (const loop of loops) {
      problems.push(
        problem(
          'step-placed-after-itself',
          repository.id,
          loop[0] ?? null,
          `${repository.name} places its step “${loop[0] ?? ''}” after itself: ${loop.join(' → ')}.`,
        ),
      )
    }
  }
  // 13. A repository delivers after repositories of the Project.
  for (const { repository, resolved } of facts) {
    if (resolved.deliversAfter.every((id) => names.has(id))) continue
    problems.push(
      problem(
        'unknown-repository',
        repository.id,
        null,
        `${repository.name} delivers after a repository that is not in this Project.`,
      ),
    )
  }
  return problems
}

/** Dependencies to accept that name a repository the Project does not have. */
export function dependencyProblems(
  edges: ReadonlyArray<DeliveryDependency>,
  project: DeliveryProject,
): DeliveryProblem[] {
  const known = (id: string) => project.repositories.some((one) => one.id === id)
  return edges
    .filter((edge) => !known(edge.repositoryId) || !known(edge.deliversAfter))
    .map(() => ({
      code: 'unknown-repository',
      repositoryId: null,
      stepId: null,
      sentence: 'A dependency names a repository that is not in this Project.',
    }))
}

// ——— The sections a mission copies (CT-47) ———

const EffectivePreparation = Schema.Struct({
  repositoryId: Schema.String,
  name: Schema.String,
  commitTemplate: Schema.String,
  pullRequestTitle: Schema.String,
  pullRequestBody: Schema.String,
  reviewers: Schema.Array(Schema.String),
  requireApproval: Schema.Boolean,
  steps: Schema.Array(DeliveryAction),
})

const copyFields = { version: Schema.Number, copiedAt: Schema.String }

/**
 * After each task as a mission copied it, at its first task done: each repository's stack, with
 * the commit template its commit actions use.
 */
export const TasksCopy = Schema.Struct({
  section: Schema.Literal('tasks'),
  ...copyFields,
  repositories: Schema.Array(
    Schema.Struct({
      repositoryId: Schema.String,
      name: Schema.String,
      commitTemplate: Schema.String,
      steps: Schema.Array(DeliveryAction),
    }),
  ),
})
export type TasksCopy = typeof TasksCopy.Type

/** The preparation as a mission copied it, at its first push or pull request. */
export const PreparationCopy = Schema.Struct({
  section: Schema.Literal('preparation'),
  ...copyFields,
  reviewDrafts: Schema.Boolean,
  repositories: Schema.Array(EffectivePreparation),
})
export type PreparationCopy = typeof PreparationCopy.Type

/** The waves as a mission copied them, at Ship. */
export const WavesCopy = Schema.Struct({
  section: Schema.Literal('waves'),
  ...copyFields,
  repositories: Schema.Array(
    Schema.Struct({
      repositoryId: Schema.String,
      name: Schema.String,
      preset: DeliveryPreset,
      steps: Schema.Array(DeliveryAction),
      deliversAfter: Schema.Array(Schema.String),
    }),
  ),
})
export type WavesCopy = typeof WavesCopy.Type

/** The End as a mission copied it, at Ship. */
export const EndCopy = Schema.Struct({
  section: Schema.Literal('end'),
  ...copyFields,
  closing: Schema.Literal(CLOSING),
  cleanup: Schema.Array(DeliveryAction),
})
export type EndCopy = typeof EndCopy.Type

/** A section of the rules copied into a mission, resolved, with the version it was copied at. */
export const SectionCopy = Schema.Union([TasksCopy, PreparationCopy, WavesCopy, EndCopy])
export type SectionCopy = typeof SectionCopy.Type

/** A section of the rules, resolved for the Project as it is, as a mission copies it. */
export function sectionOf(
  rules: DeliveryRules,
  project: DeliveryProject,
  section: DeliverySection,
  copiedAt: string,
): SectionCopy {
  const effective = effectiveRepositories(rules, project)
  const version = rules.version
  switch (section) {
    case 'tasks':
      return {
        section,
        version,
        copiedAt,
        repositories: effective.map((one) => ({
          repositoryId: one.repositoryId,
          name: one.name,
          commitTemplate: one.preparation.commitTemplate,
          steps: one.stacks.tasks,
        })),
      }
    case 'preparation':
      return {
        section,
        version,
        copiedAt,
        reviewDrafts: rules.preparation.reviewDrafts,
        repositories: effective.map((one) => ({
          repositoryId: one.repositoryId,
          name: one.name,
          ...one.preparation,
          steps: one.stacks.preparation,
        })),
      }
    case 'waves':
      return {
        section,
        version,
        copiedAt,
        repositories: inOrder(effective).map((one) => ({
          repositoryId: one.repositoryId,
          name: one.name,
          preset: one.preset,
          steps: one.stacks.waves,
          deliversAfter: one.deliversAfter,
        })),
      }
    case 'end':
      return { section, version, copiedAt, closing: rules.end.closing, cleanup: rules.end.cleanup }
  }
}

/** The repositories whose team approval the copy requires before Ship. */
export const approvalsRequired = (copy: SectionCopy): string[] =>
  copy.section === 'preparation'
    ? copy.repositories.filter((one) => one.requireApproval).map((one) => one.repositoryId)
    : []

/** What changed in the Project's preparation since a mission copied it. */
export const PreparationDifference = Schema.Struct({
  /** Null for a change of the whole section. */
  repositoryId: Schema.NullOr(Schema.String),
  field: Schema.Literals([
    'reviewDrafts',
    'repository',
    'commitTemplate',
    'pullRequestTitle',
    'pullRequestBody',
    'reviewers',
    'requireApproval',
    'steps',
  ]),
})
export type PreparationDifference = typeof PreparationDifference.Type

const PREPARATION_FIELDS = [
  'commitTemplate',
  'pullRequestTitle',
  'pullRequestBody',
  'reviewers',
  'requireApproval',
  'steps',
] as const

const sameValue = Schema.toEquivalence(EffectivePreparation)

/**
 * The differences between a mission's preparation copy and the preparation as it is now: a
 * repository added or gone, then each field changed, in the order of the copy.
 */
export function preparationDifferences(
  copy: PreparationCopy,
  now: PreparationCopy,
): PreparationDifference[] {
  const differences: PreparationDifference[] = []
  if (copy.reviewDrafts !== now.reviewDrafts) {
    differences.push({ repositoryId: null, field: 'reviewDrafts' })
  }
  const ids = [
    ...copy.repositories.map((one) => one.repositoryId),
    ...now.repositories
      .map((one) => one.repositoryId)
      .filter((id) => !copy.repositories.some((one) => one.repositoryId === id)),
  ]
  for (const repositoryId of ids) {
    const before = copy.repositories.find((one) => one.repositoryId === repositoryId)
    const after = now.repositories.find((one) => one.repositoryId === repositoryId)
    if (before === undefined || after === undefined) {
      differences.push({ repositoryId, field: 'repository' })
      continue
    }
    if (sameValue(before, after)) continue
    for (const field of PREPARATION_FIELDS) {
      const one = { ...before, [field]: after[field] }
      if (!sameValue(one, before)) differences.push({ repositoryId, field })
    }
  }
  return differences
}

/**
 * The copies a mission holds at Ship, checked together (R9 calls it at Ship): After each task,
 * copied at the first task done, the preparation, copied at the first push or pull request, and
 * the waves, copied at Ship, may be of different versions, each consistent alone. The sequence
 * refusals are read across them; a mission with no task done yet has no copy of After each task.
 */
export function validateCopies(copies: {
  readonly tasks: TasksCopy | null
  readonly preparation: PreparationCopy
  readonly waves: WavesCopy
}): DeliveryProblem[] {
  const stepsIn = (
    repositories: ReadonlyArray<{
      readonly repositoryId: string
      readonly steps: ReadonlyArray<DeliveryAction>
    }>,
    repositoryId: string,
  ) => repositories.find((one) => one.repositoryId === repositoryId)?.steps ?? []
  const sequences = copies.waves.repositories.map((repository) =>
    sequenceProblems(repository.repositoryId, repository.name, [
      ...stepsIn(copies.tasks?.repositories ?? [], repository.repositoryId),
      ...stepsIn(copies.preparation.repositories, repository.repositoryId),
      ...repository.steps,
    ]),
  )
  return [
    ...sequences.flatMap((one) => one.merge),
    ...sequences.flatMap((one) => one.push),
    ...sequences.flatMap((one) => one.commit),
  ]
}

// ——— The stored documents ———

const strict = { onExcessProperty: 'error', errors: 'all' } as const

/** The rules as one stored document. */
export const DeliveryRulesJson = Schema.fromJsonString(DeliveryRules)

/** A copy as one stored document. */
export const SectionCopyJson = Schema.fromJsonString(SectionCopy)

/**
 * Rules read from their document: a key the model does not have (one trying to remove Closing, or
 * #340's `commitRule`) is refused, not dropped.
 */
export const decodeDeliveryRules = (document: string) =>
  Schema.decodeUnknownResult(DeliveryRulesJson)(document, strict)

/** A copy read from its document, as strictly as the rules. */
export const decodeSectionCopy = (document: string) =>
  Schema.decodeUnknownResult(SectionCopyJson)(document, strict)
