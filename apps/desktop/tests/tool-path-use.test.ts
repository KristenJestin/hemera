/**
 * The path the gate allows is the one really used (#373): the file tools read, list, search and
 * write the very file the gate judged, never one a link or a junction planted between the check
 * and the use leads to. A file with a second name (a hard link) is read as any file, since a
 * command that could plant one could as well copy the file; it is only never kept as evidence,
 * nor written over.
 *
 * The verdict is asked between the check and the use, so a verdict of the suite's own plants the
 * swap there, as a command running beside the session could.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import fsPromises from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'
import { Effect, Result } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { readEvidence } from '../src/engine/memory/evidence.ts'
import { MISSIONS_FOLDER } from '../src/engine/memory/files.ts'
import type { MissionParts } from '../src/engine/missions.ts'
import { createMission, moveMission } from '../src/engine/missions.ts'
import { Database } from '../src/engine/storage/database.ts'
import { memoryEvidence } from '../src/engine/storage/schema.ts'
import { replaceFile } from '../src/engine/tools/files.ts'
import { openJudged } from '../src/engine/tools/judged.ts'
import { readPage } from '../src/engine/tools/read.ts'
import { searchIn } from '../src/engine/tools/search.ts'
import { commandsEngine } from './commands-engine.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { ALLOW, acmeWithMission, callTool, sessionOf, verdictsSaying } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('path-use'))
  work = realpathSync.native(temporaryFolder('path-use-work'))
})
afterEach(removeFolders)

const SECRET = 'the key of another place'

/** A folder outside the place, holding a file the session may not read. */
const elsewhere = () => {
  const folder = join(work, 'elsewhere')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'notes.txt'), SECRET)
  return folder
}

/** A folder of the place swapped for a junction (a symbolic link off Windows) to `target`. */
const swapForJunction = (folder: string, target: string) => {
  renameSync(folder, `${folder}-before`)
  symlinkSync(target, folder, 'junction')
}

/** An engine whose verdict allows, after running what the suite plants between check and use. */
const engineSwapping = (between: () => void) => {
  let armed = false
  const verdicts = verdictsSaying(() => {
    if (armed) {
      armed = false
      between()
    }
    return ALLOW
  })
  return {
    arm: Effect.sync(() => {
      armed = true
    }),
    run: commandsEngine(data, { tools: { verdicts: verdicts.layer } }),
  }
}

describe('fs_read reads the file the gate judged', () => {
  test('a file swapped for a symbolic link between the check and the read is refused', async (context) => {
    const outside = elsewhere()
    let main = ''
    const engine = engineSwapping(() => {
      rmSync(join(main, 'notes.txt'))
      symlinkSync(join(outside, 'notes.txt'), join(main, 'notes.txt'), 'file')
    })
    // A symbolic link to a file needs a privilege on Windows: the junction below covers it there.
    try {
      symlinkSync(join(outside, 'notes.txt'), join(work, 'probe'), 'file')
    } catch {
      context.skip()
    }
    const answer = await engine.run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const world = yield* acmeWithMission(work)
          main = world.main
          writeFileSync(join(main, 'notes.txt'), 'ours')
          const builder = yield* sessionOf('builder', main, {
            kind: 'mission',
            id: world.mission.id,
          })
          yield* engine.arm
          return yield* callTool(builder.grantId, 'fs_read', { path: 'notes.txt' })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(answer.text).toContain('a link or a junction')
    expect(answer.text).not.toContain(SECRET)
  })

  test('a folder swapped for a junction between the check and the read is refused', async () => {
    const outside = elsewhere()
    let main = ''
    const engine = engineSwapping(() => swapForJunction(join(main, 'docs'), outside))
    const answer = await engine.run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const world = yield* acmeWithMission(work)
          main = world.main
          mkdirSync(join(main, 'docs'))
          writeFileSync(join(main, 'docs', 'notes.txt'), 'ours')
          const builder = yield* sessionOf('builder', main, {
            kind: 'mission',
            id: world.mission.id,
          })
          yield* engine.arm
          return yield* callTool(builder.grantId, 'fs_read', { path: 'docs/notes.txt' })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(answer.text).not.toContain(SECRET)
  })

  test.skipIf(process.platform === 'win32')(
    'a FIFO in the place is refused at once, and the engine stays responsive',
    async () => {
      const answers = await engineSwapping(() => undefined).run(({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { mission, main } = yield* acmeWithMission(work)
            execFileSync('mkfifo', [join(main, 'pipe')])
            writeFileSync(join(main, 'notes.txt'), 'ours\n')
            const builder = yield* sessionOf('builder', main, {
              kind: 'mission',
              id: mission.id,
            })
            // More opens than libuv has threads: one that waited on the pipe would hold one each.
            const pipes = yield* Effect.all(
              Array.from({ length: 6 }, () =>
                callTool(builder.grantId, 'fs_read', { path: 'pipe' }),
              ),
              { concurrency: 'unbounded' },
            )
            const searched = yield* callTool(builder.grantId, 'search', { pattern: 'ours' })
            const after = yield* callTool(builder.grantId, 'fs_read', { path: 'notes.txt' })
            return { pipes, searched, after }
          }),
        ),
      )
      for (const pipe of answers.pipes) {
        expect(pipe).toMatchObject({ ok: false, refused: true })
        expect(pipe.text).toContain('not a regular file')
      }
      expect(answers.searched.text).toContain('notes.txt:1: ours')
      expect(answers.after).toMatchObject({ ok: true })
    },
    20_000,
  )

  test('a hard-linked file inside the Workspace is read by fs_read', async () => {
    // What pnpm makes of every file under node_modules: a second name in its store.
    const store = join(work, 'store')
    mkdirSync(store)
    writeFileSync(join(store, 'index.js'), 'export const left = 1\n')
    const answer = await engineSwapping(() => undefined).run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          mkdirSync(join(main, 'node_modules', 'left'), { recursive: true })
          linkSync(join(store, 'index.js'), join(main, 'node_modules', 'left', 'index.js'))
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'fs_read', {
            path: 'node_modules/left/index.js',
          })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: true })
    expect(answer.text).toContain('export const left = 1')
  })

  test('a hard-linked file is never written over, and neither of its names changes', async () => {
    const outside = elsewhere()
    const answers = await engineSwapping(() => undefined).run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          linkSync(join(outside, 'notes.txt'), join(main, 'notes.txt'))
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return {
            read: yield* callTool(builder.grantId, 'fs_read', { path: 'notes.txt' }),
            write: yield* callTool(builder.grantId, 'fs_write', {
              path: 'notes.txt',
              content: 'written',
            }),
            edit: yield* callTool(builder.grantId, 'fs_edit', {
              path: 'notes.txt',
              edits: [{ old: 'key', new: 'lock' }],
            }),
          }
        }),
      ),
    )
    expect(answers.read).toMatchObject({ ok: true })
    for (const answer of [answers.write, answers.edit]) {
      expect(answer).toMatchObject({ ok: false, refused: true })
      expect(answer.text).toContain('hard link')
    }
    expect(readFileSync(join(outside, 'notes.txt'), 'utf8')).toBe(SECRET)
    expect(readFileSync(join(work, 'acme', 'notes.txt'), 'utf8')).toBe(SECRET)
  })

  test('a file with a single name in the place is read as before', async () => {
    const answer = await engineSwapping(() => undefined).run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          writeFileSync(join(main, 'notes.txt'), 'ours\n')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'fs_read', { path: 'notes.txt' })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: true })
    expect(answer.text).toContain('ours')
  })
})

describe('fs_write and fs_edit write where the gate judged', () => {
  test('a write into a folder swapped for a junction after the check writes nothing elsewhere', async () => {
    const outside = elsewhere()
    let main = ''
    const engine = engineSwapping(() => swapForJunction(join(main, 'docs'), outside))
    const answer = await engine.run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const world = yield* acmeWithMission(work)
          main = world.main
          mkdirSync(join(main, 'docs'))
          const builder = yield* sessionOf('builder', main, {
            kind: 'mission',
            id: world.mission.id,
          })
          yield* engine.arm
          return yield* callTool(builder.grantId, 'fs_write', {
            path: 'docs/new.md',
            content: 'written',
          })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(existsSync(join(outside, 'new.md'))).toBe(false)
    expect(readFileSync(join(outside, 'notes.txt'), 'utf8')).toBe(SECRET)
  })

  test('a write on a file whose folder was swapped for a junction shows and touches nothing there', async () => {
    const outside = elsewhere()
    let main = ''
    const engine = engineSwapping(() => swapForJunction(join(main, 'docs'), outside))
    const answer = await engine.run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const world = yield* acmeWithMission(work)
          main = world.main
          mkdirSync(join(main, 'docs'))
          writeFileSync(join(main, 'docs', 'notes.txt'), 'ours')
          const builder = yield* sessionOf('builder', main, {
            kind: 'mission',
            id: world.mission.id,
          })
          yield* callTool(builder.grantId, 'fs_read', { path: 'docs/notes.txt' })
          yield* engine.arm
          return yield* callTool(builder.grantId, 'fs_edit', {
            path: 'docs/notes.txt',
            edits: [{ old: 'ours', new: 'theirs' }],
          })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(answer.text).not.toContain(SECRET)
    expect(readFileSync(join(outside, 'notes.txt'), 'utf8')).toBe(SECRET)
  })
})

describe('fs_list and search look where the gate judged', () => {
  test('a listing of a folder swapped for a junction after the check is refused', async () => {
    const outside = elsewhere()
    let main = ''
    const engine = engineSwapping(() => swapForJunction(join(main, 'docs'), outside))
    const answer = await engine.run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const world = yield* acmeWithMission(work)
          main = world.main
          mkdirSync(join(main, 'docs'))
          const builder = yield* sessionOf('builder', main, {
            kind: 'mission',
            id: world.mission.id,
          })
          yield* engine.arm
          return yield* callTool(builder.grantId, 'fs_list', { path: 'docs' })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(answer.text).not.toContain('notes.txt')
  })

  test('a search reads nothing of a folder swapped for a junction after the check', async () => {
    const outside = elsewhere()
    let main = ''
    const engine = engineSwapping(() => swapForJunction(main, outside))
    const answer = await engine.run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const world = yield* acmeWithMission(work)
          main = world.main
          const builder = yield* sessionOf('builder', main, {
            kind: 'mission',
            id: world.mission.id,
          })
          yield* engine.arm
          return yield* callTool(builder.grantId, 'search', { pattern: 'key' })
        }),
      ),
    )
    expect(answer.text).not.toContain(SECRET)
    expect(answer.text).toContain('no match')
  })

  test('a hard-linked .gitignore steers the search as any .gitignore', async () => {
    // What a dotfiles manager or a `cp -l` checkout leaves: the root .gitignore has a second name.
    const dotfiles = join(work, 'dotfiles')
    mkdirSync(dotfiles)
    writeFileSync(join(dotfiles, 'gitignore'), 'dist\n')
    const answer = await engineSwapping(() => undefined).run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          linkSync(join(dotfiles, 'gitignore'), join(main, '.gitignore'))
          mkdirSync(join(main, 'dist'))
          writeFileSync(join(main, 'dist', 'out.js'), 'token = built\n')
          writeFileSync(join(main, 'src.js'), 'token = ours\n')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'search', { pattern: 'token' })
        }),
      ),
    )
    expect(answer.text).toContain('src.js:1: token = ours')
    expect(answer.text).not.toContain('dist/')
  })

  test('a .gitignore that is a link to a file elsewhere steers nothing', async (context) => {
    const outside = elsewhere()
    writeFileSync(join(outside, 'ignore'), 'notes.txt\n')
    // A symbolic link to a file needs a privilege on Windows.
    try {
      symlinkSync(join(outside, 'ignore'), join(work, 'probe'), 'file')
    } catch {
      context.skip()
    }
    const answer = await engineSwapping(() => undefined).run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          writeFileSync(join(main, 'notes.txt'), 'token = ours\n')
          symlinkSync(join(outside, 'ignore'), join(main, '.gitignore'), 'file')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'search', { pattern: 'token' })
        }),
      ),
    )
    expect(answer.text).toContain('notes.txt:1: token = ours')
  })

  test('a search reads a hard-linked file as any file', async () => {
    const outside = elsewhere()
    const answer = await engineSwapping(() => undefined).run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          linkSync(join(outside, 'notes.txt'), join(main, 'notes.txt'))
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'search', { pattern: 'key' })
        }),
      ),
    )
    expect(answer.text).toContain(`notes.txt:1: ${SECRET}`)
  })
})

/** Every guard registered and passing: the moves are the stages' to allow. */
const PASSING: MissionParts['guards'] = {
  freeze: () => Effect.succeed([]),
  launch: () => Effect.succeed([]),
  fix: () => Effect.succeed([]),
  ship: () => Effect.succeed([]),
}

describe('evidence_add keeps the file the gate judged', () => {
  test('`evidence_add` on a hard-linked file is refused, with a clear reason, and nothing is kept', async () => {
    const answer = await commandsEngine(data, { missions: { guards: PASSING } })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { project, mission, main } = yield* acmeWithMission(work)
          yield* moveMission(mission.id, 'freeze', 'user')
          yield* moveMission(mission.id, 'launch', 'user')
          const other = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Store the invoices', ticket: null },
          })
          const theirs = join(data, MISSIONS_FOLDER, other.key, 'evidence', 'log.txt')
          mkdirSync(join(theirs, '..'), { recursive: true })
          writeFileSync(theirs, SECRET)
          linkSync(theirs, join(main, 'log.txt'))
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          const added = yield* callTool(builder.grantId, 'evidence_add', {
            name: 'a log',
            path: 'log.txt',
          })
          const database = yield* Database
          return { added, kept: yield* database.select().from(memoryEvidence) }
        }),
      ),
    )
    expect(answer.added).toMatchObject({ ok: false, refused: true })
    expect(answer.added.text).toBe(
      'refused: could not read log.txt: it has more than one name on the disk (a hard link), and its other name may be a file outside the Workspace: it is never kept as evidence',
    )
    expect(answer.kept).toEqual([])
  })
})

describe('A page is read from the file judged', () => {
  test('readPage reads a file with a second name', async () => {
    const outside = elsewhere()
    linkSync(join(outside, 'notes.txt'), join(work, 'linked.txt'))
    expect((await readPage(join(work, 'linked.txt'), 0, 100)).text).toBe(SECRET)
  })
})

/**
 * A root holding `D`, a real folder, and `outside/D`, a folder of the same name elsewhere, with
 * the moves that make `root/D` a link to `outside/D` and put the real one back.
 */
const swappable = () => {
  const root = join(work, 'root')
  const outside = join(work, 'outside')
  mkdirSync(join(root, 'D'), { recursive: true })
  mkdirSync(join(outside, 'D'), { recursive: true })
  symlinkSync(join(outside, 'D'), join(root, 'Dlink'), 'junction')
  return {
    root,
    outside,
    clean: () => {
      renameSync(join(root, 'D'), join(root, 'Dlink.tmp'))
      renameSync(join(root, 'Dreal'), join(root, 'D'))
      renameSync(join(root, 'Dlink.tmp'), join(root, 'Dlink'))
    },
    linked: () => {
      renameSync(join(root, 'D'), join(root, 'Dreal'))
      renameSync(join(root, 'Dlink'), join(root, 'D'))
    },
  }
}

/**
 * Runs `use` while every `realpath` of the process sees the real folder and every other lookup
 * the link: the state a swap that keeps racing lands on each lookup by name, made deterministic
 * (the review's probe 1). `during` runs in the clean state, before the lookup.
 */
const racing = async <A>(
  folders: ReturnType<typeof swappable>,
  use: () => Promise<A>,
  during: (path: string) => void = () => undefined,
): Promise<A> => {
  const realpath = fsPromises.realpath
  const wrapped = async (path: string) => {
    folders.clean()
    try {
      during(path)
      return await realpath(path)
    } finally {
      folders.linked()
    }
  }
  Reflect.set(fsPromises, 'realpath', wrapped)
  syncBuiltinESMExports()
  folders.linked()
  try {
    return await use()
  } finally {
    Reflect.set(fsPromises, 'realpath', realpath)
    syncBuiltinESMExports()
  }
}

/**
 * Runs `use` while the call `name` of `node:fs/promises` first lands `swap`: the folder swapped
 * between the proof and that very call.
 */
const swappingBefore = async <A>(
  name: 'rename' | 'mkdir' | 'lstat',
  swap: () => void,
  use: () => Promise<A>,
): Promise<A> => {
  const original = fsPromises[name]
  let armed = true
  const wrapped = async (...args: ReadonlyArray<string>) => {
    if (armed) {
      armed = false
      swap()
    }
    return Reflect.apply(original, fsPromises, args)
  }
  Reflect.set(fsPromises, name, wrapped)
  syncBuiltinESMExports()
  try {
    return await use()
  } finally {
    Reflect.set(fsPromises, name, original)
    syncBuiltinESMExports()
  }
}

describe('A write replaces the name, never writes through it', () => {
  // On every platform: a hard link needs no privilege on Windows (NTFS, same volume), and the
  // `lstat` the write makes of its target, before the new file is made, is where it is planted.
  test('a hard link planted right before the write is replaced, its other name untouched', async () => {
    const outside = elsewhere()
    const root = join(work, 'root')
    mkdirSync(root)
    writeFileSync(join(root, 'notes.txt'), SECRET)
    const target = join(root, 'notes.txt')
    await swappingBefore(
      'lstat',
      () => {
        rmSync(target)
        linkSync(join(outside, 'notes.txt'), target)
      },
      () => replaceFile(realpathSync.native(target), 'the agent content'),
    )
    expect(readFileSync(target, 'utf8')).toBe('the agent content')
    expect(readFileSync(join(outside, 'notes.txt'), 'utf8')).toBe(SECRET)
  })
})

// Windows has no path of an open handle that Node can read: there, the check still looks the
// path up by name, the residual put to the maintainer (#373).
describe.skipIf(process.platform === 'win32')(
  'Every judgement is made on the opened handle',
  () => {
    test('a file opened through a link is refused even when every lookup by name sees the real folder', async () => {
      const folders = swappable()
      writeFileSync(join(folders.root, 'D', 'f.txt'), 'ours')
      writeFileSync(join(folders.outside, 'D', 'f.txt'), SECRET)
      const read = await racing(folders, async () => {
        const handle = await openJudged(join(folders.root, 'D', 'f.txt'))
        try {
          return (await handle.readFile()).toString()
        } finally {
          await handle.close()
        }
      }).catch((cause: Error) => cause.message)
      expect(read).not.toContain(SECRET)
      expect(read).toContain('a link or a junction')
    })

    test('a write under the same race writes nothing outside the root and leaves no file there', async () => {
      const folders = swappable()
      writeFileSync(join(folders.outside, 'D', 'x'), SECRET)
      const written = await racing(
        folders,
        () => replaceFile(join(folders.root, 'D', 'x'), 'the agent content'),
        // The temporary file the write made through the link, named in the real folder too.
        (path) => {
          if (path.endsWith('.hemera') && !existsSync(path)) writeFileSync(path, '')
        },
      ).then(
        () => 'written',
        (cause: Error) => cause.message,
      )
      expect(written).not.toBe('written')
      expect(readFileSync(join(folders.outside, 'D', 'x'), 'utf8')).toBe(SECRET)
      expect(readdirSync(join(folders.outside, 'D'))).toEqual(['x'])
    })

    test('a folder swapped right before the rename keeps the file, and the write says it moved', async () => {
      const folders = swappable()
      writeFileSync(join(folders.outside, 'D', 'x'), SECRET)
      const written = await swappingBefore('rename', folders.linked, () =>
        replaceFile(join(folders.root, 'D', 'x'), 'the agent content'),
      ).then(
        () => 'written',
        (cause: Error) => cause.message,
      )
      expect(written).toContain('moved away')
      expect(readFileSync(join(folders.root, 'Dreal', 'x'), 'utf8')).toBe('the agent content')
      expect(readFileSync(join(folders.outside, 'D', 'x'), 'utf8')).toBe(SECRET)
      expect(readdirSync(join(folders.outside, 'D'))).toEqual(['x'])
    })

    test('a folder swapped right before a missing folder is made gets no folder outside', async () => {
      const folders = swappable()
      const written = await swappingBefore('mkdir', folders.linked, () =>
        replaceFile(join(folders.root, 'D', 'new1', 'new2', 'x'), 'the agent content'),
      ).then(
        () => 'written',
        (cause: Error) => cause.message,
      )
      expect(written).toContain('a link or a junction')
      expect(readdirSync(join(folders.outside, 'D'))).toEqual([])
    })

    test('a search under the same race returns nothing of the folder the link leads to', async () => {
      const folders = swappable()
      writeFileSync(join(folders.root, 'D', 'notes.txt'), 'token = inside\n')
      writeFileSync(join(folders.outside, 'D', 'notes.txt'), `token = ${SECRET}\n`)
      const root = join(folders.root, 'D')
      const found = await racing(folders, () => searchIn({ root, judged: root, query: 'token' }))
      expect(found.hits.map((hit) => hit.text).join('\n')).not.toContain(SECRET)
    })
  },
)

describe("A write's missing folders are made inside the root only", () => {
  test('after a swap while the verdict is asked, no folder is made outside', async () => {
    const outside = elsewhere()
    let main = ''
    const engine = engineSwapping(() => swapForJunction(join(main, 'docs'), outside))
    const answer = await engine.run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const world = yield* acmeWithMission(work)
          main = world.main
          mkdirSync(join(main, 'docs'))
          const builder = yield* sessionOf('builder', main, {
            kind: 'mission',
            id: world.mission.id,
          })
          yield* engine.arm
          return yield* callTool(builder.grantId, 'fs_write', {
            path: 'docs/new1/new2/notes.md',
            content: 'written',
          })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(readdirSync(outside)).toEqual(['notes.txt'])
  })

  test('missing folders inside the root are made, and the file written', async () => {
    const answer = await engineSwapping(() => undefined).run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'fs_write', {
            path: 'docs/new1/new2/notes.md',
            content: 'written',
          })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: true })
    expect(readFileSync(join(work, 'acme', 'docs', 'new1', 'new2', 'notes.md'), 'utf8')).toBe(
      'written',
    )
  })
})

describe('fs_list names a link', () => {
  test('a link is named, never followed nor measured', async (context) => {
    const outside = elsewhere()
    writeFileSync(join(outside, 'plan.pdf'), Buffer.alloc(12_345))
    // A symbolic link to a file needs a privilege on Windows.
    try {
      symlinkSync(join(outside, 'plan.pdf'), join(work, 'probe'), 'file')
    } catch {
      context.skip()
    }
    const answer = await engineSwapping(() => undefined).run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          symlinkSync(join(outside, 'plan.pdf'), join(main, 'plan-link'), 'file')
          symlinkSync(outside, join(main, 'linked'), 'junction')
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'fs_list', { path: '.', depth: 2 })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: true })
    expect(answer.text).toContain('linked  link')
    expect(answer.text).toContain('plan-link  link')
    expect(answer.text).not.toContain('12345')
    expect(answer.text).not.toContain('plan.pdf')
  })
})

describe('An evidence is read as a regular file only', () => {
  test.skipIf(process.platform === 'win32')(
    'an evidence file swapped for a FIFO is refused at once',
    async () => {
      const read = await commandsEngine(data, { missions: { guards: PASSING } })(({ profile }) =>
        profile.use(
          Effect.gen(function* () {
            const { mission, main } = yield* acmeWithMission(work)
            yield* moveMission(mission.id, 'freeze', 'user')
            yield* moveMission(mission.id, 'launch', 'user')
            const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
            yield* callTool(builder.grantId, 'evidence_add', { name: 'a log', content: 'ours' })
            const database = yield* Database
            const [row] = yield* database
              .select()
              .from(memoryEvidence)
              .where(eq(memoryEvidence.missionId, mission.id))
            const folder = join(data, MISSIONS_FOLDER, mission.key, 'evidence')
            for (const name of readdirSync(folder)) {
              rmSync(join(folder, name))
              execFileSync('mkfifo', [join(folder, name)])
            }
            return yield* readEvidence(mission.id, row?.id ?? '').pipe(Effect.result)
          }),
        ),
      )
      expect(Result.isFailure(read)).toBe(true)
    },
    20_000,
  )
})
