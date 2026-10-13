/**
 * The live diff of a mission (#249): per repository of its Workspace, the files changed from the
 * merge base with the repository's base branch to the working tree as it is now, untracked files
 * included and the user's index untouched; each file with Git's letter, its counts or its binary
 * sizes, and whether it is generated, large, changed outside Hemera or withheld; both sides of a
 * file on request; what moved, as it moves; and the last checkpoint once the Workspace is gone.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent: Acme's `api` and `web` in
 * temporary folders, a mission launched into Building over both, the test writing in its
 * Workspace as the user or through the Builder's tools.
 */

import { readFileSync, rmSync, writeFileSync, mkdirSync, unlinkSync, renameSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { join } from 'node:path'

import {
  type DiffChange,
  type DiffContents,
  type DiffFile,
  DiffBinary,
  DiffSides,
  DiffTooLarge,
  DiffWithheld,
  type MissionDiff,
} from '@hemera/ipc'
import { asc, desc, eq } from 'drizzle-orm'
import { Effect, Fiber, Predicate, Ref, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { Checkpoints } from '../src/engine/building/checkpoints.ts'
import { OutsideChanges, type OutsideSettings } from '../src/engine/building/outside.ts'
import { Diffs, LARGE_BYTES } from '../src/engine/review/diffs.ts'
import { Database } from '../src/engine/storage/database.ts'
import {
  buildingLaunches,
  workspaceRepositories,
  workspaces,
} from '../src/engine/storage/schema.ts'
import { call } from './building-world.ts'
import { builderAgents, builderOf, launched } from './builder-world.ts'
import { git } from './repositories.ts'
import { HELPER, sessionsEngine, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { ALLOW, verdictsSaying } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('live-diff'))
  work = realpathSync.native(temporaryFolder('live-diff-work'))
})
afterEach(removeFolders)

/** The detector's timers never on their own: a compare is the test's. */
const QUIET_TIMERS: Partial<OutsideSettings> = {
  compareEveryMillis: 3_600_000,
  baseEveryMillis: 3_600_000,
}

const engine = () =>
  sessionsEngine(data, builderAgents, {
    roles: [HELPER],
    tools: { home: work, verdicts: verdictsSaying(() => ALLOW).layer },
    building: { outside: QUIET_TIMERS },
  })

/** A few bytes no text holds: the start of a PNG. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3])

/** More of Acme's `api` on its base branch, pushed: a file to change type, a PNG, ignores. */
const moreOnBase = () =>
  Effect.sync(() => {
    const api = join(work, 'acme', 'api')
    writeFileSync(join(api, 'link.txt'), 'plain\n')
    writeFileSync(join(api, 'logo.png'), PNG)
    writeFileSync(join(api, '.gitignore'), '*.log\nbuild/\n')
    // As Git stores a text file whose checkout ends its lines with CRLF under core.autocrlf.
    writeFileSync(join(api, 'crlf.txt'), 'un\ndeux\n')
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'more')
    git(api, 'push', '-q', 'origin', 'HEAD')
  })

/** Acme's mission launched over `api` and `web`, and the folder of each in its Workspace. */
/** A `.env` whose value must never leave the engine. */
const SECRET = 'TOKEN=hunter2-not-a-real-one\n'

const launchedOverBoth = (onBase: () => Effect.Effect<void> = moreOnBase) =>
  Effect.gen(function* () {
    const { mission } = yield* launched(work, onBase, 'It touches api and web, nothing else.')
    const database = yield* Database
    const [launch] = yield* database
      .select({ workspaceId: buildingLaunches.workspaceId })
      .from(buildingLaunches)
      .where(eq(buildingLaunches.missionId, mission.id))
      .orderBy(desc(buildingLaunches.startedAt))
    const rows = yield* database
      .select()
      .from(workspaceRepositories)
      .where(eq(workspaceRepositories.workspaceId, launch?.workspaceId ?? ''))
      .orderBy(asc(workspaceRepositories.position))
    // Never an empty folder: the suite would write into the folder it runs from.
    const folderOf = (path: string) => {
      const found = rows.find((row) => row.path === path)?.worktree
      if (found === undefined) throw new Error(`no ${path} in the Workspace`)
      return found
    }
    return {
      missionId: mission.id,
      api: folderOf('api'),
      web: folderOf('web'),
      rows,
    }
  })

const live = (missionId: string) => Diffs.use((diffs) => diffs.live(missionId))
const fileOf = (missionId: string, repository: string, path: string, force = false) =>
  Diffs.use((diffs) => diffs.file(missionId, repository, path, force))

const filesOf = (diff: MissionDiff, repository: string): ReadonlyArray<DiffFile> =>
  diff.repositories.find((one) => one.repository === repository)?.files ?? []
const entry = (diff: MissionDiff, repository: string, path: string) =>
  filesOf(diff, repository).find((one) => one.path === path)

const textOf = (contents: DiffContents, side: 'before' | 'after') => {
  if (!Predicate.isTagged(contents, 'DiffSides')) return null
  const one = contents[side]
  return one !== null && Predicate.isTagged(one, 'DiffText') ? one.text : null
}

describe('Each change gives Git’s letter', () => {
  test('a modified, an added, a deleted, a renamed and a mode-changed file give M, A, D, R with oldPath, T', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          writeFileSync(join(api, 'invoices.ts'), 'export const invoices = ["csv"]\n')
          writeFileSync(join(api, 'export.ts'), 'export const csv = true\n')
          git(api, 'add', 'export.ts')
          unlinkSync(join(api, 'package.json'))
          mkdirSync(join(api, 'docs'))
          renameSync(join(api, 'README.md'), join(api, 'docs', 'README.md'))
          // A type change written as Git records it, which every platform can check out.
          git(api, 'config', 'core.symlinks', 'false')
          writeFileSync(join(api, 'link.txt'), 'invoices.ts')
          const blob = git(api, 'hash-object', '-w', 'link.txt')
          git(api, 'update-index', '--cacheinfo', `120000,${blob},link.txt`)
          git(api, 'commit', '-q', '-m', 'link')
          return yield* live(missionId)
        }),
      ),
    )
    expect(seen.source).toBe('live')
    const letters = filesOf(seen, 'api').map(({ path, oldPath, letter }) => ({
      path,
      oldPath,
      letter,
    }))
    expect(letters).toEqual(
      expect.arrayContaining([
        { path: 'invoices.ts', oldPath: null, letter: 'M' },
        { path: 'export.ts', oldPath: null, letter: 'A' },
        { path: 'package.json', oldPath: null, letter: 'D' },
        { path: 'docs/README.md', oldPath: 'README.md', letter: 'R' },
        { path: 'link.txt', oldPath: null, letter: 'T' },
      ]),
    )
    expect(letters).toHaveLength(5)
    expect(entry(seen, 'api', 'invoices.ts')).toMatchObject({ added: 1, removed: 1 })
  })
})

describe('Untracked files are shown, ignored ones are not', () => {
  test('an untracked non-ignored file is listed with untracked; an ignored one is not', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          writeFileSync(join(api, 'notes.md'), 'mine\n')
          writeFileSync(join(api, 'debug.log'), 'noise\n')
          mkdirSync(join(api, 'build'))
          writeFileSync(join(api, 'build', 'out.js'), 'built\n')
          return yield* live(missionId)
        }),
      ),
    )
    expect(filesOf(seen, 'api').map((one) => one.path)).toEqual(['notes.md'])
    expect(entry(seen, 'api', 'notes.md')).toMatchObject({ letter: 'A', untracked: true })
  })
})

describe('Two repositories with a file of the same name are told apart', () => {
  test('README.md changed in both repositories gives two entries with distinct tree paths', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api, web } = yield* launchedOverBoth()
          writeFileSync(join(api, 'README.md'), 'Acme api, with exports\n')
          writeFileSync(join(web, 'README.md'), 'Acme web\n')
          return yield* live(missionId)
        }),
      ),
    )
    expect(seen.repositories.map((one) => one.repository)).toEqual(['api', 'web'])
    const readmes = seen.repositories.flatMap((one) =>
      one.files.filter((file) => file.path === 'README.md'),
    )
    expect(
      readmes.map(({ repository, treePath, letter }) => ({ repository, treePath, letter })),
    ).toEqual([
      { repository: 'api', treePath: 'api/README.md', letter: 'M' },
      { repository: 'web', treePath: 'web/README.md', letter: 'A' },
    ])
  })

  test('a repository with no change is listed with zero files', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          writeFileSync(join(api, 'README.md'), 'Acme api, with exports\n')
          return yield* live(missionId)
        }),
      ),
    )
    const web = seen.repositories.find((one) => one.repository === 'web')
    expect(web).toMatchObject({ files: [], added: 0, removed: 0, changedOutside: false })
    expect(seen.repositories.find((one) => one.repository === 'api')).toMatchObject({
      branch: expect.stringContaining('/'),
      baseBranch: 'origin/main',
      added: 1,
      removed: 1,
    })
  })
})

describe('A binary file is handled', () => {
  test('a PNG gives binary with both sizes and no line counts', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          writeFileSync(join(api, 'logo.png'), Buffer.concat([PNG, PNG]))
          const diff = yield* live(missionId)
          return { diff, contents: yield* fileOf(missionId, 'api', 'logo.png') }
        }),
      ),
    )
    expect(entry(seen.diff, 'api', 'logo.png')).toMatchObject({
      letter: 'M',
      binary: true,
      added: null,
      removed: null,
      sizeBefore: PNG.length,
      sizeAfter: PNG.length * 2,
    })
    expect(seen.contents).toEqual(
      DiffSides.make({
        before: DiffBinary.make({ size: PNG.length }),
        after: DiffBinary.make({ size: PNG.length * 2 }),
      }),
    )
  })
})

describe('Generated files are marked', () => {
  test('pnpm-lock.yaml and a file marked linguist-generated in .gitattributes are generated', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          writeFileSync(join(api, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
          writeFileSync(
            join(api, '.gitattributes'),
            'client.ts linguist-generated\nschema.sql -diff\n',
          )
          writeFileSync(join(api, 'client.ts'), 'export const client = 1\n')
          writeFileSync(join(api, 'schema.sql'), 'create table invoices ();\n')
          writeFileSync(join(api, 'notes.md'), 'mine\n')
          return yield* live(missionId)
        }),
      ),
    )
    const generated = Object.fromEntries(
      filesOf(seen, 'api').map((one) => [one.path, one.generated]),
    )
    expect(generated).toEqual({
      '.gitattributes': false,
      'client.ts': true,
      'notes.md': false,
      'pnpm-lock.yaml': true,
      'schema.sql': true,
    })
  })
})

describe('A large change is loaded on request', () => {
  test('a 5,000-line change is large: no content in the list, content given with force', async () => {
    const lines = Array.from({ length: 5_000 }, (_, at) => `line ${String(at)}`).join('\n')
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          writeFileSync(join(api, 'big.txt'), `${lines}\n`)
          const diff = yield* live(missionId)
          return {
            diff,
            refused: yield* fileOf(missionId, 'api', 'big.txt'),
            forced: yield* fileOf(missionId, 'api', 'big.txt', true),
          }
        }),
      ),
    )
    const big = entry(seen.diff, 'api', 'big.txt')
    expect(big).toMatchObject({ large: true, added: 5_000, removed: 0 })
    expect(Object.keys(big ?? {})).not.toContain('content')
    expect(seen.refused).toEqual(
      DiffTooLarge.make({ sizeBefore: null, sizeAfter: lines.length + 1, lines: 5_000 }),
    )
    expect(textOf(seen.forced, 'after')).toBe(`${lines}\n`)
    expect(entry(seen.diff, 'api', 'big.txt')?.generated).toBe(false)
  })
})

/**
 * A clean/smudge driver in the manner of git-lfs, run by Node: Git stores a short pointer text,
 * the checkout holds the bytes, kept aside in `store` under their hash.
 */
const POINTER_DRIVER = `const { createHash } = require('node:crypto')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const [, , mode, store] = process.argv
const input = readFileSync(0)
if (mode === 'clean') {
  const id = createHash('sha256').update(input).digest('hex')
  writeFileSync(join(store, id), input)
  process.stdout.write('pointer ' + id + ' size ' + input.length + '\\n')
} else {
  const id = /^pointer (\\w+)/.exec(input.toString('latin1'))?.[1]
  const kept = id === undefined ? null : join(store, id)
  process.stdout.write(kept !== null && existsSync(kept) ? readFileSync(kept) : input)
}
`

/** A drawing as text. */
const SVG = '<svg><circle r="1"/></svg>\n'

/** The base of Acme's `api` with two drawings under the pointer driver, pushed. */
const filteredOnBase = () =>
  Effect.sync(() => {
    const api = join(work, 'acme', 'api')
    const store = join(work, 'pointer-store')
    mkdirSync(store)
    const script = join(work, 'pointer-driver.cjs')
    writeFileSync(script, POINTER_DRIVER)
    // Forward slashes: Git runs the command through its shell, on Windows too.
    const quoted = (path: string) => `"${path.replaceAll('\\', '/')}"`
    for (const mode of ['clean', 'smudge']) {
      git(
        api,
        'config',
        `filter.pointer.${mode}`,
        `node ${quoted(script)} ${mode} ${quoted(store)}`,
      )
    }
    writeFileSync(join(api, '.gitattributes'), '*.svg filter=pointer\n')
    writeFileSync(join(api, 'logo.svg'), SVG)
    writeFileSync(join(api, 'icon.svg'), SVG)
    git(api, 'add', '.')
    git(api, 'commit', '-q', '-m', 'assets')
    git(api, 'push', '-q', 'origin', 'HEAD')
  })

describe('A file under a filter driver is diffed in one form on both sides', () => {
  test('a filtered file changed in the working tree shows its stored form on both sides, judged large on it; an unchanged one shows no change', async () => {
    // A text past the size that makes a file large, as an LFS file can be and its pointer is not.
    const drawn = `<svg>${'<g/>'.repeat(LARGE_BYTES / 4)}</svg>\n`
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth(filteredOnBase)
          const checkedOut = readFileSync(join(api, 'icon.svg'), 'utf8')
          writeFileSync(join(api, 'logo.svg'), drawn)
          const diff = yield* live(missionId)
          return { diff, checkedOut, contents: yield* fileOf(missionId, 'api', 'logo.svg') }
        }),
      ),
    )
    // The checkout holds the bytes, smudged by the driver: the scene is the one of git-lfs.
    expect(seen.checkedOut).toBe(SVG)
    expect(entry(seen.diff, 'api', 'icon.svg')).toBeUndefined()
    expect(entry(seen.diff, 'api', 'logo.svg')).toMatchObject({
      letter: 'M',
      binary: false,
      added: 1,
      removed: 1,
      large: false,
    })
    expect(textOf(seen.contents, 'before')).toMatch(
      new RegExp(`^pointer \\w+ size ${String(SVG.length)}\\n$`),
    )
    expect(textOf(seen.contents, 'after')).toMatch(
      new RegExp(`^pointer \\w+ size ${String(drawn.length)}\\n$`),
    )
  })
})

describe('A file changed outside Hemera is flagged', () => {
  test('a file B10 attributes to outside Hemera is changedOutside', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          const { grantId } = yield* builderOf(missionId)
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
          yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'invoices.ts',
            content: 'export const invoices = ["csv"]\n',
          })
          writeFileSync(join(api, 'stray.md'), 'mine\n')
          yield* OutsideChanges.use((outside) => outside.compare(missionId, null))
          return yield* live(missionId)
        }),
      ),
    )
    expect(entry(seen, 'api', 'stray.md')?.changedOutside).toEqual(expect.any(String))
    expect(entry(seen, 'api', 'invoices.ts')?.changedOutside).toBeNull()
    expect(seen.repositories.map((one) => [one.repository, one.changedOutside])).toEqual([
      ['api', true],
      ['web', false],
    ])
  })
})

describe('A sensitive file is listed, its content withheld', () => {
  test('a .env in the Workspace is listed and withheld', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          writeFileSync(join(api, '.env'), SECRET)
          const diff = yield* live(missionId)
          return { diff, contents: yield* fileOf(missionId, 'api', '.env') }
        }),
      ),
    )
    expect(entry(seen.diff, 'api', '.env')).toMatchObject({
      letter: 'A',
      untracked: true,
      withheld: true,
      added: null,
      binary: false,
    })
    expect(JSON.stringify(seen.contents)).not.toContain('hunter2')
    expect(seen.contents).toEqual(
      DiffSides.make({
        before: null,
        after: DiffWithheld.make({ reason: 'content withheld: .env', size: SECRET.length }),
      }),
    )
  })
})

describe('The diff follows the Workspace live', () => {
  test('a write in the Workspace produces one diff.changes event with the next sequence number', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId } = yield* launchedOverBoth()
          const { grantId } = yield* builderOf(missionId)
          const before = yield* live(missionId)
          const heard = yield* Ref.make<ReadonlyArray<DiffChange>>([])
          const listening = yield* Effect.forkChild(
            Stream.runForEach(
              Stream.unwrap(Diffs.use((diffs) => Effect.succeed(diffs.changes(missionId)))),
              (change) => Ref.update(heard, (all) => [...all, change]),
            ),
          )
          yield* call(grantId, 'task_start', { task: 'T1' })
          yield* call(grantId, 'fs_read', { repository: 'api', path: 'invoices.ts' })
          yield* call(grantId, 'fs_write', {
            repository: 'api',
            path: 'invoices.ts',
            content: 'export const invoices = ["csv"]\n',
          })
          yield* until(Effect.map(Ref.get(heard), (all) => all.length > 0))
          // Long past the debounce: still one.
          yield* Effect.sleep('1 second')
          yield* Fiber.interrupt(listening)
          return { before, heard: yield* Ref.get(heard) }
        }),
      ),
    )
    const sequence =
      seen.before.repositories.find((one) => one.repository === 'api')?.sequence ?? -1
    expect(seen.heard).toHaveLength(1)
    expect(seen.heard[0]).toMatchObject({ repository: 'api', sequence: sequence + 1, gone: [] })
    expect(seen.heard[0]?.files.map((one) => [one.path, one.letter])).toEqual([
      ['invoices.ts', 'M'],
    ])
  })

  test('a change B10 reports, then one seen when the window regains the focus, each bump the sequence once', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api, web } = yield* launchedOverBoth()
          const heard = yield* Ref.make<ReadonlyArray<DiffChange>>([])
          const listening = yield* Effect.forkChild(
            Stream.runForEach(
              Stream.unwrap(Diffs.use((diffs) => Effect.succeed(diffs.changes(missionId)))),
              (change) => Ref.update(heard, (all) => [...all, change]),
            ),
          )
          const before = yield* live(missionId)
          writeFileSync(join(api, 'stray.md'), 'mine\n')
          yield* OutsideChanges.use((outside) => outside.compare(missionId, null))
          yield* until(Effect.map(Ref.get(heard), (all) => all.length > 0))
          rmSync(join(api, 'stray.md'))
          writeFileSync(join(web, 'notes.md'), 'mine\n')
          yield* Diffs.use((diffs) => diffs.focused)
          yield* until(Effect.map(Ref.get(heard), (all) => all.length > 2))
          yield* Effect.sleep('1 second')
          yield* Fiber.interrupt(listening)
          return { before, heard: yield* Ref.get(heard) }
        }),
      ),
    )
    const sequenceOf = (repository: string) =>
      seen.before.repositories.find((one) => one.repository === repository)?.sequence ?? -1
    expect(
      seen.heard.map(({ repository, sequence, files, gone }) => ({
        repository,
        sequence,
        files: files.map((one) => one.path),
        gone,
      })),
    ).toEqual([
      { repository: 'api', sequence: sequenceOf('api') + 1, files: ['stray.md'], gone: [] },
      { repository: 'api', sequence: sequenceOf('api') + 2, files: [], gone: ['stray.md'] },
      { repository: 'web', sequence: sequenceOf('web') + 1, files: ['notes.md'], gone: [] },
    ])
  })

  test('a commit made in the Workspace does not change the diff (base to live)', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          writeFileSync(join(api, 'invoices.ts'), 'export const invoices = ["csv"]\n')
          writeFileSync(join(api, 'export.ts'), 'export const csv = true\n')
          git(api, 'add', '.')
          const staged = yield* live(missionId)
          git(api, 'commit', '-q', '-m', 'exports')
          const committed = yield* live(missionId)
          return { staged, committed }
        }),
      ),
    )
    expect(filesOf(seen.committed, 'api')).toEqual(filesOf(seen.staged, 'api'))
    expect(filesOf(seen.committed, 'api').map((one) => one.path)).toEqual([
      'export.ts',
      'invoices.ts',
    ])
    expect(seen.committed.repositories[0]?.sequence).toBe(seen.staged.repositories[0]?.sequence)
  })

  test('the user’s index is unchanged after any diff (git status --porcelain identical)', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          writeFileSync(join(api, 'invoices.ts'), 'export const invoices = ["csv"]\n')
          writeFileSync(join(api, 'export.ts'), 'export const csv = true\n')
          git(api, 'add', 'export.ts')
          writeFileSync(join(api, 'notes.md'), 'mine\n')
          const index = git(api, 'rev-parse', '--path-format=absolute', '--git-path', 'index')
          const before = {
            status: git(api, 'status', '--porcelain'),
            index: readFileSync(index),
          }
          yield* live(missionId)
          yield* fileOf(missionId, 'api', 'invoices.ts')
          yield* fileOf(missionId, 'api', 'notes.md')
          const after = {
            status: git(api, 'status', '--porcelain'),
            index: readFileSync(index),
          }
          return { before, after }
        }),
      ),
    )
    expect(seen.after.status).toBe(seen.before.status)
    expect(seen.after.index.equals(seen.before.index)).toBe(true)
  })

  test('paths with spaces and non-ASCII names and a CRLF file read back as they are', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api } = yield* launchedOverBoth()
          // Windows runners set it system-wide: Git stores the lines with LF, the disk keeps CRLF.
          git(api, 'config', 'core.autocrlf', 'true')
          mkdirSync(join(api, 'mes docs'))
          writeFileSync(join(api, 'mes docs', 'été à noël.md'), 'un\r\ndeux\r\n')
          writeFileSync(join(api, 'crlf.txt'), 'un\r\ndeux\r\ntrois\r\n')
          const diff = yield* live(missionId)
          return {
            diff,
            added: yield* fileOf(missionId, 'api', 'mes docs/été à noël.md'),
            modified: yield* fileOf(missionId, 'api', 'crlf.txt'),
          }
        }),
      ),
    )
    expect(entry(seen.diff, 'api', 'mes docs/été à noël.md')).toMatchObject({
      letter: 'A',
      treePath: 'api/mes docs/été à noël.md',
      added: 2,
    })
    expect(entry(seen.diff, 'api', 'crlf.txt')).toMatchObject({ letter: 'M', added: 1, removed: 0 })
    expect(textOf(seen.added, 'after')).toBe('un\r\ndeux\r\n')
    // Each side as the user's checkout has it: the base with the line endings Git gives it.
    expect(textOf(seen.modified, 'before')).toBe('un\r\ndeux\r\n')
    expect(textOf(seen.modified, 'after')).toBe('un\r\ndeux\r\ntrois\r\n')
  })

  test('a checkpoint keeps a CRLF file as Git stores it', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api, rows } = yield* launchedOverBoth()
          git(api, 'config', 'core.autocrlf', 'true')
          writeFileSync(join(api, 'crlf.txt'), 'un\r\ndeux\r\ntrois\r\n')
          const checkpointId = yield* Checkpoints.use((checkpoints) =>
            checkpoints.take(
              missionId,
              'review',
              rows.map((row) => ({
                name: row.path,
                folder: row.worktree,
                baseRef: row.baseRef,
                baseCommit: row.baseCommit,
              })),
            ),
          )
          return yield* Diffs.use((diffs) =>
            diffs.fileAtCheckpoint(checkpointId, 'api', 'crlf.txt'),
          )
        }),
      ),
    )
    expect(textOf(seen, 'before')).toBe('un\ndeux\n')
    expect(textOf(seen, 'after')).toBe('un\ndeux\ntrois\n')
  })
})

describe('Without the Workspace, the diff is the last checkpoint', () => {
  test('after the Workspace is removed and git gc --prune=now, diff.live answers from the last checkpoint with source: checkpoint', async () => {
    const { run } = engine()
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { missionId, api, rows } = yield* launchedOverBoth()
          writeFileSync(join(api, 'invoices.ts'), 'export const invoices = ["csv"]\n')
          writeFileSync(join(api, 'notes.md'), 'mine\n')
          const wanted = yield* live(missionId)
          const checkpointId = yield* Checkpoints.use((checkpoints) =>
            checkpoints.take(
              missionId,
              'review',
              rows.map((row) => ({
                name: row.path,
                folder: row.worktree,
                baseRef: row.baseRef,
                baseCommit: row.baseCommit,
              })),
            ),
          )
          const main = join(work, 'acme', 'api')
          const [workspace] = yield* Database.use((database) =>
            database
              .select({ branch: workspaces.branch })
              .from(workspaces)
              .where(eq(workspaces.id, rows[0]?.workspaceId ?? '')),
          )
          for (const row of rows) {
            const repository = join(work, 'acme', row.path)
            git(repository, 'worktree', 'remove', '--force', row.worktree)
            if (workspace?.branch != null) git(repository, 'branch', '-D', workspace.branch)
          }
          git(main, 'reflog', 'expire', '--expire=now', '--all')
          git(main, 'gc', '-q', '--prune=now')
          rmSync(api, { recursive: true, force: true })
          const after = yield* live(missionId)
          return {
            checkpointId,
            wanted,
            after,
            contents: yield* fileOf(missionId, 'api', 'invoices.ts'),
            atCheckpoint: yield* Diffs.use((diffs) => diffs.atCheckpoint(checkpointId)),
          }
        }),
      ),
    )
    expect(seen.after.source).toBe('checkpoint')
    expect(seen.after.checkpoint).toMatchObject({ id: seen.checkpointId, kind: 'review' })
    const strip = (files: ReadonlyArray<DiffFile>) =>
      files.map(({ path, letter, untracked, added, removed }) => ({
        path,
        letter,
        untracked,
        added,
        removed,
      }))
    expect(strip(filesOf(seen.after, 'api'))).toEqual(strip(filesOf(seen.wanted, 'api')))
    expect(seen.after.repositories.map((one) => one.repository)).toEqual(['api', 'web'])
    expect(textOf(seen.contents, 'after')).toBe('export const invoices = ["csv"]\n')
    expect(seen.atCheckpoint).toEqual(seen.after)
  })
})
