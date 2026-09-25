/**
 * What an agent is provided, and how a change of it reaches it (D6-07, D6-08).
 *
 * The scenarios of the issue over a real database and a real Workspace: what a Session starts
 * with is recorded, the file is read natively and never sent, a change waits for the next safe
 * point and is handed over once, and a file that reads again as what was already given is not a
 * change at all.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { AGENTS_FILE, CONTEXT_BASE, DELIVERY_MARKER } from '@hemera/core'

import { StderrSink } from '#engine/agents/supervisor.ts'
import { Context, contextLayer } from '#engine/context/service.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { databaseLayer } from '#engine/storage/database.ts'
import type { Database, SqliteClient } from '#engine/storage/database.ts'
import { gitLayer } from '#engine/git.ts'

/** The migrations this branch ships, and the version it writes in the profile. */
const SHIPPED = join(import.meta.dirname, '..', 'drizzle')
const VERSION = '0.4.0'

let folder = ''
let root = ''

beforeEach(() => {
  // The engine spells a path the way the filesystem does — `realpathSync.native`, the long form
  // of a short name under a Windows runner — so the fixture is settled the same way before use.
  folder = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-context-')))
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
    Layer.provide(gitLayer()),
    Layer.provideMerge(
      Layer.mergeAll(projectsLayer, sessionsLayer).pipe(
        Layer.provideMerge(databaseLayer(join(place, 'hemera.sqlite'))),
        Layer.provide(Layer.succeed(StderrSink, { write: () => Effect.void })),
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

/** What waits, handed to the agent and recorded as given, as the runtime does once it was sent. */
const handedOver = (sessionId: string) =>
  Effect.gen(function* () {
    const context = yield* Context
    const waiting = yield* context.pending(sessionId)
    if (waiting === null) return null
    const record = yield* context.delivered(sessionId, waiting)
    return { ...waiting, record }
  })

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

    // The base, then the line that names where the Session works (D8-08).
    expect(seen.started.base).toEqual(`${CONTEXT_BASE}\nWorkspace: main at ${root}`)
    expect(seen.started.instructions?.path).toEqual(AGENTS_FILE)
    expect(seen.provided.map((one) => one.kind).sort()).toEqual(['base', 'provided'])
    const file = seen.provided.find((one) => one.kind === 'provided')
    expect(file?.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('names each repository of the Workspace with the branch Git reads for it (D8-08)', async () => {
    // A declared repository that is one, on a branch of its own, and one that holds no
    // repository: the first is named with its branch, the second as its path alone.
    const api = join(root, 'sources', 'api')
    mkdirSync(api, { recursive: true })
    mkdirSync(join(root, 'docs'), { recursive: true })
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', api, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' })
    git('init', '-q', '-b', 'trunk')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'base')

    const seen = await given(
      Effect.gen(function* () {
        const projects = yield* Projects
        const sessions = yield* Sessions
        const project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: root })
        const withApi = yield* projects.addRepository(project.id, project.version, './sources/api')
        yield* projects.addRepository(withApi.id, withApi.version, './docs')
        const session = yield* sessions.create(project.id, 'claude')
        const context = yield* Context
        return yield* context.start(session.id)
      }),
    )

    expect(seen.base).toEqual(
      `${CONTEXT_BASE}\nWorkspace: main at ${root} (repositories: ./sources/api on trunk, ./docs)`,
    )
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
        const once = yield* handedOver(sessionId)
        const twice = yield* handedOver(sessionId)
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
        yield* handedOver(sessionId)
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
          const delivered = yield* handedOver(sessionId)
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

  it('hands over a file deleted after the agent read it as an empty change, once', async () => {
    instructions('Be brief.\n')

    const seen = await given(
      Effect.gen(function* () {
        const { sessionId } = yield* opened
        yield* (yield* Context).start(sessionId)
        rmSync(join(root, AGENTS_FILE))
        const once = yield* handedOver(sessionId)
        const twice = yield* handedOver(sessionId)
        return { once, twice }
      }),
    )

    expect(seen.once?.content).toBe('')
    expect(seen.once?.text).toContain(DELIVERY_MARKER)
    expect(seen.once?.record.kind).toBe('instructions')
    expect(seen.twice).toBeNull()
  })

  it('keeps a change pending until it is recorded as given, and names what it replaces', async () => {
    const A = 'Be brief.\n'
    const B = 'Be brief, and say why.\n'
    instructions(A)

    const seen = await given(
      Effect.gen(function* () {
        const { sessionId } = yield* opened
        const context = yield* Context
        const started = yield* context.start(sessionId)
        instructions(B)
        // Asked for, and never recorded as given: its sending failed.
        const first = yield* context.pending(sessionId)
        const again = yield* context.pending(sessionId)
        return { started, first, again, provided: yield* context.provided(sessionId) }
      }),
    )

    expect(seen.again?.fingerprint).toBe(seen.first?.fingerprint)
    expect(seen.first?.before).toBe(seen.started.instructions?.fingerprint)
    expect(seen.provided.filter((one) => one.kind === 'instructions')).toHaveLength(0)
  })
})

/** A Session of the suite's Workspace on the agent named, as the Home's composer makes one. */
const openedOn = (provider: 'claude' | 'codex') =>
  Effect.gen(function* () {
    const project = yield* (yield* Projects).create({
      name: 'Atlas',
      tone: 'primary',
      mainPath: root,
    })
    const session = yield* (yield* Sessions).create(project.id, provider)
    return session.id
  })

describe('An agent that does not read AGENTS.md itself is given it at session start', () => {
  it('hands Claude Code the file as it stands, lists it as given then, and queues nothing', async () => {
    instructions('End every answer with the word KESTREL.\n')

    const seen = await given(
      Effect.gen(function* () {
        const sessionId = yield* openedOn('claude')
        const context = yield* Context
        const started = yield* context.start(sessionId)
        return {
          started,
          provided: yield* context.provided(sessionId),
          pending: yield* context.pending(sessionId),
        }
      }),
    )

    expect(seen.started.instructions?.given).toBe('End every answer with the word KESTREL.\n')
    expect(seen.provided.map((one) => [one.kind, one.path, one.reached])).toEqual([
      ['base', '', 'system_prompt'],
      ['provided', AGENTS_FILE, 'session_start'],
    ])
    // Given at the start is given: the same file is not a change to deliver again.
    expect(seen.pending).toBeNull()
  })
})

describe('An agent that reads AGENTS.md itself is not given it twice', () => {
  it('records Codex reading the file natively and hands it nothing', async () => {
    instructions('Be brief.\n')

    const seen = await given(
      Effect.gen(function* () {
        const sessionId = yield* openedOn('codex')
        const context = yield* Context
        const started = yield* context.start(sessionId)
        return {
          started,
          provided: yield* context.provided(sessionId),
          pending: yield* context.pending(sessionId),
        }
      }),
    )

    expect(seen.started.instructions?.given).toBeNull()
    expect(seen.provided.map((one) => [one.kind, one.path, one.reached])).toEqual([
      ['base', '', 'embedded_resource'],
      ['native', AGENTS_FILE, 'read_natively'],
    ])
    expect(seen.pending).toBeNull()
  })

  it('never sends a CLAUDE.md of the Workspace, to any agent', async () => {
    instructions('Be brief.\n')
    writeFileSync(join(root, 'CLAUDE.md'), 'Answer in French.\n')

    const seen = await given(
      Effect.gen(function* () {
        const sessionId = yield* openedOn('claude')
        const context = yield* Context
        const started = yield* context.start(sessionId)
        return { started, provided: yield* context.provided(sessionId) }
      }),
    )

    expect(seen.started.instructions?.given).not.toContain('French')
    expect(seen.provided.map((one) => one.path)).not.toContain('CLAUDE.md')
  })
})
