/**
 * The report Hemera asks a proof's runner for (#342, round 9). For a known runner its command
 * invokes itself, Hemera adds the reporter flags (`withReporting`): the report goes to a folder of
 * the run's own in the system's temporary folder, outside every repository, so neither freshness
 * nor the change detector sees it, and no file a test writes in a repository is taken for it.
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

import { REPORT_CAP, type ReportFound, foundReport, withReporting } from '@hemera/core/domain'

/** The report a proof's run is asked for: the line run, the flags added, and where it goes. */
export interface ReportPlan extends NonNullable<ReturnType<typeof withReporting>> {
  readonly path: string
  readonly folder: string
}

/** How the report is opened: never through a link, never waiting on a pipe (POSIX only). */
const OPENED =
  process.platform === 'win32'
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK

const NOT_A_FILE: ReportFound = { kind: 'unreadable', reason: 'not a regular file' }
const MISSING: ReportFound = { kind: 'unreadable', reason: 'missing' }

/**
 * The report a proof's command is asked for, in a new folder of its own; null, and no folder left,
 * when Hemera adds no reporting to it (a script, a runner it does not know, one writing its own).
 */
export const reportFor = (command: string): ReportPlan | null => {
  const folder = mkdtempSync(join(tmpdir(), 'hemera-report-'))
  const path = join(folder, 'report')
  const added = withReporting(command, path)
  if (added === null) {
    rmSync(folder, { recursive: true, force: true })
    return null
  }
  return { ...added, path, folder }
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
  rmSync(plan.path, { recursive: true, force: true })
  // The run's start on the file system's own clock, which a file's time is written on: coarser
  // than the process's, a report written at once could otherwise look older than the run.
  const started = join(plan.folder, 'started')
  writeFileSync(started, '')
  const startedMs = statSync(started).mtimeMs
  return () => readReport(plan.path, startedMs)
}

/** Removes the report's folder once the run is judged. */
export const disposeReport = (plan: ReportPlan): void => {
  rmSync(plan.folder, { recursive: true, force: true })
}
