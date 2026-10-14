import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { shardsOf, timesFromLog } from './test-shards.ts'

const repository = resolve(import.meta.dirname, '..')
const MEASURED: Readonly<Record<string, number>> = JSON.parse(
  readFileSync(join(repository, 'tools', 'test-times.json'), 'utf8'),
)

const TIMES = new Map([
  ['apps/desktop/tests/end.test.ts', 700],
  ['apps/desktop/tests/proofs.test.ts', 600],
  ['apps/desktop/tests/attempts.test.ts', 150],
  ['apps/desktop/tests/checks.test.ts', 120],
  ['packages/core/tests/plan.test.ts', 4],
  ['tools/scales.test.ts', 2],
])
const FILES = [...TIMES.keys()]

describe('The repository suites split into shards by their measured time, with no test lost', () => {
  test('every file runs in exactly one shard, whatever the number of shards', () => {
    for (const count of [1, 2, 3, 4, 7]) {
      const shards = shardsOf(FILES, TIMES, count)
      expect(shards).toHaveLength(count)
      expect(shards.flat().toSorted()).toEqual(FILES.toSorted())
    }
  })

  test('the two slowest files never share a shard of two', () => {
    const [first, second] = shardsOf(FILES, TIMES, 2)
    expect(first).toContain('apps/desktop/tests/end.test.ts')
    expect(second).toContain('apps/desktop/tests/proofs.test.ts')
  })

  test('the shards carry the same measured time to within the slowest file that is left', () => {
    const shards = shardsOf(Object.keys(MEASURED), new Map(Object.entries(MEASURED)), 2)
    const sums = shards.map((files) => files.reduce((sum, file) => sum + (MEASURED[file] ?? 0), 0))
    expect(Math.abs((sums[0] ?? 0) - (sums[1] ?? 0))).toBeLessThan(60)
  })

  test('a file with no measured time still runs, in one shard', () => {
    const added = 'apps/desktop/tests/new-suite.test.ts'
    const shards = shardsOf([...FILES, added], TIMES, 2)
    expect(shards.flat().filter((file) => file === added)).toHaveLength(1)
  })

  test('every runner computes the same split, whatever order it lists the files in', () => {
    expect(shardsOf(FILES.toReversed(), TIMES, 3)).toEqual(shardsOf(FILES, TIMES, 3))
  })
})

describe('The measured times are read from the log of a CI run', () => {
  test('a finished file of the repository project gives its path and its seconds', () => {
    const log = [
      'windows (repository 1/2)\tTest\t2026-10-14T10:44:43.8Z  \u001b[32m✓\u001b[39m \u001b[30m\u001b[46m repository \u001b[49m\u001b[39m apps/desktop/tests/planning-probes.test.ts \u001b[2m(\u001b[22m\u001b[2m44 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[33m 100521\u001b[2mms\u001b[22m\u001b[39m',
      '2026-10-14T10:44:41.5Z  ✓  repository  apps/desktop/tests/planning-freeze.test.ts (41 tests | 1 skipped) 98226ms',
      '2026-10-14T10:44:42.0Z ^[[32m✓^[[39m ^[[30m^[[46m repository ^[[49m^[[39m tools/scales.test.ts ^[[2m(^[[22m^[[2m3 tests^[[22m^[[2m)^[[22m^[[33m 412^[[2mms^[[22m^[[39m',
      '2026-10-14T10:44:41.5Z  ✓  storybook-light  src/blocks/ball/ball-mark.stories.tsx (4 tests) 1200ms',
      '2026-10-14T10:44:42.0Z stdout | apps/desktop/tests/planning-probes.test.ts > a probe',
    ].join('\n')
    expect(timesFromLog(log)).toEqual(
      new Map([
        ['apps/desktop/tests/planning-probes.test.ts', 100.5],
        ['apps/desktop/tests/planning-freeze.test.ts', 98.2],
        ['tools/scales.test.ts', 0.4],
      ]),
    )
  })
})
