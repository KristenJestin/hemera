/**
 * The tester mode's findings on files (#45): one file a finding, the same problem reported again
 * as one more occurrence of it, the index written again after every change, everything masked by
 * #35's masking, and two reports at once never losing one.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { join } from 'node:path'

import type { FindingContext, ReportedFinding } from '@hemera/core/domain'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { Secrets, secretsRegistry } from '../src/engine/secrets.ts'
import {
  TesterFindings,
  readFindingFile,
  testerFindingsLayer,
} from '../src/engine/tester/findings.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let folder: string

beforeEach(() => {
  folder = temporaryFolder('tester')
})
afterEach(removeFolders)

const REDIRECT: ReportedFinding = {
  title: 'commands_run cannot redirect output with >',
  kind: 'missing_capability',
  place: 'commands_run',
  severity: 'hurts',
  trying: 'Keep the output of the tests in a file.',
  happened: 'The line was refused for its shell syntax.',
  expected: 'A way to keep a long output.',
  steps: 'Run `pnpm test > out.txt` through commands_run.',
  files: ['api/package.json'],
  callId: 'toolu_01',
  error: 'refused: a command line with shell syntax',
  code: '1',
}

const CONTEXT: FindingContext = {
  at: '2026-10-06T16:32:08.000+02:00',
  hemera: { version: '1.0.0', channel: 'dev', commit: null, os: 'Linux 7.1.9' },
  agent: { name: 'Claude Code', version: null, model: 'large', effort: null },
  where: 'ACME-12',
  role: 'builder',
  stage: 'building',
  sessionId: 's-builder',
  call: null,
}

/** Runs a program against the findings of the test's data folder, with these known secrets. */
const withFindings = <A, E>(
  program: Effect.Effect<A, E, TesterFindings>,
  secrets: ReadonlyArray<string> = [],
) => {
  const registry = secretsRegistry()
  registry.register('test', secrets)
  return Effect.runPromise(
    program.pipe(
      Effect.provide(
        testerFindingsLayer({
          dataFolder: folder,
          version: '1.0.0',
          channel: 'dev',
          os: 'Linux',
        }).pipe(Layer.provide(Layer.succeed(Secrets, registry))),
      ),
    ),
  )
}

const report = (reported: ReportedFinding, context = CONTEXT) =>
  TesterFindings.use((findings) => findings.report(reported, context))

const findingsFolder = () => join(folder, 'tester', 'findings')

describe('A report becomes a file of its own', () => {
  test('the first report of a problem is #1, in tester/findings, and reads back as it was written', async () => {
    const answer = await withFindings(report(REDIRECT))
    expect(answer).toMatchObject({ number: 1, added: false, occurrences: 1 })
    expect(readdirSync(findingsFolder())).toEqual([answer.file])
    const read = readFindingFile(readFileSync(join(findingsFolder(), answer.file), 'utf8'))
    expect(read?.head).toMatchObject({ number: 1, missions: ['ACME-12'], roles: ['builder'] })
  })

  test('a file that is not a finding reads as nothing', () => {
    expect(readFindingFile('no front matter')).toBeNull()
    expect(readFindingFile('---\ntitle: "x"\n---\nbody')).toBeNull()
  })
})

describe('The same problem reported again is one more occurrence', () => {
  test('same kind, same place, a similar title: added to #1, not a second file; another place is #2', async () => {
    const [again, other] = await withFindings(
      Effect.gen(function* () {
        yield* report(REDIRECT)
        const second = yield* report({
          ...REDIRECT,
          title: 'commands_run cannot redirect its output with >',
        })
        const third = yield* report({ ...REDIRECT, place: 'fs_read' })
        return [second, third] as const
      }),
    )
    expect(again).toMatchObject({ number: 1, added: true, occurrences: 2 })
    expect(other).toMatchObject({ number: 2, added: false })
    expect(readdirSync(findingsFolder())).toHaveLength(2)
  })

  test('two reports at once are two occurrences of one finding', async () => {
    const answers = await withFindings(
      Effect.all([report(REDIRECT), report(REDIRECT), report(REDIRECT)], {
        concurrency: 'unbounded',
      }),
    )
    expect(answers.map((one) => one.occurrences).toSorted()).toEqual([1, 2, 3])
    expect(readdirSync(findingsFolder())).toHaveLength(1)
  })

  test('a number is never taken again, even from a file that no longer reads', async () => {
    mkdirSync(findingsFolder(), { recursive: true })
    writeFileSync(join(findingsFolder(), '0004-broken.md'), 'no front matter')
    const answer = await withFindings(report(REDIRECT))
    expect(answer.number).toBe(5)
  })

  test('a number is never taken again, even once the user deleted the highest finding', async () => {
    const OTHER: ReportedFinding = {
      ...REDIRECT,
      title: 'memory_read says the first line of the Journal is line 6',
      place: 'memory_read',
    }
    const THIRD: ReportedFinding = {
      ...REDIRECT,
      title: 'fs_list shows a folder past its depth like an empty one',
      place: 'fs_list',
    }
    const [first, second] = await withFindings(Effect.all([report(REDIRECT), report(OTHER)]))
    rmSync(join(findingsFolder(), second?.file ?? ''))
    const third = await withFindings(report(THIRD))
    expect([first?.number, second?.number, third.number]).toEqual([1, 2, 3])
  })
})

describe('The index lists them all', () => {
  test('tester/README.md is written again after every change', async () => {
    await withFindings(report(REDIRECT))
    expect(readFileSync(join(folder, 'tester', 'README.md'), 'utf8')).toContain(
      '1 finding · 1 occurrence',
    )
    await withFindings(
      report({
        ...REDIRECT,
        title: 'fs_read drops the last line',
        kind: 'hemera_bug',
        place: 'fs_read',
        severity: 'blocks',
      }),
    )
    const index = readFileSync(join(folder, 'tester', 'README.md'), 'utf8')
    expect(index).toContain('2 findings · 2 occurrences')
    expect(index).toContain('[#2](findings/0002-fs-read-drops-the-last-line.md)')
    expect(index.indexOf('## Hemera bug')).toBeLessThan(index.indexOf('## Missing capability'))
  })

  test('the list reads the folder, the latest seen first; an empty folder lists nothing', async () => {
    expect(await withFindings(TesterFindings.use((findings) => findings.list))).toEqual([])
    const listed = await withFindings(
      Effect.gen(function* () {
        yield* report(REDIRECT)
        yield* report(
          { ...REDIRECT, title: 'The notice never came', kind: 'interface', place: 'notices' },
          { ...CONTEXT, at: '2026-10-06T18:00:00.000+02:00' },
        )
        return yield* TesterFindings.use((findings) => findings.list)
      }),
    )
    expect(listed.map((one) => one.head.number)).toEqual([2, 1])
  })
})

describe('The list across a change of the clocks', () => {
  test('is ordered by the instant each was last seen, whatever offset it was written with', async () => {
    const listed = await withFindings(
      Effect.gen(function* () {
        // 00:30 UTC, written in summer time; then 01:10 UTC, written once the clocks went back.
        yield* report(REDIRECT, { ...CONTEXT, at: '2026-10-25T02:30:00.000+02:00' })
        yield* report(
          { ...REDIRECT, title: 'The notice never came', kind: 'interface', place: 'notices' },
          { ...CONTEXT, at: '2026-10-25T02:10:00.000+01:00' },
        )
        return yield* TesterFindings.use((findings) => findings.list)
      }),
    )
    expect(listed.map((one) => one.head.number)).toEqual([2, 1])
  })
})

describe('A file renamed over one an editor holds open', () => {
  test('is tried again when the system refuses it for a moment, and the report is written', async () => {
    let refused = 0
    const registry = secretsRegistry()
    const answer = await Effect.runPromise(
      report(REDIRECT).pipe(
        Effect.provide(
          testerFindingsLayer(
            { dataFolder: folder, version: '1.0.0', channel: 'dev', os: 'Windows' },
            {
              rename: async (from, to) => {
                if (to.endsWith('README.md') && refused < 2) {
                  refused += 1
                  throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
                }
                await rename(from, to)
              },
            },
          ).pipe(Layer.provide(Layer.succeed(Secrets, registry))),
        ),
      ),
    )
    expect(refused).toBe(2)
    expect(answer.number).toBe(1)
    expect(readFileSync(join(folder, 'tester', 'README.md'), 'utf8')).toContain('#1')
  })
})

describe('The call a finding is about', () => {
  test('keeps its arguments, masked', async () => {
    await withFindings(
      report(REDIRECT, {
        ...CONTEXT,
        call: {
          id: 'toolu_01',
          tool: 'commands_run',
          outcome: 'refused',
          durationMs: 3,
          position: 1,
          line: null,
          arguments:
            '{"line":"pnpm test > out.txt","why":"deploy with ghp_acmeNotARealToken000001"}',
          at: CONTEXT.at,
        },
      }),
    )
    const [file] = readdirSync(findingsFolder())
    const written = readFileSync(join(findingsFolder(), file ?? ''), 'utf8')
    expect(written).toContain(
      '  - Arguments: `{"line":"pnpm test > out.txt","why":"deploy with •••"}`',
    )
    expect(written).not.toContain('ghp_acmeNotARealToken000001')
  })
})

describe('A finding is masked by #35', () => {
  test('a secret by its shape and a variable value by its value; a file content sent in happened is masked like any text; files hold paths', async () => {
    const answer = await withFindings(
      report({
        ...REDIRECT,
        happened:
          'The file said ACME_TOKEN=acme-value-91 and the key ghp_abcdefghijklmnopqrstuvwxyz0123456789.',
        error: 'fetch failed with acme-value-91',
        steps: 'Run it with ACME_TOKEN=acme-value-91.',
      }),
      ['acme-value-91'],
    )
    const written = readFileSync(join(findingsFolder(), answer.file), 'utf8')
    expect(written).not.toContain('acme-value-91')
    expect(written).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(written).toContain('•••')
    expect(written).toContain('- Files: `api/package.json`')
  })
})
