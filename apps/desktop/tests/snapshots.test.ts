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
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

import { DatabaseSync } from 'node:sqlite'
import { Deferred, Effect, Fiber, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import {
  FOREIGN_GIT_FOLDER,
  type FileDiff,
  READ_CAP,
  SNAPSHOTS_FOLDER,
  type SnapshotOwner,
  Snapshots,
} from '../src/engine/building/snapshots.ts'
import { Checkpoints } from '../src/engine/building/checkpoints.ts'
import { NOT_A_FILE, OVER_CAP, THROUGH_A_LINK } from '../src/engine/tools/judged.ts'
import { createMission } from '../src/engine/missions.ts'
import { DATABASE_FILE } from '../src/engine/migrate.ts'
import { createProject } from '../src/engine/projects.ts'
import { BACKUP_FOLDERS } from '../src/engine/registries.ts'
import { FILE_CLASSES } from '../src/engine/retention.ts'
import { Secrets } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { domainEvents, fileContents, snapshotFiles } from '../src/engine/storage/schema.ts'
import { commandsEngine } from './commands-engine.ts'
import { LARGE_TEXT, largeJson, watchedSecrets } from './paced-masking.ts'
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

describe('Two first snapshots of a Project at once share one store', () => {
  test('a snapshot taken while another creates the Project’s store never creates it over that one, and both are taken', async () => {
    const { main, worktree } = workspace()
    // Git refuses a second `init` over one still writing (its config lock, its templates): the
    // first creation is held while the second snapshot runs from start to end.
    const firstHeld = Deferred.makeUnsafe<void>()
    const firstArrived = Deferred.makeUnsafe<void>()
    const creating = new Set<string>()
    const createdOver: string[] = []
    let inits = 0
    const seen = await commandsEngine(data, {
      snapshotsGit: (real) => (folder, args, kind, options) => {
        if (args[0] !== 'init') return real(folder, args, kind, options)
        const target = args.at(-1) ?? ''
        if (creating.has(target)) createdOver.push(target)
        creating.add(target)
        inits += 1
        const turn =
          inits === 1
            ? Effect.andThen(Deferred.succeed(firstArrived, undefined), Deferred.await(firstHeld))
            : Effect.void
        return turn.pipe(
          Effect.andThen(real(folder, args, kind, options)),
          Effect.ensuring(Effect.sync(() => creating.delete(target))),
        )
      },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { projectId, missionId } = yield* missionOf(main)
          const place = { name: 'acme', folder: worktree }
          const first = yield* Effect.forkChild(
            Snapshots.use((snapshots) => snapshots.take(place, attempt(missionId, 'start'))),
          )
          yield* Deferred.await(firstArrived)
          const second = yield* Snapshots.use((snapshots) =>
            snapshots.take(place, attempt(missionId, 'end')),
          )
          yield* Deferred.succeed(firstHeld, undefined)
          return { projectId, missionId, first: yield* Fiber.join(first), second }
        }),
      ),
    )

    expect(createdOver).toEqual([])
    expect(seen.first).toBe(seen.second)
    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    expect(git(store, 'for-each-ref', '--format=%(refname) %(objectname)')).toBe(
      [
        `refs/hemera/${seen.missionId}/attempt-1/end/acme ${seen.second}`,
        `refs/hemera/${seen.missionId}/attempt-1/start/acme ${seen.first}`,
      ].join('\n'),
    )
    expect(readdirSync(join(data, 'snapshots'))).toEqual([`${seen.projectId}.git`])
  })
})

describe('A snapshot costs as few Git processes as it needs', () => {
  // Every `git` is a process, and on a Windows runner one costs 40 to 50 ms where Linux takes 2:
  // a Building takes dozens of snapshots, so the tests that run one are as slow as their count.
  test('a snapshot of a linked worktree asks Git where its objects and its index are in one call', async () => {
    const { main, worktree } = workspace()
    const asked: string[][] = []
    const seen = await commandsEngine(data, {
      snapshotsGit: (real) => (folder, args, kind, options) => {
        if (folder === worktree) asked.push([...args])
        return real(folder, args, kind, options)
      },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(main)
          const place = { name: 'acme', folder: worktree }
          // The first snapshot makes the Project's store; the second is the steady state.
          yield* Snapshots.use((snapshots) => snapshots.take(place, attempt(missionId, 'start')))
          asked.length = 0
          // A change to add: with nothing to add, a snapshot runs no `add` at all.
          writeFileSync(join(worktree, 'form.txt'), 'the form\n')
          yield* Snapshots.use((snapshots) => snapshots.take(place, attempt(missionId, 'end')))
          // The subcommand: what follows the options (`-c key=value`, `--no-optional-locks`).
          return asked.map((args) => {
            let at = 0
            while (args[at]?.startsWith('-') === true) at += args[at] === '-c' ? 2 : 1
            return args[at] ?? ''
          })
        }),
      ),
    )
    expect(seen).toEqual(['rev-parse', 'ls-files', 'add', 'write-tree'])
  })

  test('a Project whose main checkout is a folder of repositories is asked about once, and a repository’s objects once', async () => {
    // The main checkout holds `api` and is no repository itself: asking it fails every time.
    const main = join(work, 'acme')
    const api = mainCheckout(join(main, 'api'))
    const worktree = join(work, 'workspace', 'api')
    git(api, 'worktree', 'add', '-q', '-b', 'mission/login', worktree)
    const sharedFolder = ['rev-parse', '--path-format=absolute', '--git-common-dir']
    const asked: string[] = []
    const seen = await commandsEngine(data, {
      snapshotsGit: (real) => (folder, args, kind, options) => {
        if (args.join(' ') === sharedFolder.join(' ')) asked.push(folder)
        return real(folder, args, kind, options)
      },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* createProject({
            name: 'Acme',
            mainCheckout: main,
            repositories: ['api'],
          })
          const mission = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Add the login form', ticket: null },
          })
          const place = { name: 'api', folder: worktree }
          const between = (attemptId: string) =>
            Effect.gen(function* () {
              writeFileSync(join(worktree, `${attemptId}.txt`), 'the form\n')
              const first = yield* Snapshots.use((snapshots) =>
                snapshots.take(place, attempt(mission.id, 'start', attemptId)),
              )
              writeFileSync(join(worktree, `${attemptId}-more.txt`), 'the form\n')
              const second = yield* Snapshots.use((snapshots) =>
                snapshots.take(place, attempt(mission.id, 'end', attemptId)),
              )
              return yield* Snapshots.use((snapshots) =>
                snapshots.changed(mission.id, place, first, second),
              )
            })
          // The first attempt looks the folders up; the second is the steady state.
          yield* between('one')
          asked.length = 0
          const files = yield* between('two')
          return { files: files.map((file) => file.path), asked: [...asked] }
        }),
      ),
    )
    expect(seen.files).toEqual(['two-more.txt'])
    expect(seen.asked).toEqual([])
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

/** Every file of a repository's Git folders (its own, and the one it shares), by path. */
function gitFolderFiles(cwd: string): ReadonlyArray<string> {
  const folders = ['--absolute-git-dir', '--git-common-dir'].map((flag) =>
    git(cwd, 'rev-parse', '--path-format=absolute', flag),
  )
  return [...new Set(folders.flatMap(filesUnder))].sort()
}

describe('A snapshot of a repository with a split index', () => {
  /** A snapshot of `worktree`, and the files its Git folders held before and after it. */
  const snapshotAround = (main: string, worktree: string) => {
    const before = gitFolderFiles(worktree)
    return commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          const tree = yield* snapshots.take(
            { name: 'acme', folder: worktree },
            attempt(missionId, 'start'),
          )
          return { tree, before, after: gitFolderFiles(worktree) }
        }),
      ),
    )
  }

  /** Enough tracked files that changing them all is more than a split index keeps in its own file. */
  const manyFiles = (main: string, worktree: string) => {
    for (let n = 0; n < 20; n++) writeFileSync(join(main, `file-${n}.txt`), `${n}\n`)
    git(main, 'add', '.')
    git(main, 'commit', '-q', '-m', 'many')
    git(worktree, 'merge', '-q', 'main')
    for (let n = 0; n < 20; n++) writeFileSync(join(worktree, `file-${n}.txt`), `changed ${n}\n`)
  }

  test('a snapshot of a repository with core.splitIndex set writes nothing into its Git folder', async () => {
    const { main, worktree } = workspace()
    manyFiles(main, worktree)
    // Set once the index exists, whole: the first write to a copy of it is the one that splits it.
    git(worktree, 'config', 'core.splitIndex', 'true')
    writeFileSync(join(worktree, 'untracked.txt'), 'loose\n')
    const before = observed(worktree)

    const seen = await snapshotAround(main, worktree)

    expect(seen.after).toEqual(seen.before)
    expect(seen.after.filter((path) => path.includes('sharedindex'))).toEqual([])
    expect(observed(worktree)).toEqual(before)
    expect(seen.tree).toMatch(/^[0-9a-f]{40}$/)
  })

  test('a snapshot of a repository whose index is already split writes nothing into its Git folder', async () => {
    const { main, worktree } = workspace()
    manyFiles(main, worktree)
    git(worktree, 'update-index', '--split-index')
    // Many files Git has not seen: more than a split index keeps in its own file asks for a new one.
    for (let n = 0; n < 40; n++) writeFileSync(join(worktree, `new-${n}.txt`), `${n}\n`)
    const before = observed(worktree)

    const seen = await snapshotAround(main, worktree)

    expect(seen.after).toEqual(seen.before)
    expect(observed(worktree)).toEqual(before)
    expect(seen.tree).toMatch(/^[0-9a-f]{40}$/)
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

describe('A large file is masked in slices the engine answers between (#402)', () => {
  test('a large JSON file a snapshot captures is stored masked as the whole mask gives it, while another fiber keeps its turns', async () => {
    const { main, worktree } = workspace()
    const value = 'variable-value-8812'
    const original = largeJson(4 * LARGE_TEXT, value)
    const { secrets, watch, unwatched } = watchedSecrets((registry) =>
      registry.register('project-variables:acme', [value]),
    )
    const expected = unwatched.mask(original)
    expect(expected).not.toContain(value)

    const rows = await commandsEngine(data, { secrets })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          const acme = { name: 'acme', folder: worktree }
          const start = yield* snapshots.take(acme, attempt(missionId, 'start'))
          writeFileSync(join(worktree, 'lock.json'), original)
          const end = yield* snapshots.take(acme, attempt(missionId, 'end'))
          const files = yield* snapshots.changed(missionId, acme, start, end)
          yield* snapshots.capture(missionId, acme, start, end, files)
          return yield* Database.use((database) => database.select().from(fileContents)).pipe(
            Effect.orDie,
          )
        }),
      ),
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.masked).toBe(true)
    expect(rows[0]?.bytes.toString('utf8')).toBe(expected)
    expect(watch.syncOnLarge).toBe(0)
    expect(watch.pacedTurns).toHaveLength(1)
    expect(watch.pacedTurns[0]).toBeGreaterThan(0)
  })
})

describe('A large file read from a snapshot is masked in slices too (#402)', () => {
  test('a large JSON file read back from a tree of the store comes masked as the whole mask gives it, while another fiber keeps its turns', async () => {
    const { main, worktree } = workspace()
    const value = 'variable-value-8812'
    const original = largeJson(4 * LARGE_TEXT, value)
    const { secrets, watch, unwatched } = watchedSecrets((registry) =>
      registry.register('project-variables:acme', [value]),
    )

    const read = await commandsEngine(data, { secrets })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(main)
          const snapshots = yield* Snapshots
          const acme = { name: 'acme', folder: worktree }
          writeFileSync(join(worktree, 'lock.json'), original)
          const end = yield* snapshots.take(acme, attempt(missionId, 'end'))
          return yield* snapshots.read(missionId, acme, end, 'lock.json')
        }),
      ),
    )

    expect(text(read)).toBe(unwatched.mask(original))
    expect(read?.masked).toBe(true)
    expect(watch.syncOnLarge).toBe(0)
    expect(watch.pacedTurns).toHaveLength(1)
    expect(watch.pacedTurns[0]).toBeGreaterThan(0)
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

describe('A checkpoint reads only the repository’s own Git folder, and never waits on it (#439)', () => {
  /** The Workspace's worktree, and the Git folder the main checkout keeps for it. */
  const ownEntry = () => {
    const { main, worktree } = workspace()
    const entry = git(worktree, 'rev-parse', '--path-format=absolute', '--absolute-git-dir')
    return { main, worktree, entry }
  }

  /**
   * Points the worktree's `.git` at another Git folder. It is removed first: Git for Windows makes
   * it hidden, and Windows refuses to open a hidden file for writing over (EPERM).
   */
  const pointAt = (worktree: string, folder: string) => {
    rmSync(join(worktree, '.git'))
    writeFileSync(join(worktree, '.git'), `gitdir: ${folder}\n`)
  }

  /** A Git folder of an agent's making, which the worktree's `.git` is pointed at. */
  const pointedAtFake = (worktree: string, index: (fake: string) => void) => {
    const fake = join(work, 'fake-git')
    mkdirSync(fake)
    git(fake, 'init', '-q', '-b', 'main')
    const folder = join(fake, '.git')
    index(join(folder, 'index'))
    pointAt(worktree, folder)
    return folder
  }

  /** A checkpoint of the worktree, taken while another call of the engine is answered. */
  const checkpointOf = (main: string, worktree: string) =>
    commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { missionId } = yield* missionOf(main)
          const checkpoints = yield* Checkpoints
          const taking = yield* Effect.forkChild(
            Effect.result(
              checkpoints.take(missionId, 'review', [
                { name: 'acme', folder: worktree, baseRef: 'origin/main', baseCommit: null },
              ]),
            ),
          )
          // Another call of the engine, answered while the checkpoint is taken.
          const answered = yield* Database.use((database) =>
            database.select().from(domainEvents),
          ).pipe(Effect.orDie)
          const taken = yield* Fiber.join(taking)
          return {
            answered: answered.length > 0,
            refusal: Result.isFailure(taken) ? taken.failure.message : null,
          }
        }),
      ),
    )

  test.skipIf(process.platform === 'win32')(
    'a worktree whose .git points at a Git folder with a pipe as index: the checkpoint is refused at once, and the engine answers another call meanwhile',
    async () => {
      const { main, worktree } = workspace()
      pointedAtFake(worktree, (index) => execFileSync('mkfifo', [index]))

      const seen = await checkpointOf(main, worktree)

      expect(seen.answered).toBe(true)
      expect(seen.refusal).toContain(FOREIGN_GIT_FOLDER)
    },
  )

  test('a worktree whose .git points at a Git folder outside the repository: its index is never read', async () => {
    const { main, worktree } = workspace()
    const fake = pointedAtFake(worktree, (index) => writeFileSync(index, 'an index of elsewhere'))

    const seen = await checkpointOf(main, worktree)

    expect(seen.refusal).toContain(FOREIGN_GIT_FOLDER)
    expect(seen.refusal).toContain(realpathSync.native(fake))
  })

  test('a worktree whose .git points at a Git folder of its own making that names the repository’s shared one: its index is never read', async () => {
    const { main, worktree, entry } = ownEntry()
    const fake = join(work, 'fake-entry')
    mkdirSync(fake)
    writeFileSync(join(fake, 'HEAD'), readFileSync(join(entry, 'HEAD')))
    writeFileSync(join(fake, 'commondir'), `${join(main, '.git')}\n`)
    writeFileSync(join(fake, 'gitdir'), `${join(worktree, '.git')}\n`)
    writeFileSync(join(fake, 'index'), 'an index of elsewhere')
    pointAt(worktree, fake)

    const seen = await checkpointOf(main, worktree)

    expect(seen.refusal).toContain(FOREIGN_GIT_FOLDER)
    expect(seen.refusal).toContain(realpathSync.native(fake))
  })

  test('a sensitive file reached through a folder link leading outside is never read', async () => {
    const { main, worktree } = workspace()
    mkdirSync(join(worktree, 'config'))
    writeFileSync(join(worktree, 'config', '.env.local'), 'TOKEN=inside\n')
    git(worktree, 'add', 'config/.env.local')
    git(worktree, 'commit', '-q', '-m', 'config')
    const outside = join(work, 'outside-config')
    mkdirSync(outside)
    writeFileSync(join(outside, '.env.local'), 'TOKEN=outside\n')
    rmSync(join(worktree, 'config'), { recursive: true })
    symlinkSync(outside, join(worktree, 'config'), 'junction')

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { projectId, missionId } = yield* missionOf(main)
          const tree = yield* Snapshots.use((snapshots) =>
            snapshots.take({ name: 'acme', folder: worktree }, attempt(missionId, 'end')),
          )
          return { projectId, tree }
        }),
      ),
    )

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    expect(treeFiles(store, seen.tree, objectsOf(main))).not.toContain('config/.env.local')
    const everything = execFileSync(
      'git',
      ['cat-file', '--batch-all-objects', '--batch', '--unordered'],
      { cwd: store, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    )
    expect(everything).not.toContain('TOKEN=outside')
  })

  test('a tracked sensitive file replaced by a link is left out of the tree, its old content with it', async (context) => {
    const { main, worktree } = workspace()
    mkdirSync(join(worktree, 'config'))
    writeFileSync(join(worktree, 'config', '.env.local'), 'TOKEN=committed-before-29\n')
    writeFileSync(join(worktree, 'notes.txt'), 'notes\n')
    git(worktree, 'add', 'config/.env.local', 'notes.txt')
    git(worktree, 'commit', '-q', '-m', 'config')
    rmSync(join(worktree, 'config', '.env.local'))
    try {
      symlinkSync(join(worktree, 'notes.txt'), join(worktree, 'config', '.env.local'), 'file')
    } catch {
      context.skip()
    }

    const seen = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { projectId, missionId } = yield* missionOf(main)
          const tree = yield* Snapshots.use((snapshots) =>
            snapshots.take({ name: 'acme', folder: worktree }, attempt(missionId, 'end')),
          )
          return { projectId, tree }
        }),
      ),
    )

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    const files = treeFiles(store, seen.tree, objectsOf(main))
    expect(files).toContain('notes.txt')
    expect(files).not.toContain('config/.env.local')
  })

  test.skipIf(process.platform === 'win32')(
    'a pipe as the index of the worktree’s own Git folder: the checkpoint is refused at once',
    async () => {
      const { main, worktree, entry } = ownEntry()
      rmSync(join(entry, 'index'))
      execFileSync('mkfifo', [join(entry, 'index')])

      const seen = await checkpointOf(main, worktree)

      expect(seen.answered).toBe(true)
      expect(seen.refusal).toContain(NOT_A_FILE)
    },
  )

  test('a link as the index of the worktree’s own Git folder is never followed', async (context) => {
    const { main, worktree, entry } = ownEntry()
    const elsewhere = join(work, 'elsewhere-index')
    renameSync(join(entry, 'index'), elsewhere)
    try {
      symlinkSync(elsewhere, join(entry, 'index'), 'file')
    } catch {
      context.skip()
    }

    const seen = await checkpointOf(main, worktree)

    expect(seen.refusal).toContain(THROUGH_A_LINK)
  })

  test('an index larger than the cap is refused, never read', async () => {
    const { main, worktree, entry } = ownEntry()
    truncateSync(join(entry, 'index'), READ_CAP + 1)

    const seen = await checkpointOf(main, worktree)

    expect(seen.refusal).toContain(OVER_CAP)
  })

  test('an ordinary checkpoint of a worktree is still taken', async () => {
    const { main, worktree } = workspace()
    writeFileSync(join(worktree, 'form.txt'), 'the form\n')

    expect(await checkpointOf(main, worktree)).toEqual({ answered: true, refusal: null })
  })

  test('an ordinary checkpoint of the main checkout is still taken', async () => {
    const { main } = workspace()
    writeFileSync(join(main, 'form.txt'), 'the form\n')

    expect(await checkpointOf(main, main)).toEqual({ answered: true, refusal: null })
  })
})

describe('A snapshot adds only the paths it listed and checked', () => {
  /** The subcommand of a Git call: what follows its options (`-c key=value`, `--no-optional-locks`). */
  const subcommandOf = (args: ReadonlyArray<string>): string => {
    let at = 0
    while (args[at]?.startsWith('-') === true) at += args[at] === '-c' ? 2 : 1
    return args[at] ?? ''
  }

  /** A snapshot of the worktree, `meanwhile` run once its paths are listed and before it adds. */
  const takenWith = (main: string, worktree: string, meanwhile: () => void) => {
    let held = false
    return commandsEngine(data, {
      snapshotsGit: (real) => (folder, args, kind, options) => {
        if (subcommandOf(args) !== 'add' || held) return real(folder, args, kind, options)
        held = true
        return Effect.andThen(Effect.sync(meanwhile), real(folder, args, kind, options))
      },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { projectId, missionId } = yield* missionOf(main)
          const tree = yield* Snapshots.use((snapshots) =>
            snapshots.take({ name: 'acme', folder: worktree }, attempt(missionId, 'end')),
          )
          return { projectId, tree }
        }),
      ),
    )
  }

  /** Every object of a Project's store, printed. */
  const storeObjects = (projectId: string) =>
    execFileSync('git', ['cat-file', '--batch-all-objects', '--batch', '--unordered'], {
      cwd: join(data, 'snapshots', `${projectId}.git`),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })

  test('a sensitive file created between the listing and the add is never stored', async () => {
    const { main, worktree } = workspace()
    writeFileSync(join(worktree, 'form.txt'), 'the form\n')

    const seen = await takenWith(main, worktree, () =>
      writeFileSync(join(worktree, '.env'), 'API_KEY=created-meanwhile-55\n'),
    )

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    expect(existsSync(join(worktree, '.env'))).toBe(true)
    const files = treeFiles(store, seen.tree, objectsOf(main))
    expect(files).toContain('form.txt')
    expect(files).not.toContain('.env')
    expect(storeObjects(seen.projectId)).not.toContain('created-meanwhile-55')
  })

  test('a folder link leading outside, made between the listing and the add, is never followed', async () => {
    const { main, worktree } = workspace()
    writeFileSync(join(worktree, 'form.txt'), 'the form\n')
    const outside = join(work, 'outside-cfg')
    mkdirSync(outside)
    writeFileSync(join(outside, '.env'), 'TOKEN=junction-meanwhile-81\n')

    const seen = await takenWith(main, worktree, () =>
      symlinkSync(outside, join(worktree, 'cfg'), 'junction'),
    )

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    const files = treeFiles(store, seen.tree, objectsOf(main))
    expect(files).toContain('form.txt')
    expect(files).not.toContain('cfg/.env')
    expect(storeObjects(seen.projectId)).not.toContain('junction-meanwhile-81')
  })

  test('with only a sensitive file to add, a snapshot runs no add that would take the whole folder', async () => {
    const { main, worktree } = workspace()
    writeFileSync(join(worktree, '.env'), 'API_KEY=listed-and-withheld\n')

    // An add with no path at all would take the whole folder, and what was made there since.
    const seen = await takenWith(main, worktree, () =>
      writeFileSync(join(worktree, '.env.production'), 'API_KEY=whole-folder-37\n'),
    )

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    expect(treeFiles(store, seen.tree, objectsOf(main))).toContain('.env')
    expect(existsSync(join(worktree, '.env.production'))).toBe(false)
    expect(storeObjects(seen.projectId)).not.toContain('whole-folder-37')
  })

  /** The Workspace with a tracked `settings` file, committed, that the test then replaces. */
  const withSettings = () => {
    const { main, worktree } = workspace()
    writeFileSync(join(worktree, 'settings'), 'plain settings\n')
    git(worktree, 'add', 'settings')
    git(worktree, 'commit', '-q', '-m', 'settings')
    return { main, worktree }
  }

  test('a tracked file replaced by a folder holding a sensitive file: its other files are kept, the secret never reaches the store', async () => {
    const { main, worktree } = withSettings()
    rmSync(join(worktree, 'settings'))
    mkdirSync(join(worktree, 'settings'))
    writeFileSync(join(worktree, 'settings', '.env.local'), 'TOKEN=probe-secret-17\n')
    writeFileSync(join(worktree, 'settings', 'notes.txt'), 'notes\n')

    const seen = await takenWith(main, worktree, () => {})

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    const files = treeFiles(store, seen.tree, objectsOf(main))
    expect(files).toContain('settings/notes.txt')
    expect(files).not.toContain('settings')
    expect(storeObjects(seen.projectId)).not.toContain('probe-secret-17')
  })

  test('a tracked file replaced by a folder holding only a sensitive file leaves the tree', async () => {
    const { main, worktree } = withSettings()
    rmSync(join(worktree, 'settings'))
    mkdirSync(join(worktree, 'settings'))
    writeFileSync(join(worktree, 'settings', '.env.local'), 'TOKEN=probe-secret-19\n')

    const seen = await takenWith(main, worktree, () => {})

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    const files = treeFiles(store, seen.tree, objectsOf(main))
    expect(files).not.toContain('settings')
    expect(storeObjects(seen.projectId)).not.toContain('probe-secret-19')
  })

  test('a repository nested in the Workspace is kept as its commit, never walked into', async () => {
    const { main, worktree } = workspace()
    const nested = join(worktree, 'vendor', 'lib')
    mkdirSync(nested, { recursive: true })
    git(nested, 'init', '-q', '-b', 'main')
    writeFileSync(join(nested, 'index.js'), 'export {}\n')
    git(nested, 'add', 'index.js')
    git(nested, 'commit', '-q', '-m', 'lib')
    const commit = git(nested, 'rev-parse', 'HEAD')

    const seen = await takenWith(main, worktree, () => {})

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    expect(execInStore(store, objectsOf(main), 'ls-tree', seen.tree, 'vendor/lib')).toBe(
      `160000 commit ${commit}\tvendor/lib`,
    )
  })

  test('a path holding glob characters is added as itself, and its neighbours with it', async () => {
    const { main, worktree } = workspace()
    writeFileSync(join(worktree, 'x[1]'), 'bracketed\n')
    mkdirSync(join(worktree, 'x1'))
    writeFileSync(join(worktree, 'x1', 'notes.txt'), 'notes\n')

    const seen = await takenWith(main, worktree, () => {})

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    expect(treeFiles(store, seen.tree, objectsOf(main))).toEqual(
      expect.arrayContaining(['x[1]', 'x1/notes.txt']),
    )
  })

  test('a tracked file replaced by a link to a folder outside is never followed', async (context) => {
    const { main, worktree } = withSettings()
    const outside = join(work, 'outside-settings')
    mkdirSync(outside)
    writeFileSync(join(outside, '.env'), 'TOKEN=outside-folder-23\n')
    rmSync(join(worktree, 'settings'))
    try {
      symlinkSync(outside, join(worktree, 'settings'), 'junction')
    } catch {
      context.skip()
    }

    const seen = await takenWith(main, worktree, () => {})

    expect(storeObjects(seen.projectId)).not.toContain('outside-folder-23')
  })

  test('a tracked file replaced by a folder between the listing and the add: nothing under it is added', async () => {
    const { main, worktree } = withSettings()
    writeFileSync(join(worktree, 'settings'), 'changed settings\n')

    const seen = await takenWith(main, worktree, () => {
      rmSync(join(worktree, 'settings'))
      mkdirSync(join(worktree, 'settings'))
      writeFileSync(join(worktree, 'settings', '.env.local'), 'TOKEN=made-meanwhile-41\n')
    })

    expect(existsSync(join(worktree, 'settings', '.env.local'))).toBe(true)
    expect(storeObjects(seen.projectId)).not.toContain('made-meanwhile-41')
  })

  test('a file removed between the listing and the add leaves the snapshot taken without it', async () => {
    const { main, worktree } = workspace()
    writeFileSync(join(worktree, 'form.txt'), 'the form\n')
    writeFileSync(join(worktree, 'build.tmp'), 'scratch\n')

    const seen = await takenWith(main, worktree, () => rmSync(join(worktree, 'build.tmp')))

    const store = join(data, 'snapshots', `${seen.projectId}.git`)
    const files = treeFiles(store, seen.tree, objectsOf(main))
    expect(files).toContain('form.txt')
    expect(files).not.toContain('build.tmp')
  })
  describe('A checkpoint never stores a file reached through a link leading outside (#449)', () => {
    /** A folder outside the repository holding a plain `notes.txt` with this marker. */
    const outsideNotes = (name: string, marker: string) => {
      const outside = join(work, name)
      mkdirSync(outside)
      writeFileSync(join(outside, 'notes.txt'), `${marker}\n`)
      return outside
    }

    /** The tree's entry at a path as `ls-tree` prints it, its mode first; '' when it has none. */
    const entryAt = (projectId: string, main: string, tree: string, path: string) =>
      execInStore(
        join(data, 'snapshots', `${projectId}.git`),
        objectsOf(main),
        'ls-tree',
        tree,
        '--',
        path,
      )

    /** The files of a snapshot's tree, by path. */
    const filesOf = (projectId: string, main: string, tree: string) =>
      treeFiles(join(data, 'snapshots', `${projectId}.git`), tree, objectsOf(main))

    test('an untracked junction to an outside folder: the link is kept, notes.txt is not', async () => {
      const { main, worktree } = workspace()
      writeFileSync(join(worktree, 'form.txt'), 'the form\n')
      symlinkSync(outsideNotes('outside-a', 'OUTSIDE-NOTES-11'), join(worktree, 'link'), 'junction')

      const seen = await takenWith(main, worktree, () => {})

      expect(filesOf(seen.projectId, main, seen.tree)).toContain('form.txt')
      expect(filesOf(seen.projectId, main, seen.tree)).not.toContain('link/notes.txt')
      expect(entryAt(seen.projectId, main, seen.tree, 'link')).toMatch(/^120000 blob /)
      expect(storeObjects(seen.projectId)).not.toContain('OUTSIDE-NOTES-11')
    })

    test('a tracked file replaced by a junction to an outside folder: the link is kept, notes.txt is not', async () => {
      const { main, worktree } = withSettings()
      rmSync(join(worktree, 'settings'))
      symlinkSync(
        outsideNotes('outside-b', 'OUTSIDE-NOTES-12'),
        join(worktree, 'settings'),
        'junction',
      )

      const seen = await takenWith(main, worktree, () => {})

      expect(filesOf(seen.projectId, main, seen.tree)).not.toContain('settings/notes.txt')
      expect(entryAt(seen.projectId, main, seen.tree, 'settings')).toMatch(/^120000 blob /)
      expect(storeObjects(seen.projectId)).not.toContain('OUTSIDE-NOTES-12')
    })

    test('a junction nested below a normal folder: its neighbour is kept, notes.txt is not', async () => {
      const { main, worktree } = workspace()
      mkdirSync(join(worktree, 'a', 'b'), { recursive: true })
      writeFileSync(join(worktree, 'a', 'b', 'plain.txt'), 'plain\n')
      symlinkSync(
        outsideNotes('outside-c', 'OUTSIDE-NOTES-13'),
        join(worktree, 'a', 'b', 'link'),
        'junction',
      )

      const seen = await takenWith(main, worktree, () => {})

      expect(filesOf(seen.projectId, main, seen.tree)).toContain('a/b/plain.txt')
      expect(filesOf(seen.projectId, main, seen.tree)).not.toContain('a/b/link/notes.txt')
      expect(entryAt(seen.projectId, main, seen.tree, 'a/b/link')).toMatch(/^120000 blob /)
      expect(storeObjects(seen.projectId)).not.toContain('OUTSIDE-NOTES-13')
    })

    test('a tracked folder replaced by a junction to an outside folder: the snapshot is taken with the link alone', async () => {
      const { main, worktree } = workspace()
      mkdirSync(join(worktree, 'docs'))
      writeFileSync(join(worktree, 'docs', 'notes.txt'), 'the committed notes\n')
      git(worktree, 'add', 'docs')
      git(worktree, 'commit', '-q', '-m', 'docs')
      rmSync(join(worktree, 'docs'), { recursive: true })
      symlinkSync(outsideNotes('outside-d', 'OUTSIDE-NOTES-14'), join(worktree, 'docs'), 'junction')

      const seen = await takenWith(main, worktree, () => {})

      expect(filesOf(seen.projectId, main, seen.tree)).not.toContain('docs/notes.txt')
      expect(entryAt(seen.projectId, main, seen.tree, 'docs')).toMatch(/^120000 blob /)
      expect(storeObjects(seen.projectId)).not.toContain('OUTSIDE-NOTES-14')
    })

    test('a link swapped for a folder between the listing and the add: nothing under it is added', async () => {
      const { main, worktree } = workspace()
      writeFileSync(join(worktree, 'form.txt'), 'the form\n')
      symlinkSync(
        outsideNotes('outside-e', 'OUTSIDE-NOTES-15'),
        join(worktree, 'cache'),
        'junction',
      )

      const seen = await takenWith(main, worktree, () => {
        rmSync(join(worktree, 'cache'))
        mkdirSync(join(worktree, 'cache'))
        writeFileSync(join(worktree, 'cache', '.env'), 'TOKEN=swapped-in-65\n')
        writeFileSync(join(worktree, 'cache', 'notes.txt'), 'swapped-notes-66\n')
      })

      expect(filesOf(seen.projectId, main, seen.tree)).toContain('form.txt')
      const objects = storeObjects(seen.projectId)
      expect(objects).not.toContain('swapped-in-65')
      expect(objects).not.toContain('swapped-notes-66')
      expect(objects).not.toContain('OUTSIDE-NOTES-15')
    })

    test('a file swapped for a junction to an outside folder between the listing and the add: notes.txt is not stored', async () => {
      const { main, worktree } = workspace()
      writeFileSync(join(worktree, 'form.txt'), 'the form\n')
      writeFileSync(join(worktree, 'report'), 'the report\n')
      const outside = outsideNotes('outside-f', 'OUTSIDE-NOTES-16')

      const seen = await takenWith(main, worktree, () => {
        rmSync(join(worktree, 'report'))
        symlinkSync(outside, join(worktree, 'report'), 'junction')
      })

      expect(filesOf(seen.projectId, main, seen.tree)).toContain('form.txt')
      expect(filesOf(seen.projectId, main, seen.tree)).not.toContain('report/notes.txt')
      expect(storeObjects(seen.projectId)).not.toContain('OUTSIDE-NOTES-16')
    })

    test('a folder on the way swapped for a junction to an outside folder between the listing and the add: notes.txt is not stored', async () => {
      const { main, worktree } = workspace()
      writeFileSync(join(worktree, 'form.txt'), 'the form\n')
      mkdirSync(join(worktree, 'a', 'b'), { recursive: true })
      writeFileSync(join(worktree, 'a', 'b', 'notes.txt'), 'the inside notes\n')
      const outside = outsideNotes('outside-g', 'OUTSIDE-NOTES-17')

      const seen = await takenWith(main, worktree, () => {
        rmSync(join(worktree, 'a', 'b'), { recursive: true })
        symlinkSync(outside, join(worktree, 'a', 'b'), 'junction')
      })

      expect(filesOf(seen.projectId, main, seen.tree)).toContain('form.txt')
      expect(filesOf(seen.projectId, main, seen.tree)).not.toContain('a/b/notes.txt')
      expect(storeObjects(seen.projectId)).not.toContain('OUTSIDE-NOTES-17')
    })

    test('a link to a file outside: the checkpoint keeps the link, and its copy is a file holding the link’s target', async (context) => {
      const { main, worktree } = workspace()
      const target = join(outsideNotes('outside-h', 'OUTSIDE-NOTES-18'), 'notes.txt')
      try {
        symlinkSync(target, join(worktree, 'notes-link'), 'file')
      } catch {
        context.skip()
      }
      const copy = join(work, 'copy')

      const seen = await commandsEngine(data)(({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { projectId, missionId } = yield* missionOf(main)
            const repository = { name: 'acme', folder: worktree }
            const tree = yield* Snapshots.use((snapshots) =>
              snapshots.take(repository, attempt(missionId, 'end')),
            )
            yield* Snapshots.use((snapshots) =>
              snapshots.materialize(missionId, repository, tree, copy),
            )
            return { projectId, tree }
          }),
        ),
      )

      expect(entryAt(seen.projectId, main, seen.tree, 'notes-link')).toMatch(/^120000 blob /)
      expect(storeObjects(seen.projectId)).not.toContain('OUTSIDE-NOTES-18')
      expect(lstatSync(join(copy, 'notes-link')).isFile()).toBe(true)
      expect(readFileSync(join(copy, 'notes-link'), 'utf8')).not.toContain('OUTSIDE-NOTES-18')
    })

    test('a link inside the repository is kept as the link Git stores', async (context) => {
      const { main, worktree } = workspace()
      mkdirSync(join(worktree, 'inner'))
      writeFileSync(join(worktree, 'inner', 'x.txt'), 'x\n')
      symlinkSync(join(worktree, 'inner'), join(worktree, 'alias'), 'junction')
      try {
        symlinkSync('tracked.txt', join(worktree, 'tracked-link'), 'file')
      } catch {
        context.skip()
      }

      const seen = await takenWith(main, worktree, () => {})

      const files = filesOf(seen.projectId, main, seen.tree)
      expect(files).toEqual(expect.arrayContaining(['inner/x.txt', 'alias', 'tracked-link']))
      expect(files).not.toContain('alias/x.txt')
      const blob = execFileSync('git', ['hash-object', '--stdin'], {
        cwd: worktree,
        input: 'tracked.txt',
        encoding: 'utf8',
      }).trim()
      expect(entryAt(seen.projectId, main, seen.tree, 'tracked-link')).toBe(
        `120000 blob ${blob}\ttracked-link`,
      )
      expect(entryAt(seen.projectId, main, seen.tree, 'alias')).toMatch(/^120000 blob /)
    })
  })
})

function restore(previous: Readonly<Record<string, string | undefined>>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
