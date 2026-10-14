/**
 * The frozen prototypes in Building (#235): a prototype the user judged in Planning is part of what
 * was decided, so the Builder's brief and a helper's name each one with its verdict, its folder and
 * its kept files, and `prototype_read` reads those files, read-only, never outside the prototype's
 * folder.
 *
 * On the engine as it starts, with the fake agent of #32 as every agent (the three Prototypers, the
 * cold read, the Builder, a helper), a temporary data folder and Acme's real repositories. The test
 * drives the Planner's, the Prototypers' and the Builder's tools through their grants. Every wait is
 * on state, never on time.
 */

import { createHash } from 'node:crypto'
import { linkSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { TOOLS, toolsOf } from '@hemera/core/domain'
import { eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript } from '../src/engine/agents/fake.ts'
import { helperRowsOf } from '../src/engine/building/helper-store.ts'
import { getMission } from '../src/engine/missions.ts'
import { judgePrototype } from '../src/engine/planning/prototypes.ts'
import { sessionsOfLineage } from '../src/engine/sessions/store.ts'
import { Database } from '../src/engine/storage/database.ts'
import { helpers, memoryEvidence, permissionRequests } from '../src/engine/storage/schema.ts'
import { QUIET, READING, call, grantOf } from './building-world.ts'
import { builderOf, launched } from './builder-world.ts'
import { held, sessionsEngine, text, until, within } from './sessions-world.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { callTool } from './tools-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('building-prototypes'))
  work = realpathSync.native(temporaryFolder('building-prototypes-work'))
})
afterEach(removeFolders)

/**
 * The engine with this version's roles. The Prototypers come first (`prototypers` of them), then the
 * cold read, then the Builder, quiet; every other agent (the Prototypers, a helper) holds its turn
 * open until the test lets it go.
 */
const prototyping = (prototypers: number) => {
  const hold = held()
  const working: FakeScript = {
    steps: [{ does: 'says', text: 'Working.' }],
    between: () => hold.promise,
  }
  const agents = (index: number): FakeScript =>
    index === prototypers ? READING : index === prototypers + 1 ? QUIET : working
  const engine = sessionsEngine(data, agents, { roles: [], tools: { home: work } })
  return {
    world: engine.world,
    run: <A, E>(program: Parameters<typeof engine.run<A, E>>[0]) =>
      engine.run(program).finally(hold.release),
  }
}

/** Each prompt an agent was sent, as text. */
const promptsOf = (
  agent:
    | { answers: { prompts: ReadonlyArray<ReadonlyArray<{ type: string; text?: string }>> } }
    | undefined,
) => agent?.answers.prompts.map((prompt) => text(prompt)) ?? []

/** The mission's helper of a number, once its session works, and a grant the test drives it with. */
const helperNumbered = (missionId: string, number: number) =>
  Effect.gen(function* () {
    const sessionOf = Effect.gen(function* () {
      const row = (yield* helperRowsOf(missionId)).find((one) => one.number === number)
      if (row === undefined) return null
      const live = (yield* sessionsOfLineage(row.lineage)).filter((one) =>
        ['working', 'idle'].includes(one.state),
      )
      const session = live.toSorted((a, b) => b.epoch - a.epoch).at(0)
      return session === undefined ? null : { row, session }
    })
    yield* until(Effect.map(sessionOf, (found) => found !== null))
    const found = yield* sessionOf
    if (found === null) return yield* Effect.die(new Error(`no helper H${String(number)}`))
    return { ...found, grantId: yield* grantOf(found.session.id) }
  })

const QUESTION = 'Does the invoice list read in two columns on a narrow window?'

const RESULT = (file: string) => ({
  tried: 'A two-column invoice list in plain HTML.',
  works: ['The two columns hold at 480 pixels.'],
  does_not_work: ['The totals wrap under 360 pixels.'],
  files: [file],
})

/** What a prototype was judged: validated, set aside with its note, or not at all. */
type Judged = 'validated' | 'set-aside' | null

/**
 * A mission frozen with one Prototyper per entry of `judged`, in Planning: it tries `<n>.html`,
 * hands it back, and the user judges it as told. Then checked and launched into Building.
 */
const frozenWith = (judged: ReadonlyArray<Judged>) =>
  launched(
    work,
    () => Effect.void,
    'The impact.',
    undefined,
    undefined,
    (mission, planner) =>
      Effect.gen(function* () {
        for (const [at, verdict] of judged.entries()) {
          const number = at + 1
          const file = `list-${String(number)}.html`
          yield* call(planner, 'helper_launch', { helper: 'prototyper', brief: QUESTION })
          const prototyper = yield* helperNumbered(mission.id, number)
          yield* callTool(prototyper.grantId, 'fs_write', {
            path: file,
            content: `<ul class="prototype-${String(number)}"></ul>\n`,
          })
          const result = yield* call(prototyper.grantId, 'helper_result', RESULT(file))
          expect(result).toBe('Your result is kept and handed to your parent. End your turn now.')
          // Judged only once its result is kept.
          yield* until(Effect.map(helperRowsOf(mission.id), (rows) => rows[at]?.state === 'done'))
          if (verdict !== null) {
            yield* judgePrototype(
              prototyper.row.id,
              verdict,
              verdict === 'set-aside' ? 'Too narrow for the totals.' : 'Keep the two columns.',
            )
          }
        }
      }),
  )

describe('The Builder’s brief names each frozen prototype with its verdict and its folder', () => {
  test('a validated and a set-aside prototype are both named, with their verdict, note, folder and kept file', async () => {
    const { world, run } = prototyping(2)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith(['validated', 'set-aside'])
          yield* builderOf(mission.id)
          return { key: (yield* getMission(mission.id)).key }
        }),
      ),
    )
    const brief = promptsOf(world.agents[3])[0] ?? ''
    expect(brief).toContain(`Builder · ${seen.key}`)
    const section = brief.split('## Prototypes')[1]?.split('\n## ')[0] ?? ''
    const folder = (number: number) =>
      join(data, 'missions', seen.key, 'prototypes', String(number))
    const validated = section.split('- H2')[0] ?? ''
    const setAside = section.split('- H2')[1] ?? ''
    expect(validated).toContain('- H1 · validated')
    expect(validated).toContain(QUESTION)
    expect(validated).toContain('Reference for the interface: follow it.')
    expect(validated).toContain('Keep the two columns.')
    expect(validated).toContain(`Folder: ${folder(1)}`)
    expect(validated).toContain('Files: list-1.html')
    expect(validated).toContain('The two columns hold at 480 pixels.')
    expect(validated).toContain('The totals wrap under 360 pixels.')
    expect(setAside).toContain(' · set aside')
    expect(setAside).toContain('What not to do: do not follow it.')
    expect(setAside).toContain('Too narrow for the totals.')
    expect(setAside).toContain(`Folder: ${folder(2)}`)
    expect(setAside).toContain('Files: list-2.html')
    // The Planner’s own sentence about the Freeze is not the Builder’s business.
    expect(section).not.toContain('before the Freeze')
  })

  test('an unjudged prototype is named as not decided', async () => {
    const { world, run } = prototyping(1)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith([null])
          yield* builderOf(mission.id)
          return { key: (yield* getMission(mission.id)).key }
        }),
      ),
    )
    const brief = promptsOf(world.agents[2])[0] ?? ''
    expect(brief).toContain(`Builder · ${seen.key}`)
    const section = brief.split('## Prototypes')[1]?.split('\n## ')[0] ?? ''
    expect(section).toContain('- H1 · not judged')
    expect(section).toContain(
      'Not decided: the user did not judge it; neither follow it nor avoid it',
    )
    expect(section).toContain('Files: list-1.html')
  })

  test('a mission frozen with no prototype has no prototype section in the brief', async () => {
    const { world, run } = prototyping(0)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith([])
          yield* builderOf(mission.id)
          return { key: (yield* getMission(mission.id)).key }
        }),
      ),
    )
    const brief = promptsOf(world.agents[1])[0] ?? ''
    expect(brief).toContain(`Builder · ${seen.key}`)
    expect(brief).not.toContain('## Prototypes')
    expect(brief).not.toContain('prototype_read')
  })
})

describe('A helper of the Building is given the frozen prototypes too', () => {
  test('a helper launched by the Builder names the validated prototype in its brief', async () => {
    const { world, run } = prototyping(1)
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith(['validated'])
          const builder = yield* builderOf(mission.id)
          yield* call(builder.grantId, 'helper_launch', { brief: 'Write the list.', task: 'T1' })
          // The Prototyper was H1: the Building’s helper is H2.
          yield* helperNumbered(mission.id, 2)
          yield* until(Effect.sync(() => promptsOf(world.agents[3]).length > 0))
        }),
      ),
    )
    const brief = promptsOf(world.agents[3])[0] ?? ''
    expect(brief).toContain('Write the list.')
    const section = brief.split('## Prototypes')[1]?.split('\n## ')[0] ?? ''
    expect(section).toContain('- H1 · validated')
    expect(section).toContain('Files: list-1.html')
  })

  test('a helper of a mission with no prototype has no prototype section', async () => {
    const { world, run } = prototyping(0)
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith([])
          const builder = yield* builderOf(mission.id)
          yield* call(builder.grantId, 'helper_launch', { brief: 'Write the list.', task: 'T1' })
          yield* helperNumbered(mission.id, 1)
          yield* until(Effect.sync(() => promptsOf(world.agents[2]).length > 0))
        }),
      ),
    )
    const brief = promptsOf(world.agents[2])[0] ?? ''
    expect(brief).toContain('Write the list.')
    expect(brief).not.toContain('## Prototypes')
  })
})

describe('The Builder reads a frozen prototype’s files, never writes them', () => {
  test('it reads a validated prototype’s kept file by pages, and the same call writes nothing', async () => {
    const { run } = prototyping(1)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith(['validated'])
          const builder = yield* builderOf(mission.id)
          const read = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: 'list-1.html',
          })
          const paged = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: 'list-1.html',
            range: { offset: 4, length: 6 },
          })
          const database = yield* Database
          return {
            key: (yield* getMission(mission.id)).key,
            read,
            paged,
            requests: yield* database.select().from(permissionRequests),
          }
        }),
      ),
    )
    expect(seen.read.ok).toBe(true)
    expect(seen.read.text).toContain('<ul class="prototype-1"></ul>')
    expect(seen.paged.ok).toBe(true)
    expect(seen.paged.text).toContain('class=')
    expect(seen.paged.text).not.toContain('<ul class="prototype-1"></ul>')
    expect(seen.requests).toEqual([])
    const file = join(data, 'missions', seen.key, 'prototypes', '1', 'list-1.html')
    expect(readFileSync(file, 'utf8')).toBe('<ul class="prototype-1"></ul>\n')
  })

  test('writing or editing a frozen prototype’s file is refused, and the file is unchanged', async () => {
    const { run } = prototyping(1)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith(['validated'])
          const builder = yield* builderOf(mission.id)
          const key = (yield* getMission(mission.id)).key
          const file = join(data, 'missions', key, 'prototypes', '1', 'list-1.html')
          const written = yield* callTool(builder.grantId, 'fs_write', {
            path: file,
            content: 'overwritten\n',
          })
          const edited = yield* callTool(builder.grantId, 'fs_edit', {
            path: file,
            edits: [{ old: '<ul', new: '<ol' }],
            why: 'Change the prototype.',
          })
          return { file, written, edited }
        }),
      ),
    )
    for (const answer of [seen.written, seen.edited]) {
      expect(answer).toMatchObject({ ok: false, refused: true })
      expect(answer.text).toBe(
        'refused: that file is in the folder of H1, a prototype frozen with the Spec: read it with prototype_read, never write it.',
      )
    }
    expect(readFileSync(seen.file, 'utf8')).toBe('<ul class="prototype-1"></ul>\n')
  })

  test('a path that leaves the prototype’s folder, or a link to a file outside, is refused', async () => {
    const { run } = prototyping(1)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission, main } = yield* frozenWith(['validated'])
          const builder = yield* builderOf(mission.id)
          const folder = (yield* helperRowsOf(mission.id))[0]?.folder ?? ''
          const outside = join(work, 'key.pem')
          writeFileSync(outside, 'not-a-real-key')
          // What a command run in its folder could have made: a link to a key outside it.
          symlinkSync(outside, join(folder, 'link.txt'))
          const up = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: '../../../../../../key.pem',
          })
          const absolute = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: outside,
          })
          const link = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: 'link.txt',
          })
          const checkout = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: join(main, 'api', 'README.md'),
          })
          return { up, absolute, link, checkout }
        }),
      ),
    )
    for (const answer of [seen.up, seen.absolute, seen.link, seen.checkout]) {
      expect(answer).toMatchObject({ ok: false, refused: true })
      expect(answer.text).toMatch(/^refused: .* is not inside the folder of H1/)
      expect(answer.text).not.toContain('not-a-real-key')
      expect(answer.text).not.toContain('Acme api')
    }
  })

  test('a file handed back that has a second name is refused, and nothing of it is kept', async () => {
    const { run } = prototyping(1)
    const outside = join(work, 'key.pem')
    writeFileSync(outside, 'not-a-real-key')
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          let refused = ''
          yield* launched(
            work,
            () => Effect.void,
            'The impact.',
            undefined,
            undefined,
            (mission, planner) =>
              Effect.gen(function* () {
                yield* call(planner, 'helper_launch', { helper: 'prototyper', brief: QUESTION })
                const prototyper = yield* helperNumbered(mission.id, 1)
                const file = join(prototyper.row.folder ?? '', 'list-1.html')
                linkSync(outside, file)
                refused = yield* call(prototyper.grantId, 'helper_result', RESULT('list-1.html'))
                rmSync(file)
                yield* callTool(prototyper.grantId, 'fs_write', {
                  path: 'list-1.html',
                  content: '<ul class="prototype-1"></ul>\n',
                })
                yield* call(prototyper.grantId, 'helper_result', RESULT('list-1.html'))
                yield* until(
                  Effect.map(helperRowsOf(mission.id), (rows) => rows[0]?.state === 'done'),
                )
              }),
          )
          const database = yield* Database
          return { refused, kept: yield* database.select().from(memoryEvidence) }
        }),
      ),
    )
    expect(seen.refused).toContain('list-1.html')
    expect(seen.refused).toContain('hard link')
    const secret = createHash('sha256').update('not-a-real-key').digest('hex')
    expect(seen.kept.map((row) => row.sha256)).not.toContain(secret)
  })

  test('a kept file that has a second name is refused, never read', async () => {
    const { run } = prototyping(1)
    const answer = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith(['validated'])
          const builder = yield* builderOf(mission.id)
          const folder = (yield* helperRowsOf(mission.id))[0]?.folder ?? ''
          const outside = join(work, 'key.pem')
          writeFileSync(outside, 'not-a-real-key')
          rmSync(join(folder, 'list-1.html'))
          linkSync(outside, join(folder, 'list-1.html'))
          return yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: 'list-1.html',
          })
        }),
      ),
    )
    expect(answer).toMatchObject({ ok: false, refused: true })
    expect(answer.text).toContain('hard link')
    expect(answer.text).not.toContain('not-a-real-key')
  })

  test('a prototype that is not frozen with the Spec, or a file it does not hold, is refused naming it', async () => {
    const { run } = prototyping(1)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith(['validated'])
          const builder = yield* builderOf(mission.id)
          const unknown = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H7',
            path: 'list-1.html',
          })
          const missing = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: 'absent.html',
          })
          return { unknown, missing }
        }),
      ),
    )
    expect(seen.unknown).toMatchObject({
      ok: false,
      text: 'refused: H7 is not a prototype frozen with the Spec: the frozen ones are H1',
    })
    expect(seen.missing).toMatchObject({
      ok: false,
      refused: true,
      text: 'refused: absent.html is not a file H1 kept: it kept list-1.html',
    })
  })

  test('a file in the folder that the prototype did not keep is refused', async () => {
    const { run } = prototyping(1)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith(['validated'])
          const builder = yield* builderOf(mission.id)
          const folder = (yield* helperRowsOf(mission.id))[0]?.folder ?? ''
          writeFileSync(join(folder, 'scratch.txt'), 'left behind\n')
          const read = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: 'scratch.txt',
          })
          const kept = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: './list-1.html',
          })
          return { read, kept }
        }),
      ),
    )
    expect(seen.read).toMatchObject({
      ok: false,
      refused: true,
      text: 'refused: scratch.txt is not a file H1 kept: it kept list-1.html',
    })
    expect(seen.read.text).not.toContain('left behind')
    // The same kept file, spelled another way, is still the kept file.
    expect(seen.kept.ok).toBe(true)
  })

  test('a frozen prototype whose folder or helper is gone says its files are no longer there', async () => {
    const { run } = prototyping(2)
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { mission } = yield* frozenWith(['validated', 'validated'])
          const builder = yield* builderOf(mission.id)
          const rows = yield* helperRowsOf(mission.id)
          rmSync(rows[0]?.folder ?? '', { recursive: true, force: true })
          const database = yield* Database
          yield* database.delete(helpers).where(eq(helpers.id, rows[1]?.id ?? ''))
          const folderGone = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H1',
            path: 'list-1.html',
          })
          const rowGone = yield* callTool(builder.grantId, 'prototype_read', {
            prototype: 'H2',
            path: 'list-2.html',
          })
          return { folderGone, rowGone }
        }),
      ),
    )
    for (const [answer, label] of [
      [seen.folderGone, 'H1'],
      [seen.rowGone, 'H2'],
    ] as const) {
      expect(answer).toMatchObject({
        ok: false,
        refused: true,
        text: `refused: the files of ${label} are no longer there`,
      })
    }
  })

  test('the Builder and its helpers hold the tool as a read; the Planner and the Prototyper do not', () => {
    expect(TOOLS.prototype_read.effect).toBe('reads')
    expect(TOOLS.prototype_read.roles).toEqual(['builder', 'helper'])
    expect(toolsOf('builder')).toContain('prototype_read')
    expect(toolsOf('helper')).toContain('prototype_read')
    expect(toolsOf('planner')).not.toContain('prototype_read')
    expect(toolsOf('prototyper')).not.toContain('prototype_read')
  })
})
