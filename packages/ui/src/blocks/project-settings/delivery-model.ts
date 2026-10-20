/**
 * The delivery rules of a Project, as its settings show them: what Hemera reads from the engine
 * (`deliveryRules.read`, `forge.status`) and hands back on a save. Plain data, no behaviour: the
 * engine resolves the effective recipes and validates the rules; the section draws what it says.
 */

/** What a repository's recipe starts from. Local: no forge, the branch merged on this machine. */
export type Preset = 'library' | 'application' | 'local'

export const PRESETS: readonly Preset[] = ['library', 'application', 'local']

export const PRESET_WORDS: Record<Preset, string> = {
  library: 'Library',
  application: 'Application',
  local: 'Local',
}

/** How a step starts: on its own once the step before it is done, or on the user's click. */
export type StepStart = 'auto' | 'click'

export type MergeMethod = 'squash' | 'merge' | 'rebase'

export const MERGE_WORDS: Record<MergeMethod, string> = {
  squash: 'Squash',
  merge: 'Merge commit',
  rebase: 'Rebase',
}

/** How a published version is found: a tag, the version on a registry, or the user's word. */
export type PublishedBy = 'tag' | 'registry' | 'confirm'

/**
 * When a step runs: after each task during Building, when Review starts, or after Ship in the
 * repository's wave. Every step of the catalogue may stand in any of them.
 */
export type Moment = 'tasks' | 'review' | 'waves'

export const MOMENTS: readonly Moment[] = ['tasks', 'review', 'waves']

export const MOMENT_WORDS: Record<Moment, string> = {
  tasks: 'After each task',
  review: 'When Review starts',
  waves: 'After Ship',
}

/** What a step does, with what it needs. */
export type StepConfig =
  /** Hemera commits what the Workspace holds, with the commit template. */
  | { readonly kind: 'commit-by-hemera' }
  /** Hemera waits for your click, then checks that a new commit is on the branch. */
  | { readonly kind: 'commit-by-me' }
  /** An agent allowed to run `git commit` in the Workspace, under the permission rules. */
  | { readonly kind: 'commit-by-agent' }
  | { readonly kind: 'push' }
  | { readonly kind: 'pull-request' }
  /** The dependencies moved to the versions their upstream just published, pushed on the PR. */
  | { readonly kind: 'bump'; readonly how: 'command' | 'agent'; readonly command: string | null }
  | { readonly kind: 'merge'; readonly method: MergeMethod }
  /** The pull request's checks, on the commit Hemera pushed. */
  | { readonly kind: 'ci' }
  /**
   * A workflow or a pipeline the forge's command line starts, with a workflow's inputs, one
   * `name=value` a line.
   */
  | {
      readonly kind: 'remote-action'
      readonly action: string
      readonly inputs?: string | undefined
    }
  /** The deployment waiting on an environment, approved as the user, on a forge that can (#502). */
  | { readonly kind: 'approve-deployment'; readonly environment: string }
  | { readonly kind: 'published'; readonly by: PublishedBy; readonly pattern: string }
  /** A command of the catalogue: it may write to the network. */
  | { readonly kind: 'command'; readonly command: string }
  /** A task for an agent: it may write to the network. */
  | { readonly kind: 'agent'; readonly task: string }
  /** “I did it”, for what Hemera can neither see nor start. */
  | { readonly kind: 'confirm'; readonly what: string }
  /** The Local preset's merge of the mission's branch into the base branch, on this machine. */
  | { readonly kind: 'local-merge' }
  | { readonly kind: 'pull-main-checkout' }
  | { readonly kind: 'stop-services' }
  | { readonly kind: 'remove-worktrees' }
  | { readonly kind: 'remove-workspace' }

export type StepKind = StepConfig['kind']

export interface DeliveryStep {
  readonly id: string
  readonly start: StepStart
  readonly config: StepConfig
}

/** Where a step of a repository's recipe comes from. */
export type StepOrigin = 'preset' | 'changed' | 'added' | 'omitted'

/** One step of a repository's effective recipe, and where it comes from. */
export interface RecipeStep {
  readonly step: DeliveryStep
  readonly origin: StepOrigin
  readonly moment: Moment
  /** Why the rules refuse this step, in words, at its place. */
  readonly refused?: string | undefined
}

export type ForgeKind = 'github' | 'bitbucket-cloud' | 'bitbucket-dc' | 'none'

export const FORGE_WORDS: Record<ForgeKind, string> = {
  github: 'GitHub',
  'bitbucket-cloud': 'Bitbucket Cloud',
  'bitbucket-dc': 'Bitbucket Data Center',
  none: 'No forge',
}

/** The command line Hemera speaks to each forge through. */
export const FORGE_CLI: Record<Exclude<ForgeKind, 'none'>, string> = {
  github: 'gh',
  'bitbucket-cloud': 'bkt',
  'bitbucket-dc': 'bkt',
}

/** Where the forge's command line stands on this machine; null while it is read. */
export type CliState = 'ready' | 'missing' | 'signed-out' | 'unreachable'

export interface ForgeView {
  readonly kind: ForgeKind
  /** The host the remote points at: `github.com`, `bitbucket.acme.test`. */
  readonly host: string
  /** Whether the user chose the forge rather than Hemera reading it from the remote. */
  readonly forced: boolean
  /** Null: being read. */
  readonly cli: CliState | null
  /** The command that fixes the command line, as the user runs it in their own terminal. */
  readonly fix?: string | undefined
  /** What stands wrong with the command line, in words. */
  readonly sentence?: string | undefined
}

export interface DeliveryRepository {
  /** Its path in the Project: `api`. */
  readonly path: string
  readonly preset: Preset
  readonly remote: string
  /** The remotes the repository has, to choose from. */
  readonly remotes: readonly string[]
  readonly base: string
  readonly forge: ForgeView
  /** The effective recipe, every moment in order, left-out steps in their place. */
  readonly steps: readonly RecipeStep[]
}

/** `on` must have published before `repository` delivers. */
export interface Dependency {
  readonly repository: string
  readonly on: string
  /** Proposed by Hemera from the manifests, not kept until accepted. */
  readonly proposed: boolean
}

/** Where the step that pushes and opens the pull requests stands. */
export type PushPlacement = 'review' | 'waves'

export interface Reviewer {
  /** `@acme/web`, or a person's handle on the forge. */
  readonly handle: string
  /** A person's name; a team has none. */
  readonly name?: string | undefined
}

export interface PullRequestRules {
  readonly placement: PushPlacement
  readonly start: StepStart
  readonly commit: string
  readonly title: string
  readonly body: string
  readonly reviewers: readonly Reviewer[]
  readonly requireApproval: boolean
  readonly reviewDrafts: boolean
}

/** A step of the End's cleanup: built in, or a command, an agent or a confirmation of the Project's. */
export interface CleanupStep {
  readonly id: string
  readonly label: string
  /** For a step the Project added: what it runs. */
  readonly config?: StepConfig | undefined
  /** Why the rules refuse this step, in words, at its place. */
  readonly refused?: string | undefined
}

export interface DeliveryRules {
  readonly pullRequests: PullRequestRules
  readonly repositories: readonly DeliveryRepository[]
  readonly dependencies: readonly Dependency[]
  /** The repositories by wave, in the order they deliver, from the accepted dependencies. */
  readonly waves: readonly (readonly string[])[]
  readonly cleanup: readonly CleanupStep[]
}

/** What the rules refuse, in words, away from a step: each said at its own place. */
export interface DeliveryRefusals {
  /** Approvals required while the pull requests open after Ship. */
  readonly approval?: string | undefined
  /** A cycle among the repositories. */
  readonly dependencies?: string | undefined
  /** A template the rules refuse, each said under its line. */
  readonly templates?:
    | Readonly<Partial<Record<'commit' | 'title' | 'body', string | undefined>>>
    | undefined
}

/** What a step is called on its line. */
export const STEP_WORDS: Record<StepKind, string> = {
  'commit-by-hemera': 'Hemera commits',
  'commit-by-me': 'I commit myself',
  'commit-by-agent': 'An agent commits',
  push: 'Push',
  'pull-request': 'Pull request',
  bump: 'Bump',
  merge: 'Merge',
  ci: 'CI',
  'remote-action': 'Action on the remote',
  'approve-deployment': 'Approve a deployment',
  published: 'Published version',
  command: 'Command',
  agent: 'Agent',
  confirm: 'Confirm',
  'local-merge': 'Merge locally',
  'pull-main-checkout': 'Pull the main checkout',
  'stop-services': 'Stop the mission’s services',
  'remove-worktrees': 'Remove the worktrees',
  'remove-workspace': 'Remove the Workspace',
}

/** The catalogue: every kind of step, which any moment accepts, the End's Cleanup included. */
export const CATALOGUE: readonly StepKind[] = [
  'commit-by-hemera',
  'commit-by-me',
  'commit-by-agent',
  'push',
  'pull-request',
  'bump',
  'merge',
  'local-merge',
  'ci',
  'remote-action',
  'approve-deployment',
  'published',
  'command',
  'agent',
  'confirm',
  'pull-main-checkout',
  'stop-services',
  'remove-worktrees',
  'remove-workspace',
]

/** What a step acts on, as its line says it after its name. */
export function detailOf(
  config: StepConfig,
  repository?: Pick<DeliveryRepository, 'remote' | 'base'>,
): string {
  switch (config.kind) {
    case 'commit-by-hemera':
      return 'with the commit template'
    case 'commit-by-me':
      return 'waits for your commit'
    case 'commit-by-agent':
      return 'under the permission rules'
    case 'push':
      return repository === undefined ? 'the branch' : repository.remote
    case 'pull-request':
      return repository === undefined ? 'into the base' : `into ${repository.base}`
    case 'bump':
      return config.how === 'agent' ? 'by the agent' : (config.command ?? '')
    case 'merge':
      return MERGE_WORDS[config.method].toLowerCase()
    case 'ci':
      return 'checks of the pushed commit'
    case 'remote-action':
      return config.action
    case 'approve-deployment':
      return config.environment
    case 'published':
      if (config.by === 'confirm') return 'your confirmation'
      return config.by === 'tag' ? `tag ${config.pattern}` : config.pattern
    case 'command':
      return config.command
    case 'agent':
      return config.task
    case 'confirm':
      return config.what
    case 'local-merge':
      return repository === undefined ? 'into the base' : `into ${repository.base}`
    case 'pull-main-checkout':
      return repository === undefined ? 'the base branch' : repository.base
    case 'stop-services':
    case 'remove-worktrees':
      return 'of the mission'
    case 'remove-workspace':
      return 'once its work is merged'
  }
}

/**
 * The kinds a repository's step may be on its forge: every one of the catalogue, but the approval
 * of a deployment only where the forge can approve one (GitHub, as the engine's forge port says).
 */
export function kindsOn(forge: ForgeKind): StepKind[] {
  return CATALOGUE.filter((kind) => kind !== 'approve-deployment' || forge === 'github')
}

/** Whether a step may write to the network on the Project's say: a command, an agent. */
export function writesToNetwork(config: StepConfig): boolean {
  return config.kind === 'command' || config.kind === 'agent' || config.kind === 'commit-by-agent'
}

/** The names a template may hold, and what Hemera fills each with. */
export const TEMPLATE_VARIABLES = [
  { name: '{key}', filled: 'Mission key' },
  { name: '{title}', filled: 'Mission title' },
  { name: '{slug}', filled: 'Title, as a slug' },
  { name: '{branch}', filled: 'Workspace branch' },
  { name: '{summary}', filled: 'The agent’s final summary' },
  { name: '{images}', filled: 'The images chosen for the pull request' },
] as const
