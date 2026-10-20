import { type CatalogueChoice } from './command-line.tsx'

/**
 * The checks of a Project, in its settings: what Hemera runs to judge the work, never the agent.
 *
 * A check runs at one moment — after each task, after each requirement, at the end — and the
 * section reads as those moments, in the order they come: under each, its checks in the order they
 * run, one line each. A line is the command's glyph (a free line wears the terminal's), its name,
 * its line in the mono face, where it runs, the number it expects when it expects one, and two
 * marks in columns of their own: it runs only on some of the files the task wrote, it asks before
 * running. The marks are named once, at the head of the columns, by their legends; a line says
 * everything in words to a screen reader. A check is moved within its moment by its handle, with
 * the pointer or the arrows; it changes moment in its dialog.
 *
 * A Project with no check is offered what the catalogue holds, each proposal where it would run,
 * in the quiet tone, with Accept; Accept all stands in the head. Nothing is kept before it is
 * accepted. What arrives or leaves grows and folds on `fold`, pushing what stands under it.
 *
 * Under the checks, how long a proof may run before Hemera ends it, as the Cap and budget fields
 * are: empty until the user writes in it, the default shown in its quiet tone, the × that empties
 * it, and a value refused said under it.
 */
export type CheckWhen = 'task' | 'requirement' | 'end'

/** Where a check runs: each repository the task changed, the root, or one repository. */
export type CheckWhere = 'changed' | 'root' | 'repository'

/** A number read in the output: the first group the pattern captures, at least the minimum. */
export interface CheckExpect {
  pattern: string
  minimum: string
}

export interface SettingsCheck {
  id: string
  name: string
  /** The catalogue command it runs; null for a line of its own. */
  command: CatalogueChoice | null
  /** The line of its own; null for a command of the catalogue. */
  line: string | null
  where: CheckWhere
  /** The repository it runs in, by path, when `where` is one repository. */
  repository: string | null
  when: CheckWhen
  /** Null: exit code 0. */
  expect: CheckExpect | null
  /** The pattern of the files `{files}` stands for; null when the line has none. */
  files: string | null
}

export const MOMENTS: readonly CheckWhen[] = ['task', 'requirement', 'end']

export const MOMENT_WORDS: Record<CheckWhen, string> = {
  task: 'After each task',
  requirement: 'After each requirement',
  end: 'At the end',
}

/** Where a check runs, as its line says it. */
export function whereOf(check: Pick<SettingsCheck, 'where' | 'repository'>): string {
  if (check.where === 'changed') return 'changed repositories'
  if (check.where === 'root') return 'root'
  return check.repository ?? ''
}

/** The line a check runs: its own, or its catalogue command's. */
export function lineOf(check: Pick<SettingsCheck, 'command' | 'line'>): string {
  return check.command?.line ?? check.line ?? ''
}

/** Everything a line shows, in words, for a screen reader. */
export function wordsOf(check: SettingsCheck): string {
  return [
    check.name,
    check.command === null ? null : 'from the catalogue',
    lineOf(check),
    check.where === 'changed' ? 'in each changed repository' : `in ${whereOf(check)}`,
    check.expect === null ? null : `expects a number of at least ${check.expect.minimum}`,
    check.files === null ? null : `only on the files matching ${check.files}`,
    check.command?.askBeforeRunning === true ? 'asks before running' : null,
  ]
    .filter((part) => part !== null)
    .join(', ')
}

/** What the dialog of a check writes: its catalogue command by id. */
export type CheckDraft = Omit<SettingsCheck, 'id' | 'command'> & { command: string | null }

/** A check not written yet: a line of its own, after each task, on the changed repositories. */
export const NEW_CHECK: CheckDraft = {
  name: '',
  command: null,
  line: '',
  where: 'changed',
  repository: null,
  when: 'task',
  expect: null,
  files: null,
}
