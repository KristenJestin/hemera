/**
 * The pre-launch check and the launch of a Building (#139): the values they are made of, the
 * arguments of the agent's one tool, and the rules that need nothing but those values: the branch a
 * Building's worktrees are made on, how the files handed to the agent of the check are sorted, what
 * its report must answer, and which actions a check offers.
 */

import { Schema } from 'effect'

/** How the user launches: `launch_anyway` is required when the check marked the mission outdated. */
export const LAUNCH_CHOICES = ['launch', 'launch_anyway'] as const
export const LaunchChoice = Schema.Literals(LAUNCH_CHOICES)
export type LaunchChoice = typeof LaunchChoice.Type

/** What a check offers the user, each action theirs. */
export const PRELAUNCH_ACTIONS = [
  'launch',
  'launch_anyway',
  'back_to_planning',
  'check_again',
] as const
export const PrelaunchAction = Schema.Literals(PRELAUNCH_ACTIONS)
export type PrelaunchAction = typeof PrelaunchAction.Type

export const CHECK_STATES = ['running', 'done', 'failed'] as const
export const CheckState = Schema.Literals(CHECK_STATES)
export type CheckState = typeof CheckState.Type

/** Where a Building's preparation stands, from the launch to the move to Building. */
export const LAUNCH_STATES = ['preparing', 'failed', 'launched', 'cancelled'] as const
export const LaunchState = Schema.Literals(LAUNCH_STATES)
export type LaunchState = typeof LaunchState.Type

/** How a file handed to the agent of the check is sorted (CT-25, third bullet). */
export const HANDED_KINDS = ['manifest', 'configuration', 'other'] as const
export const HandedKind = Schema.Literals(HANDED_KINDS)
export type HandedKind = typeof HandedKind.Type

/** The dependency manifests and lockfiles of the usual ecosystems, by file name. */
const MANIFESTS = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.json',
  'deno.lock',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'poetry.lock',
  'uv.lock',
  'Pipfile',
  'Pipfile.lock',
  'requirements.txt',
  'Gemfile',
  'Gemfile.lock',
  'composer.json',
  'composer.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'mix.exs',
  'mix.lock',
  'pubspec.yaml',
  'pubspec.lock',
  'Package.swift',
  'Package.resolved',
])

/** The test and CI configuration of the usual tools, by file name or by folder. */
const CONFIGURATION_FILES =
  /^(?:(?:vitest|vite|jest|playwright|cypress|karma|wdio|ava)\.config\.[a-z]+|\.mocharc(?:\.[a-z]+)?|pytest\.ini|tox\.ini|conftest\.py|phpunit\.xml(?:\.dist)?|\.gitlab-ci\.yml|azure-pipelines\.yml|Jenkinsfile|\.travis\.yml|bitbucket-pipelines\.yml)$/
const CONFIGURATION_FOLDERS = /^(?:\.github\/workflows|\.circleci|\.buildkite)\//

/** How a changed file is sorted for the agent of the check: by its name, never by its content. */
export function handedKindOf(path: string): HandedKind {
  const normal = path.replaceAll('\\', '/')
  const name = normal.slice(normal.lastIndexOf('/') + 1)
  if (MANIFESTS.has(name) || /^requirements[\w.-]*\.txt$/.test(name) || name.endsWith('.csproj')) {
    return 'manifest'
  }
  if (CONFIGURATION_FILES.test(name) || CONFIGURATION_FOLDERS.test(normal)) return 'configuration'
  return 'other'
}

/** The longest a Building's branch name grows, after the branch prefix. */
const BRANCH_NAME_MOST = 60

/**
 * The name a Building's Workspace and its branch take (open question 20): a slug of the mission's
 * key and title, `acme-12-export-notes-as-markdown`, cut on a word.
 */
export function buildingBranchName(key: string, title: string): string {
  const slug = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  const whole = [slug(key), slug(title)].filter((part) => part !== '').join('-')
  if (whole.length <= BRANCH_NAME_MOST) return whole
  const cut = whole.slice(0, BRANCH_NAME_MOST + 1)
  const end = cut.lastIndexOf('-')
  return (end > 0 ? cut.slice(0, end) : whole.slice(0, BRANCH_NAME_MOST)).replace(/-+$/, '')
}

/** A mission blocked by the dependencies not Done yet, as the check says it. */
export const blockedBySaid = (keys: ReadonlyArray<string>): string =>
  `blocked by ${keys.join(', ')}`

/** What a launch is refused with when the check no longer holds (CT-25, fourth bullet). */
export const CHECK_EXPIRED = 'Something moved since the check: check again'

/** What the check says of an agent that ended twice without its report. */
export const AGENT_DID_NOT_ANSWER = 'The agent did not answer: launch anyway or check again'

/** What the check says of a mission planned on code the base did not hold (CT-23). */
export const dirtyAtFreezeSaid = (path: string): string =>
  `${path} had uncommitted changes when the Spec was frozen: the Spec may describe code that is not in the base.`

const Bounded = (maximum: number, description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(maximum)).annotate({ description })

/** One file of the brief, as the agent of the check answers it. */
export const PrelaunchItem = Schema.Struct({
  repository: Bounded(200, 'The repository of the file, as your brief names it.'),
  path: Bounded(1000, 'The file, as your brief names it.'),
  matters: Schema.Boolean.annotate({
    description:
      'True when the frozen Spec, a proof, a task or a decision would be wrong or incomplete against this change.',
  }),
  why: Bounded(
    2000,
    'Why it matters, or why not, from what you read: "does not matter" needs a reason.',
  ),
})
export type PrelaunchItem = typeof PrelaunchItem.Type

/** What `prelaunch_report` carries. */
export const PrelaunchReport = Schema.Struct({
  summary: Bounded(4000, 'What you read, in a few sentences.'),
  items: Schema.Array(PrelaunchItem).annotate({
    description: 'Every file of your brief, each answered once.',
  }),
}).annotate({
  description:
    'Report, once, whether each file of your brief matters for what the frozen Spec asks, and why. Then end your turn.',
})
export type PrelaunchReport = typeof PrelaunchReport.Type

/** A file handed to the agent of the check: its repository and its path. */
export interface HandedFile {
  readonly repository: string
  readonly path: string
}

const fileSaid = (file: HandedFile): string => `${file.repository}/${file.path}`

/**
 * Why a report does not answer the files it was handed: a file answered twice, one the check does
 * not know, or one missing; null when every file is answered once.
 */
export function prelaunchReportRefusal(
  handed: ReadonlyArray<HandedFile>,
  items: ReadonlyArray<HandedFile>,
): string | null {
  const known = new Set(handed.map(fileSaid))
  const seen = new Set<string>()
  for (const item of items) {
    const said = fileSaid(item)
    if (!known.has(said)) return `${said} is not a file of your brief.`
    if (seen.has(said)) return `${said} is answered twice.`
    seen.add(said)
  }
  const missing = handed.map(fileSaid).filter((said) => !seen.has(said))
  return missing.length === 0
    ? null
    : `Your report misses ${missing.join(', ')}: answer every file of your brief.`
}

/** What a check's verdict is made of. */
export interface PrelaunchStanding {
  readonly state: CheckState
  /** The keys of the dependencies not Done yet. */
  readonly blocked: ReadonlyArray<string>
  /** Something moved, or the agent said a file matters. */
  readonly outdated: boolean
  /** The agent of the check ended without its report, after its reminder. */
  readonly unanswered: boolean
}

/**
 * The actions a check offers: none while it runs; Check again once it failed; never a launch while
 * a dependency is not Done (open point); Launch anyway and Back to Planning when something moved,
 * Launch anyway and Check again when the agent did not answer, Launch otherwise.
 */
export function prelaunchActions(standing: PrelaunchStanding): ReadonlyArray<PrelaunchAction> {
  if (standing.state === 'running') return []
  if (standing.state === 'failed') return ['check_again']
  if (standing.blocked.length > 0) return ['back_to_planning']
  if (standing.outdated) return ['launch_anyway', 'back_to_planning']
  if (standing.unanswered) return ['launch_anyway', 'check_again']
  return ['launch']
}
