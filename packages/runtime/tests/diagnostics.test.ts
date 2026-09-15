import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_RETENTION_DAYS,
  diagnosticLine,
  expiredLogs,
  logFileNameOf,
  openDiagnosticLog,
} from '../src/platform/diagnostics.ts'

const AT = new Date('2026-09-15T08:30:00.000Z')

function profile(): string {
  return mkdtempSync(join(tmpdir(), 'hemera-log-'))
}

describe('Diagnostic sans console', () => {
  test('what is reported is readable in the profile afterwards', () => {
    const directory = profile()
    const log = openDiagnosticLog({ directory, now: () => AT.getTime(), print: () => {} })

    log.error('embedded font files missing for Inter')
    log.info('channel prod, route sessions')

    const written = readFileSync(log.path, 'utf8')
    expect(written).toContain('ERROR embedded font files missing for Inter')
    expect(written).toContain('INFO  channel prod, route sessions')
    // The console keeps its copy for the runs that have one; the file is what the others read.
    expect(log.path).toBe(join(directory, 'logs', 'hemera-2026-09-15.log'))
  })

  test('a line carries the instant, the level and the message, in that order', () => {
    expect(diagnosticLine(AT, 'warn', 'the folder cannot be read')).toBe(
      '2026-09-15T08:30:00.000Z WARN  the folder cannot be read',
    )
  })

  test('the console still receives what the file records', () => {
    const printed: string[] = []
    const log = openDiagnosticLog({
      directory: profile(),
      now: () => AT.getTime(),
      print: (_level, line) => printed.push(line),
    })

    log.warn('another instance already owns this profile')

    expect(printed).toHaveLength(1)
    expect(printed[0]).toContain('another instance already owns this profile')
  })
})

describe('Journal borné dans le temps', () => {
  test('logs older than the retention are removed when the log opens', () => {
    const directory = profile()
    const folder = join(directory, 'logs')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'hemera-2026-08-01.log'), 'old\n')
    writeFileSync(join(folder, 'hemera-2026-09-14.log'), 'yesterday\n')

    const log = openDiagnosticLog({ directory, now: () => AT.getTime(), print: () => {} })
    log.info('today')

    const kept = readdirSync(folder).toSorted()
    expect(kept).toEqual(['hemera-2026-09-14.log', 'hemera-2026-09-15.log'])
  })

  test('the retention is counted in days, and a file of the last day is kept', () => {
    const files = [
      'hemera-2026-09-15.log',
      'hemera-2026-09-01.log',
      'hemera-2026-08-31.log',
      'notes.txt',
    ]
    expect(expiredLogs(files, AT, DEFAULT_RETENTION_DAYS)).toEqual(['hemera-2026-08-31.log'])
    // A file that is not a log of ours is never removed, whatever its age.
    expect(expiredLogs(files, AT, 0)).not.toContain('notes.txt')
  })

  test('one file per day, named after that day', () => {
    expect(logFileNameOf(AT)).toBe('hemera-2026-09-15.log')
    expect(logFileNameOf(new Date('2026-01-02T23:59:59.999Z'))).toBe('hemera-2026-01-02.log')
  })
})

describe('Journal non inscriptible', () => {
  test('a file that cannot be written leaves the diagnostic reported', () => {
    const directory = profile()
    const printed: { level: string; line: string }[] = []
    const log = openDiagnosticLog({
      directory,
      now: () => AT.getTime(),
      print: (level, line) => printed.push({ level, line }),
    })

    // A directory where the file is expected: the append fails, the run does not.
    mkdirSync(join(directory, 'logs', 'blocked'), { recursive: true })
    const blocked = openDiagnosticLog({
      directory: join(directory, 'logs'),
      now: () => AT.getTime(),
      print: (level, line) => printed.push({ level, line }),
    })
    mkdirSync(blocked.path, { recursive: true })

    expect(() => blocked.error('the addon could not be loaded')).not.toThrow()

    const messages = printed.map((entry) => entry.line)
    expect(messages.some((line) => line.includes('the addon could not be loaded'))).toBe(true)
    expect(messages.some((line) => line.includes('could not be written to'))).toBe(true)
    expect(log.path).toContain('hemera-2026-09-15.log')
  })
})
