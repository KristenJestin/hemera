/**
 * The path the gate allows is the one really used (#373): the file tools read, list, search and
 * write the very file the gate judged, never one a link or a junction planted between the check
 * and the use leads to, and never a file with a second name (a hard link) that may belong to a
 * place the session may not reach.
 *
 * The verdict is asked between the check and the use, so a verdict of the suite's own plants the
 * swap there, as a command running beside the session could.
 */

import { execFileSync } from 'node:child_process'
import {
  closeSync,
  constants,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'

import { Effect, Fiber } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { MISSIONS_FOLDER } from '../src/engine/memory/files.ts'
import type { MissionParts } from '../src/engine/missions.ts'
import { createMission, moveMission } from '../src/engine/missions.ts'
import { readPage } from '../src/engine/tools/read.ts'
import { commandsEngine } from './commands-engine.ts'
import { until } from './sessions-world.ts'
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

  // A FIFO holds the open until the suite writes into it: the link is planted for the open and
  // taken away before the check, which only the file's id tells apart. POSIX only.
  test.skipIf(process.platform === 'win32')(
    'a link planted for the open and taken away before the check is refused',
    async () => {
      const fifo = join(elsewhere(), 'pipe')
      execFileSync('mkfifo', [fifo])
      let main = ''
      const engine = engineSwapping(() => {
        rmSync(join(main, 'notes.txt'))
        symlinkSync(fifo, join(main, 'notes.txt'))
      })
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
            const read = yield* Effect.forkChild(
              callTool(builder.grantId, 'fs_read', { path: 'notes.txt' }),
            )
            // The read has opened the FIFO once a writer can open it without waiting.
            let writer = -1
            yield* until(
              Effect.sync(() => {
                try {
                  writer = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK)
                  return true
                } catch {
                  return false
                }
              }),
            )
            rmSync(join(main, 'notes.txt'))
            writeFileSync(join(main, 'notes.txt'), 'ours')
            writeSync(writer, SECRET)
            closeSync(writer)
            return yield* Fiber.join(read)
          }),
        ),
      )
      expect(answer).toMatchObject({ ok: false, refused: true })
      expect(answer.text).not.toContain(SECRET)
    },
  )

  test('a hard link in the place to a file elsewhere is refused', async () => {
    const outside = elsewhere()
    const answer = await engineSwapping(() => undefined).run(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const { mission, main } = yield* acmeWithMission(work)
          linkSync(join(outside, 'notes.txt'), join(main, 'notes.txt'))
          const builder = yield* sessionOf('builder', main, { kind: 'mission', id: mission.id })
          return yield* callTool(builder.grantId, 'fs_read', { path: 'notes.txt' })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(answer.text).toContain('hard link')
    expect(answer.text).not.toContain(SECRET)
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

  test('a search passes over a hard-linked file and says so', async () => {
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
    expect(answer.text).not.toContain(SECRET)
    expect(answer.text).toContain('notes.txt (linked)')
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
  test("a hard link to another mission's evidence is refused, and nothing is kept", async () => {
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
          return yield* callTool(builder.grantId, 'evidence_add', {
            name: 'a log',
            path: 'log.txt',
          })
        }),
      ),
    )
    expect(answer.ok).toBe(false)
    expect(answer.text).toContain('hard link')
  })
})

describe('A page is read from the file judged', () => {
  test('readPage refuses a file with a second name', async () => {
    const outside = elsewhere()
    linkSync(join(outside, 'notes.txt'), join(work, 'linked.txt'))
    await expect(readPage(join(work, 'linked.txt'), 0, 100)).rejects.toThrow('hard link')
  })
})
