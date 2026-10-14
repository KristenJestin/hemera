/**
 * A Project's delivery rules (#340): how a mission's work leaves its Workspace and how a mission
 * ends, as data. Running them is other tickets' work; this is the model, its presets, the
 * validation that refuses inconsistent rules, the templates, and the sections a mission copies
 * when they start acting.
 *
 * The rules come in three sections:
 *
 * - **the preparation**: per repository, the templates of the commit and of the pull request, its
 *   reviewers and whether team approval is required before Ship; whether the drafts are reviewed;
 *   and the push steps, `push` and `pull-request`, each placed in Review (before Ship) or in the
 *   waves (after it);
 * - **the waves**: per repository, its preset, what it changes of the preset's base recipe, and the
 *   repositories it delivers after;
 * - **the End**: Closing, fixed (the model has no way to remove it), then Cleanup, a list.
 *
 * The Project keeps a base recipe per preset; a repository takes a preset and keeps only what it
 * changes: a step left out (`off`), a step changed (`changed`), a step of its own inserted after
 * another (`added`). The push steps are the same for every repository (none under Local) unless
 * the repository overrides them the same way. The effective recipe of a repository is computed,
 * never stored twice. A repository the rules do not name yet takes the defaults: Local when it has
 * no forge, Application otherwise.
 *
 * Pure rules: the engine stores them, reads the forges and the catalogue, and copies the sections.
 *
 * The rules and the copies are stored documents, read strictly: a field added later (S2's manifest
 * path, S4's ref and variables) is a `Schema.optionalKey` with a default, so what was stored still
 * reads; a field renamed, removed or made required ships a data migration of both tables.
 */

import { Option, Schema } from 'effect'

// ——— The values ———

/** How a step starts: by itself, or on a click, which is then a decision need. */
export const STEP_MODES = ['auto', 'click'] as const
export const StepMode = Schema.Literals(STEP_MODES)
export type StepMode = typeof StepMode.Type

/** Where a push step runs: in Review, before Ship, or in the waves, after it. */
export const PUSH_PLACEMENTS = ['review', 'waves'] as const
export const PushPlacement = Schema.Literals(PUSH_PLACEMENTS)
export type PushPlacement = typeof PushPlacement.Type

/** What a repository delivers as: a library others depend on, an application, or local work. */
export const DELIVERY_PRESETS = ['library', 'application', 'local'] as const
export const DeliveryPreset = Schema.Literals(DELIVERY_PRESETS)
export type DeliveryPreset = typeof DeliveryPreset.Type

/**
 * Who commits and when (open question 26): Hemera when it pushes, or Hemera when each task is
 * done. No value lets an agent run `git commit` itself.
 */
export const COMMIT_RULES = ['at-push', 'after-each-task'] as const
export const CommitRule = Schema.Literals(COMMIT_RULES)
export type CommitRule = typeof CommitRule.Type

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
export const DELIVERY_SECTIONS = ['preparation', 'waves', 'end'] as const
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

// ——— The steps ———

const stepFields = { id: Schema.String, mode: StepMode }

/** Pushes the mission's branch to the repository's delivery remote. */
export const PushStep = Schema.Struct({
  ...stepFields,
  kind: Schema.Literal('push'),
  placement: PushPlacement,
})
export type PushStep = typeof PushStep.Type

/**
 * Opens the pull request, into the repository's base branch, with the templates and reviewers of
 * the preparation.
 */
export const PullRequestStep = Schema.Struct({
  ...stepFields,
  kind: Schema.Literal('pull-request'),
  placement: PushPlacement,
})
export type PullRequestStep = typeof PullRequestStep.Type

/** A push step of the preparation. */
export const PreparationStep = Schema.Union([PushStep, PullRequestStep])
export type PreparationStep = typeof PreparationStep.Type

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

export const CiStep = Schema.Struct({ ...stepFields, kind: Schema.Literal('ci') })

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

/** A step of a repository's recipe, in the waves. */
export const WaveStep = Schema.Union([
  BumpStep,
  MergeStep,
  CiStep,
  RemoteActionStep,
  PublishedVersionStep,
  CommandStep,
  AgentStep,
  ConfirmStep,
])
export type WaveStep = typeof WaveStep.Type

/** The Cleanup steps Hemera knows, beside a catalogue command. */
export const CLEANUP_KINDS = [
  'pull-main-checkout',
  'stop-services',
  'remove-worktrees',
  'remove-workspace',
] as const

/** A step of Cleanup, the configurable part of the End. */
export const CleanupStep = Schema.Union([
  Schema.Struct({ ...stepFields, kind: Schema.Literals(CLEANUP_KINDS) }),
  CommandStep,
])
export type CleanupStep = typeof CleanupStep.Type

/** A step of any section. */
export type DeliveryStep = PreparationStep | WaveStep | CleanupStep

/** Whether a step may write to the network whatever it is told: a command, an agent (CT-50). */
export const mayWriteToNetwork = (step: DeliveryStep): boolean =>
  step.kind === 'command' || step.kind === 'agent'

// ——— Base and overrides ———

/** What a repository changes of a base list of steps. */
const overridesOf = <S extends Schema.Top>(step: S) =>
  Schema.Struct({
    /** The base steps it leaves out, by id. */
    off: Schema.Array(Schema.String),
    /** The base steps it changes, each as it is here, by id. */
    changed: Schema.Array(step),
    /** Its own steps, each after the step it follows (of the base or its own), null for first. */
    added: Schema.Array(Schema.Struct({ after: Schema.NullOr(Schema.String), step })),
  })

export const PreparationOverrides = overridesOf(PreparationStep)
export const WaveOverrides = overridesOf(WaveStep)

/** What a repository changes, whatever the steps. */
export interface Overrides<S extends { readonly id: string }> {
  readonly off: ReadonlyArray<string>
  readonly changed: ReadonlyArray<S>
  readonly added: ReadonlyArray<{ readonly after: string | null; readonly step: S }>
}

const NO_OVERRIDES = { off: [], changed: [], added: [] }

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
  /** What it changes of the Project's push steps. */
  pushSteps: PreparationOverrides,
})
export type RepositoryPreparation = typeof RepositoryPreparation.Type

/** The waves of one repository: its preset, what it changes of it, and what it delivers after. */
export const RepositoryWaves = Schema.Struct({
  repositoryId: Schema.String,
  preset: DeliveryPreset,
  steps: WaveOverrides,
  /** The repositories it depends on, by id: it leaves only once they have published. */
  deliversAfter: Schema.Array(Schema.String),
})
export type RepositoryWaves = typeof RepositoryWaves.Type

const draftFields = {
  commitRule: CommitRule,
  preparation: Schema.Struct({
    /** When on, the push steps wait for a click that shows the rendered pull requests. */
    reviewDrafts: Schema.Boolean,
    /** The push steps of every repository (none under Local), unless it overrides them. */
    pushSteps: Schema.Array(PreparationStep),
    repositories: Schema.Array(RepositoryPreparation),
  }),
  waves: Schema.Struct({
    /** The base recipe of each preset. */
    presets: Schema.Struct({
      library: Schema.Array(WaveStep),
      application: Schema.Array(WaveStep),
      local: Schema.Array(WaveStep),
    }),
    repositories: Schema.Array(RepositoryWaves),
  }),
  end: Schema.Struct({
    /** Fixed: the model has no way to remove it. */
    closing: Schema.Literal(CLOSING),
    cleanup: Schema.Array(CleanupStep),
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

const strict = { onExcessProperty: 'error', errors: 'all' } as const

/** The rules as one stored document. */
export const DeliveryRulesJson = Schema.fromJsonString(DeliveryRules)

/**
 * Rules read from their document: a key the model does not have (one trying to remove Closing) is
 * refused, not dropped.
 */
export const decodeDeliveryRules = (document: string) =>
  Schema.decodeUnknownResult(DeliveryRulesJson)(document, strict)

// ——— The presets ———

const PUSH_STEPS: ReadonlyArray<PreparationStep> = [
  { id: 'push', kind: 'push', mode: 'click', placement: 'review' },
  { id: 'pull-request', kind: 'pull-request', mode: 'click', placement: 'review' },
]

const BUMP: WaveStep = { id: 'bump', kind: 'bump', mode: 'auto', how: { by: 'agent' } }
const SQUASH: WaveStep = { id: 'merge', kind: 'merge', mode: 'auto', method: 'squash' }
const CI: WaveStep = { id: 'ci', kind: 'ci', mode: 'auto' }

/** The template defaults. */
export const DEFAULT_COMMIT_TEMPLATE = '{key}: {title}'
export const DEFAULT_PULL_REQUEST_TITLE = '{key}: {title}'
export const DEFAULT_PULL_REQUEST_BODY = '{summary}\n\n{images}'

/** The rules of a Project that never saved any. */
export function defaultDeliveryRules(): DeliveryRulesDraft {
  return {
    commitRule: 'at-push',
    preparation: { reviewDrafts: false, pushSteps: PUSH_STEPS, repositories: [] },
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
        local: [{ id: 'merge', kind: 'merge', mode: 'auto', method: 'local' }],
      },
      repositories: [],
    },
    end: {
      closing: CLOSING,
      cleanup: CLEANUP_KINDS.map((kind) => ({ id: kind, kind, mode: 'auto' })),
    },
  }
}

// ——— The effective recipe ———

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
  /** Its push steps, in order: those placed in Review run before Ship. */
  pushSteps: Schema.Array(PreparationStep),
  /** Its recipe in the waves, in order. */
  steps: Schema.Array(WaveStep),
  deliversAfter: Schema.Array(Schema.String),
  /** What it changes of its preset and of the push steps. */
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
    pushSteps: NO_OVERRIDES,
  }

/**
 * Every repository of the Project, resolved, in the Project's order. A preset's bump stays only
 * where an upstream repository publishes a version ("only when an upstream publishes"); a bump the
 * repository changed or added stays, and the validation says when nothing feeds it.
 */
export function effectiveRepositories(
  rules: DeliveryRulesDraft,
  project: DeliveryProject,
): EffectiveRepository[] {
  const recipes = new Map(
    project.repositories.map((repository) => {
      const waves = wavesOf(rules, repository)
      return [repository.id, applyOverrides(rules.waves.presets[waves.preset], waves.steps)]
    }),
  )
  const publishes = (id: string) =>
    recipes.get(id)?.some((step) => step.kind === 'published-version') ?? false
  return project.repositories.map((repository) => {
    const waves = wavesOf(rules, repository)
    const preparation = preparationOf(rules, repository.id)
    const fed = waves.deliversAfter.some(publishes)
    const own = new Set([
      ...waves.steps.changed.map((step) => step.id),
      ...waves.steps.added.map((one) => one.step.id),
    ])
    const steps = (recipes.get(repository.id) ?? []).filter(
      (step) => fed || step.kind !== 'bump' || own.has(step.id),
    )
    const pushBase = waves.preset === 'local' ? [] : rules.preparation.pushSteps
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
      pushSteps: applyOverrides(pushBase, preparation.pushSteps),
      steps,
      deliversAfter: waves.deliversAfter,
      changes: changesOf(waves.steps) + changesOf(preparation.pushSteps),
    }
  })
}

/** The steps one repository runs, in order: its push steps, then its recipe. */
export const stepsOfRepository = (
  repository: EffectiveRepository,
): ReadonlyArray<PreparationStep | WaveStep> => [...repository.pushSteps, ...repository.steps]

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

/** One row of the table of a preset's recipes: a step, and where it stands in each repository. */
export interface RuleRow {
  readonly step: WaveStep
  /** The repository whose own step it is, or null for a step of the preset's base. */
  readonly owner: string | null
  readonly cells: ReadonlyArray<{
    readonly repositoryId: string
    /** Where it comes from there, or null where it is not. */
    readonly origin: 'inherited' | 'changed' | 'added' | 'off' | null
    readonly step: WaveStep | null
  }>
}

/**
 * The base of a preset and the steps of each repository taking it, as one table, its columns in
 * delivery order.
 */
export function rowsOf(
  rules: DeliveryRulesDraft,
  project: DeliveryProject,
  preset: DeliveryPreset,
): RuleRow[] {
  const repositories = inOrder(
    project.repositories.map((repository) => wavesOf(rules, repository)),
  ).filter((one) => one.preset === preset)
  const base = rules.waves.presets[preset]
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

export function partsOf(step: DeliveryStep): StepParts {
  switch (step.kind) {
    case 'push':
      return { what: 'Push', on: step.placement === 'review' ? 'in Review' : 'after Ship' }
    case 'pull-request':
      return { what: 'Pull request', on: step.placement === 'review' ? 'in Review' : 'after Ship' }
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
  'dependency-cycle',
  'bump-without-publisher',
  'approval-after-ship',
  'forge-step-without-forge',
  'remote-action-not-allowed',
  'unknown-template-variable',
  'unknown-command',
  'local-merge-outside-local',
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

/** Refusals 1 and 2 of one repository, apart, so each list keeps the order of the refusals. */
interface SequenceProblems {
  readonly merge: DeliveryProblem[]
  readonly push: DeliveryProblem[]
}

/** Refusals 1 and 2 for one repository's push steps and recipe, wherever they were read from. */
function sequenceProblems(
  repositoryId: string,
  name: string,
  pushSteps: ReadonlyArray<PreparationStep>,
  steps: ReadonlyArray<WaveStep>,
): SequenceProblems {
  // Review runs before the waves, whatever the order of the list.
  const all = [
    ...pushSteps.filter((step) => step.placement === 'review'),
    ...pushSteps.filter((step) => step.placement === 'waves'),
    ...steps,
  ]
  const merging = steps.find((step) => step.kind === 'merge' && step.method !== 'local')
  const pullRequest = all.find((step) => step.kind === 'pull-request')
  const merge: DeliveryProblem[] = []
  const push: DeliveryProblem[] = []
  if (merging !== undefined) {
    const at = pullRequest === undefined ? -1 : all.indexOf(pullRequest)
    if (at === -1 || at > all.indexOf(merging)) {
      merge.push({
        code: 'merge-without-pull-request',
        repositoryId,
        stepId: merging.id,
        sentence: `Merge needs a pull request: ${name} has no pull request step.`,
      })
    }
  }
  if (pullRequest !== undefined) {
    const pushed = all.findIndex((step) => step.kind === 'push')
    if (pushed === -1 || pushed > all.indexOf(pullRequest)) {
      push.push({
        code: 'pull-request-without-push',
        repositoryId,
        stepId: pullRequest.id,
        sentence: `A pull request needs a push: ${name} has no push step before its pull request step.`,
      })
    }
  }
  return { merge, push }
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

const PRESET_NAMES: Readonly<Record<DeliveryPreset, string>> = {
  library: 'Library',
  application: 'Application',
  local: 'Local',
}

/**
 * Every reason the rules cannot be saved, by refusal in the order of the ticket, then by
 * repository in the Project's order. Pure: the forges and the catalogue come with the Project.
 */
export function validateRules(
  rules: DeliveryRulesDraft,
  project: DeliveryProject,
): DeliveryProblem[] {
  const effective = effectiveRepositories(rules, project)
  const facts = project.repositories.flatMap((repository) => {
    const resolved = effective.find((one) => one.repositoryId === repository.id)
    return resolved === undefined ? [] : [{ repository, resolved }]
  })
  const problem = (
    code: DeliveryProblem['code'],
    repositoryId: string | null,
    stepId: string | null,
    sentence: string,
  ): DeliveryProblem => ({ code, repositoryId, stepId, sentence })
  const publishes = (id: string) =>
    effective
      .find((one) => one.repositoryId === id)
      ?.steps.some((step) => step.kind === 'published-version') ?? false
  const known = (commandId: string) => project.commandIds.includes(commandId)

  const problems: DeliveryProblem[] = []
  // 1 and 2. A merge through a pull request needs one, and a pull request a push before it.
  const sequences = facts.map(({ repository, resolved }) =>
    sequenceProblems(repository.id, repository.name, resolved.pushSteps, resolved.steps),
  )
  problems.push(...sequences.flatMap((one) => one.merge))
  problems.push(...sequences.flatMap((one) => one.push))
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
  for (const { repository, resolved } of facts) {
    const bump = resolved.steps.find((step) => step.kind === 'bump')
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
  // 5. Approvals before Ship need the pull request opened before Ship (CT-56).
  for (const { repository, resolved } of facts) {
    const pullRequest = resolved.pushSteps.find((step) => step.kind === 'pull-request')
    if (!resolved.preparation.requireApproval || pullRequest?.placement !== 'waves') continue
    problems.push(
      problem(
        'approval-after-ship',
        repository.id,
        pullRequest.id,
        `${repository.name} requires team approval before Ship, but its pull request is opened after Ship.`,
      ),
    )
  }
  // 6. A forge step needs a forge.
  for (const { repository, resolved } of facts) {
    if (repository.forge !== 'none') continue
    for (const step of stepsOfRepository(resolved)) {
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
  for (const { repository, resolved } of facts) {
    if (repository.forge === 'none') continue
    for (const step of resolved.steps) {
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
  for (const { repository, resolved } of facts) {
    for (const step of resolved.steps) {
      const commandId =
        step.kind === 'command'
          ? step.commandId
          : step.kind === 'bump' && step.how.by === 'command'
            ? step.how.commandId
            : null
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
  for (const step of rules.end.cleanup) {
    if (step.kind !== 'command' || known(step.commandId)) continue
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
  for (const { repository, resolved } of facts) {
    if (resolved.preset === 'local') continue
    const local = resolved.steps.find((step) => step.kind === 'merge' && step.method === 'local')
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
  // 11. Each step has an id of its own: overrides and plans address steps by id.
  const twice = (where: string, id: string) =>
    `${where} two steps with the id “${id}”: each step needs its own.`
  for (const id of duplicated(rules.preparation.pushSteps.map((step) => step.id))) {
    problems.push(problem('duplicate-step-id', null, id, twice('The push steps have', id)))
  }
  for (const preset of DELIVERY_PRESETS) {
    for (const id of duplicated(rules.waves.presets[preset].map((step) => step.id))) {
      problems.push(
        problem('duplicate-step-id', null, id, twice(`The ${PRESET_NAMES[preset]} preset has`, id)),
      )
    }
  }
  for (const { repository, resolved } of facts) {
    const waves = wavesOf(rules, repository)
    const preparation = preparationOf(rules, repository.id)
    const pushBase = resolved.preset === 'local' ? [] : rules.preparation.pushSteps
    // A base's own duplicates are said once, above; here what the repository adds meets.
    const ids = [
      ...new Set(pushBase.map((step) => step.id)),
      ...preparation.pushSteps.added.map((one) => one.step.id),
      ...new Set(rules.waves.presets[waves.preset].map((step) => step.id)),
      ...waves.steps.added.map((one) => one.step.id),
    ]
    for (const id of duplicated(ids)) {
      problems.push(
        problem('duplicate-step-id', repository.id, id, twice(`${repository.name} has`, id)),
      )
    }
  }
  for (const id of duplicated(rules.end.cleanup.map((step) => step.id))) {
    problems.push(problem('duplicate-step-id', null, id, twice('Cleanup has', id)))
  }
  // 12. An added step is placed after something that is not itself.
  for (const { repository, resolved } of facts) {
    const waves = wavesOf(rules, repository)
    const preparation = preparationOf(rules, repository.id)
    const pushBase = resolved.preset === 'local' ? [] : rules.preparation.pushSteps
    const loops = [
      ...anchorLoops(pushBase, preparation.pushSteps),
      ...anchorLoops(rules.waves.presets[waves.preset], waves.steps),
    ]
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
  pushSteps: Schema.Array(PreparationStep),
})

const copyFields = { version: Schema.Number, copiedAt: Schema.String }

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
      steps: Schema.Array(WaveStep),
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
  cleanup: Schema.Array(CleanupStep),
})

/** A section of the rules copied into a mission, resolved, with the version it was copied at. */
export const SectionCopy = Schema.Union([PreparationCopy, WavesCopy, EndCopy])
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
          pushSteps: one.pushSteps,
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
          steps: one.steps,
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
    'pushSteps',
  ]),
})
export type PreparationDifference = typeof PreparationDifference.Type

const PREPARATION_FIELDS = [
  'commitTemplate',
  'pullRequestTitle',
  'pullRequestBody',
  'reviewers',
  'requireApproval',
  'pushSteps',
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
 * The two copies a mission holds at Ship, checked together (R9 calls it at Ship): the preparation,
 * copied at the first push or pull request, and the waves, copied at Ship, may be of different
 * versions, each consistent alone. Refusals 1 and 2 are read across both.
 */
export function validateCopies(preparation: PreparationCopy, waves: WavesCopy): DeliveryProblem[] {
  const sequences = waves.repositories.map((repository) =>
    sequenceProblems(
      repository.repositoryId,
      repository.name,
      preparation.repositories.find((one) => one.repositoryId === repository.repositoryId)
        ?.pushSteps ?? [],
      repository.steps,
    ),
  )
  return [...sequences.flatMap((one) => one.merge), ...sequences.flatMap((one) => one.push)]
}
