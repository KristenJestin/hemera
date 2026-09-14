import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  TARGETS,
  UNKNOWN,
  collectReport,
  renderReport,
  reportPathOf,
  targetOfHost,
} from './environment-report.ts'

const repository = resolve(import.meta.dir, '..')

describe('Vérification par cible', () => {
  test('the report describes the target this machine is, and refuses any other', () => {
    expect(targetOfHost('win32', 'x64')).toBe(TARGETS['win32-x64'])
    expect(targetOfHost('linux', 'x64')).toBe(TARGETS['linux-x64'])
    expect(() => targetOfHost('darwin', 'arm64')).toThrow(/no target of the lot matches/)
  })

  test('a report carries every field D02 asks for, for this target only', () => {
    const report = collectReport({ repositoryRoot: repository })
    expect(report.target).toBe(targetOfHost())

    const document = renderReport(report)
    for (const field of [
      'System and version',
      'Graphical session',
      'GPU and driver',
      'Toolchain',
      'Artefacts',
      'Observation',
    ]) {
      expect(document).toContain(field)
    }
    // Nothing of the other target is carried into it.
    const other = Object.values(TARGETS).find((target) => target !== report.target)
    expect(document).not.toContain(other!)
  })

  test('a field that cannot be read says so instead of being filled in', () => {
    const report = collectReport({ repositoryRoot: '/nowhere-that-exists' })
    expect(report.artefacts.fork).toBe(UNKNOWN)
    expect(report.artefacts.packages).toEqual([])
  })

  test('a run that opened no window does not claim one', () => {
    const report = collectReport({ repositoryRoot: repository })
    expect(report.observation.window).toBe('not observed in this run')
    expect(renderReport(report)).toContain('not observed in this run')
  })
})

describe('Une seule cible vérifiée', () => {
  test('the report of this machine exists and names only what was observed here', () => {
    const path = reportPathOf(repository, targetOfHost())
    // A target carries its own report or it is not verified. The absence says what produces
    // it, because the first run on a new target lands here with nothing to read.
    const found = existsSync(path)
      ? path
      : `no report for ${targetOfHost()}; run "bun run report" on this target to produce it`
    expect(found).toBe(path)

    const document = readFileSync(path, 'utf8')
    expect(document).toContain(`# Environment report — ${targetOfHost()}`)
    expect(document).toContain('window opened')

    // No report of a target this machine is not.
    const other = Object.values(TARGETS).find((target) => target !== targetOfHost())
    expect(existsSync(reportPathOf(repository, other!))).toBe(false)
  })
})
