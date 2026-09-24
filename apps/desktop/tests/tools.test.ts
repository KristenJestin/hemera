/**
 * The tools Hemera lends an agent, and the one door every call goes through (D6-03 to D6-05).
 *
 * Every suite here is named after the scenario of the issue's Spec section that it covers, and
 * none of it is mocked: the engine is the real one — the Projects, the Sessions, the commands and
 * the catalogue over a database in a temporary folder — and the two things that are scripted are
 * the human (a question about a path outside the root is answered by this suite, not by a window)
 * and nothing else. The commands run for real, as children of the machine running the tests.
 *
 * What is read is what the agent would read: the answer of the call, the thread the window draws,
 * and the Journal line. A refusal is asserted as an answer and not as a failure, because a tool
 * that refuses is a tool that answered.
 */

import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { Deferred, Effect, Fiber, Layer } from 'effect'
import type { Scope } from 'effect'
import { z } from 'zod'

import { READ_PAGE_BYTES, SEARCH_MATCH_LIMIT, TOOL_NAMES, type ToolName } from '@hemera/core'

import {
  StderrSink,
  hostProcessesLayer,
  processSupervisorLayer,
} from '#engine/agents/supervisor.ts'
import { heldWordsLayer } from '#engine/agents/held.ts'
import { NoNotices } from '#engine/agents/notices.ts'
import { Commands, commandsLayer } from '#engine/commands/service.ts'
import { Journal, journalLayer } from '#engine/journal.ts'
import { openProfile } from '#engine/migrate.ts'
import { Projects, projectsLayer } from '#engine/projects.ts'
import { Sessions, sessionsLayer } from '#engine/sessions.ts'
import { NoSpecNotices } from '#engine/specs/notices.ts'
import { specsLayer } from '#engine/specs/specs.ts'
import { databaseLayer } from '#engine/storage/database.ts'
import type { Database, SqliteClient } from '#engine/storage/database.ts'
import { ToolCatalogue, toolCatalogueLayer } from '#engine/tools/catalogue.ts'
import type { ToolArguments } from '#engine/tools/arguments.ts'
import type { ToolOutcome } from '#engine/tools/catalogue.ts'
import { ToolAccess, toolAccessLayer } from '#engine/tools/access.ts'
import { ToolPermissions } from '#engine/tools/permissions.ts'
import type { OutsideAnswer, OutsideRequest } from '#engine/tools/permissions.ts'
import { variablesLayer } from '#engine/workspaces/variables.ts'

const SHIPPED = join(import.meta.dirname, '..', 'drizzle')

/** The version the shipped migrations are opened with, as the engine opens them. */
const VERSION = '0.4.0'

let folder: string
let root: string

beforeEach(() => {
  folder = join(tmpdir(), `hemera-tools-${String(Date.now())}-${String(Math.random())}`)
  mkdirSync(join(folder, 'workspace'), { recursive: true })
  // The Workspace as the disk spells it, which is how a Project keeps its root.
  folder = realpathSync.native(folder)
  root = join(folder, 'workspace')
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

/** The human, scripted: what they answer to the next question, and what they were asked. */
interface Human {
  readonly service: {
    readonly askOutside: (asked: OutsideRequest) => Effect.Effect<OutsideAnswer>
    readonly answer: () => Effect.Effect<boolean>
    readonly withdrawn: () => Effect.Effect<void>
  }
  readonly asked: OutsideRequest[]
}

/**
 * A human who answers in order, and refuses once they have run out of answers.
 *
 * The questions are kept rather than thrown away: "a permission block appears in the thread" is
 * asserted on what was asked, and a suite that let a tool through without asking would have an
 * empty list to show for it.
 */
function humanSaying(...answers: readonly OutsideAnswer[]): Human {
  const asked: OutsideRequest[] = []
  let next = 0
  return {
    asked,
    service: {
      askOutside: (question) =>
        Effect.sync(() => {
          asked.push(question)
          const answer = answers[next] ?? 'refused'
          next += 1
          return answer
        }),
      answer: () => Effect.succeed(false),
      // This human answers where they are asked: nothing here is left standing for a window.
      withdrawn: () => Effect.void,
    },
  }
}

/** Everything a program of these suites may ask: the engine, and nothing of the window. */
type Engine =
  | Projects
  | Sessions
  | Commands
  | Journal
  | ToolCatalogue
  | ToolAccess
  | ToolPermissions
  | Database
  | SqliteClient

/**
 * One run of this engine, over one database in the suite's folder.
 *
 * The same composition the engine process builds, minus what needs a window: the commands are on
 * the real supervisor, so a run of a command is a real process of this machine, and the human is
 * the layer this suite hands over rather than a default that would let a tool through.
 */
function engine(human: Human) {
  const sink = Layer.succeed(StderrSink, { write: () => Effect.void })
  const processes = processSupervisorLayer.pipe(
    Layer.provideMerge(Layer.mergeAll(hostProcessesLayer, sink)),
  )
  const services: Layer.Layer<Engine> = toolCatalogueLayer.pipe(
    Layer.provideMerge(journalLayer),
    Layer.provideMerge(toolAccessLayer),
    Layer.provideMerge(Layer.succeed(ToolPermissions, human.service)),
    Layer.provideMerge(commandsLayer),
    Layer.provide(variablesLayer),
    Layer.provideMerge(
      Layer.mergeAll(
        projectsLayer,
        sessionsLayer,
        specsLayer.pipe(Layer.provide(NoSpecNotices)),
      ).pipe(Layer.provideMerge(databaseLayer(join(folder, 'hemera.sqlite')))),
    ),
    Layer.provide(processes),
    Layer.provide(heldWordsLayer),
    // Nobody is watching: these suites read the thread and the runs, not what was pushed.
    Layer.provide(NoNotices),
  )
  return <A, E>(program: Effect.Effect<A, E, Engine | Scope.Scope>): Promise<A> =>
    Effect.runPromise(
      Effect.scoped(
        Effect.provide(
          Effect.gen(function* () {
            yield* openProfile(folder, SHIPPED, VERSION)
            return yield* program
          }),
          services,
        ),
      ),
    )
}

/** A Project on the suite's Workspace and one Session of it, as the window would make them. */
const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const sessions = yield* Sessions
  const project = yield* projects.create({ name: 'Atlas', tone: 'primary', mainPath: root })
  const session = yield* sessions.create(project.id, 'claude')
  // An agent holds the Session's token, as it does once `session/new` has answered.
  const access = yield* ToolAccess
  yield* access.granted(session.id, 'agent-1', 'free')
  return { projectId: project.id, sessionId: session.id }
})

/** The key an agent sent among its arguments, read as the server reads it: a string, or none. */
const keySent = (sent: ToolArguments) => {
  const read = z.object({ key: z.string().min(1) }).safeParse(sent)
  return read.success ? read.data.key : null
}

/** One call of one tool, as the server hands it over once the token has been read. */
const calling = (asked: {
  readonly sessionId: string
  readonly tool: string
  readonly arguments: ToolArguments
  readonly key?: string | undefined
  readonly offered?: readonly ToolName[] | undefined
}) =>
  Effect.gen(function* () {
    const catalogue = yield* ToolCatalogue
    const outcome: ToolOutcome = yield* catalogue.call({
      sessionId: asked.sessionId,
      tool: asked.tool,
      // The key travels in the arguments, as an agent sends it, and beside them, as the server
      // hands it over once it has read it.
      arguments: asked.key === undefined ? asked.arguments : { ...asked.arguments, key: asked.key },
      key: asked.key ?? keySent(asked.arguments),
      offered: asked.offered ?? TOOL_NAMES,
      caller: 'a1b2c3d4e5f6',
    })
    return outcome
  })

/** The entries of a Session's thread, oldest first. */
const threadEntries = (sessionId: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    const page = yield* sessions.read(sessionId)
    return page.entries
  })

/** The Journal lines of a Project, newest first, as the bell reads them. */
const journalLines = (projectId: string) =>
  Effect.gen(function* () {
    const journal = yield* Journal
    const read = yield* journal.read({ projectId })
    return read.entries
  })

/** A file inside the root, written by the suite rather than by a tool. */
const fileInRoot = (name: string, content: string) => {
  const path = join(root, name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
  return path
}

describe('every tool name is one the model APIs accept', () => {
  it('is letters, digits, underscores or hyphens, 64 characters at most, and no dot', () => {
    // The Anthropic and OpenAI APIs refuse a tool name outside this pattern, and an agent hands
    // the model `mcp__hemera__<name>` or `hemera_<name>`: a dot would reach it and be refused.
    for (const name of TOOL_NAMES) expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
  })
})

describe('A read inside the Workspace goes through on its own', () => {
  it('returns the content, and the call is an entry of the thread and a line of the Journal', async () => {
    fileInRoot('notes.md', 'the answer is 42\n')
    const human = humanSaying()
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const answer = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_read',
          arguments: { path: 'notes.md' },
        })
        return {
          answer,
          entries: yield* threadEntries(session.sessionId),
          lines: yield* journalLines(session.projectId),
        }
      }),
    )

    expect(seen.answer.ok).toBe(true)
    expect(seen.answer.text).toContain('the answer is 42')
    expect(seen.answer.paths).toEqual(['notes.md'])

    const calls = seen.entries.filter((entry) => entry.kind === 'hemera_tool_call')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body).toContain('notes.md')

    const written = seen.lines.filter((line) => line.type.startsWith('tool.'))
    expect(written.map((line) => line.type)).toEqual(['tool.completed'])
    // Nothing was asked of the human: a read inside the root is what Hemera promises.
    expect(human.asked).toHaveLength(0)
  })
})

describe('A tool not offered is refused all the same', () => {
  it('is refused with a reason, and the refusal is recorded like any call', async () => {
    const human = humanSaying()
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const offered = TOOL_NAMES.filter((name) => name !== 'fs_write')
        const answer = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_write',
          arguments: { path: 'kept.md', content: 'written anyway' },
          offered,
        })
        return { answer, entries: yield* threadEntries(session.sessionId) }
      }),
    )

    expect(seen.answer.ok).toBe(false)
    expect(seen.answer.state).toBe('refused')
    expect(seen.answer.summary).toContain('not offered')
    const calls = seen.entries.filter((entry) => entry.kind === 'hemera_tool_call')
    expect(calls.map((entry) => entry.state)).toEqual(['refused'])
  })
})

describe('No human-only action is reachable', () => {
  it('is refused, which is how an action reserved to the human stays unreachable', async () => {
    const seen = await engine(humanSaying())(
      Effect.gen(function* () {
        const session = yield* opened
        return yield* calling({
          sessionId: session.sessionId,
          tool: 'shell.run',
          arguments: { line: 'rm -rf /' },
        })
      }),
    )

    expect(seen.ok).toBe(false)
    expect(seen.summary).toBe('Hemera has no tool named shell.run')
  })
})

describe('The same write twice has one effect', () => {
  it('happens once, and the second call answers what the first one did', async () => {
    const human = humanSaying()
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const write = () =>
          calling({
            sessionId: session.sessionId,
            tool: 'fs_write',
            arguments: { path: 'once.txt', content: 'first' },
            key: 'write-1',
          })
        const first = yield* write()
        yield* Effect.sync(() => writeFileSync(join(root, 'once.txt'), 'changed since'))
        const second = yield* write()
        return {
          first,
          second,
          entries: yield* threadEntries(session.sessionId),
          lines: yield* journalLines(session.projectId),
        }
      }),
    )

    expect(seen.first.ok).toBe(true)
    expect(seen.first.repeated).toBe(false)
    expect(seen.second.repeated).toBe(true)
    expect(seen.second.summary).toBe(seen.first.summary)
    // Nothing was written the second time: the file holds what the suite put there since.
    expect(readFileSync(join(root, 'once.txt'), 'utf8')).toBe('changed since')
    // One entry in the thread, and the Journal says the second call was a repeat.
    const calls = seen.entries.filter((entry) => entry.kind === 'hemera_tool_call')
    expect(calls).toHaveLength(1)
    expect(
      seen.lines.filter((line) => line.type.startsWith('tool.')).map((line) => line.type),
    ).toEqual(['tool.repeated', 'tool.completed'])
  })
})

describe('A key used again', () => {
  it('with other arguments is refused, says why, and writes nothing', async () => {
    const seen = await engine(humanSaying())(
      Effect.gen(function* () {
        const session = yield* opened
        const write = (content: string) =>
          calling({
            sessionId: session.sessionId,
            tool: 'fs_write',
            arguments: { path: 'once.txt', content },
            key: 'write-1',
          })
        yield* write('first')
        const other = yield* write('second')
        return { other, entries: yield* threadEntries(session.sessionId) }
      }),
    )

    expect(seen.other.state).toBe('refused')
    expect(seen.other.summary).toContain('the key "write-1" was already used')
    expect(readFileSync(join(root, 'once.txt'), 'utf8')).toBe('first')
    // Two calls, two entries: the refusal is recorded like any call, and the first entry stays.
    const calls = seen.entries.filter((entry) => entry.kind === 'hemera_tool_call')
    expect(calls.map((entry) => entry.state)).toEqual(['completed', 'refused'])
    expect(new Set(calls.map((entry) => entry.correlationId)).size).toBe(2)
  })

  it('after a refusal is answered the refusal, and nothing is written over its entry', async () => {
    const outside = join(folder, 'refused.txt')
    const human = humanSaying('refused', 'allowed')
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const write = () =>
          calling({
            sessionId: session.sessionId,
            tool: 'fs_write',
            arguments: { path: outside, content: 'no' },
            key: 'out-1',
          })
        const first = yield* write()
        const second = yield* write()
        return { first, second, entries: yield* threadEntries(session.sessionId) }
      }),
    )

    expect(human.asked).toHaveLength(1)
    expect(seen.second.repeated).toBe(true)
    expect(seen.second.ok).toBe(false)
    expect(existsSync(outside)).toBe(false)
    expect(
      seen.entries.filter((entry) => entry.kind === 'hemera_tool_call').map((entry) => entry.state),
    ).toEqual(['failed'])
  })
})

describe('An edit needs a unique match', () => {
  it('writes nothing and says how many matches were found', async () => {
    fileInRoot('twice.txt', 'same\nother\nsame\n')
    const human = humanSaying()
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const twice = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_edit',
          arguments: { path: 'twice.txt', old: 'same', new: 'changed', key: 'edit-1' },
          key: 'edit-1',
        })
        const none = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_edit',
          arguments: { path: 'twice.txt', old: 'absent', new: 'changed', key: 'edit-2' },
          key: 'edit-2',
        })
        const once = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_edit',
          arguments: { path: 'twice.txt', old: 'other', new: 'changed', key: 'edit-3' },
          key: 'edit-3',
        })
        return { twice, none, once }
      }),
    )

    expect(seen.twice.ok).toBe(false)
    expect(seen.twice.summary).toContain('2')
    expect(seen.none.ok).toBe(false)
    expect(seen.none.summary).toContain('0')
    expect(seen.once.ok).toBe(true)
    expect(readFileSync(join(root, 'twice.txt'), 'utf8')).toBe('same\nchanged\nsame\n')
  })
})

describe('A long read is paginated', () => {
  it('is read in a page, and the answer says which bytes and where the next page starts', async () => {
    const body = 'x'.repeat(READ_PAGE_BYTES + 1024)
    fileInRoot('long.txt', body)
    const human = humanSaying()
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const first = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_read',
          arguments: { path: 'long.txt' },
        })
        const second = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_read',
          arguments: { path: 'long.txt', offset: READ_PAGE_BYTES },
        })
        return { first, second }
      }),
    )

    expect(seen.first.summary).toContain(`bytes 0-${String(READ_PAGE_BYTES)}`)
    expect(seen.first.summary).toContain(`of ${String(body.length)}`)
    expect(seen.first.text).toContain(`the next page starts at offset ${String(READ_PAGE_BYTES)}`)
    expect(seen.second.summary).toContain('bytes 262144-')
    // The range is fields as well as words: what the Spec asks a long read to carry.
    expect(seen.first.range).toEqual({
      offset: 0,
      end: READ_PAGE_BYTES,
      size: body.length,
      truncated: true,
      next: READ_PAGE_BYTES,
    })
    expect(seen.second.range?.truncated).toBe(false)
    expect(seen.second.range?.next).toBeNull()
  })
})

describe('a file read in pages', () => {
  it('numbers its lines, and each page starts on the line after the last one', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${String(index + 1)} of the file`)
    fileInRoot('lines.txt', `${lines.join('\n')}\n`)
    const seen = await engine(humanSaying())(
      Effect.gen(function* () {
        const session = yield* opened
        const first = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_read',
          arguments: { path: 'lines.txt', limit: 100 },
        })
        const second = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_read',
          arguments: { path: 'lines.txt', offset: first.range?.next ?? 0, limit: 100 },
        })
        return { first, second }
      }),
    )

    const numberedLines = (text: string) => text.split('\n').filter((one) => /^ *\d+\t/.test(one))
    const first = numberedLines(seen.first.text)
    const second = numberedLines(seen.second.text)
    expect(first[0]).toBe('     1\tline 1 of the file')
    // The first page stopped after a whole line, and the second picks up at the next one.
    const last = Number.parseInt(first.at(-1) ?? '', 10)
    expect(second[0]).toBe(
      `${String(last + 1).padStart(6, ' ')}\tline ${String(last + 1)} of the file`,
    )
  })

  it('never cuts a character in two, and the pages put together are the file', async () => {
    // Two bytes a character and no newline: a page of an odd number of bytes would cut one.
    const body = 'é'.repeat(300)
    fileInRoot('accents.txt', body)
    const seen = await engine(humanSaying())(
      Effect.gen(function* () {
        const session = yield* opened
        const first = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_read',
          arguments: { path: 'accents.txt', limit: 101 },
        })
        const second = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_read',
          arguments: { path: 'accents.txt', offset: first.range?.next ?? 0 },
        })
        return { first, second }
      }),
    )

    const textOf = (text: string) => (text.split('\n')[0] ?? '').replace(/^ *\d+\t/, '')
    expect(seen.first.text).not.toContain('�')
    expect(seen.second.text).not.toContain('�')
    expect(seen.first.range?.end).toBe(100)
    expect(textOf(seen.first.text) + textOf(seen.second.text)).toBe(body)
  })
})

describe('A search is bounded and says so', () => {
  it('stops at the match limit, says which limit it hit, and offers a cursor', async () => {
    const lines = Array.from({ length: SEARCH_MATCH_LIMIT + 20 }, () => 'needle in a line')
    fileInRoot('many.txt', `${lines.join('\n')}\n`)
    const seen = await engine(humanSaying())(
      Effect.gen(function* () {
        const session = yield* opened
        return yield* calling({
          sessionId: session.sessionId,
          tool: 'search',
          arguments: { query: 'needle' },
        })
      }),
    )

    expect(seen.ok).toBe(true)
    expect(seen.text).toContain(`${String(SEARCH_MATCH_LIMIT)} match(es)`)
    expect(seen.text).toContain('stopped by the match limit')
    expect(seen.text).toContain('continue from cursor')
  })
})

describe('the commands of a Project', () => {
  it('are listed for the agent, and a one-off line runs inside the root', async () => {
    const human = humanSaying()
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        yield* commands.save(
          {
            projectId: session.projectId,
            name: 'dev',
            // A line is not a shell line: what it names is the program and the rest are its
            // arguments, so the program to evaluate is one token.
            line: 'node -e console.log(process.cwd())',
            type: 'script',
            lineWindows: null,
            lineLinux: null,
            scope: 'workspace',
            portless: false,
            folderBase: null,
            folder: null,
          },
          false,
        )
        const listed = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_list',
          arguments: {},
        })
        const ran = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { name: 'dev', key: 'run-1' },
          key: 'run-1',
        })
        // A `check` or a `utility` ends on its own: the agent reads it once it has ended, which
        // is the whole reason its exit code is kept.
        let outcome = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_output',
          arguments: {},
        })
        for (let tries = 0; tries < 50 && outcome.text.includes('still running'); tries += 1) {
          yield* Effect.sleep('50 millis')
          outcome = yield* calling({
            sessionId: session.sessionId,
            tool: 'commands_output',
            arguments: {},
          })
        }
        return { listed, ran, outcome, projectId: session.projectId }
      }),
    )

    expect(seen.listed.ok).toBe(true)
    expect(seen.listed.text).toContain('dev')
    expect(seen.ran.ok).toBe(true)
    expect(seen.outcome.text).toContain('exit code 0')
    expect(seen.outcome.text).toContain(root)
    expect(human.asked).toHaveLength(0)
  })
})

describe('A command outside the Workspace asks the human', () => {
  it('asks the human before anything runs, and starts nothing when they refuse', async () => {
    const human = humanSaying('refused')
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const answer = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { line: 'node -e "console.log(1)"', folder: '../elsewhere', key: 'run-2' },
          key: 'run-2',
        })
        const commands = yield* Commands
        const running = yield* commands.running(session.sessionId)
        return { answer, running }
      }),
    )

    expect(human.asked).toHaveLength(1)
    expect(human.asked[0]?.named).toContain('elsewhere')
    expect(seen.answer.ok).toBe(false)
    expect(seen.running).toHaveLength(0)
  })
})

describe('A write outside the root asks the human', () => {
  it('asks the human about the place it leads to, not the text the agent wrote', async () => {
    const human = humanSaying('allowed')
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const answer = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_write',
          arguments: { path: 'src/../../elsewhere.txt', content: 'allowed once', key: 'out-1' },
        })
        return { answer, entries: yield* threadEntries(session.sessionId) }
      }),
    )

    const where = join(realpathSync.native(folder), 'elsewhere.txt')
    expect(human.asked).toHaveLength(1)
    expect(human.asked[0]?.named).toBe(where)
    const asked = seen.entries.find((entry) => entry.kind === 'permission_request')
    expect(asked?.body).toContain(where)
    expect(seen.answer.ok).toBe(true)
    expect(readFileSync(where, 'utf8')).toBe('allowed once')
  })
})

describe('A write through a link inside the root that leads outside asks the human', () => {
  it('asks about the place the link points at, and writes nothing there when refused', async () => {
    // A junction to a folder that does not exist yet: `realpath` fails on it, and it is inside.
    symlinkSync(join(folder, 'planted'), join(root, 'notes'), 'junction')
    const human = humanSaying('refused')
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const write = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_write',
          arguments: { path: 'notes/keys.txt', content: 'planted', key: 'link-1' },
        })
        const edit = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_edit',
          arguments: { path: 'notes/keys.txt', old: 'a', new: 'b', key: 'link-2' },
        })
        return { write, edit }
      }),
    )

    expect(human.asked.map((one) => one.named)).toEqual([
      join(folder, 'planted', 'keys.txt'),
      join(folder, 'planted', 'keys.txt'),
    ])
    expect(seen.write.ok).toBe(false)
    expect(seen.edit.ok).toBe(false)
    expect(existsSync(join(folder, 'planted'))).toBe(false)
  })
})

describe('A write to a hard link inside the root', () => {
  it('replaces the name inside the root and leaves the file outside as it was', async () => {
    const outside = join(folder, 'shared.txt')
    writeFileSync(outside, 'outside')
    linkSync(outside, join(root, 'written.txt'))
    linkSync(outside, join(root, 'edited.txt'))
    const seen = await engine(humanSaying())(
      Effect.gen(function* () {
        const session = yield* opened
        const write = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_write',
          arguments: { path: 'written.txt', content: 'inside', key: 'hard-1' },
        })
        const edit = yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_edit',
          arguments: { path: 'edited.txt', old: 'outside', new: 'edited', key: 'hard-2' },
        })
        return { write, edit }
      }),
    )

    expect(seen.write.ok).toBe(true)
    expect(seen.edit.ok).toBe(true)
    expect(readFileSync(join(root, 'written.txt'), 'utf8')).toBe('inside')
    expect(readFileSync(join(root, 'edited.txt'), 'utf8')).toBe('edited')
    expect(readFileSync(outside, 'utf8')).toBe('outside')
  })
})

describe('an edit whose new text carries replacement patterns', () => {
  it('writes the new text as it was sent', async () => {
    fileInRoot('price.txt', 'price: TBD\n')
    const seen = await engine(humanSaying())(
      Effect.gen(function* () {
        const session = yield* opened
        return yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_edit',
          arguments: { path: 'price.txt', old: 'TBD', new: "$& costs $$5, $' and $`", key: 'e-1' },
        })
      }),
    )

    expect(seen.ok).toBe(true)
    expect(readFileSync(join(root, 'price.txt'), 'utf8')).toBe("price: $& costs $$5, $' and $`\n")
  })
})

describe('an edit whose old and new texts are the same', () => {
  it('is refused, and the file is left as it was', async () => {
    fileInRoot('same.txt', 'unchanged\n')
    const seen = await engine(humanSaying())(
      Effect.gen(function* () {
        const session = yield* opened
        return yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_edit',
          arguments: { path: 'same.txt', old: 'unchanged', new: 'unchanged', key: 'e-2' },
        })
      }),
    )

    expect(seen.ok).toBe(false)
    expect(seen.summary).toContain('changes nothing')
    expect(readFileSync(join(root, 'same.txt'), 'utf8')).toBe('unchanged\n')
  })
})

describe('the same write twice at the same time', () => {
  it('runs once: the second call waits for the first and is answered what it was', async () => {
    const decision = Deferred.makeUnsafe<OutsideAnswer>()
    const asked: OutsideRequest[] = []
    const human: Human = {
      asked,
      service: {
        askOutside: (question) =>
          Effect.gen(function* () {
            asked.push(question)
            return yield* Deferred.await(decision)
          }),
        answer: () => Effect.succeed(false),
        withdrawn: () => Effect.void,
      },
    }
    const outside = join(folder, 'shared.txt')
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const write = (content: string) =>
          calling({
            sessionId: session.sessionId,
            tool: 'fs_write',
            arguments: { path: outside, content },
            key: 'same-key',
          })
        // The first call waits on the human; the retry arrives while it does.
        const first = yield* Effect.forkChild(write('first'))
        yield* Effect.sleep('50 millis')
        const second = yield* Effect.forkChild(write('first'))
        yield* Effect.sleep('50 millis')
        Deferred.doneUnsafe(decision, Effect.succeed<OutsideAnswer>('allowed'))
        return { first: yield* Fiber.join(first), second: yield* Fiber.join(second) }
      }),
    )

    expect(asked).toHaveLength(1)
    expect(seen.first.repeated).toBe(false)
    expect(seen.second.repeated).toBe(true)
    expect(readFileSync(outside, 'utf8')).toBe('first')
  })
})

describe('a write without an idempotency key', () => {
  it('is refused before anything is written', async () => {
    const seen = await engine(humanSaying())(
      Effect.gen(function* () {
        const session = yield* opened
        return yield* calling({
          sessionId: session.sessionId,
          tool: 'fs_write',
          arguments: { path: 'keyless.txt', content: 'no key' },
        })
      }),
    )

    expect(seen.state).toBe('refused')
    expect(seen.summary).toContain('key')
  })
})

describe('the answers a Session keeps against a retry', () => {
  it('are bounded, the least recently asked let go of first', async () => {
    const seen = await engine(humanSaying())(
      Effect.gen(function* () {
        const session = yield* opened
        const write = (key: string, content: string) =>
          calling({
            sessionId: session.sessionId,
            tool: 'fs_write',
            arguments: { path: `kept/${key}.txt`, content, key },
          })
        yield* write('oldest', 'first')
        yield* Effect.forEach(
          Array.from({ length: 256 }, (_, index) => `k${String(index)}`),
          (key) => write(key, 'filler'),
        )
        // 257 keys were answered: the oldest is gone, and asking it again writes again.
        return yield* write('oldest', 'second')
      }),
    )

    expect(seen.repeated).toBe(false)
    expect(readFileSync(join(root, 'kept', 'oldest.txt'), 'utf8')).toBe('second')
    // 258 real writes, each a file and a thread entry: the Windows runner needs more than 30 s.
  }, 120_000)
})

describe('A one-off command asks the human before it runs', () => {
  it('shows the line in a permission block, and starts nothing when the human refuses', async () => {
    const human = humanSaying('refused')
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const answer = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { line: 'node -e console.log(1)', key: 'one-off-1' },
        })
        const commands = yield* Commands
        return {
          answer,
          running: yield* commands.running(session.sessionId),
          recent: yield* commands.recent(session.sessionId),
          entries: yield* threadEntries(session.sessionId),
        }
      }),
    )

    expect(human.asked).toHaveLength(1)
    const block = seen.entries.find((entry) => entry.kind === 'permission_request')
    expect(block?.body).toContain('node -e console.log(1)')
    expect(seen.answer.ok).toBe(false)
    expect(seen.running).toHaveLength(0)
    expect(seen.recent).toHaveLength(0)
  })

  it('runs the line once the human allows it', async () => {
    const human = humanSaying('allowed')
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const answer = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { line: 'node -e console.log(1)', key: 'one-off-2' },
        })
        const commands = yield* Commands
        return { answer, recent: yield* commands.recent(session.sessionId) }
      }),
    )

    expect(human.asked).toHaveLength(1)
    expect(seen.answer.ok).toBe(true)
    expect(seen.recent).toHaveLength(1)
  })
})

describe('A catalogue command inside the root runs on its own', () => {
  it('starts without a question to the human', async () => {
    const human = humanSaying()
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        yield* commands.save(
          {
            projectId: session.projectId,
            name: 'hello',
            line: 'node -e console.log(1)',
            type: 'script',
            lineWindows: null,
            lineLinux: null,
            scope: 'workspace',
            portless: false,
            folderBase: null,
            folder: null,
          },
          false,
        )
        const answer = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { name: 'hello', key: 'cat-1' },
        })
        return { answer, recent: yield* commands.recent(session.sessionId) }
      }),
    )

    expect(human.asked).toHaveLength(0)
    expect(seen.answer.ok).toBe(true)
    expect(seen.recent).toHaveLength(1)
  })
})

describe("A catalogue command's folder is the Project's", () => {
  it('is refused with the folder it runs in when the agent names another, and nothing starts', async () => {
    const human = humanSaying('allowed')
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        yield* commands.save(
          {
            projectId: session.projectId,
            name: 'hello',
            line: 'node -e console.log(1)',
            type: 'script',
            lineWindows: null,
            lineLinux: null,
            scope: 'workspace',
            portless: false,
            folderBase: null,
            folder: null,
          },
          false,
        )
        const elsewhere = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { name: 'hello', folder: folder, key: 'cat-2' },
        })
        const same = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { name: 'hello', folder: '.', key: 'cat-3' },
        })
        return { elsewhere, same, recent: yield* commands.recent(session.sessionId) }
      }),
    )

    expect(seen.elsewhere.ok).toBe(false)
    expect(seen.elsewhere.text).toContain('hello runs in the Workspace root')
    expect(human.asked).toHaveLength(0)
    // Its own folder named again is no override: it runs, once.
    expect(seen.same.ok).toBe(true)
    expect(seen.recent).toHaveLength(1)
  })
})

describe('A run asked for before its Session ended', () => {
  it('does not start once the Session has ended, even if the human then allows it', async () => {
    // The Session ends while the human is being asked: its token is revoked and its runs are
    // swept, as the runtime does when the agent goes, and only then does the human answer.
    let ending: Effect.Effect<void> = Effect.void
    const asked: OutsideRequest[] = []
    const human: Human = {
      asked,
      service: {
        askOutside: (question) =>
          Effect.gen(function* () {
            asked.push(question)
            yield* ending
            return 'allowed' as const
          }),
        answer: () => Effect.succeed(false),
        withdrawn: () => Effect.void,
      },
    }
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const access = yield* ToolAccess
        const commands = yield* Commands
        ending = Effect.gen(function* () {
          yield* access.revoked(session.sessionId)
          yield* commands.stopped(session.sessionId).pipe(Effect.ignore)
        })
        const answer = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { line: 'node -e setInterval(()=>{},1000)', key: 'late-1' },
        })
        return { answer, recent: yield* commands.recent(session.sessionId) }
      }),
    )

    expect(asked).toHaveLength(1)
    expect(seen.answer.ok).toBe(false)
    expect(seen.answer.summary).toContain('ended')
    expect(seen.recent).toHaveLength(0)
  })
})

describe('A short command answers with its output; a long one is left running', () => {
  it('waits for a short one, and leaves one that outlasts the wait running with its run id', async () => {
    const human = humanSaying()
    const seen = await engine(human)(
      Effect.gen(function* () {
        const session = yield* opened
        const commands = yield* Commands
        const save = (name: string, line: string) =>
          commands.save(
            {
              projectId: session.projectId,
              name,
              line,
              type: 'test',
              lineWindows: null,
              lineLinux: null,
              folderBase: null,
              folder: null,
              scope: 'workspace',
              portless: false,
            },
            false,
          )
        yield* save('short', 'node -e console.log(42)')
        yield* save('long', 'node -e setInterval(()=>{},1000)')
        const short = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { name: 'short', key: 'wait-1' },
        })
        const long = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { name: 'long', key: 'wait-2', timeout: 300 },
        })
        const began = Date.now()
        const background = yield* calling({
          sessionId: session.sessionId,
          tool: 'commands_run',
          arguments: { name: 'long', key: 'wait-3', background: true },
        })
        const waited = Date.now() - began
        yield* commands.stopped(session.sessionId)
        return { short, long, background, waited }
      }),
    )

    // The short one is answered once it has ended: its exit code and what it printed.
    expect(seen.short.text).toContain('exit code 0')
    expect(seen.short.text).toContain('42')
    // The long one outlasted the wait: it is still running, and the answer says which run it is.
    expect(seen.long.text).toContain('still running, left in the background')
    expect(seen.long.text).toMatch(/run id [0-9a-f-]{36}/)
    // Asked for in the background, it is answered as soon as it has started, not 30 s later.
    expect(seen.background.text).toContain('still running')
    expect(seen.waited).toBeLessThan(5_000)
  })
})
