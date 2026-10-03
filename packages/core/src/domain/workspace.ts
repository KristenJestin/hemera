/**
 * The rules of a Workspace: its name, its branch, its preparation, the environment it runs with,
 * and the template names Hemera fills.
 *
 * A Workspace is the isolated folder where a mission's code is built: one Git worktree per chosen
 * repository of the Project, prepared by the Project's recipe (copy a file, link a folder, run a
 * command) and run with the Project's and the Workspace's variables. What is here is pure: every
 * act on the disk, on Git or on a process belongs to the engine, which asks these rules first.
 *
 * Each rule answers a `Result`: a refusal is a value with its reason, never a throw.
 */

import { Result, Schema } from 'effect'

import { InvalidBranchName, branchNameRefusal } from './project.ts'

/**
 * The name the main checkout answers to where a Workspace's name is asked for: `{workspace}` in
 * the main checkout, as the 0.x `main` Workspace was named.
 */
export const MAIN_CHECKOUT_NAME = 'main'

/** What a step of a preparation does: a worktree, or one of the three kinds of a recipe step. */
export const STEP_KINDS = ['worktree', 'copy', 'link', 'run'] as const
export type StepKind = (typeof STEP_KINDS)[number]

/** What a step of a Project's recipe does: copy a file or folder, link one, or run a command. */
export const RECIPE_KINDS = ['copy', 'link', 'run'] as const
export type RecipeKind = (typeof RECIPE_KINDS)[number]

/** Where a step stands; `skipped` is a step that had nothing to do, and counts as done. */
export const STEP_STATES = ['pending', 'running', 'done', 'failed', 'skipped'] as const
export type StepState = (typeof STEP_STATES)[number]

/**
 * Where a preparation stands: nothing started yet, under way (or interrupted), every step done,
 * or stopped by the step that failed.
 */
export const PREPARATION_STATES = ['pending', 'preparing', 'ready', 'failed'] as const
export type PreparationState = (typeof PREPARATION_STATES)[number]

/** The names Hemera fills in a variable's value, a recipe step's line or path, a command's line. */
export const TEMPLATE_NAMES = ['workspace', 'workspace.path', 'project', 'branch'] as const
export type TemplateName = (typeof TEMPLATE_NAMES)[number]

/**
 * What each name is filled with: `workspace` the Workspace's folder name, `workspace.path` its
 * absolute folder, `project` the Project's name as a slug, `branch` the Workspace's branch, empty
 * when it has none.
 */
export type TemplateValues = Readonly<Record<TemplateName, string>>

/** Characters no folder name holds on Windows, refused on every system so a name travels. */
// oxlint-disable-next-line no-control-regex -- a control character is exactly what is refused
const NOT_IN_A_FOLDER_NAME = /[<>:"|?*\u0000-\u001f]/

export class InvalidWorkspaceName extends Schema.TaggedError<InvalidWorkspaceName>()(
  'InvalidWorkspaceName',
  { name: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `This Workspace name is refused: ${this.reason}.`
  }
}

export class InvalidVariableKey extends Schema.TaggedError<InvalidVariableKey>()(
  'InvalidVariableKey',
  { key: Schema.String },
) {
  override get message(): string {
    return `“${this.key}” is not a variable name: letters, digits and underscores, not starting with a digit.`
  }
}

/**
 * A template Hemera cannot fill: a name it does not know, or a brace never closed. It names what
 * is wrong and never carries the text itself, which may be a secret's value.
 */
export class InvalidTemplate extends Schema.TaggedError<InvalidTemplate>()('InvalidTemplate', {
  /** The unknown name, or null for a brace never closed. */
  name: Schema.NullOr(Schema.String),
}) {
  override get message(): string {
    return this.name === null
      ? 'A “{” is never closed: write “{{” for a brace.'
      : `“{${this.name}}” is not a name Hemera fills: ${TEMPLATE_NAMES.map((one) => `{${one}}`).join(', ')}.`
  }
}

/**
 * The name a Workspace is created with, which is also its folder under the Workspaces root: one
 * folder name, never a path, without the spaces around it.
 */
export function workspaceName(candidate: string): Result.Result<string, InvalidWorkspaceName> {
  const name = candidate.trim()
  const refused = (reason: string) => Result.fail(new InvalidWorkspaceName({ name, reason }))
  if (name.length === 0) return refused('it is empty')
  if (name.includes('/') || name.includes('\\')) return refused('it is a folder name, not a path')
  if (name === '.' || name.includes('..')) return refused('it would leave the Workspaces folder')
  if (NOT_IN_A_FOLDER_NAME.test(name)) return refused('it holds a character a folder cannot')
  return Result.succeed(name)
}

/** The branch a Workspace's worktrees are made on: `<branch prefix>/<name>`, one Git accepts. */
export function workspaceBranch(
  prefix: string,
  name: string,
): Result.Result<string, InvalidBranchName> {
  const branch = `${prefix}/${name}`
  const reason = branchNameRefusal(branch)
  return reason === null
    ? Result.succeed(branch)
    : Result.fail(new InvalidBranchName({ name: branch, reason }))
}

/** What the rules of a preparation read of a step. */
export interface StepProgress {
  readonly id: string
  /** Its place in the preparation, counting from one. */
  readonly position: number
  readonly kind: StepKind
  readonly state: StepState
}

/** Where a preparation stands from its steps. */
export function preparationStateOf(steps: ReadonlyArray<StepProgress>): PreparationState {
  if (steps.every((step) => step.state === 'done' || step.state === 'skipped')) return 'ready'
  if (steps.some((step) => step.state === 'failed')) return 'failed'
  if (steps.every((step) => step.state === 'pending')) return 'pending'
  return 'preparing'
}

/**
 * The steps of a preparation as a resume finds them. A `done` step whose result is no longer on
 * the disk (`present` answers that) is `pending` again, the `failed` one is retried, and one an
 * engine that stopped left `running` is started again. A `run` that is done is never run again:
 * what a command did is not something the disk can be asked about.
 */
export function resumedSteps<S extends StepProgress>(
  steps: ReadonlyArray<S>,
  present: (step: S) => boolean,
): ReadonlyArray<S> {
  return steps.map((step) => {
    const redone =
      step.state === 'failed' ||
      step.state === 'running' ||
      (step.state === 'done' && step.kind !== 'run' && !present(step))
    return redone ? { ...step, state: 'pending' } : step
  })
}

/** The step a preparation carries on with: the first one still `pending`, or none. */
export function nextPending<S extends StepProgress>(steps: ReadonlyArray<S>): S | undefined {
  return steps
    .filter((step) => step.state === 'pending')
    .toSorted((one, other) => one.position - other.position)[0]
}

/** The name of an environment variable, as a shell takes it. */
export function variableKey(candidate: string): Result.Result<string, InvalidVariableKey> {
  const key = candidate.trim()
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    ? Result.succeed(key)
    : Result.fail(new InvalidVariableKey({ key: candidate }))
}

/**
 * The environment a process of a Workspace is given: the process's own, then the Project's
 * variables over it, then the Workspace's over those. A variable the process holds with no value
 * is not one, and is left out.
 */
export function mergedEnvironment(
  process: Readonly<Record<string, string | undefined>>,
  project: Readonly<Record<string, string>>,
  workspace: Readonly<Record<string, string>>,
): Record<string, string> {
  const merged = new Map<string, string>()
  for (const [key, value] of Object.entries(process)) {
    if (value !== undefined) merged.set(key, value)
  }
  for (const [key, value] of [...Object.entries(project), ...Object.entries(workspace)]) {
    merged.set(key, value)
  }
  return Object.fromEntries(merged)
}

type Piece = { readonly text: string } | { readonly name: TemplateName }

const isTemplateName = (name: string): name is TemplateName =>
  TEMPLATE_NAMES.some((known) => known === name)

/** A template read into its pieces: text, and the names to fill. */
function piecesOf(template: string): Result.Result<ReadonlyArray<Piece>, InvalidTemplate> {
  const pieces: Piece[] = []
  let text = ''
  let at = 0
  while (at < template.length) {
    const character = template[at]
    if (character !== '{') {
      text += character
      at += 1
      continue
    }
    if (template[at + 1] === '{') {
      text += '{'
      at += 2
      continue
    }
    const close = template.indexOf('}', at)
    if (close === -1) return Result.fail(new InvalidTemplate({ name: null }))
    const name = template.slice(at + 1, close)
    if (!isTemplateName(name)) return Result.fail(new InvalidTemplate({ name }))
    pieces.push({ text }, { name })
    text = ''
    at = close + 1
  }
  pieces.push({ text })
  return Result.succeed(pieces)
}

/** A template, refused when it names something Hemera does not fill; kept as it was written. */
export function checkedTemplate(template: string): Result.Result<string, InvalidTemplate> {
  return Result.map(piecesOf(template), () => template)
}

/**
 * A template with its names filled and `{{` written as one brace. A template that was checked
 * when it was saved is always filled; one that cannot be read is answered as it was written.
 */
export function fillTemplate(template: string, values: TemplateValues): string {
  const pieces = piecesOf(template)
  if (Result.isFailure(pieces)) return template
  return pieces.success.map((piece) => ('name' in piece ? values[piece.name] : piece.text)).join('')
}
