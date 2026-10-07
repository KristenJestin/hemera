/**
 * The Chat (#43), on the engine as it starts, with the fake agent of #32 behind the starter, never
 * a real agent: two Chats at once in the main checkout, outside the cap; the user's message with
 * no marker; a sensitive read held at once as the Project's need, Allow once delivering its result;
 * pushes, forge writes and publications that always ask; the Memory of the Project's missions read,
 * another Project's refused; a mission draft; a fresh session handed the end of the conversation;
 * a restart that marks the turn it interrupted and resumes nothing; a stop; a model change.
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CHAT_CONTINUE,
  CHAT_INTERRUPTED,
  CHAT_STOPPED,
  PermissionAnswer,
} from '@hemera/core/domain'
import { Effect, Predicate, References, Stream } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { FakeScript, FakeStep } from '../src/engine/agents/fake.ts'
import { setProjectLimits } from '../src/engine/budget.ts'
import { Chats } from '../src/engine/chat/service.ts'
import { getChat, transcriptOf } from '../src/engine/chat/store.ts'
import { Memory } from '../src/engine/memory/index.ts'
import { createMission, listMissions } from '../src/engine/missions.ts'
import { answerNeed, listNeeds } from '../src/engine/needs.ts'
import { createProject } from '../src/engine/projects.ts'
import { Sessions } from '../src/engine/sessions/service.ts'
import { sessionsIn } from '../src/engine/sessions/store.ts'
import { repository } from './repositories.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { acmeIn, agentsFound, held, sessionsEngine, text, until, within } from './sessions-world.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('chat'))
  work = realpathSync.native(temporaryFolder('chat-work'))
})
afterEach(removeFolders)

const acme = Effect.suspend(() => acmeIn(work))

const SAYS = (words: string): FakeScript => ({ steps: [{ does: 'says', text: words }] })

/** What a held call answers the agent. */
const WAITING = /Waiting for the user's approval, request #\d+/

const send = (chatId: string, words: string) => Chats.use((chats) => chats.send(chatId, words, []))

const created = (projectId: string) => Chats.use((chats) => chats.create(projectId))

/** Waits until the Chat's live session is between turns with nothing queued. */
const settledChat = (chatId: string) =>
  Effect.gen(function* () {
    const chat = yield* getChat(chatId)
    const [session] = (yield* sessionsIn(['starting', 'working', 'idle'])).filter(
      (one) => one.lineage === chat.lineage,
    )
    if (session !== undefined) yield* Sessions.use((sessions) => sessions.settled(session.id))
  })

const pendingNeeds = Effect.map(listNeeds, (groups) => groups.flatMap((group) => group.needs))

describe('Chats of a Project', () => {
  test('two Chats run at once, each in its own session in the main checkout, and neither counts in the cap', async () => {
    const hold = held()
    const { world, run } = sessionsEngine(data, () => ({
      ...SAYS('done'),
      between: () => hold.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, owner, main } = yield* acme
          yield* setProjectLimits(project.id, {
            cap: 1,
            budget: { launches: 8, attempts: 30, rounds: 3 },
          })
          yield* Sessions.use((sessions) =>
            sessions.open({ owner, role: 'helper', folder: main, requestedBy: 'agent' }),
          )
          const first = yield* created(project.id)
          const second = yield* created(project.id)
          yield* send(first.id, 'Where are the invoices exported?')
          yield* send(second.id, 'Which tests cover the export?')
          yield* until(Effect.sync(() => world.agents.length === 3))
          const chats = (yield* sessionsIn(['starting', 'working', 'idle'])).filter(
            (one) => one.role === 'chat',
          )
          hold.release()
          return { chats, main }
        }),
      ),
    )
    expect(seen.chats).toHaveLength(2)
    expect(new Set(seen.chats.map((one) => one.lineage)).size).toBe(2)
    expect(seen.chats.every((one) => one.folder === seen.main)).toBe(true)
    expect(seen.chats.every((one) => one.owner.kind === 'project')).toBe(true)
  })

  test('the user’s message reaches the agent without a marker, after the brief; Hemera’s deliveries keep theirs', async () => {
    const { world, run } = sessionsEngine(data, () => SAYS('It is in api/export.ts.'))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, owner } = yield* acme
          const chat = yield* created(project.id)
          yield* send(chat.id, 'Where are the invoices exported?')
          yield* settledChat(chat.id)
          const lineage = (yield* getChat(chat.id)).lineage ?? ''
          yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner: { kind: 'project', projectId: project.id },
              target: { lineage },
              kind: 'approval',
              body: 'Request #1 was allowed: done.',
            }),
          )
          yield* settledChat(chat.id)
          // The agent's words of a turn are written once its end is told.
          yield* until(Effect.map(transcriptOf(chat.id, null), (page) => page.entries.length === 3))
          const refused = yield* Sessions.use((sessions) =>
            sessions.deliver({
              owner,
              target: { role: 'builder' },
              kind: 'user',
              body: 'Hello mission',
            }),
          ).pipe(Effect.flip)
          return {
            transcript: yield* transcriptOf(chat.id, null),
            refused,
            chat: yield* getChat(chat.id),
          }
        }),
      ),
    )
    const [first, second] = world.agents[0]?.answers.prompts ?? []
    const opening = text(first ?? [])
    expect(opening).toMatch(/^\[hemera:brief\]\n## Chat · Acme/)
    expect(opening).toMatch(/\n\nWhere are the invoices exported\?$/)
    expect(text(second ?? [])).toBe('[hemera:approval]\nRequest #1 was allowed: done.')
    expect(seen.refused.message).toContain('nobody writes to a mission’s sessions')
    expect(seen.chat.title).toBe('Where are the invoices exported?')
    expect(seen.transcript.entries.map((entry) => [entry.kind, entry.text])).toEqual([
      ['user', 'Where are the invoices exported?'],
      ['agent', 'It is in api/export.ts.'],
      ['agent', 'It is in api/export.ts.'],
    ])
  })
})

describe('The Chat’s permissions: all tools, the same gate, no grace', () => {
  test('a read of .env is held at once as the Project’s need, Allow once and Deny only; Allow delivers its result', async () => {
    const uses: FakeStep = {
      does: 'uses',
      id: 'toolu_env',
      tool: 'fs_read',
      arguments: { path: '.env' },
    }
    const { world, run } = sessionsEngine(data, (index) =>
      index === 0
        ? {
            turns: [[uses, { does: 'says', text: 'It waits for your approval.' }]],
            steps: [{ does: 'says', text: 'Read.' }],
          }
        : SAYS('done'),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          writeFileSync(join(main, '.env'), 'ACME_TOKEN=example\n')
          const chat = yield* created(project.id)
          yield* send(chat.id, 'Read the .env file.')
          yield* until(Effect.map(pendingNeeds, (needs) => needs.length === 1))
          const [need] = yield* pendingNeeds
          if (need === undefined) return yield* Effect.die(new Error('no need'))
          yield* settledChat(chat.id)
          const waiting = yield* transcriptOf(chat.id, null)
          yield* answerNeed({
            id: need.id,
            key: 'allow',
            answer: PermissionAnswer.make({ choice: 'allow-once' }),
          })
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 2))
          return {
            need,
            projectId: project.id,
            waiting,
            transcript: yield* transcriptOf(chat.id, null),
          }
        }),
      ),
    )
    expect(world.agents[0]?.answers.toolAnswers[0]?.text).toMatch(WAITING)
    expect(seen.need.owner).toMatchObject({ projectId: seen.projectId })
    expect(seen.need.choices).toEqual(['allow-once', 'deny'])
    expect(text(world.agents[0]?.answers.prompts[1] ?? [])).toMatch(/^\[hemera:approval\]/)
    const action = seen.transcript.entries.find((entry) => entry.kind === 'action')
    expect(action).toMatchObject({ outcome: 'held', request: 1 })
    // The card the page draws: what it asks, why, the need it answers, and how it was answered.
    const before = seen.waiting.entries.find((entry) => entry.kind === 'action')
    expect(before?.held).toMatchObject({ needId: seen.need.id, answer: 'waiting' })
    expect(before?.held?.command).toContain('.env')
    expect(action?.held).toMatchObject({ needId: seen.need.id, answer: 'allowed' })
  })

  test('git push, sh -c "git push", npx gh pr create and npm publish always ask, with their reason', async () => {
    const lines = ['git push', 'sh -c "git push"', 'npx gh pr create', 'npm publish']
    const steps: ReadonlyArray<FakeStep> = lines.map((line, at) => ({
      does: 'uses',
      id: `toolu_${String(at)}`,
      tool: 'commands_run',
      arguments: { line },
    }))
    const { world, run } = sessionsEngine(data, () => ({
      steps: [...steps, { does: 'says', text: 'done' }],
    }))
    const reasons = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          yield* send(chat.id, 'Push it.')
          yield* settledChat(chat.id)
          return (yield* pendingNeeds).map((need) =>
            Predicate.isTagged(need.fields, 'Permission') ? need.fields.hemeraReason : '',
          )
        }),
      ),
    )
    const answers = world.agents[0]?.answers.toolAnswers.map((one) => one.text) ?? []
    expect(answers).toHaveLength(4)
    expect(answers.every((answer) => WAITING.test(answer))).toBe(true)
    expect(reasons).toEqual([
      'the Chat always asks before git push',
      'the Chat always asks before git push',
      'the Chat always asks before gh writes to the forge',
      'the Chat always asks before publishing a package (npm)',
    ])
  })
})

describe('The Chat reads missions and creates drafts, and writes into none', () => {
  test('memory_read reads a mission of its Project and refuses another Project’s', async () => {
    const steps = (key: string): FakeStep => ({
      does: 'uses',
      id: `toolu_${key}`,
      tool: 'memory_read',
      arguments: { part: 'now', mission: key },
    })
    // The other Project's mission key is known once it is made, before the agent starts.
    let otherKey = ''
    const { world, run } = sessionsEngine(data, () => ({
      steps: [steps('ACME-1'), steps(otherKey), { does: 'says', text: 'done' }],
    }))
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const other = join(work, 'hemera')
          mkdirSync(other, { recursive: true })
          repository(join(other, 'shared'))
          const hemera = yield* createProject({
            name: 'Hemera',
            mainCheckout: other,
            repositories: ['shared'],
          })
          const elsewhere = yield* createMission({
            projectId: hemera.id,
            idea: { sentence: 'Show the budget', ticket: null },
          })
          otherKey = elsewhere.key
          const chat = yield* created(project.id)
          yield* send(chat.id, 'Where does ACME-1 stand?')
          yield* settledChat(chat.id)
        }),
      ),
    )
    const [own, other] = world.agents[0]?.answers.toolAnswers ?? []
    expect(own?.text).toContain('ACME-1: Building')
    expect(other?.text).toContain(`refused: ${otherKey} is a mission of another Project`)
  })

  test('spec_create_draft creates a mission in Planning with a new key, a Journal line naming the Chat, and the titles like it', async () => {
    const { world, run } = sessionsEngine(data, () => ({
      steps: [
        { does: 'uses', id: 'toolu_list', tool: 'missions_list', arguments: {} },
        {
          does: 'uses',
          id: 'toolu_draft',
          tool: 'spec_create_draft',
          arguments: {
            title: 'Export the invoices as JSON',
            idea: 'The user wants a JSON export beside the CSV one, in api/export.ts.',
          },
        },
        { does: 'says', text: 'Created ACME-2.' },
      ],
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          yield* send(chat.id, 'Make a mission for a JSON export.')
          yield* settledChat(chat.id)
          const missions = yield* listMissions(project.id)
          const draft = missions.find((one) => one.key === 'ACME-2')
          if (draft === undefined) return yield* Effect.die(new Error('no draft'))
          yield* Memory.use((memory) => memory.catchUp)
          const journal = yield* Memory.use((memory) => memory.journal(draft.id, null))
          return { draft, journal, transcript: yield* transcriptOf(chat.id, null) }
        }),
      ),
    )
    const [listed, drafted] = world.agents[0]?.answers.toolAnswers ?? []
    expect(listed?.text).toContain('ACME-1 · Export the invoices as CSV · building')
    expect(seen.draft).toMatchObject({ stage: 'planning', title: 'Export the invoices as JSON' })
    expect(drafted?.text).toContain('Created ACME-2 in Planning')
    expect(drafted?.text).toContain('- ACME-1 · Export the invoices as CSV · building')
    expect(seen.journal.lines.map((line) => line.text)).toContain(
      'Mission started: Export the invoices as JSON (created from the Chat “Make a mission for a JSON export.”)',
    )
    expect(seen.transcript.entries.map((entry) => entry.text)).toContain(
      'Mission ACME-2 created: Export the invoices as JSON',
    )
  })
})

describe('Sessions of a Chat come and go; the conversation stays', () => {
  test('a model change applies from the next turn, on a fresh session handed the end of the conversation', async () => {
    const { world, run } = sessionsEngine(data, (index) =>
      SAYS(index === 0 ? 'First answer.' : 'Second answer.'),
    )
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          yield* send(chat.id, 'First question?')
          yield* settledChat(chat.id)
          yield* Chats.use((chats) =>
            chats.setSetting(chat.id, { agent: 'codex', model: null, effort: null }),
          )
          yield* send(chat.id, 'Second question?')
          yield* settledChat(chat.id)
          return yield* sessionsIn(['idle', 'ended'])
        }),
      ),
    )
    expect(world.agents).toHaveLength(2)
    const opening = text(world.agents[1]?.answers.prompts[0] ?? [])
    expect(opening).toContain('## The conversation so far')
    expect(opening).toContain('The user: First question?\nYou: First answer.')
    expect(opening).toContain(CHAT_CONTINUE)
    expect(opening).toMatch(/\n\nSecond question\?$/)
    expect(opening).not.toContain('The user: Second question?')
    const chats = seen.filter((one) => one.role === 'chat')
    expect(chats.map((one) => [one.provider, one.epoch, one.state])).toEqual([
      ['claude', 0, 'ended'],
      ['codex', 1, 'idle'],
    ])
  })

  test('a Chat session replaced like any session hands its successor the end of the conversation', async () => {
    const { world, run } = sessionsEngine(data, (index) =>
      SAYS(index === 0 ? 'First answer.' : 'Second answer.'),
    )
    await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          yield* send(chat.id, 'First question?')
          yield* settledChat(chat.id)
          const lineage = (yield* getChat(chat.id)).lineage
          const [live] = (yield* sessionsIn(['idle'])).filter((one) => one.lineage === lineage)
          if (live === undefined) return yield* Effect.die(new Error('no live session'))
          yield* until(Effect.map(transcriptOf(chat.id, null), (page) => page.entries.length === 2))
          yield* Sessions.use((sessions) => sessions.replace(live.id, 'its agent stopped'))
          yield* until(Effect.sync(() => (world.agents[1]?.answers.prompts.length ?? 0) === 1))
        }),
      ),
    )
    const opening = text(world.agents[1]?.answers.prompts[0] ?? [])
    expect(opening).toContain('The user: First question?\nYou: First answer.')
    expect(opening).toContain(CHAT_CONTINUE)
    expect(opening).not.toContain('[hemera:resume]')
  })

  test('stopping a turn cancels it and keeps the conversation', async () => {
    const hold = held()
    const { world, run } = sessionsEngine(data, () => ({
      turns: [
        [
          { does: 'says', text: 'Counting…' },
          { does: 'says', text: ' still counting' },
        ],
      ],
      steps: [{ does: 'says', text: 'done' }],
      between: () => hold.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          yield* send(chat.id, 'Count to a million.')
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          yield* Chats.use((chats) => chats.stop(chat.id))
          yield* until(Effect.sync(() => (world.agents[0]?.answers.cancels ?? 0) === 1))
          hold.release()
          yield* settledChat(chat.id)
          return yield* transcriptOf(chat.id, null)
        }),
      ),
    )
    expect(world.agents[0]?.answers.cancels).toBe(1)
    expect(seen.entries[0]).toMatchObject({ kind: 'user', text: 'Count to a million.' })
    expect(seen.entries.filter((entry) => entry.kind === 'notice')).toMatchObject([
      { text: CHAT_STOPPED },
    ])
  })

  test('a Stop and a message at once: the turn stopped is said before the message that follows', async () => {
    const hold = held()
    const { world, run } = sessionsEngine(data, () => ({
      turns: [[{ does: 'says', text: 'Counting…' }]],
      steps: [{ does: 'says', text: 'done' }],
      between: () => hold.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          yield* send(chat.id, 'Count to a million.')
          yield* until(Effect.sync(() => (world.agents[0]?.answers.prompts.length ?? 0) === 1))
          yield* Effect.all(
            [Chats.use((chats) => chats.stop(chat.id)), send(chat.id, 'Count to ten instead.')],
            { concurrency: 'unbounded' },
          )
          hold.release()
          yield* settledChat(chat.id)
          return yield* transcriptOf(chat.id, null)
        }),
      ),
    )
    expect(
      seen.entries
        .filter((entry) => entry.kind !== 'agent')
        .map((entry) => (entry.kind === 'notice' ? entry.text : entry.kind)),
    ).toEqual(['user', CHAT_STOPPED, 'user'])
  })

  test('after a restart a Chat whose turn ran says it was interrupted, and nothing resumes on its own', async () => {
    const hold = held()
    const first = sessionsEngine(data, () => ({ ...SAYS('done'), between: () => hold.promise }))
    const chatId = await first.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          yield* send(chat.id, 'Count to a million.')
          yield* until(
            Effect.sync(() => (first.world.agents[0]?.answers.prompts.length ?? 0) === 1),
          )
          return chat.id
        }),
      ),
    )
    hold.release()
    const second = sessionsEngine(data, () => SAYS('done'))
    const seen = await second.run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          yield* until(
            Effect.map(transcriptOf(chatId, null), (page) =>
              page.entries.some((entry) => entry.text === CHAT_INTERRUPTED),
            ),
          )
          // The rebuild ends the Chat's session rather than starting a successor: once it has,
          // nothing will start it again.
          yield* until(
            Effect.map(sessionsIn(['ended']), (ended) =>
              ended.some((one) => one.role === 'chat' && one.stateReason === 'Hemera restarted'),
            ),
          )
          return yield* sessionsIn(['starting', 'working', 'idle'])
        }),
      ),
    )
    expect(seen.filter((one) => one.role === 'chat')).toEqual([])
    expect(second.world.agents).toHaveLength(0)
  })
})

describe('A Chat whose model changes while its session still starts', () => {
  test('a replacement and a send with another model leave exactly one live session on the lineage', async () => {
    const release = held()
    let holdingProjection = true
    const { world, run } = sessionsEngine(data, () => SAYS('Answered.'), {
      // The Memory is not ready until released: the Chat's first session stays `starting`.
      memory: {
        beforeProjecting: () =>
          holdingProjection ? Effect.promise(() => release.promise) : Effect.void,
      },
    })
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          yield* send(chat.id, 'First question?')
          const lineage = (yield* getChat(chat.id)).lineage
          const [first] = (yield* sessionsIn(['starting'])).filter((one) => one.lineage === lineage)
          if (first === undefined) return yield* Effect.die(new Error('no starting session'))
          // Its agent dies (as a death, a saturation or the sweep replaces it) while the user
          // changes the model and writes again.
          yield* Effect.all(
            [
              Sessions.use((sessions) => sessions.replace(first.id, 'its agent stopped')),
              Chats.use((chats) =>
                chats.setSetting(chat.id, { agent: 'codex', model: null, effort: null }),
              ).pipe(Effect.andThen(send(chat.id, 'Second question?'))),
            ],
            { concurrency: 'unbounded' },
          ).pipe(Effect.provideService(References.MaxOpsBeforeYield, 10))
          holdingProjection = false
          release.release()
          yield* until(
            Effect.map(sessionsIn(['idle']), (idle) => idle.some((one) => one.lineage === lineage)),
          )
          // Whatever else would start has the time to.
          yield* Effect.sleep('300 millis')
          const live = (yield* sessionsIn(['starting', 'working', 'idle', 'stuck'])).filter(
            (one) => one.lineage === lineage,
          )
          return { live }
        }),
      ),
    )
    expect(seen.live.map((one) => one.provider)).toEqual(['codex'])
    expect(world.agents).toHaveLength(1)
  })
})

describe('A Chat written to twice at once', () => {
  test('opens one session, which gets both messages', async () => {
    const { run } = sessionsEngine(data, () => SAYS('Both read.'))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          // Every step yields, so the two sends interleave as two calls from the window may.
          yield* Effect.all(
            [
              send(chat.id, 'Where are the invoices exported?'),
              send(chat.id, 'And which tests cover it?'),
            ],
            { concurrency: 'unbounded' },
          ).pipe(Effect.provideService(References.MaxOpsBeforeYield, 10))
          yield* settledChat(chat.id)
          const sessions = (yield* sessionsIn(['starting', 'working', 'idle', 'ended'])).filter(
            (one) => one.role === 'chat',
          )
          return { sessions, lineage: (yield* getChat(chat.id)).lineage }
        }),
      ),
    )
    expect(seen.sessions).toHaveLength(1)
    expect(seen.sessions[0]?.lineage).toBe(seen.lineage)
  })
})

describe('A call folded in the transcript', () => {
  test('is held only when the gate held it: a file that names a request is a read like any other', async () => {
    const uses: FakeStep = {
      does: 'uses',
      id: 'toolu_notes',
      tool: 'fs_read',
      arguments: { path: 'NOTES.md' },
    }
    const { run } = sessionsEngine(data, () => ({
      turns: [[uses, { does: 'says', text: 'Read.' }]],
      steps: [{ does: 'says', text: 'done' }],
    }))
    const transcript = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project, main } = yield* acme
          writeFileSync(
            join(main, 'NOTES.md'),
            'The export waits for request #7 of the api team.\n',
          )
          const chat = yield* created(project.id)
          yield* send(chat.id, 'Read NOTES.md.')
          yield* settledChat(chat.id)
          yield* until(
            Effect.map(transcriptOf(chat.id, null), (read) =>
              read.entries.some((entry) => entry.kind === 'action'),
            ),
          )
          return yield* transcriptOf(chat.id, null)
        }),
      ),
    )
    const action = transcript.entries.find((entry) => entry.kind === 'action')
    expect(action).toMatchObject({ outcome: 'completed', request: null })
  })
})

describe('A Chat’s turn, as its page follows it', () => {
  test('the Chat says whether its agent is in a turn, and its turn’s start and end are changes', async () => {
    const hold = held()
    const { run } = sessionsEngine(data, () => ({
      turns: [[{ does: 'thinks', text: 'Reading the export.' }]],
      steps: [{ does: 'says', text: 'done' }],
      between: () => hold.promise,
    }))
    const seen = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          const working = Effect.flatMap(getChat(chat.id), (now) =>
            Chats.use((chats) => chats.working(now)),
          )
          const turns = yield* Chats.use((chats) => chats.turns)
          const changed: string[] = []
          yield* Stream.runForEach(turns, (change) =>
            Effect.sync(() => changed.push(change.chatId)),
          ).pipe(Effect.forkScoped)
          yield* send(chat.id, 'Where are the invoices exported?')
          yield* until(working)
          yield* until(Effect.sync(() => changed.length === 1))
          const during = yield* working
          hold.release()
          yield* until(Effect.map(working, (now) => !now))
          yield* until(Effect.sync(() => changed.length === 2))
          return { during, changed }
        }).pipe(Effect.scoped),
      ),
    )
    expect(seen.during).toBe(true)
    expect(seen.changed).toHaveLength(2)
  })
})

describe('A Chat’s turn read again as soon as it changes', () => {
  test('a read on the turn’s end finds it ended, so Stop never stays after it', async () => {
    const hold = held()
    const { run } = sessionsEngine(data, () => ({
      turns: [[{ does: 'thinks', text: 'Reading the export.' }]],
      steps: [{ does: 'says', text: 'done' }],
      between: () => hold.promise,
    }))
    const reads = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          const turns = yield* Chats.use((chats) => chats.turns)
          const read: boolean[] = []
          // As the page does: each change of the Chat, its summary read again at once.
          yield* Stream.runForEach(turns, () =>
            Effect.flatMap(getChat(chat.id), (now) =>
              Effect.map(
                Chats.use((chats) => chats.working(now)),
                (working) => void read.push(working),
              ),
            ),
          ).pipe(Effect.forkScoped)
          yield* send(chat.id, 'Where are the invoices exported?')
          yield* until(Effect.sync(() => read.length === 1))
          hold.release()
          yield* until(Effect.sync(() => read.length === 2))
          return read
        }).pipe(Effect.scoped),
      ),
    )
    expect(reads).toEqual([true, false])
  })
})

describe('A Chat whose agent cannot start', () => {
  test('says why in its conversation, after the message that asked for it', async () => {
    const { run } = sessionsEngine(data, () => SAYS('never said'), {
      sessions: { discovery: agentsFound(['claude']) },
    })
    const entries = await run(({ profile }) =>
      within(
        profile,
        Effect.gen(function* () {
          const { project } = yield* acme
          const chat = yield* created(project.id)
          yield* send(chat.id, 'Where are the invoices exported?')
          yield* until(
            Effect.map(transcriptOf(chat.id, null), (page) =>
              page.entries.some((entry) => entry.kind === 'notice'),
            ),
          )
          return (yield* transcriptOf(chat.id, null)).entries
        }),
      ),
    )
    expect(entries.map((entry) => entry.kind)).toEqual(['user', 'notice'])
    expect(entries[1]?.text).toContain('not signed in')
  })
})
