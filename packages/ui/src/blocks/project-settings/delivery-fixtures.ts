import {
  type CleanupStep,
  type DeliveryRefusals,
  type DeliveryRepository,
  type DeliveryRules,
  type DeliveryStep,
  type Dependency,
  type ForgeView,
  type Moment,
  type Preset,
  type RecipeStep,
  type Reviewer,
  type StepConfig,
} from './delivery-model.ts'
import { templateRefusal } from './delivery-words.ts'

/**
 * Acme's delivery rules, as the settings show them, and the engine's refusals in its words.
 * Neutral data only: this repository is public.
 */

/** The catalogue commands a Bump or a Command step may run. */
export const DELIVERY_COMMANDS = [
  'bump-deps',
  'changeset-version',
  'db-migrate-check',
  'notify-release',
] as const

function step(id: string, config: StepConfig, start: DeliveryStep['start'] = 'auto'): DeliveryStep {
  return { id, start, config }
}

const COMMIT = step('commit', { kind: 'commit-by-hemera' })
const PUSH = step('push', { kind: 'push' })
const PULL_REQUEST = step('pull-request', { kind: 'pull-request' })
const BUMP = step('bump', { kind: 'bump', how: 'command', command: 'bump-deps' })
const MERGE = step('merge', { kind: 'merge', method: 'squash' })
const CI = step('ci', { kind: 'ci' })

/** A step of a recipe, in its moment: after Ship unless said. */
function at(
  one: DeliveryStep,
  origin: RecipeStep['origin'] = 'preset',
  moment: Moment = 'waves',
): RecipeStep {
  return { step: one, origin, moment }
}

/** Hemera's commit, the push and the pull request, when Review starts: the presets' preparation. */
const PREPARATION: readonly RecipeStep[] = [
  at(COMMIT, 'preset', 'review'),
  at(PUSH, 'preset', 'review'),
  at(PULL_REQUEST, 'preset', 'review'),
]

/** The recipe each preset starts a repository with, in every moment. */
export function presetSteps(preset: Preset, published = '@acme/shared'): RecipeStep[] {
  if (preset === 'local') return [at(COMMIT), at(step('local-merge', { kind: 'local-merge' }))]
  const head = [...PREPARATION, at(BUMP), at(MERGE), at(CI)]
  if (preset === 'application') return head
  return [...head, at(step('published', { kind: 'published', by: 'registry', pattern: published }))]
}

const GITHUB: ForgeView = { kind: 'github', host: 'github.com', forced: false, cli: 'ready' }

function repository(
  part: Partial<DeliveryRepository> & Pick<DeliveryRepository, 'path' | 'preset'>,
): DeliveryRepository {
  return {
    remote: 'origin',
    remotes: ['origin'],
    base: 'main',
    forge: GITHUB,
    steps: presetSteps(part.preset, `@acme/${part.path}`),
    ...part,
  }
}

/** shared: the Library preset as it is. */
export const SHARED = repository({ path: 'shared', preset: 'library' })

/**
 * api: an agent commits after each task, its merge changed to rebase, and a migration check and a
 * staging deploy of its own.
 */
export const API = repository({
  path: 'api',
  preset: 'application',
  remotes: ['origin', 'upstream'],
  steps: [
    at(step('agent-commit', { kind: 'commit-by-agent' }), 'added', 'tasks'),
    ...PREPARATION,
    at(BUMP),
    at(step('db-check', { kind: 'command', command: 'db-migrate-check' }), 'added'),
    at(step('merge', { kind: 'merge', method: 'rebase' }), 'changed'),
    at(CI),
    at(step('deploy', { kind: 'remote-action', action: 'deploy-staging.yml' }, 'click'), 'added'),
  ],
})

/**
 * web: you commit yourself, in place of Hemera's commit; no CI of its own after the merge, and a
 * check by hand on staging.
 */
export const WEB = repository({
  path: 'web',
  preset: 'application',
  steps: [
    at(COMMIT, 'omitted', 'review'),
    at(step('own-commit', { kind: 'commit-by-me' }, 'click'), 'added', 'review'),
    at(PUSH, 'preset', 'review'),
    at(PULL_REQUEST, 'preset', 'review'),
    at(BUMP),
    at(MERGE),
    at(CI, 'omitted'),
    at(
      step('staging', { kind: 'confirm', what: 'The release is checked on staging' }, 'click'),
      'added',
    ),
  ],
})

/** ui-kit: on a Bitbucket Data Center Hemera cannot read from its remote, so forced. */
export const UI_KIT = repository({
  path: 'ui-kit',
  preset: 'library',
  forge: {
    kind: 'bitbucket-dc',
    host: 'bitbucket.acme.test',
    forced: true,
    cli: 'signed-out',
    fix: 'bkt auth login --host bitbucket.acme.test',
    sentence: 'bkt is signed out of bitbucket.acme.test',
  },
})

/** billing: on GitHub, whose command line is not installed on this machine. */
export const BILLING = repository({
  path: 'billing',
  preset: 'application',
  base: 'develop',
  forge: {
    ...GITHUB,
    cli: 'missing',
    fix: 'brew install gh',
    sentence: 'gh, the GitHub CLI, is not installed on this machine',
  },
})

/** The repositories by wave, from the accepted dependencies; null for a cycle. */
export function wavesOf(
  paths: readonly string[],
  dependencies: readonly Dependency[],
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

export const REVIEWERS: readonly Reviewer[] = [
  { handle: '@acme/web' },
  { handle: 'dreyes', name: 'Dana Reyes' },
]

/** Every reviewer the forge offers for Acme: teams first, then people. */
export const CANDIDATES: readonly Reviewer[] = [
  { handle: '@acme/web' },
  { handle: '@acme/api' },
  { handle: '@acme/platform' },
  { handle: '@acme/design' },
  { handle: '@acme/security' },
  { handle: 'dreyes', name: 'Dana Reyes' },
  { handle: 'mokafor', name: 'Mira Okafor' },
  { handle: 'tlindqvist', name: 'Tomas Lindqvist' },
  { handle: 'pnair', name: 'Priya Nair' },
  { handle: 'jkowalski', name: 'Jan Kowalski' },
  { handle: 'ahassan', name: 'Amal Hassan' },
  { handle: 'sbrennan', name: 'Sean Brennan' },
  { handle: 'ychen', name: 'Yun Chen' },
  { handle: 'lmoreau', name: 'Lucie Moreau' },
  { handle: 'rsantos', name: 'Rafael Santos' },
  { handle: 'kito', name: 'Kenji Ito' },
  { handle: 'nabara', name: 'Nora Abara' },
  { handle: 'evolkov', name: 'Elena Volkov' },
  { handle: 'gmensah', name: 'Grace Mensah' },
  { handle: 'oberg', name: 'Olof Berg' },
  { handle: 'hdubois', name: 'Hugo Dubois' },
  { handle: 'wnakamura', name: 'Wren Nakamura' },
]

export const BODY = `{summary}

{images}

Branch: {branch}
Refs {key}`

/** The cleanup a Project starts with. */
export const CLEANUP: readonly CleanupStep[] = [
  { id: 'pull', label: 'Pull the main checkout' },
  { id: 'services', label: 'Stop the mission’s services' },
  { id: 'worktrees', label: 'Remove the worktrees and the Workspace' },
]

/**
 * The push and the pull requests of every repository moved to a moment, with Hemera's commit
 * before them: where the line Push and open puts them.
 */
export function pushedIn(
  repositories: readonly DeliveryRepository[],
  placement: 'review' | 'waves',
): DeliveryRepository[] {
  const early = (recipe: RecipeStep) =>
    recipe.moment !== 'tasks' &&
    (recipe.step.config.kind === 'commit-by-hemera' ||
      recipe.step.config.kind === 'push' ||
      recipe.step.config.kind === 'pull-request')
  return repositories.map((one) => {
    if (one.preset === 'local') return one
    const moved = one.steps.filter(early).map((recipe): RecipeStep => ({
      step: recipe.step,
      origin: recipe.origin,
      moment: placement,
    }))
    const rest = one.steps.filter((recipe) => !early(recipe))
    // In the waves, they lead the recipe; in Review, they stand after what runs after each task.
    const tasks = rest.filter((recipe) => recipe.moment === 'tasks')
    const others = rest.filter((recipe) => recipe.moment !== 'tasks')
    return Object.assign({}, one, { steps: [...tasks, ...moved, ...others] })
  })
}

const DEPENDENCIES: readonly Dependency[] = [
  { repository: 'api', on: 'shared', proposed: false },
  { repository: 'web', on: 'shared', proposed: false },
  { repository: 'web', on: 'api', proposed: true },
]

function rules(
  repositories: readonly DeliveryRepository[],
  dependencies: readonly Dependency[],
  part: Partial<DeliveryRules> = {},
): DeliveryRules {
  return {
    pullRequests: {
      placement: 'review',
      start: 'auto',
      commit: '{key}: {title}',
      title: '{key} {title}',
      body: BODY,
      reviewers: REVIEWERS,
      requireApproval: true,
      reviewDrafts: false,
    },
    repositories,
    dependencies,
    waves:
      wavesOf(
        repositories.map((one) => one.path),
        dependencies,
      ) ?? [],
    cleanup: CLEANUP,
    ...part,
  }
}

/** Acme as it is lived in: shared first, then api and web; Hemera proposes that web waits for api. */
export const RULES: DeliveryRules = rules([SHARED, API, WEB], DEPENDENCIES)

/** Five repositories, many reviewers, two forges in trouble. */
export const DENSE_RULES: DeliveryRules = rules(
  [SHARED, UI_KIT, API, BILLING, WEB],
  [
    ...DEPENDENCIES,
    { repository: 'web', on: 'ui-kit', proposed: false },
    { repository: 'billing', on: 'shared', proposed: false },
    { repository: 'billing', on: 'api', proposed: true },
  ],
  {
    pullRequests: {
      ...RULES.pullRequests,
      reviewers: CANDIDATES.slice(0, 14),
    },
  },
)

/** A Project just added: every repository on its preset, nothing proposed, nothing changed. */
export const PLAIN_RULES: DeliveryRules = rules(
  [
    SHARED,
    repository({ path: 'api', preset: 'application' }),
    repository({ path: 'web', preset: 'application' }),
  ],
  [],
)

const LONG_BODY = `## What changes

{summary}

## How it looks

{images}

## How to try it

1. Check out {branch} and install the dependencies with the lockfile as it is.
2. Start the services of the Workspace, then open the invoices page of a customer with at least
   two hundred invoices across three fiscal years and several currencies.
3. Export them as CSV and open the file in a spreadsheet: every row holds its currency.

## Notes for the reviewers

The export streams its rows; nothing is held in memory past one page of the query.

Refs {key} · {slug}`

/** A long template in every field and a long path in every place. */
export const LONG_RULES: DeliveryRules = rules(
  [
    repository({
      path: 'services/platform-api-and-background-workers',
      preset: 'application',
      base: 'release/2026-q4-long-term-support',
    }),
    SHARED,
    WEB,
  ],
  [],
  {
    pullRequests: {
      ...RULES.pullRequests,
      commit:
        '{key}({slug}): {title} — generated by the Builder from the mission’s Spec, task by task',
      title: '[{key}] {title} · {branch} · {slug} · please read the summary before reviewing',
      body: LONG_BODY,
      reviewers: CANDIDATES,
    },
  },
)

/** One repository whose recipe holds every kind of step. */
export const EVERY_STEP_RULES: DeliveryRules = rules(
  [
    repository({
      path: 'api',
      preset: 'library',
      steps: [
        at(step('task-commit', { kind: 'commit-by-hemera' }), 'added', 'tasks'),
        at(step('agent-commit', { kind: 'commit-by-agent' }), 'added', 'tasks'),
        at(step('own-commit', { kind: 'commit-by-me' }, 'click'), 'added', 'review'),
        ...PREPARATION,
        at(BUMP),
        at(MERGE),
        at(CI),
        at(
          step(
            'release',
            { kind: 'remote-action', action: 'release.yml', inputs: 'channel=stable' },
            'click',
          ),
          'added',
        ),
        at(
          step('approve', { kind: 'approve-deployment', environment: 'production' }, 'click'),
          'added',
        ),
        at(step('published', { kind: 'published', by: 'tag', pattern: 'v*' }), 'changed'),
        at(step('notify', { kind: 'command', command: 'notify-release' }), 'added'),
        at(
          step('changelog', {
            kind: 'agent',
            task: 'Write the release note of the published version in docs/releases.md',
          }),
          'added',
        ),
        at(
          step('announce', { kind: 'confirm', what: 'The release is announced' }, 'click'),
          'added',
        ),
        at(step('stop', { kind: 'stop-services' }), 'added'),
      ],
    }),
  ],
  [],
)

// ——— The refused rules, one per reason ———

const MISTYPED = '{key}: {titel}'

/** The commit template with a name Hemera does not fill: refused under its line. */
export const REFUSED_TEMPLATE = {
  rules: { ...RULES, pullRequests: { ...RULES.pullRequests, commit: MISTYPED } },
  refusals: { templates: { commit: templateRefusal(MISTYPED) } },
} satisfies { rules: DeliveryRules; refusals: DeliveryRefusals }

/** A cleanup step after the Workspace is gone: refused under its line. */
export const REFUSED_CLEANUP = {
  rules: {
    ...RULES,
    cleanup: [
      ...CLEANUP,
      {
        id: 'notify',
        label: 'Notify the release',
        config: { kind: 'command', command: 'notify-release' },
        refused:
          'Cleanup runs “Notify the release” after removing the Workspace, but nothing runs once it is gone.',
      },
    ],
  },
} satisfies { rules: DeliveryRules }

/** What Hemera reads in Acme's manifests: api and web use shared, web uses api. */
export const MANIFESTS: readonly Dependency[] = [
  { repository: 'api', on: 'shared', proposed: true },
  { repository: 'web', on: 'shared', proposed: true },
  { repository: 'web', on: 'api', proposed: true },
]

/** A step of a recipe, refused with these words. */
function refusedAs(recipe: RecipeStep, words: string): RecipeStep {
  return { ...recipe, refused: words }
}

function refusing(
  path: string,
  stepId: string,
  words: string,
  change: (steps: readonly RecipeStep[]) => readonly RecipeStep[] = (steps) => steps,
): DeliveryRules {
  return {
    ...RULES,
    repositories: RULES.repositories.map((one) =>
      one.path !== path
        ? one
        : {
            ...one,
            steps: change(one.steps).map((recipe) =>
              recipe.step.id === stepId ? refusedAs(recipe, words) : recipe,
            ),
          },
    ),
  }
}

function leaveOut(id: string): (steps: readonly RecipeStep[]) => readonly RecipeStep[] {
  return (steps) => steps.map((one) => (one.step.id === id ? { ...one, origin: 'omitted' } : one))
}

export const MERGE_WITHOUT_PR = refusing(
  'api',
  'merge',
  'Merge needs a pull request, and api leaves out Pull request. Put it back, or leave out Merge.',
  leaveOut('pull-request'),
)

export const PR_WITHOUT_PUSH = refusing(
  'web',
  'pull-request',
  'A pull request needs the branch pushed, and web leaves out Push. Put Push back.',
  leaveOut('push'),
)

export const BUMP_WITHOUT_UPSTREAM: DeliveryRules = {
  ...refusing(
    'web',
    'bump',
    'web bumps what api publishes, and api publishes no version. Add a Published version step to api, or leave out Bump in web.',
  ),
  dependencies: [
    { repository: 'api', on: 'shared', proposed: false },
    { repository: 'web', on: 'api', proposed: false },
  ],
  waves: [['shared'], ['api'], ['web']],
}

export const CYCLE_RULES: DeliveryRules = {
  ...RULES,
  dependencies: [
    { repository: 'api', on: 'shared', proposed: false },
    { repository: 'shared', on: 'api', proposed: false },
    { repository: 'web', on: 'shared', proposed: false },
  ],
  waves: [],
}

export const CYCLE: DeliveryRefusals = {
  dependencies:
    'shared delivers after api, which delivers after shared: no wave can go first. Remove one of the two in the repository’s dialog.',
}

export const APPROVAL_AFTER_SHIP_RULES: DeliveryRules = {
  ...RULES,
  pullRequests: { ...RULES.pullRequests, placement: 'waves', requireApproval: true },
  repositories: pushedIn(RULES.repositories, 'waves'),
}

export const APPROVAL_AFTER_SHIP: DeliveryRefusals = {
  approval:
    'Approvals before Ship need the pull requests open before Ship, and they open after it. Open them when Review starts, or stop requiring approvals.',
}

export const FORGE_CANNOT: DeliveryRules = {
  ...RULES,
  repositories: [
    SHARED,
    {
      ...UI_KIT,
      forge: { ...UI_KIT.forge, cli: 'ready' },
      steps: [
        ...UI_KIT.steps,
        {
          ...at(
            step('release', { kind: 'remote-action', action: 'release pipeline' }, 'click'),
            'added',
          ),
          refused:
            'Bitbucket Data Center cannot start a pipeline from its command line. Use Confirm, and start it yourself.',
        },
      ],
    },
    API,
    WEB,
  ],
  dependencies: DEPENDENCIES,
  waves: [
    ['shared', 'ui-kit'],
    ['api', 'web'],
  ],
}

/** Every refusal at once, as a save that meets them all would show. */
export const EVERY_REFUSAL: DeliveryRules = {
  ...APPROVAL_AFTER_SHIP_RULES,
  repositories: [
    ...MERGE_WITHOUT_PR.repositories.filter((one) => one.path !== 'web'),
    ...PR_WITHOUT_PUSH.repositories.filter((one) => one.path === 'web'),
  ],
}

// ——— The forge's command line, one state each ———

export function withForge(forge: Partial<ForgeView>, base: DeliveryRules = RULES): DeliveryRules {
  return {
    ...base,
    repositories: base.repositories.map((one) =>
      one.path === 'api' ? { ...one, forge: { ...one.forge, ...forge } } : one,
    ),
  }
}

export const CLI_MISSING = withForge({
  cli: 'missing',
  fix: 'brew install gh',
  sentence: 'gh, the GitHub CLI, is not installed on this machine',
})

export const CLI_SIGNED_OUT = withForge({
  cli: 'signed-out',
  fix: 'gh auth login --hostname github.com',
  sentence: 'gh is signed out of github.com',
})

export const CLI_UNREACHABLE = withForge({
  cli: 'unreachable',
  sentence: 'github.com did not answer gh within 10 seconds',
})

export const CLI_CHECKING = withForge({ cli: null })

export const FORCED = withForge({
  kind: 'bitbucket-dc',
  host: 'bitbucket.acme.test',
  forced: true,
  cli: 'ready',
})
