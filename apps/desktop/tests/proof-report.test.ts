/**
 * The report Hemera asks a proof's runner for (#342, round 9): written to a folder of the run's
 * own, outside every repository, emptied before the run, and read after it only when it is a
 * regular file the run wrote, opened without following a link and without waiting on a pipe.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  closeSync,
  ftruncateSync,
  openSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { REPORT_CAP } from '@hemera/core/domain'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
  disposeReport,
  prepareReport,
  reportFor,
  reportIn,
} from '../src/engine/building/proof-report.ts'

const COMMAND = 'vp test run export.test.ts'
const windows = process.platform === 'win32'

const plans: Array<NonNullable<ReturnType<typeof reportFor>>> = []
const planned = (command = COMMAND) => {
  const plan = reportFor(command)
  if (plan !== null) plans.push(plan)
  return plan
}

afterEach(() => {
  for (const plan of plans.splice(0)) disposeReport(plan)
})

describe('The report Hemera asks a proof’s runner for (#342, round 9)', () => {
  test('the report goes to a folder of its own outside the repository, removed once the run is judged', () => {
    const repository = mkdtempSync(join(tmpdir(), 'acme-api-'))
    const plan = planned()
    expect(plan).not.toBeNull()
    if (plan === null) return
    expect(relative(repository, plan.path).startsWith('..')).toBe(true)
    expect(plan.line).toBe(`${COMMAND} ${plan.added}`)
    expect(plan.reporting).toEqual({
      runner: 'vitest',
      report: { format: 'json', path: plan.path },
    })
    expect(existsSync(plan.folder)).toBe(true)
    disposeReport(plan)
    expect(existsSync(plan.folder)).toBe(false)
    rmSync(repository, { recursive: true, force: true })
  })

  test('a command Hemera adds no reporting to has no report, and leaves no folder behind', () => {
    const before = new Set(readdirSync(tmpdir()))
    expect(reportFor('npm test')).toBeNull()
    expect(reportFor('go test ./...')).toBeNull()
    const left = readdirSync(tmpdir()).filter((name) => !before.has(name))
    expect(left.filter((name) => name.startsWith('hemera-report-'))).toEqual([])
  })

  test('a file at the report’s path before the run is removed: it is never read as the run’s', () => {
    const plan = planned()
    if (plan === null) throw new Error('no plan')
    writeFileSync(plan.path, '{"testResults":[]}')
    const read = prepareReport(plan)
    expect(existsSync(plan.path)).toBe(false)
    expect(read()).toEqual({ kind: 'unreadable', reason: 'missing' })
  })

  test('a report the run wrote is read', () => {
    const plan = planned()
    if (plan === null) throw new Error('no plan')
    const read = prepareReport(plan)
    writeFileSync(plan.path, '{"testResults":[]}')
    expect(read()).toEqual({ kind: 'read', text: '{"testResults":[]}' })
  })

  test('a report last written before the run started is not read', () => {
    const plan = planned()
    if (plan === null) throw new Error('no plan')
    const read = prepareReport(plan)
    writeFileSync(plan.path, '{"testResults":[]}')
    utimesSync(plan.path, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    expect(read()).toEqual({ kind: 'unreadable', reason: 'older than the run' })
  })

  test('a report larger than the cap is not read', () => {
    const plan = planned()
    if (plan === null) throw new Error('no plan')
    const read = prepareReport(plan)
    const file = openSync(plan.path, 'w')
    ftruncateSync(file, REPORT_CAP + 1)
    closeSync(file)
    expect(read()).toEqual({ kind: 'unreadable', reason: 'over its size cap' })
  })

  test('a folder at the report’s path is not read', () => {
    const plan = planned()
    if (plan === null) throw new Error('no plan')
    const read = prepareReport(plan)
    mkdirSync(plan.path)
    expect(read()).toEqual({ kind: 'unreadable', reason: 'not a regular file' })
  })

  test.skipIf(windows)('a link at the report’s path is not followed', () => {
    const plan = planned()
    if (plan === null) throw new Error('no plan')
    const read = prepareReport(plan)
    const forged = join(plan.folder, 'forged.json')
    writeFileSync(forged, '{"testResults":[]}')
    symlinkSync(forged, plan.path)
    expect(read()).toEqual({ kind: 'unreadable', reason: 'not a regular file' })
  })

  test.skipIf(windows)('a named pipe at the report’s path is refused without waiting on it', () => {
    const plan = planned()
    if (plan === null) throw new Error('no plan')
    const read = prepareReport(plan)
    execFileSync('mkfifo', [plan.path])
    expect(read()).toEqual({ kind: 'unreadable', reason: 'not a regular file' })
  })
})

describe('the proof run uses the custom value (#421)', () => {
  test('a runner set by hand other than the one the command runs gets no reporting from Hemera', () => {
    expect(reportFor(COMMAND, 'pytest')).toBeNull()
    const plan = reportFor(COMMAND, 'vitest')
    if (plan !== null) plans.push(plan)
    expect(plan?.reporting.runner).toBe('vitest')
  })

  test('a report set by hand is read in the repository, which Hemera never empties', () => {
    const repository = mkdtempSync(join(tmpdir(), 'acme-api-'))
    const plan = reportIn('make test', repository, 'pytest', {
      format: 'junit',
      path: 'reports/junit.xml',
    })
    plans.push(plan)
    expect(plan.line).toBe('make test')
    expect(plan.path).toBe(join(repository, 'reports', 'junit.xml'))
    mkdirSync(join(repository, 'reports'))
    writeFileSync(plan.path, '<testsuites/>')
    utimesSync(plan.path, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    const read = prepareReport(plan)
    // The file there before the run stays, and its age alone keeps it from being read.
    expect(existsSync(plan.path)).toBe(true)
    expect(read()).toEqual({ kind: 'unreadable', reason: 'older than the run' })
    writeFileSync(plan.path, '<testsuites></testsuites>')
    expect(read()).toEqual({ kind: 'read', text: '<testsuites></testsuites>' })
    rmSync(repository, { recursive: true, force: true })
  })

  test('a report set by hand that a link leads outside the repository is not read', () => {
    const repository = mkdtempSync(join(tmpdir(), 'acme-api-'))
    const outside = mkdtempSync(join(tmpdir(), 'acme-outside-'))
    const plan = reportIn('make test', repository, 'pytest', {
      format: 'junit',
      path: 'reports/junit.xml',
    })
    plans.push(plan)
    const read = prepareReport(plan)
    // A junction on Windows, which needs no privilege; a directory link elsewhere.
    symlinkSync(outside, join(repository, 'reports'), 'junction')
    writeFileSync(join(outside, 'junit.xml'), '<testsuites></testsuites>')
    expect(read()).toEqual({ kind: 'unreadable', reason: 'it leads outside the repository' })
    rmSync(repository, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })
})
