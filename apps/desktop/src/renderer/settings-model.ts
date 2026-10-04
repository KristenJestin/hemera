/**
 * The settings of a Project as the page draws them, read off the engine's records, and the page's
 * drafts turned back into what the engine writes. Plain values and functions: no React, no link.
 *
 * The page names a repository by its path, the engine by its identifier; a line of the page says
 * when in words, the engine in ISO dates; a run is a line per command, the engine a list of every
 * run. Each translation is here, once.
 */

import { FetchedNow, LocalBranch, NotFetchedSince, Unreadable } from '@hemera/ipc'
import type {
  BaseFreshness as EngineFreshness,
  Command,
  CommandDraft as EngineCommandDraft,
  RecipeStep,
  RecipeStepDraft,
  Repository,
  RepositoryStatus,
  Run,
} from '@hemera/ipc'
import type {
  BaseFreshness,
  CommandDraft,
  LiveState,
  SettingsCommand,
  SettingsRepository,
  SettingsRun,
  SettingsStep,
  StepDraft,
} from '@hemera/ui'
import { Schema } from 'effect'

const isLocal = Schema.is(LocalBranch)
const isNotFetched = Schema.is(NotFetchedSince)
const isFetchedNow = Schema.is(FetchedNow)
const isUnreadable = Schema.is(Unreadable)

/** The path the main checkout itself has as a repository, and the place of what runs at its root. */
const ROOT = '.'

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const DAY_OF_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const sameDay = (one: Date, other: Date): boolean =>
  one.getFullYear() === other.getFullYear() &&
  one.getMonth() === other.getMonth() &&
  one.getDate() === other.getDate()

/** When something happened, as a line says it: `09:02` today, `yesterday`, `28 Sept` before. */
export function whenOf(iso: string, now: Date): string {
  const at = new Date(iso)
  if (sameDay(at, now)) return TIME.format(at)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(at, yesterday)) return 'yesterday'
  return at.getFullYear() === now.getFullYear() ? DAY.format(at) : DAY_OF_YEAR.format(at)
}

/** What the window learnt of a repository in this visit: what Git read, and its last fetch. */
export interface RepositoryRead {
  readonly status?: RepositoryStatus | undefined
  readonly fetch?: EngineFreshness | undefined
}

/**
 * How fresh a repository's base is: no remote, the fetch just made or the one that failed, or
 * the last fetch the Profile recorded.
 */
export function freshnessOf(
  repository: Repository,
  fetch: EngineFreshness | undefined,
  now: Date,
): BaseFreshness {
  if (repository.remote === null || isLocal(fetch)) return { kind: 'local' }
  if (isNotFetched(fetch)) {
    // Never fetched, and the fetch just tried failed: since it was added, and why.
    const since = fetch.since === null ? 'it was added' : whenOf(fetch.since, now)
    return { kind: 'old', since, reason: fetch.reason }
  }
  const at = isFetchedNow(fetch) ? fetch.at : repository.lastFetchedAt
  return at === null ? { kind: 'never' } : { kind: 'fetched', when: whenOf(at, now) }
}

/** A repository's line: its path, its base and its freshness, or Git's reason it cannot be read. */
export function repositoryRowOf(
  repository: Repository,
  read: RepositoryRead,
  now: Date,
): SettingsRepository {
  const row: SettingsRepository = {
    id: repository.id,
    path: repository.path,
    includedByDefault: repository.includedByDefault,
    remote: repository.remote,
    baseBranch: repository.baseBranch,
    freshness: freshnessOf(repository, read.fetch, now),
  }
  return isUnreadable(read.status) ? { ...row, unreadable: read.status.reason } : row
}

/** A repository's path by its identifier: the root for none, or for one no longer there. */
function pathOf(repositories: ReadonlyArray<Repository>, id: string | null): string {
  return repositories.find((one) => one.id === id)?.path ?? ROOT
}

/** A repository's identifier by its path: none for the root. */
function idOf(repositories: ReadonlyArray<Repository>, path: string): string | null {
  return path === ROOT ? null : (repositories.find((one) => one.path === path)?.id ?? null)
}

/** A command's line in the catalogue. */
export function commandRowOf(
  command: Command,
  repositories: ReadonlyArray<Repository>,
): SettingsCommand {
  return {
    id: command.id,
    name: command.name,
    type: command.type,
    line: command.line,
    lineLinux: command.lineLinux,
    lineWindows: command.lineWindows,
    place: pathOf(repositories, command.repositoryId),
    folder: command.folder,
    scope: command.scope,
    check: command.check,
    atOpen: command.atOpen,
    askBeforeRunning: command.askBeforeRunning,
    readOnly: command.readOnly,
    writeGlobs: command.writeGlobs,
  }
}

/**
 * A command's form, written back as the engine takes it: its repository by its identifier, the
 * empty lines of the files field left out, and what the form does not show (Portless) kept as it
 * was.
 */
export function commandDraftOf(
  draft: CommandDraft,
  previous: Command | null,
  repositories: ReadonlyArray<Repository>,
): EngineCommandDraft {
  return {
    name: draft.name,
    type: draft.type,
    line: draft.line,
    lineWindows: draft.lineWindows,
    lineLinux: draft.lineLinux,
    repositoryId: idOf(repositories, draft.place),
    folder: draft.folder,
    scope: draft.scope,
    portless: previous?.portless ?? false,
    portlessName: previous?.portlessName ?? null,
    check: draft.check,
    atOpen: draft.atOpen,
    askBeforeRunning: draft.askBeforeRunning,
    readOnly: draft.readOnly,
    writeGlobs: draft.writeGlobs.filter((glob) => glob.trim() !== ''),
  }
}

/** A command's form, as it opens on a command of the catalogue. */
export function commandFormOf(
  command: Command,
  repositories: ReadonlyArray<Repository>,
): CommandDraft {
  const { id: _id, ...draft } = commandRowOf(command, repositories)
  return draft
}

/**
 * The steps of the recipe on their lines: where each applies, what it does — a run by its
 * command's name — and what is wrong with it, by its position.
 */
export function stepRowsOf(
  steps: ReadonlyArray<RecipeStep>,
  repositories: ReadonlyArray<Repository>,
  catalogue: ReadonlyArray<Command>,
  problems: ReadonlyMap<number, string>,
): SettingsStep[] {
  return steps.map((step) => {
    const row: SettingsStep = {
      id: step.id,
      kind: step.kind,
      place: pathOf(repositories, step.repositoryId),
      path: step.kind === 'run' ? null : step.path,
      command:
        step.commandId === null
          ? null
          : (catalogue.find((one) => one.id === step.commandId)?.name ?? step.commandId),
      line: step.line,
    }
    const problem = problems.get(step.position)
    return problem === undefined ? row : { ...row, problem }
  })
}

/** A step's form, as it opens on a step of the recipe: a run's command by its identifier. */
export function stepDraftOf(step: RecipeStep, repositories: ReadonlyArray<Repository>): StepDraft {
  return {
    kind: step.kind,
    place: pathOf(repositories, step.repositoryId),
    path: step.kind === 'run' ? null : step.path,
    command: step.commandId,
    line: step.line,
  }
}

/**
 * A step's form written back as the engine takes it: a copy or a link names a path and nothing
 * to run; a run names a command or a line, and keeps the folder it ran in, which the form does
 * not show.
 */
export function recipeDraftOf(
  draft: StepDraft,
  repositories: ReadonlyArray<Repository>,
  previous: RecipeStep | null,
): RecipeStepDraft {
  const repositoryId = idOf(repositories, draft.place)
  if (draft.kind !== 'run') {
    return { kind: draft.kind, repositoryId, path: draft.path, commandId: null, line: null }
  }
  return {
    kind: 'run',
    repositoryId,
    path: previous?.kind === 'run' ? previous.path : null,
    commandId: draft.command,
    line: draft.command === null ? draft.line : null,
  }
}

/** A step of the recipe as the engine writes it again, unchanged. */
export function recipeDraftOfStep(step: RecipeStep): RecipeStepDraft {
  return {
    kind: step.kind,
    repositoryId: step.repositoryId,
    path: step.path,
    commandId: step.commandId,
    line: step.line,
  }
}

/** How a run's state is drawn: waiting is a line of its own, every other a live line's mark. */
const LIVE: Record<Exclude<Run['state'], 'waiting_for_permission'>, LiveState> = {
  starting: 'running',
  running: 'running',
  ready: 'running',
  done: 'finished',
  failed: 'failed',
  stopped: 'stopped',
  interrupted: 'stopped',
}

const isLive = (state: Run['state']): boolean =>
  state === 'waiting_for_permission' ||
  state === 'starting' ||
  state === 'running' ||
  state === 'ready'

/** The line a command's row is known by, whichever of its runs it shows. */
export const commandLineId = (commandId: string): string => `command:${commandId}`

/** The line a run of a line of its own is known by. */
export const freeLineId = (runId: string): string => `run:${runId}`

function rowOfRun(
  id: string,
  run: Run,
  name: string,
  place: string,
  outputs: ReadonlyMap<string, ReadonlyArray<string>>,
): SettingsRun {
  const common = { id, name, type: run.type, line: run.line, place }
  if (run.state === 'waiting_for_permission') return { kind: 'waiting', ...common }
  const output = outputs.get(run.id)
  return {
    kind: 'live',
    ...common,
    state: LIVE[run.state],
    startedAt: Date.parse(run.startedAt),
    endedAt: run.endedAt === null ? null : Date.parse(run.endedAt),
    url: run.url ?? undefined,
    output: output === undefined ? undefined : [...output],
  }
}

/**
 * What runs in the main checkout, one line per command in the order of the catalogue: its last
 * run as it stands or ended, a service of the main checkout never started with Start, then the
 * lines of their own still running. A line keeps its identity across the runs it shows, so a
 * restart changes the line in place.
 */
export function runRowsOf(
  runs: ReadonlyArray<Run>,
  catalogue: ReadonlyArray<Command>,
  repositories: ReadonlyArray<Repository>,
  outputs: ReadonlyMap<string, ReadonlyArray<string>>,
): SettingsRun[] {
  const rows: SettingsRun[] = []
  for (const command of catalogue) {
    const place = pathOf(repositories, command.repositoryId)
    const id = commandLineId(command.id)
    // The runs come newest first: the first of a command is its last.
    const last = runs.find((one) => one.commandId === command.id)
    if (last !== undefined) rows.push(rowOfRun(id, last, command.name, place, outputs))
    else if (command.type === 'serve' && command.scope === 'project') {
      rows.push({
        kind: 'idle',
        id,
        name: command.name,
        type: command.type,
        line: command.line,
        place,
      })
    }
  }
  for (const free of runs) {
    if (free.commandId !== null || !isLive(free.state)) continue
    rows.push(rowOfRun(freeLineId(free.id), free, free.name, ROOT, outputs))
  }
  return rows
}

/** The run a line shows now, by the line's identity; none for a service never started. */
export function runOfLine(runs: ReadonlyArray<Run>, lineId: string): Run | undefined {
  if (lineId.startsWith('run:')) return runs.find((one) => freeLineId(one.id) === lineId)
  return runs.find((one) => one.commandId !== null && commandLineId(one.commandId) === lineId)
}

/** The last lines of what a run printed, as the glance shows them. */
export function linesOf(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .slice(-8)
}
