/**
 * The report Hemera asks a proof's runner for (#342, round 9). For a known runner its command
 * invokes itself, Hemera adds the reporter flags (`withReporting`): the report goes to a folder of
 * the run's own in the system's temporary folder, outside every repository, so neither freshness
 * nor the change detector sees it, and no file a test writes in a repository is taken for it.
 *
 * A repository's report set by hand in Project settings (#421) is the one exception: the command
 * runs as written, writing its report at that path of the repository, never emptied by Hemera, and
 * read only while the path, every link on its way followed, stays inside the repository.
 *
 * The path is emptied right before the run launches; after it, the file is read only when it is a
 * regular file written since: opened without following a link and without waiting on a pipe (on
 * Windows, where a test's folder holds no pipe, a link is followed), its size and age checked on
 * the open handle, and never read past the cap.
 */

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  REPORT_CAP,
  type ReportFormat,
  type ReportFound,
  type TestReporting,
  type TestRunner,
  foundReport,
  withReporting,
} from '@hemera/core/domain'

import { leadsOutside } from '../repository-tests.ts'

/** The report a proof's run is asked for: the line run, the flags added, and where it goes. */
export interface ReportPlan extends Omit<
  NonNullable<ReturnType<typeof withReporting>>,
  'reporting'
> {
  readonly reporting: TestReporting
  readonly path: string
  readonly folder: string
  /** Where a report set in Project settings is written: its repository, and its path from there. */
  readonly repository?: { readonly root: string; readonly path: string }
}

/** How the report is opened: never through a link, never waiting on a pipe (POSIX only). */
const OPENED =
  process.platform === 'win32'
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK

const NOT_A_FILE: ReportFound = { kind: 'unreadable', reason: 'not a regular file' }
const MISSING: ReportFound = { kind: 'unreadable', reason: 'missing' }
const OUTSIDE: ReportFound = { kind: 'unreadable', reason: 'it leads outside the repository' }

/**
 * The report a proof's command is asked for, in a new folder of its own; null, and no folder left,
 * when Hemera adds no reporting to it (a script, a runner it does not know, one writing its own),
 * or the runner it would ask is not the one Project settings name (`runner`).
 */
export const reportFor = (command: string, runner?: TestRunner): ReportPlan | null => {
  const folder = mkdtempSync(join(tmpdir(), 'hemera-report-'))
  const path = join(folder, 'report')
  const added = withReporting(command, path)
  if (added === null || (runner !== undefined && added.reporting.runner !== runner)) {
    rmSync(folder, { recursive: true, force: true })
    return null
  }
  return { ...added, path, folder }
}

/**
 * The report a repository's Project settings set (#421): the command as written, its report at
 * `report.path` of the repository at `root`, and a folder of the run's own for its start's time.
 */
export const reportIn = (
  command: string,
  root: string,
  runner: TestRunner,
  report: { readonly format: ReportFormat; readonly path: string },
): ReportPlan => {
  const folder = mkdtempSync(join(tmpdir(), 'hemera-report-'))
  const path = join(root, report.path)
  return {
    line: command,
    added: '',
    reporting: { runner, report: { format: report.format, path } },
    path,
    folder,
    repository: { root, path: report.path },
  }
}

/** The bytes of an open file, at most `size` and never past the cap. */
const readOpen = (file: number, size: number): string => {
  const buffer = Buffer.alloc(Math.min(size, REPORT_CAP))
  let length = 0
  for (let read = -1; read !== 0 && length < buffer.length; length += read) {
    read = readSync(file, buffer, length, buffer.length - length, length)
  }
  return buffer.toString('utf8', 0, length)
}

/**
 * The report at a path, read when it is a regular file written since `startedMs`: opened without
 * following a link nor waiting on a pipe, then checked on its handle, which a file put in its
 * place after the check cannot change.
 */
const readReport = (path: string, startedMs: number): ReportFound => {
  let file: number
  try {
    file = openSync(path, OPENED)
  } catch {
    return lstatSync(path, { throwIfNoEntry: false }) === undefined ? MISSING : NOT_A_FILE
  }
  try {
    const stat = fstatSync(file)
    if (!stat.isFile()) return NOT_A_FILE
    return foundReport({ size: stat.size, modifiedMs: stat.mtimeMs }, startedMs, () =>
      readOpen(file, stat.size),
    )
  } catch {
    return NOT_A_FILE
  } finally {
    closeSync(file)
  }
}

/**
 * Empties the report's path right before the run launches, and answers how to read it once the
 * run has ended: only what the run wrote is read.
 */
export const prepareReport = (plan: ReportPlan): (() => ReportFound) => {
  // A file of the repository is the user's: its age alone tells it from the run's.
  if (plan.repository === undefined) rmSync(plan.path, { recursive: true, force: true })
  // The run's start on the file system's own clock, which a file's time is written on: coarser
  // than the process's, a report written at once could otherwise look older than the run.
  const started = join(plan.folder, 'started')
  writeFileSync(started, '')
  const startedMs = statSync(started).mtimeMs
  const { repository } = plan
  if (repository === undefined) return () => readReport(plan.path, startedMs)
  return () =>
    leadsOutside(repository.root, repository.path) ? OUTSIDE : readReport(plan.path, startedMs)
}

/** Removes the report's folder once the run is judged. */
export const disposeReport = (plan: ReportPlan): void => {
  rmSync(plan.folder, { recursive: true, force: true })
}
