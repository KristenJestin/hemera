/**
 * Where a diagnostic goes once nobody is watching a console.
 *
 * A packaged application is started from a desktop icon: it has no terminal, so a diagnostic
 * written to the standard output is written to nothing at all. Every one of them is appended
 * to a file of the profile instead, beside the database, and the console keeps its copy for
 * the runs that do have one.
 *
 * Writes are synchronous and append-only: a diagnostic exists to explain a start that went
 * wrong, and a buffered line is exactly the line a crash loses.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

export type DiagnosticLevel = 'info' | 'warn' | 'error'

export interface DiagnosticLog {
  /** File the run is writing to. */
  path: string
  write: (level: DiagnosticLevel, message: string) => void
  /** Records the message and prints it, for the runs that have a console. */
  info: (message: string) => void
  warn: (message: string) => void
  error: (message: string) => void
}

export interface DiagnosticLogOptions {
  /** Profile directory; the log lives in `logs/` inside it. */
  directory: string
  /** Clock of the run, so a test writes a file it can name. */
  now?: () => number
  /** Days of logs kept; older files are removed when the log opens. */
  retentionDays?: number
  /** Where the copy goes; the console by default. */
  print?: (level: DiagnosticLevel, line: string) => void
}

/** Days of history kept: enough to read back a start that failed last week. */
export const DEFAULT_RETENTION_DAYS = 14

/** Name of the file a day writes to, one per day so a log never grows unbounded. */
export function logFileNameOf(at: Date): string {
  return `hemera-${at.toISOString().slice(0, 10)}.log`
}

/** Files of the folder that are logs older than the retention. */
export function expiredLogs(files: string[], at: Date, retentionDays: number): string[] {
  const oldest = new Date(at.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  return files.filter((file) => {
    const day = /^hemera-(\d{4}-\d{2}-\d{2})\.log$/.exec(file)?.[1]
    if (day === undefined) return false
    return new Date(`${day}T00:00:00.000Z`) < new Date(oldest.toISOString().slice(0, 10))
  })
}

/** One line of the log: an instant, a level, and what happened. */
export function diagnosticLine(at: Date, level: DiagnosticLevel, message: string): string {
  return `${at.toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`
}

function printToConsole(level: DiagnosticLevel, line: string): void {
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function openDiagnosticLog({
  directory,
  now = Date.now,
  retentionDays = DEFAULT_RETENTION_DAYS,
  print = printToConsole,
}: DiagnosticLogOptions): DiagnosticLog {
  const folder = join(directory, 'logs')
  mkdirSync(folder, { recursive: true })

  const opened = new Date(now())
  for (const file of expiredLogs(readdirSync(folder), opened, retentionDays)) {
    rmSync(join(folder, file), { force: true })
  }

  const path = join(folder, logFileNameOf(opened))

  const write = (level: DiagnosticLevel, message: string): void => {
    const line = diagnosticLine(new Date(now()), level, message)
    print(level, line)
    try {
      appendFileSync(path, `${line}\n`, 'utf8')
    } catch (failure) {
      // A profile that cannot be written to is a problem of its own, and it is not this
      // line's to report: losing the console copy too would leave nothing at all.
      print('error', `the diagnostic could not be written to ${path}: ${String(failure)}`)
    }
  }

  return {
    path,
    write,
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  }
}

/** Whether a folder already holds a log of that day, for a verification that reads one back. */
export function logExists(directory: string, at: Date): boolean {
  const path = join(directory, 'logs', logFileNameOf(at))
  return existsSync(path) && statSync(path).size > 0
}
