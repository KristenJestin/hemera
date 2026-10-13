/**
 * The Project's checks (#143): how Hemera judges a Building's work, never with the agent's word.
 *
 * A check is a catalogue command or a free line, run where the Project says (the Workspace root,
 * one repository, or each repository the work changed) and when (after a task, after a
 * requirement, at the end). It is green when it exits 0 and, with an `expect`, when the number its
 * output shows is at least the minimum. `{files}` in a line is filled with the files the attempt
 * wrote that match the check's filter; with none, the check is skipped there.
 *
 * Pure rules: the engine keeps the checks, copies them into a mission at launch and runs them.
 */

import { Result, Schema } from 'effect'

import { type CommandType, checkedLine } from './commands.ts'
import { checkedTemplate } from './workspace.ts'

/** Where a check runs: the Workspace root, one repository, or each repository the work changed. */
export const CHECK_WHERE = ['root', 'repository', 'changed'] as const
export const CheckWhere = Schema.Literals(CHECK_WHERE)
export type CheckWhere = typeof CheckWhere.Type

/** When a check runs: after a task, once a requirement's tasks are done, or at the end. */
export const CHECK_WHEN = ['task', 'requirement', 'end'] as const
export const CheckWhen = Schema.Literals(CHECK_WHEN)
export type CheckWhen = typeof CheckWhen.Type

/** The number a check's output must show: the first capture of `pattern`, at least `minimum`. */
export const CheckExpect = Schema.Struct({ pattern: Schema.String, minimum: Schema.Number })
export type CheckExpect = typeof CheckExpect.Type

/**
 * A check as the settings write it: a catalogue command or a line, exactly one of the two; where
 * and when it runs; the number it expects, or null for exit code 0; the filter `{files}` is filled
 * with. `repository` is the repository's name in the Workspace, only when `where` is `repository`.
 */
export const CheckDraft = Schema.Struct({
  name: Schema.String,
  commandId: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.String),
  where: CheckWhere,
  repository: Schema.NullOr(Schema.String),
  when: CheckWhen,
  expect: Schema.NullOr(CheckExpect),
  files: Schema.NullOr(Schema.String),
})
export type CheckDraft = typeof CheckDraft.Type

/** A check of a Project: a draft kept, ordered by its rank. */
export const ProjectCheck = Schema.Struct({
  ...CheckDraft.fields,
  id: Schema.String,
  projectId: Schema.String,
  rank: Schema.Number,
})
export type ProjectCheck = typeof ProjectCheck.Type

/** What `{files}` in a check's line is filled with. */
export const FILES_PLACEHOLDER = '{files}'

/** How many capture groups a pattern has, or null when it is no regular expression. */
function groupsIn(pattern: string): number | null {
  try {
    const valid = new RegExp(pattern, 'm')
    // An alternative that matches the empty text makes every group of the pattern appear, unset.
    return (new RegExp(`${valid.source}|`).exec('')?.length ?? 1) - 1
  } catch {
    return null
  }
}

/** Why a pattern cannot read a number, or null when it can. */
function patternProblem(pattern: string): string | null {
  if (pattern.trim() === '') return 'Write the pattern the number is read with.'
  const groups = groupsIn(pattern)
  if (groups === null) return 'The pattern is not a valid regular expression.'
  if (groups === 0) {
    return 'Put the number to read between parentheses in the pattern, as in Coverage: ([0-9.]+)%.'
  }
  return groups > 1 ? 'The pattern reads one number: keep exactly one pair of parentheses.' : null
}

/** Why a files filter cannot be used, or null when it can. */
function filterProblem(filter: string): string | null {
  if (filter.trim() === '') return 'Write the files filter, as in **/*.test.ts, or remove it.'
  let depth = 0
  for (const character of filter) {
    if (character === '{') depth++
    if (character === '}' && depth > 0) depth--
  }
  return depth > 0 ? 'The files filter opens a { it does not close.' : null
}

/**
 * Why a free line cannot run, or null: #7's line rules, `{files}` being Hemera's to fill. Shell
 * syntax, a glob among them, is refused naming the token.
 */
function lineProblem(line: string): string | null {
  const plain = line.replaceAll(FILES_PLACEHOLDER, 'files')
  const syntax = checkedLine(plain)
  if (Result.isFailure(syntax)) return syntax.failure.message
  const template = checkedTemplate(plain)
  return Result.isFailure(template) ? template.failure.message : null
}

/** The field of the settings a check's refusal is said under; null for the check as a whole. */
export const CHECK_FIELDS = ['name', 'line', 'pattern', 'minimum', 'files'] as const
export const CheckField = Schema.Literals(CHECK_FIELDS)
export type CheckField = typeof CheckField.Type

/** Why a check cannot be saved: the sentence the settings show, and the field it is said under. */
export interface CheckRefusal {
  readonly field: CheckField | null
  readonly sentence: string
}

const refusedAt = (field: CheckField | null, sentence: string | null): CheckRefusal | null =>
  sentence === null ? null : { field, sentence }

/**
 * Why a check cannot be saved, and where the settings say it, or null when it can be. `taken`
 * are the names of the Project's other checks: two checks never share one.
 */
export function checkRefusal(draft: CheckDraft, taken: ReadonlyArray<string>): CheckRefusal | null {
  const name = draft.name.trim()
  if (name === '') return refusedAt('name', 'Give the check a name.')
  if (taken.includes(name)) return refusedAt('name', `A check named “${name}” already exists.`)
  const line = draft.line?.trim() ?? ''
  if (draft.commandId !== null && line !== '') {
    return refusedAt(null, 'A check runs a command of the catalogue or a line, not both.')
  }
  if (draft.commandId === null && line === '') {
    return refusedAt('line', 'Choose a command of the catalogue or write a line to run.')
  }
  if (draft.where === 'repository' && draft.repository === null) {
    return refusedAt(null, 'Choose the repository the check runs in.')
  }
  if (draft.where !== 'repository' && draft.repository !== null) {
    return refusedAt(null, 'Only a check that runs in one repository names a repository.')
  }
  if (draft.expect !== null) {
    const problem = patternProblem(draft.expect.pattern)
    if (problem !== null) return refusedAt('pattern', problem)
    if (!Number.isFinite(draft.expect.minimum))
      return refusedAt('minimum', 'The minimum must be a number.')
  }
  if (draft.files !== null) {
    const problem = filterProblem(draft.files)
    if (problem !== null) return refusedAt('files', problem)
  }
  if (line === '') return null
  if (line.includes(FILES_PLACEHOLDER) && draft.files === null) {
    return refusedAt(
      'files',
      'Set the files filter {files} is filled with, as in **/*.test.ts, or take {files} out of the line.',
    )
  }
  return refusedAt('line', lineProblem(line))
}

/** Why a check cannot be saved, as the sentence the settings show, or null when it can be. */
export function checkProblem(draft: CheckDraft, taken: ReadonlyArray<string>): string | null {
  return checkRefusal(draft, taken)?.sentence ?? null
}

/**
 * How long a proof may run before Hemera ends it, in minutes (#321): the Project's setting beside
 * its checks, this default while it has none. A proof is a scenario's test, far under ten minutes;
 * past two hours it holds the end of the Building for longer than any test should take.
 */
export const DEFAULT_PROOF_MINUTES = 10
export const MAX_PROOF_MINUTES = 120

/** Why a proof's time limit cannot be kept, as the settings show it, or null when it can. */
export function proofLimitRefusal(minutes: number): string | null {
  if (!Number.isInteger(minutes)) return 'Write a whole number of minutes.'
  if (minutes < 1) return 'A proof needs at least 1 minute.'
  if (minutes > MAX_PROOF_MINUTES) {
    return `A proof may run ${String(MAX_PROOF_MINUTES)} minutes at most: a longer one holds the end of the Building for hours.`
  }
  return null
}

/** The command types a check is proposed from, and when and where each runs by default. */
const PROPOSED: Partial<Record<CommandType, Pick<CheckDraft, 'when' | 'where'>>> = {
  lint: { when: 'task', where: 'changed' },
  typecheck: { when: 'task', where: 'changed' },
  test: { when: 'requirement', where: 'changed' },
  build: { when: 'end', where: 'root' },
  e2e: { when: 'end', where: 'root' },
}

/** What a proposal reads of a catalogue command. */
export interface ProposedFrom {
  readonly id: string
  readonly name: string
  readonly type: CommandType
  /** Marked as usable as a check. */
  readonly check: boolean
  /** The repository the catalogue binds it to, or null for the root. */
  readonly repositoryId: string | null
}

/**
 * The checks proposed from a catalogue, in its order: its commands marked as checks, by their
 * type; a `serve` never. A command bound to one repository runs where the catalogue puts it, not
 * in each changed repository: its line is written for its own. Nothing is kept by proposing.
 */
export function proposeChecks(commands: ReadonlyArray<ProposedFrom>): CheckDraft[] {
  return commands.flatMap((command) => {
    const proposed = command.check ? PROPOSED[command.type] : undefined
    if (proposed === undefined) return []
    return [
      {
        name: command.name,
        commandId: command.id,
        line: null,
        where: command.repositoryId !== null ? 'root' : proposed.where,
        repository: null,
        when: proposed.when,
        expect: null,
        files: null,
      },
    ]
  })
}

/**
 * Where one check runs: `''` for the Workspace root, its one repository, or each repository in
 * `changed`. A catalogue command at the root runs where the catalogue puts it; the engine says so.
 */
export function checkPlaces(
  check: Pick<CheckDraft, 'where' | 'repository'>,
  changed: ReadonlyArray<string>,
): string[] {
  switch (check.where) {
    case 'root':
      return ['']
    case 'repository':
      return [check.repository ?? '']
    case 'changed':
      return [...changed]
  }
}

/** What a run is judged: its verdict, the number read, and why it is red ('' when green). */
export interface CheckJudgement {
  readonly verdict: 'green' | 'red'
  readonly value: number | null
  readonly detail: string
}

/**
 * The number an output shows for a pattern: the first capture of its first match, read line by
 * line. A decimal with an optional sign and `%`, a dot or a comma as the separator; anything else
 * is no number.
 */
function numberIn(output: string, pattern: string): number | null {
  const captured = new RegExp(pattern, 'm').exec(output)?.[1]?.trim().replace(/\s*%$/, '')
  if (captured === undefined || !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(captured)) return null
  return Number(captured.replace(',', '.'))
}

/**
 * The verdict of a check's run: red when it did not exit 0, whatever it printed; red when its
 * `expect` matched no number or one under the minimum; green otherwise.
 */
export function evaluateExpect(
  output: string,
  exitCode: number | null,
  expect: CheckExpect | null,
): CheckJudgement {
  const value = expect === null ? null : numberIn(output, expect.pattern)
  if (exitCode !== 0) {
    const detail =
      exitCode === null ? 'ended without an exit code' : `exited with ${String(exitCode)}`
    return { verdict: 'red', value, detail }
  }
  if (expect === null) return { verdict: 'green', value, detail: '' }
  if (value === null) {
    return { verdict: 'red', value, detail: `no number matched /${expect.pattern}/` }
  }
  if (value < expect.minimum) {
    return { verdict: 'red', value, detail: `${String(value)} < ${String(expect.minimum)}` }
  }
  return { verdict: 'green', value, detail: '' }
}

/**
 * Whether a path matches a glob: `*` any characters but `/`, `?` one of them, `**` any folders
 * (`**\/` none or several whole ones), `{a,b}` either part. The glob matches the whole path.
 */
export function globMatcher(glob: string): (path: string) => boolean {
  let source = ''
  let depth = 0
  for (let at = 0; at < glob.length; at++) {
    const character = glob.charAt(at)
    if (character === '*' && glob.charAt(at + 1) === '*') {
      const folders = glob.charAt(at + 2) === '/'
      source += folders ? '(?:.*/)?' : '.*'
      at += folders ? 2 : 1
    } else if (character === '*') {
      source += '[^/]*'
    } else if (character === '?') {
      source += '[^/]'
    } else if (character === '{') {
      source += '(?:'
      depth++
    } else if (character === '}' && depth > 0) {
      source += ')'
      depth--
    } else if (character === ',' && depth > 0) {
      source += '|'
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  const expression = new RegExp(`^${source}${')'.repeat(depth)}$`)
  return (path) => expression.test(path)
}

/**
 * One file as one word of a line run without a shell: a plain path as it is, any other in single
 * quotes, where nothing is shell syntax (a quote inside joined as `"'"`). A path starting with `-`
 * gets `./`, so it is never read as an option. A brace is doubled, so the run's templates keep it
 * literal.
 */
function asWord(path: string): string {
  const relative = path.startsWith('-') ? `./${path}` : path
  const literal = relative.replaceAll('{', '{{').replaceAll('}', '}}')
  if (/^[\w./@+=:{}-]+$/.test(literal)) return literal
  return literal
    .split("'")
    .map((part) => `'${part}'`)
    .join(`"'"`)
}

/** A file an attempt wrote in the place a check runs, relative to it. */
export interface WrittenFile {
  readonly path: string
  readonly deleted: boolean
}

/**
 * The line a check runs, or null when it is skipped: with `{files}`, the files written here that
 * match the filter, deleted ones left out, each one word; none matching skips it. A line without
 * `{files}` is returned as it is.
 */
export function expandFiles(
  line: string,
  written: ReadonlyArray<WrittenFile>,
  filter: string | null,
): string | null {
  if (!line.includes(FILES_PLACEHOLDER)) return line
  const matches = filter === null ? () => true : globMatcher(filter)
  const files = written.filter((file) => !file.deleted && matches(file.path))
  if (files.length === 0) return null
  return line.replaceAll(FILES_PLACEHOLDER, files.map((file) => asWord(file.path)).join(' '))
}
