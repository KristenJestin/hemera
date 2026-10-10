/**
 * The invisible snapshots of a Building (#140, CT-01): Hemera's own object store per Project, the
 * trees it writes there without touching anything of the user's, the files changed between two of
 * them, and their contents copied into the database, sensitive files withheld and secrets masked.
 *
 * On the engine as it starts, over a data folder of the suite's own, with the machine's `git` on
 * repositories the suite makes under the temporary directory: a main checkout with a bare remote,
 * and a linked worktree of it standing for the Workspace.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { DatabaseSync } from 'node:sqlite'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  type FileDiff,
  SNAPSHOTS_FOLDER,
  type SnapshotOwner,
  Snapshots,
} from '../src/engine/building/snapshots.ts'
import { Checkpoints } from '../src/engine/building/checkpoints.ts'
import { createMission } from '../src/engine/missions.ts'
import { DATABASE_FILE } from '../src/engine/migrate.ts'
import { createProject } from '../src/engine/projects.ts'
import { BACKUP_FOLDERS } from '../src/engine/registries.ts'
import { FILE_CLASSES } from '../src/engine/retention.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { domainEvents, fileContents, snapshotFiles } from '../src/engine/storage/schema.ts'
import { commandsEngine } from './commands-engine.ts'
import { git, remote } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('snapshots'))
  work = realpathSync.native(temporaryFolder('snapshots-work'))
})
afterEach(removeFolders)

/** A main checkout with a `.gitignore` and a tracked file, its remote, on `main`. */
function mainCheckout(path: string): string {
  mkdirSync(path, { recursive: true })
  git(path, 'init', '-q', '-b', 'main')
  writeFileSync(join(path, '.gitignore'), 'secret.log\nnode_modules/\n')
  writeFileSync(join(path, 'tracked.txt'), 'one\ntwo\nthree\n')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'tracked')
  remote(path, join(work, 'remote.git'))
  return path
}

/** The main checkout and a linked worktree of it on its own branch: the Workspace. */
function workspace() {
  const main = mainCheckout(join(work, 'acme'))
  const worktree = join(work, 'workspace', 'acme')
  git(main, 'worktree', 'add', '-q', '-b', 'mission/login', worktree)
  return { main, worktree }
}

/** Every file under a folder, by its path from it: what an object folder holds. */
function filesUnder(folder: string): ReadonlyArray<string> {
  if (!existsSync(folder)) return []
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
}

/**
 * Everything of the user's a snapshot could change, read without writing anything: the index
 * file's bytes, what Git says of HEAD, the refs, the log, the reflog, the stash and the status,
 * and every file of the object folder.
 */
function observed(cwd: string) {
  const quiet = (...args: string[]) => git(cwd, '--no-optional-locks', ...args)
  const index = quiet('rev-parse', '--path-format=absolute', '--git-path', 'index')
  const common = quiet('rev-parse', '--path-format=absolute', '--git-common-dir')
  return {
    index: existsSync(index) ? readFileSync(index).toString('base64') : null,
    head: quiet('symbolic-ref', '-q', 'HEAD'),
    commit: quiet('rev-parse', '-q', '--verify', 'HEAD'),
    refs: quiet('for-each-ref'),
    log: quiet('log', '--all', '--format=%H %s'),
    reflog: quiet('reflog', '--all'),
    stash: quiet('stash', 'list'),
    status: quiet('status', '--porcelain'),
    objects: filesUnder(join(common, 'objects')),
  }
}

/** The files a tree of the store holds, by path. */
const treeFiles = (store: string, tree: string, alternate: string): ReadonlyArray<string> =>
  execInStore(store, alternate, 'ls-tree', '-r', '--name-only', '-z', tree)
    .split('\0')
    .filter(Boolean)

/** Git in the store, borrowing the objects of a repository. */
function execInStore(store: string, alternate: string, ...args: string[]): string {
  const previous = process.env['GIT_ALTERNATE_OBJECT_DIRECTORIES']
  process.env['GIT_ALTERNATE_OBJECT_DIRECTORIES'] = alternate
  try {
    return git(store, ...args)
  } finally {
    if (previous === undefined) delete process.env['GIT_ALTERNATE_OBJECT_DIRECTORIES']
    else process.env['GIT_ALTERNATE_OBJECT_DIRECTORIES'] = previous
  }
}

const objectsOf = (cwd: string) =>
  join(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'objects')

/** A Project over the main checkout, and one mission of it. */
const missionOf = (main: string, sentence = 'Add the login form') =>
  Effect.gen(function* () {
    const project = yield* createProject({ name: 'Acme', mainCheckout: main, repositories: [] })
    const mission = yield* createMission({
      projectId: project.id,
      idea: { sentence, ticket: null },
    })
    return { projectId: project.id, missionId: mission.id }
  })

const attempt = (missionId: string, side: 'start' | 'end', attemptId = 'attempt-1') =>
  ({ kind: 'attempt', missionId, attemptId, side }) satisfies SnapshotOwner

/** A file's changed fields, its contents left out: what Git lists. */
const listed = (file: FileDiff) => ({
  path: file.path,
  oldPath: file.oldPath,
  status: file.status,
  added: file.added,
  removed: file.removed,
  before: file.before?.size ?? null,
  after: file.after?.size ?? null,
})

const text = (side: FileDiff['before']) =>
  side === null || side.content === null ? null : Buffer.from(side.content).toString('utf8')

describe('The snapshot stores are part of the Profile', () => {
  test('the snapshots folder is carried by a backup, and kept as long as its missions', () => {
    expect(BACKUP_FOLDERS).toContain(SNAPSHOTS_FOLDER)
    expect(FILE_CLASSES).toMatchObject({ [SNAPSHOTS_FOLDER]: 'heavy' })
  })
})

describe('A snapshot leaves the user’s repository untouched', () => {
  test('HEAD, refs, index bytes, log, reflog, stash, status and object folder are the same after it, and the tree holds every change', async () => {
    const { main, worktree } = workspace()
    writeFileSync(join(worktree, 'stashed.txt'), 'kept aside\n')
    git(worktree, 'add', 'stashed.txt')
    git(worktree, 'stash', '-q')
    writeFileSync(join(worktree, 'staged.txt'), 'staged\n')
    git(worktree, 'add', 'staged.txt')
    writeFileSync(join(worktree, 'tracked.txt'), 'one\ntwo\nthree\nfour\n')
    writeFileSync(join(worktree, 'untracked.txt'), 'loose\n')
    writeFileSync(join(worktree, 'secret.log'), 'ignored\n')
    const before = { worktree: observed(worktree), main: observed(main) }

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { projectId, missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          const tree = yield* snapshots.take(
            { name: 'acme', folder: worktree },
            attempt(missionId, 'start'),
          )
          return { projectId, missionId, tree }
        }),
      ),
    )

    expect({ worktree: observed(worktree), main: observed(main) }).toEqual(before)
    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    expect(git(store, 'rev-parse', '--is-bare-repository')).toBe('true')
    expect(git(store, 'for-each-ref', '--format=%(refname) %(objectname)')).toBe(
      `refs/hemera/${seen.missionId}/attempt-1/start/acme ${seen.tree}`,
    )
    expect(treeFiles(store, seen.tree, objectsOf(main))).toEqual([
      '.gitignore',
      'staged.txt',
      'tracked.txt',
      'untracked.txt',
    ])
    expect(execInStore(store, objectsOf(main), 'cat-file', '-p', `${seen.tree}:tracked.txt`)).toBe(
      'one\ntwo\nthree\nfour',
    )
  })
})

describe('Two snapshots around a change give exactly its files', () => {
  test('each file with its status, its old path, its line counts and the size of each side', async () => {
    const { main, worktree } = workspace()
    writeFileSync(join(worktree, 'gone.txt'), 'soon gone\n')
    const moved = Array.from({ length: 10 }, (_, line) => `line ${String(line)}`).join('\n')
    writeFileSync(join(worktree, 'before.txt'), `${moved}\n`)
    git(worktree, 'add', '.')
    git(worktree, 'commit', '-q', '-m', 'more')

    const files = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          const acme = { name: 'acme', folder: worktree }
          const start = yield* snapshots.take(acme, attempt(missionId, 'start'))
          writeFileSync(join(worktree, 'tracked.txt'), 'one\n2\nthree\nfour\nfive\n')
          writeFileSync(join(worktree, 'added.txt'), 'new\n')
          rmSync(join(worktree, 'gone.txt'))
          renameSync(join(worktree, 'before.txt'), join(worktree, 'after.txt'))
          writeFileSync(join(worktree, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]))
          const end = yield* snapshots.take(acme, attempt(missionId, 'end'))
          const changed = yield* snapshots.changed(missionId, acme, start, end)
          const again = yield* snapshots.changed(missionId, acme, end, end)
          return { changed, again }
        }),
      ),
    )

    const size = moved.length + 1
    expect(
      files.changed.map((file) => ({ ...file })).sort((a, b) => a.path.localeCompare(b.path)),
    ).toEqual([
      {
        path: 'added.txt',
        oldPath: null,
        status: 'A',
        added: 1,
        removed: 0,
        sizeBefore: null,
        sizeAfter: 4,
      },
      {
        path: 'after.txt',
        oldPath: 'before.txt',
        status: 'R',
        added: 0,
        removed: 0,
        sizeBefore: size,
        sizeAfter: size,
      },
      {
        path: 'gone.txt',
        oldPath: null,
        status: 'D',
        added: 0,
        removed: 1,
        sizeBefore: 10,
        sizeAfter: null,
      },
      {
        path: 'logo.png',
        oldPath: null,
        status: 'A',
        added: null,
        removed: null,
        sizeBefore: null,
        sizeAfter: 6,
      },
      {
        path: 'tracked.txt',
        oldPath: null,
        status: 'M',
        added: 3,
        removed: 1,
        sizeBefore: 14,
        sizeAfter: 22,
      },
    ])
    expect(files.again).toEqual([])
  })
})

describe('An ignored file never appears in a snapshot', () => {
  test('an ignored file and an ignored folder are left out of the tree and of the change', async () => {
    const { main, worktree } = workspace()

    const files = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          const acme = { name: 'acme', folder: worktree }
          const start = yield* snapshots.take(acme, attempt(missionId, 'start'))
          writeFileSync(join(worktree, 'secret.log'), 'ignored\n')
          mkdirSync(join(worktree, 'node_modules', 'left-pad'), { recursive: true })
          writeFileSync(
            join(worktree, 'node_modules', 'left-pad', 'index.js'),
            'module.exports = 1\n',
          )
          writeFileSync(join(worktree, 'kept.txt'), 'kept\n')
          const end = yield* snapshots.take(acme, attempt(missionId, 'end'))
          return yield* snapshots.changed(missionId, acme, start, end)
        }),
      ),
    )

    expect(files.map((file) => file.path)).toEqual(['kept.txt'])
  })
})

describe('A linked worktree is snapshotted through its own index', () => {
  test('what only the worktree’s index says is kept, and neither index is written', async () => {
    const { main, worktree } = workspace()
    // A file the worktree does not check out: through the main checkout's index instead, the
    // snapshot would record it as deleted.
    git(worktree, 'update-index', '--skip-worktree', 'tracked.txt')
    rmSync(join(worktree, 'tracked.txt'))
    writeFileSync(join(worktree, 'form.txt'), 'the form\n')
    const before = { worktree: observed(worktree), main: observed(main) }

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { projectId, missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          const tree = yield* snapshots.take(
            { name: 'acme', folder: worktree },
            attempt(missionId, 'start'),
          )
          return { projectId, tree }
        }),
      ),
    )

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    expect(treeFiles(store, seen.tree, objectsOf(main))).toEqual([
      '.gitignore',
      'form.txt',
      'tracked.txt',
    ])
    expect({ worktree: observed(worktree), main: observed(main) }).toEqual(before)
  })
})

describe('A repository with no commit and no index yet is snapshotted', () => {
  test('its files are the tree, and it is left with no index, no commit and no ref', async () => {
    const fresh = join(work, 'fresh')
    mkdirSync(fresh)
    git(fresh, 'init', '-q', '-b', 'main')
    writeFileSync(join(fresh, 'first.txt'), 'first\n')

    const files = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(fresh)
          const snapshots = yield* Snapshots
          const place = { name: 'fresh', folder: fresh }
          const tree = yield* snapshots.take(place, attempt(missionId, 'end'))
          return yield* snapshots.changed(missionId, place, null, tree)
        }),
      ),
    )

    expect(files.map(({ path, status, added }) => ({ path, status, added }))).toEqual([
      { path: 'first.txt', status: 'A', added: 1 },
    ])
    expect(existsSync(join(fresh, '.git', 'index'))).toBe(false)
    expect(git(fresh, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main')
    expect(git(fresh, 'for-each-ref')).toBe('')
    expect(
      filesUnder(join(fresh, '.git', 'objects')).filter((one) => !one.includes('info')),
    ).toEqual([])
  })
})

describe('Paths are handed to Git as they are', () => {
  test('a folder and files whose names a shell would split or expand', async () => {
    const odd = mainCheckout(join(work, 'my repo (atlas) $HOME & co'))
    const names = ['a file with spaces.txt', 'été & co.md', "it's; $PATH.txt"]

    const files = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(odd)
          const snapshots = yield* Snapshots
          const place = { name: 'my repo', folder: odd }
          const start = yield* snapshots.take(place, attempt(missionId, 'start'))
          for (const name of names) writeFileSync(join(odd, name), `${name}\n`)
          const end = yield* snapshots.take(place, attempt(missionId, 'end'))
          return yield* snapshots.changed(missionId, place, start, end)
        }),
      ),
    )

    expect(files.map((file) => file.path).sort()).toEqual([...names].sort())
    expect(files.every((file) => file.status === 'A' && file.added === 1)).toBe(true)
  })
})

/** A file name with a tab in it: Windows refuses one, so it is made only elsewhere. */
const TABBED = process.platform === 'win32' ? 'no tab here.txt' : 'with\ttab.txt'

describe('An attempt’s files are captured with their contents before and after', () => {
  test('a binary file, a deleted file, a renamed file and a file with a tab in its name, with both sides and their sizes', async () => {
    const { main, worktree } = workspace()
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0xff, 0xfe])
    const body = Array.from({ length: 12 }, (_, line) => `row ${String(line)}`).join('\n')
    writeFileSync(join(worktree, 'gone.txt'), 'soon gone\n')
    writeFileSync(join(worktree, 'old-name.txt'), `${body}\n`)
    writeFileSync(join(worktree, 'logo.bin'), binary)
    git(worktree, 'add', '.')
    git(worktree, 'commit', '-q', '-m', 'files')

    const diff = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          const acme = { name: 'acme', folder: worktree }
          const start = yield* snapshots.take(acme, attempt(missionId, 'start'))
          rmSync(join(worktree, 'gone.txt'))
          renameSync(join(worktree, 'old-name.txt'), join(worktree, 'new-name.txt'))
          writeFileSync(join(worktree, 'logo.bin'), Buffer.concat([binary, Buffer.from([0, 7])]))
          writeFileSync(join(worktree, TABBED), 'tabbed\n')
          const end = yield* snapshots.take(acme, attempt(missionId, 'end'))
          const files = yield* snapshots.changed(missionId, acme, start, end)
          yield* snapshots.capture(missionId, acme, start, end, files)
          return yield* snapshots.diff(missionId, acme, start, end)
        }),
      ),
    )

    const byPath = new Map(diff.map((file) => [file.path, file]))
    expect(diff.map(listed).sort((a, b) => a.path.localeCompare(b.path))).toEqual(
      [
        {
          path: 'gone.txt',
          oldPath: null,
          status: 'D',
          added: 0,
          removed: 1,
          before: 10,
          after: null,
        },
        {
          path: 'logo.bin',
          oldPath: null,
          status: 'M',
          added: null,
          removed: null,
          before: 11,
          after: 13,
        },
        {
          path: 'new-name.txt',
          oldPath: 'old-name.txt',
          status: 'R',
          added: 0,
          removed: 0,
          before: body.length + 1,
          after: body.length + 1,
        },
        { path: TABBED, oldPath: null, status: 'A', added: 1, removed: 0, before: null, after: 7 },
      ].sort((a, b) => a.path.localeCompare(b.path)),
    )
    expect(text(byPath.get('gone.txt')?.before ?? null)).toBe('soon gone\n')
    expect(byPath.get('gone.txt')?.after).toBeNull()
    const logo = byPath.get('logo.bin')
    expect(Buffer.from(logo?.before?.content ?? []).equals(binary)).toBe(true)
    expect(
      Buffer.from(logo?.after?.content ?? []).equals(Buffer.concat([binary, Buffer.from([0, 7])])),
    ).toBe(true)
    expect(text(byPath.get('new-name.txt')?.after ?? null)).toBe(`${body}\n`)
    expect(byPath.get(TABBED)?.before).toBeNull()
    expect(text(byPath.get(TABBED)?.after ?? null)).toBe('tabbed\n')
  })
})

/**
 * Where a value is found in the data folder: every row of every table of the database, its
 * blobs read as bytes, and every file of the data folder but the database itself.
 */
function foundIn(folder: string, value: string): ReadonlyArray<string> {
  const database = new DatabaseSync(join(folder, DATABASE_FILE), { readOnly: true })
  try {
    const tables = database
      .prepare("select name from sqlite_master where type = 'table'")
      .all()
      .map((row) => String(row['name']))
    return tables.filter((table) =>
      database
        .prepare(`select * from "${table}"`)
        .all()
        .some((row) =>
          Object.values(row).some((cell) =>
            cell instanceof Uint8Array
              ? Buffer.from(cell).includes(value)
              : String(cell).includes(value),
          ),
        ),
    )
  } finally {
    database.close()
  }
}

describe('A sensitive file is never copied', () => {
  test('a .env and a config/.env.local an attempt changed keep their path and fingerprint only, and read as withheld', async () => {
    const { main, worktree } = workspace()
    const secretOne = 'TOKEN=first-hidden-value-31'
    const secretTwo = 'TOKEN=second-hidden-value-47'

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          const acme = { name: 'acme', folder: worktree }
          const start = yield* snapshots.take(acme, attempt(missionId, 'start'))
          writeFileSync(join(worktree, '.env'), `${secretOne}\n`)
          mkdirSync(join(worktree, 'config'))
          writeFileSync(join(worktree, 'config', '.env.local'), `${secretTwo}\n`)
          const end = yield* snapshots.take(acme, attempt(missionId, 'end'))
          const files = yield* snapshots.changed(missionId, acme, start, end)
          yield* snapshots.capture(missionId, acme, start, end, files)
          const diff = yield* snapshots.diff(missionId, acme, start, end, '.env')
          const read = yield* snapshots.read(missionId, acme, end, 'config/.env.local')
          const rows = yield* Database.use((database) =>
            database.select().from(snapshotFiles).orderBy(snapshotFiles.path),
          ).pipe(Effect.orDie)
          return { diff, read, rows }
        }),
      ),
    )

    expect(seen.diff).toHaveLength(1)
    expect(seen.diff[0]?.after).toMatchObject({
      content: null,
      withheld: 'content withheld: .env',
      size: secretOne.length + 1,
    })
    expect(seen.read).toMatchObject({
      content: null,
      withheld: 'content withheld: config/.env.local',
    })
    expect(seen.rows.map(({ path, withheld }) => ({ path, withheld }))).toEqual([
      { path: '.env', withheld: 'content withheld: .env' },
      { path: 'config/.env.local', withheld: 'content withheld: config/.env.local' },
    ])
    expect(seen.rows[0]?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(foundIn(data, 'hidden-value')).toEqual([])
  })
})

describe('A sensitive file never reaches the snapshot store', () => {
  test('an unignored .env and a changed tracked config/.env.local: the tree names them, but no object of the store and no table holds their values', async () => {
    const { main, worktree } = workspace()
    mkdirSync(join(worktree, 'config'))
    writeFileSync(join(worktree, 'config', '.env.local'), 'MODE=committed-before\n')
    git(worktree, 'add', '.')
    git(worktree, 'commit', '-q', '-m', 'config')
    const untracked = 'API_KEY=store-must-not-hold-71'
    const changed = 'API_KEY=store-must-not-hold-93'

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { projectId, missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          const checkpointsService = yield* Checkpoints
          const acme = { name: 'acme', folder: worktree }
          const start = yield* snapshots.take(acme, attempt(missionId, 'start'))
          writeFileSync(join(worktree, '.env'), `${untracked}\n`)
          writeFileSync(join(worktree, 'config', '.env.local'), `${changed}\n`)
          const end = yield* snapshots.take(acme, attempt(missionId, 'end'))
          const files = yield* snapshots.changed(missionId, acme, start, end)
          yield* snapshots.capture(missionId, acme, start, end, files)
          const checkpoint = yield* checkpointsService.take(missionId, 'review', [
            { name: 'acme', folder: worktree, baseRef: 'origin/main', baseCommit: null },
          ])
          const diff = yield* snapshots.diff(missionId, acme, start, end)
          const checkpointFiles = yield* checkpointsService.files(checkpoint)
          return { projectId, end, diff, checkpointFiles }
        }),
      ),
    )

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    const everything = execFileSync(
      'git',
      ['cat-file', '--batch-all-objects', '--batch', '--unordered'],
      { cwd: store },
    )
    expect(everything.includes('store-must-not-hold')).toBe(false)
    expect(
      filesUnder(store).filter((file) => readFileSync(file).includes('store-must-not-hold')),
    ).toEqual([])
    expect(foundIn(data, 'store-must-not-hold')).toEqual([])
    // The tree still names both files, so a diff lists them, content withheld.
    expect(treeFiles(store, seen.end, objectsOf(main))).toEqual(
      expect.arrayContaining(['.env', 'config/.env.local']),
    )
    const env = seen.diff.find((file) => file.path === '.env')
    expect(env).toMatchObject({ status: 'A', added: null, removed: null, before: null })
    expect(env?.after).toMatchObject({
      content: null,
      withheld: 'content withheld: .env',
      size: untracked.length + 1,
      sha256: createHash('sha256').update(`${untracked}\n`).digest('hex'),
    })
    const local = seen.diff.find((file) => file.path === 'config/.env.local')
    expect(local?.before?.sha256).toBe(
      createHash('sha256').update('MODE=committed-before\n').digest('hex'),
    )
    expect(local?.after).toMatchObject({
      content: null,
      withheld: 'content withheld: config/.env.local',
      size: changed.length + 1,
    })
    expect(seen.checkpointFiles.filter((file) => file.path.includes('.env'))).toMatchObject([
      { path: '.env', binary: false, sizeAfter: untracked.length + 1 },
      { path: 'config/.env.local', binary: false, sizeAfter: changed.length + 1 },
    ])
  })
})

describe('A secret in a copied content is masked', () => {
  test('a file holding a Project variable’s value is stored masked, flagged, with the original’s fingerprint', async () => {
    const { main, worktree } = workspace()
    const value = 'variable-value-8812'
    const original = `const key = '${value}'\n`

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { projectId, missionId } = yield* missionOf(main)
          const secrets = yield* Secrets
          secrets.register(`project-variables:${projectId}`, [value])
          const snapshots = yield* Snapshots
          const acme = { name: 'acme', folder: worktree }
          const start = yield* snapshots.take(acme, attempt(missionId, 'start'))
          writeFileSync(join(worktree, 'config.ts'), original)
          const end = yield* snapshots.take(acme, attempt(missionId, 'end'))
          const files = yield* snapshots.changed(missionId, acme, start, end)
          yield* snapshots.capture(missionId, acme, start, end, files)
          const read = yield* snapshots.read(missionId, acme, end, 'config.ts')
          const rows = yield* Database.use((database) => database.select().from(fileContents)).pipe(
            Effect.orDie,
          )
          return { read, rows }
        }),
      ),
    )

    const fingerprint = createHash('sha256').update(original).digest('hex')
    expect(seen.rows).toHaveLength(1)
    expect(seen.rows[0]).toMatchObject({ sha256: fingerprint, masked: true, size: original.length })
    expect(seen.rows[0]?.bytes.toString('utf8')).toBe("const key = '•••'\n")
    expect(seen.read).toMatchObject({ sha256: fingerprint, masked: true, withheld: null })
    expect(Buffer.from(seen.read?.content ?? []).toString('utf8')).toBe("const key = '•••'\n")
    expect(foundIn(data, value)).toEqual([])
  })
})

describe('A content is stored once across the Profile', () => {
  test('the same content changed in two missions, and captured twice, is one row', async () => {
    const { main, worktree } = workspace()

    const counted = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const first = yield* missionOf(main)
          const second = yield* createMission({
            projectId: first.projectId,
            idea: { sentence: 'Another mission', ticket: null },
          })
          const snapshots = yield* Snapshots
          const acme = { name: 'acme', folder: worktree }
          const count = () =>
            Database.use((database) =>
              Effect.all([database.$count(fileContents), database.$count(snapshotFiles)]),
            ).pipe(Effect.orDie)
          const steps: Array<readonly [number, number]> = []
          for (const missionId of [first.missionId, second.id]) {
            writeFileSync(join(worktree, 'shared.txt'), 'before\n')
            const start = yield* snapshots.take(acme, attempt(missionId, 'start'))
            writeFileSync(join(worktree, 'shared.txt'), 'the same content\n')
            const end = yield* snapshots.take(acme, attempt(missionId, 'end'))
            const files = yield* snapshots.changed(missionId, acme, start, end)
            yield* snapshots.capture(missionId, acme, start, end, files)
            steps.push(yield* count())
            yield* snapshots.capture(missionId, acme, start, end, files)
            steps.push(yield* count())
            rmSync(join(worktree, 'shared.txt'))
          }
          return steps
        }),
      ),
    )

    // Two contents (before and after) and one row per side: the second capture of a pair writes
    // nothing, and the second mission adds its own sides but no content.
    expect(counted).toEqual([
      [2, 2],
      [2, 2],
      [2, 4],
      [2, 4],
    ])
  })
})

describe('A refused snapshot leaves nothing behind', () => {
  test('a broken index: Git’s words, no temporary folder, no ref, the index as it was, and snapshot.failed', async () => {
    const { main, worktree } = workspace()
    const index = git(worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'index')
    writeFileSync(index, 'not an index')
    // The temporary directory is this test's own while it runs, so what is left in it is what the
    // snapshot left.
    const temporary = join(work, 'temporary')
    mkdirSync(temporary)
    const previous = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { projectId, missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          Object.assign(process.env, { TMPDIR: temporary, TMP: temporary, TEMP: temporary })
          const refusal = yield* Effect.flip(
            snapshots.take({ name: 'acme', folder: worktree }, attempt(missionId, 'start')),
          ).pipe(Effect.ensuring(Effect.sync(() => restore(previous))))
          const events = yield* Database.use((database) =>
            database.select().from(domainEvents),
          ).pipe(Effect.orDie)
          return { projectId, missionId, refusal, events }
        }),
      ),
    )

    expect(seen.refusal.message).toMatch(/index/)
    expect(readdirSync(temporary)).toEqual([])
    expect(readFileSync(index, 'utf8')).toBe('not an index')
    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    expect(git(store, 'for-each-ref')).toBe('')
    const failed = seen.events.find((event) => event.type === 'snapshot.failed')
    expect(failed).toMatchObject({ entityKind: 'mission', entityId: seen.missionId })
    expect(JSON.parse(failed?.payload ?? '{}')).toMatchObject({
      repository: 'acme',
      owner: 'attempt attempt-1 start',
      said: expect.stringMatching(/index/),
    })
  })

  test('a folder that is not a repository: Git’s own words', async () => {
    const plain = join(work, 'plain')
    mkdirSync(plain)

    const refusal = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(plain)
          const snapshots = yield* Snapshots
          return yield* Effect.flip(
            snapshots.take({ name: 'plain', folder: plain }, attempt(missionId, 'start')),
          )
        }),
      ),
    )

    expect(refusal.message).toMatch(/^fatal: /)
  })
})

function restore(previous: Readonly<Record<string, string | undefined>>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
