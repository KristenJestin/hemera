#!/usr/bin/env node
/**
 * Splits the repository suites into shards by the time each file takes, not by the hash of its
 * path.
 *
 * Vitest's own split sorts the files by the hash of their path and cuts the list into equal
 * counts: on the Windows runners (#359) it put the two slowest files of the repository,
 * `building-end` and `building-proofs` (some 700 and 600 s each), in the same half, which took
 * 13 to 15 minutes while the other half took 8 to 10. Here each file goes, slowest first, to
 * the shard with the least time so far: the two halves carry the same time to within a small
 * file, and every file still runs once, in one shard.
 *
 * The times are those the Windows runners measured, kept in `tools/test-times.json`. A file
 * that has no time yet counts as the median of the others: it still runs, the split is only a
 * little less even until the times are read again. Every runner of a run computes the same
 * split, from the same files and the same times.
 *
 * To read the times again, save the logs of the Windows repository jobs of a few green runs
 * (`gh run view <run> --job <job> --log > <file>`), then:
 *
 *   node tools/test-shards.ts <log>...
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { BaseSequencer, type TestSpecification } from 'vite-plus/test/node'

const TIMES_FILE = join(import.meta.dirname, 'test-times.json')

/** The files of each shard, the slowest file first given to the shard with the least time. */
export function shardsOf(
  files: ReadonlyArray<string>,
  times: ReadonlyMap<string, number>,
  count: number,
): ReadonlyArray<ReadonlyArray<string>> {
  const known = [...times.values()].toSorted((a, b) => a - b)
  const median = known[Math.floor(known.length / 2)] ?? 1
  const timeOf = (file: string) => times.get(file) ?? median
  const ordered = [...new Set(files)].toSorted(
    (a, b) => timeOf(b) - timeOf(a) || (a < b ? -1 : a > b ? 1 : 0),
  )
  const shards = Array.from({ length: count }, () => ({ time: 0, files: new Array<string>() }))
  for (const file of ordered) {
    const lightest = shards.reduce((best, shard) => (shard.time < best.time ? shard : best))
    lightest.time += timeOf(file)
    lightest.files.push(file)
  }
  return shards.map((shard) => shard.files)
}

/**
 * The seconds each file of the repository project took, from the default reporter's lines in a
 * CI log (`✓ repository apps/desktop/tests/x.test.ts (12 tests) 4321ms`).
 */
export function timesFromLog(log: string): ReadonlyMap<string, number> {
  const line = /[✓×]\s+repository\s+(\S+\.test\.ts)\s+\([^)]*\)\s+(\d+)ms/
  const times = new Map<string, number>()
  for (const raw of log.split('\n')) {
    // The reporter's colours are escape codes, which `gh run view --log` writes out as `^[`.
    // oxlint-disable-next-line no-control-regex
    const found = line.exec(raw.replaceAll(/(?:\u001b|\^\[)\[[0-9;]*m/g, ''))
    if (found?.[1] !== undefined && found[2] !== undefined) {
      times.set(found[1], Math.round(Number(found[2]) / 100) / 10)
    }
  }
  return times
}

const readTimes = (): ReadonlyMap<string, number> =>
  new Map(Object.entries(JSON.parse(readFileSync(TIMES_FILE, 'utf8'))))

/** Vitest's sequencer with the split above: `sequence.sequencer` in `vite.config.ts`. */
export default class TimedSequencer extends BaseSequencer {
  override async shard(files: Array<TestSpecification>): Promise<Array<TestSpecification>> {
    const { root, shard } = this.ctx.config
    if (shard === undefined) return files
    const pathOf = (spec: TestSpecification) => relative(root, spec.moduleId).replaceAll('\\', '/')
    const mine = new Set(
      shardsOf(files.map(pathOf), readTimes(), shard.count)[shard.index - 1] ?? [],
    )
    return files.filter((spec) => mine.has(pathOf(spec)))
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const seen = new Map<string, Array<number>>()
  for (const file of process.argv.slice(2)) {
    for (const [path, seconds] of timesFromLog(readFileSync(file, 'utf8'))) {
      seen.set(path, [...(seen.get(path) ?? []), seconds])
    }
  }
  const mean = (all: ReadonlyArray<number>) =>
    Math.round((all.reduce((sum, one) => sum + one, 0) / all.length) * 10) / 10
  const times = Object.fromEntries(
    [...seen].toSorted(([a], [b]) => (a < b ? -1 : 1)).map(([path, all]) => [path, mean(all)]),
  )
  writeFileSync(TIMES_FILE, `${JSON.stringify(times, null, 2)}\n`)
  console.log(`${Object.keys(times).length} files timed in ${TIMES_FILE}`)
}
