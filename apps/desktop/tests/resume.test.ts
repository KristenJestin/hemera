/**
 * What happens when a Session meets its agent again after the application was closed (D5-06, D5-07).
 *
 * Every suite here runs the application twice over the same folder: the layers are built again,
 * the database is opened again and a new scripted agent answers. What the first run left behind is
 * what the second one takes back — a native handle, the directory it ran in, and the thread.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { Effect } from 'effect'

import { fakeAgent } from '#engine/agents/fake.ts'
import { AgentRuntime } from '#engine/agents/runtime.ts'
import { Projects } from '#engine/projects.ts'
import { Sessions } from '#engine/sessions.ts'
import { application, aSession, entryOf, heldInThread, threadOf } from './application.ts'

let dataFolder: string
let workingDirectory: string
let opened: ReturnType<typeof application>

beforeEach(() => {
  dataFolder = mkdtempSync(join(tmpdir(), 'hemera-resume-'))
  // The Workspace as the disk spells it, which is how a Project keeps its root.
  workingDirectory = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-workspace-')))
  opened = application(dataFolder)
})

afterEach(() => {
  rmSync(dataFolder, { recursive: true, force: true })
  rmSync(workingDirectory, { recursive: true, force: true })
})

describe('A Session is taken back by its agent', () => {
  test('app restart resumes the native session', async () => {
    const first = fakeAgent({ steps: [{ does: 'says', text: 'the reader is a mess' }] })
    let sessionId = ''

    await opened(first)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        sessionId = session.id
        yield* runtime.prompt(session.id, 'start on the reader')
      }),
    )

    // The application is started again, over the same folder, with an agent that still has the
    // session it was given.
    const second = fakeAgent({
      continues: true,
      history: [{ does: 'says', text: 'the reader is a mess', messageId: 'msg-1' }],
    })
    await opened(second)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessions = yield* Sessions
        const report = yield* runtime.resume(sessionId)

        expect(report.state).toBe('attached')
        expect(report.reason).toBeNull()
        // The agent was asked to carry on the session it handed back rather than to send it back:
        // `session/resume` is the native path, and it is the first one tried.
        expect(second.answers.resumes).toBe(1)
        expect(second.answers.loads).toBe(0)
        // Taking a session back is not a turn: nothing was asked of the agent.
        expect(second.answers.prompts).toEqual([])

        const { native } = yield* sessions.one(sessionId)
        expect(native.nativeState).toBe('attached')
        expect(native.nativeSessionId).toBe('native-session')
        expect(native.cwd).toBe(workingDirectory)
      }),
    )
  })

  test('no tool is replayed on resume', async () => {
    const call = { id: 'call-7', title: 'Read src/reader.ts', kind: 'read' as const }
    const first = fakeAgent({
      steps: [
        { does: 'says', text: 'I will read it', messageId: 'msg-1' },
        { does: 'calls', call },
        { does: 'updates', call: { id: 'call-7', status: 'completed' } },
      ],
    })
    let sessionId = ''

    await opened(first)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        sessionId = session.id
        yield* runtime.prompt(session.id, 'read the reader')
      }),
    )

    // An agent that cannot resume hands the history back instead, and the history it sends is
    // what the thread already holds.
    const second = fakeAgent({
      advertisesResume: false,
      continues: true,
      history: [
        { does: 'says', text: 'I will read it', messageId: 'msg-1' },
        { does: 'calls', call },
        { does: 'updates', call: { id: 'call-7', status: 'completed' } },
        { does: 'says', text: 'and here is what I make of it', messageId: 'msg-2' },
      ],
    })
    await opened(second)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessions = yield* Sessions
        const report = yield* runtime.resume(sessionId)

        expect(report.state).toBe('attached')
        // Not advertised, so never asked: an agent that cannot resume is not asked to.
        expect(second.answers.resumes).toBe(0)
        expect(second.answers.loads).toBe(1)

        const page = yield* sessions.read(sessionId)
        const entries = page.entries
        // The message the agent named, under the key the thread matches it by: the identifier it
        // gave and the kind that chunk was, because one identifier can name both a thought and
        // the answer that followed it.
        const messages = entries.filter((entry) => entry.correlationId === 'msg-1:message')
        const calls = entries.filter((entry) => entry.correlationId === 'call:call-7')

        // One entry each, not two: what the agent sent back was matched against what the thread
        // held rather than written a second time (D5-08).
        expect(messages).toHaveLength(1)
        expect(calls).toHaveLength(1)
        // An entry the replay matched keeps the origin it was written with: it was said live, and
        // being sent back does not make it a replay.
        expect(messages[0]?.origin).toBe('live')
        const added = entries.filter((entry) => entry.correlationId === 'msg-2:message')
        expect(added).toHaveLength(1)
        expect(added[0]?.origin).toBe('replay')
        // Nothing was re-executed: no prompt was sent, and the turn is the one the first run had.
        expect(second.answers.prompts).toEqual([])
        expect(entries.filter((entry) => entry.kind === 'turn')).toHaveLength(1)
      }),
    )
  })

  test('a window replayed with a history is not the window of the next turn', async () => {
    const first = fakeAgent({ steps: [{ does: 'says', text: 'the reader is a mess' }] })
    let sessionId = ''

    await opened(first)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        sessionId = session.id
        yield* runtime.prompt(session.id, 'start on the reader')
      }),
    )

    // The window the session was left in comes back with the history, and coming back does not
    // make it a reading of now: what the thread keeps is what was announced while the session was
    // open, and an older reading taken for the current one is a meter that goes backwards (D5-20).
    const second = fakeAgent({
      advertisesResume: false,
      continues: true,
      history: [
        { does: 'says', text: 'the reader is a mess', messageId: 'msg-1' },
        { does: 'spends', used: 198000, size: 200000 },
      ],
      steps: [{ does: 'says', text: 'and this one is new' }],
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    })
    await opened(second)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        yield* runtime.resume(sessionId)
        yield* runtime.prompt(sessionId, 'carry on')

        const spent = entryOf(yield* threadOf(sessionId), 'usage')
        // SAFETY: the payload of a usage entry is what the runtime wrote for it, and what is read
        // here are the two fields it wrote there.
        const payload = JSON.parse(spent.payload ?? '{}') as {
          used?: number | null
          size?: number | null
        }
        // The agent announced a window, and the turn is measured against none of it: this agent
        // announced it about a session it was handing back, not about this turn.
        expect(payload.used).toBeNull()
        expect(payload.size).toBeNull()
      }),
    )
  })

  test('the fallback is offered and marked', async () => {
    const first = fakeAgent({ steps: [{ does: 'says', text: 'the reader is a mess' }] })
    let sessionId = ''

    await opened(first)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        sessionId = session.id
        yield* runtime.prompt(session.id, 'start on the reader')
      }),
    )

    // An agent that refuses both: it cannot carry the session on and it cannot send it back.
    const second = fakeAgent({
      refusesResume: true,
      refusesLoad: true,
      continues: true,
    })
    await opened(second)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const sessions = yield* Sessions
        const report = yield* runtime.resume(sessionId)

        expect(report.state).toBe('fallback')
        expect(report.reason).not.toBeNull()
        // Both were tried, in the design's order: resume first, then load (D5-07).
        expect(second.answers.resumes).toBe(1)
        expect(second.answers.loads).toBe(1)

        const { native } = yield* sessions.one(sessionId)
        expect(native.nativeState).toBe('fallback')
        // The Session goes on with the agent that answered: the new session is the one a later
        // restart takes back, and the one the rebuilt context was given to.
        expect(native.nativeSessionId).toBe('native-session')

        const entries = yield* heldInThread(sessionId, (held) =>
          held.some((entry) => entry.kind === 'note'),
        )
        const note = entryOf(entries, 'note')
        expect(note.body).toContain('rebuilt')
        // The refusal is in the note, as the attempt it stopped: what an agent's own words for it
        // are is not something the protocol hands back — the SDK answers `Internal error` and the
        // call it failed on is what Hemera can name.
        expect(note.payload ?? '').toContain('loadSession')

        // And the next turn carries what was said before, because the agent no longer has it.
        yield* runtime.prompt(sessionId, 'carry on')
        expect(second.answers.prompts).toHaveLength(1)
        expect(second.answers.prompts[0]).toContain('start on the reader')
        expect(second.answers.prompts[0]).toContain('carry on')
      }),
    )
  })

  test('a wrong cwd is refused', async () => {
    const first = fakeAgent({ steps: [{ does: 'says', text: 'the reader is a mess' }] })
    let sessionId = ''
    let projectId = ''

    await opened(first)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const session = yield* aSession(workingDirectory)
        sessionId = session.id
        projectId = session.projectId
        yield* runtime.prompt(session.id, 'start on the reader')
      }),
    )

    // The folder this Session ran in is gone, and the Project has moved elsewhere.
    const elsewhere = realpathSync.native(mkdtempSync(join(tmpdir(), 'hemera-elsewhere-')))
    rmSync(workingDirectory, { recursive: true, force: true })
    mkdirSync(elsewhere, { recursive: true })

    const second = fakeAgent({ continues: true })
    await opened(second)(
      Effect.gen(function* () {
        const runtime = yield* AgentRuntime
        const projects = yield* Projects
        const sessions = yield* Sessions
        const project = (yield* projects.list()).find((candidate) => candidate.id === projectId)
        expect(project).toBeDefined()
        yield* projects.moveMain(projectId, project?.version ?? 0, elsewhere)

        const report = yield* runtime.resume(sessionId)
        expect(report.state).toBe('fallback')
        expect(report.reason).toContain('gone')

        // Nothing was asked of the agent: a session made in a directory that is gone is not
        // taken back there, and the agent is not asked about it at all.
        expect(second.answers.resumes).toBe(0)
        expect(second.answers.loads).toBe(0)

        const { native } = yield* sessions.one(sessionId)
        expect(native.nativeState).toBe('fallback')
        // The Session goes on where the Project lives now.
        expect(native.cwd).toBe(elsewhere)
      }),
    )

    rmSync(elsewhere, { recursive: true, force: true })
  })
})
