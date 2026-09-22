/**
 * What an agent is provided, and how a change of it reaches it (D6-07, D6-08).
 *
 * The scenarios of the issue over a real database and a real Workspace: what a Session starts
 * with is recorded, the file is read natively and never sent, a change waits for the next safe
 * point and is handed over once, and a file that reads again as what was already given is not a
 * change at all.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { AGENTS_FILE, CONTEXT_BASE, DELIVERY_MARKER } from '@hemera/core'

import { Context, contextLayer } from '#engine/context/service.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { databaseLayer } from '#engine/storage/database.ts'
import type { Database, SqliteClient } from '#engine/storage/database.ts'

/** The migrations this branch ships, and the version it writes in the profile. */
const SHIPPED = join(import.meta.dirname, '..', 'drizzle')
const VERSION = '0.4.0'

let folder = ''
let root = ''

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'hemera-context-'))
  root = join(folder, 'workspace')
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/** The engine a delivery needs, and nothing else, over a profile of this suite's own. */
const engine = (
  place: string,
): Layer.Layer<Context | Projects | Sessions | Database | SqliteClient> =>
  contextLayer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(projectsLayer, sessionsLayer).pipe(
        Layer.provideMerge(databaseLayer(join(place, 'hemera.sqlite'))),
      ),
    ),
  )

/** One effect, run against that engine, on a profile migrated as the engine's own start does. */
const given = <A, E>(
  program: Effect.Effect<A, E, Context | Projects | Sessions | Database | SqliteClient>,
): Promise<A> =>
  Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        yield* openProfile(folder, SHIPPED, VERSION)
        return yield* program
      }),
      engine(folder),
    ),
  )

/** A Project on the suite's Workspace and one Session of it, as the window would make them. */
const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const sessions = yield* Sessions
  const project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: root })
  const session = yield* sessions.create(project.id, 'claude')
  return { projectId: project.id, sessionId: session.id }
})

const instructions = (text: string): void => {
  writeFileSync(join(root, AGENTS_FILE), text)
}

describe('what a Session is provided', () => {
  it('records the base and the file a Session starts with', async () => {
    instructions('Be brief.\n')

    const seen = await given(
      Effect.gen(function* () {
        const { sessionId } = yield* opened
        const context = yield* Context
        const started = yield* context.start(sessionId)
        const provided = yield* context.provided(sessionId)
        return { started, provided }
      }),
    )

    expect(seen.started.base).toEqual(CONTEXT_BASE)
    expect(seen.started.instructions?.path).toEqual(AGENTS_FILE)
    expect(seen.provided.map((one) => one.kind).sort()).toEqual(['base', 'native'])
    const file = seen.provided.find((one) => one.kind === 'native')
    expect(file?.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('has nothing it read natively without AGENTS.md', async () => {
    const seen = await given(
      Effect.gen(function* () {
        const { sessionId } = yield* opened
        const context = yield* Context
        const started = yield* context.start(sessionId)
        const provided = yield* context.provided(sessionId)
        return { started, provided }
      }),
    )

    expect(seen.started.instructions).toBeNull()
    expect(seen.provided.map((one) => one.kind)).toEqual(['base'])
  })

  it('hands a change over once, at the next safe point', async () => {
    instructions('Be brief.\n')

    const seen = await given(
      Effect.gen(function* () {
        const { sessionId } = yield* opened
        const context = yield* Context
        yield* context.start(sessionId)
        const before = yield* context.pending(sessionId)
        instructions('Be brief, and say why.\n')
        const waiting = yield* context.pending(sessionId)
        const once = yield* context.deliver(sessionId)
        const twice = yield* context.deliver(sessionId)
        const provided = yield* context.provided(sessionId)
        return { before, waiting, once, twice, provided }
      }),
    )

    expect(seen.before).toBeNull()
    expect(seen.waiting?.text).toContain(DELIVERY_MARKER)
    expect(seen.waiting?.text).toContain('Be brief, and say why.')
    expect(seen.once?.record.kind).toEqual('instructions')
    expect(seen.twice).toBeNull()
    expect(seen.provided.length).toEqual(3)
  })

  it('says nothing when the file reads as what was last given', async () => {
    instructions('Be brief.\n')

    const seen = await given(
      Effect.gen(function* () {
        const { sessionId } = yield* opened
        const context = yield* Context
        yield* context.start(sessionId)
        const unchanged = yield* context.pending(sessionId)
        instructions('Be brief, and say why.\n')
        yield* context.deliver(sessionId)
        const delivered = yield* context.pending(sessionId)
        return { unchanged, delivered }
      }),
    )

    expect(seen.unchanged).toBeNull()
    expect(seen.delivered).toBeNull()
  })

  it('hands over a file put back as it was, and changed again, each time', async () => {
    const A = 'Be brief.\n'
    const B = 'Be brief, and say why.\n'
    instructions(A)

    const seen = await given(
      Effect.gen(function* () {
        const { sessionId } = yield* opened
        const context = yield* Context
        yield* context.start(sessionId)
        const handed: (string | null)[] = []
        for (const text of [B, A, B]) {
          instructions(text)
          const delivered = yield* context.deliver(sessionId)
          handed.push(delivered === null ? null : delivered.text)
        }
        return { handed, provided: yield* context.provided(sessionId) }
      }),
    )

    // The agent held A, then B, then A: each change back is a change it has to be told about.
    expect(seen.handed.map((text) => text?.includes(DELIVERY_MARKER))).toEqual([true, true, true])
    expect(seen.handed[1]).toContain('Be brief.')
    expect(seen.handed[1]).not.toContain('say why')
    expect(seen.provided.filter((one) => one.kind === 'instructions')).toHaveLength(3)
  })
})
