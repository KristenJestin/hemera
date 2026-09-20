/**
 * What the window holds about the Sessions of a Project and the thread of one (design D4b-02).
 *
 * The bridge is replaced by one that answers from a script, because what is under test is the
 * store and not the channel: which use case it asks, what it does with an answer, and what it
 * does with a refusal. The channels themselves are tested where they are declared, and the use
 * cases in `sessions.test.ts`.
 *
 * A message is the one thing here with a moment of its own — sent, not yet kept — so the
 * bridge holds every `sessions.append` until the test answers it. That is what makes the
 * suites below read as the scenarios they are named after: nothing is in the thread while the
 * engine has not answered, and the second message of a burst is not even asked for while the
 * first is in flight.
 *
 * Each suite is named after the scenario of the spec « sessions » of HEM-57 it covers.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { Session, SessionEntry } from '@hemera/ipc'
import {
  NO_ACTIVE_PROJECT,
  archiveSession,
  closeSessions,
  createSession,
  loadSessions,
  openSession,
  renameSession,
  restoreSession,
  retryMessage,
  sendMessage,
  sessionsSnapshot,
} from '#renderer/sessions-store.ts'

/** One Session, as the engine answers with one. */
function session(id: string, title: string, version = 1): Session {
  return {
    id,
    projectId: 'atlas',
    title,
    titleSource: 'derived',
    archivedAt: null,
    createdAt: 0,
    lastWrittenAt: 0,
    version,
  }
}

/** One message of a thread, as the engine wrote it down. */
function entry(sessionId: string, seq: number, body: string): SessionEntry {
  return { id: `${sessionId}-${String(seq)}`, sessionId, seq, role: 'user', body, createdAt: seq }
}

/** What was asked of the bridge, in the order it was asked. */
let asked: { name: string; argument: unknown }[] = []

/** What the bridge answers, per channel: a value, or something to throw. */
let answers: Map<string, unknown>

/** The appends in flight, each waiting for the test to say what the engine answered. */
let writing: {
  body: string
  keep: (kept: { session: Session; entry: SessionEntry }) => void
  refuse: (refusal: Error) => void
}[] = []

/** Lets everything that was already resolved run, which is what a turn of the loop is. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Which answer a call reads, which is not always the name of the channel.
 *
 * The open Sessions and the archived ones are one use case asked twice, and a suite about
 * archiving has to be able to answer the two differently.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- what the bridge was called with, which this reads one declared field of
function keyOf(name: string, argument: unknown): string {
  // SAFETY: every argument of this bridge is an object built by the store, and the only field
  // read here is the one `sessions.list` declares; anything else answers `undefined`.
  const archived = (argument as { archived?: boolean }).archived === true
  return name === 'sessions.list' && archived ? 'sessions.list:archived' : name
}

beforeEach(() => {
  asked = []
  writing = []
  answers = new Map()
  answers.set('sessions.list:archived', [])
  // The one place a test reaches into the page: the preload is not there, so the bridge is.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      hemera: {
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- stands in for the preload's bridge, whose job is to carry an argument it never reads
        invoke: async (name: string, argument: unknown) => {
          asked.push({ name, argument })
          if (name === 'sessions.append') {
            // SAFETY: the store builds this argument from the channel's own declaration, where
            // `body` is a string; nothing else reaches this bridge.
            const body = (argument as { body: string }).body
            return await new Promise((keep, refuse) => {
              writing.push({ body, keep, refuse })
            })
          }
          const answer = answers.get(keyOf(name, argument))
          if (answer instanceof Error) throw answer
          return await Promise.resolve(answer)
        },
      },
    },
  })
})

afterEach(() => {
  closeSessions()
})

/** A Project with one Session in it, opened, which is where a thread starts. */
async function opened(id = 'first', title = 'New session'): Promise<void> {
  answers.set('sessions.list', [session(id, title)])
  answers.set('sessions.read', { entries: [], nextAfter: null })
  await loadSessions('atlas')
  await openSession(id)
}

describe('Message enregistré', () => {
  test('nothing is in the thread until the engine says it is', async () => {
    await opened()

    sendMessage('the first thing I wrote')
    await settled()

    // On its way, and said to be: the thread holds no entry yet.
    expect(sessionsSnapshot().entries).toEqual([])
    expect(sessionsSnapshot().pending.map((one) => one.state)).toEqual(['saving'])

    writing[0]!.keep({
      session: session('first', 'the first thing I wrote', 2),
      entry: entry('first', 1, 'the first thing I wrote'),
    })
    await settled()

    expect(sessionsSnapshot().entries.map((one) => one.body)).toEqual(['the first thing I wrote'])
    expect(sessionsSnapshot().pending).toEqual([])
  })

  test('the message the engine wrote is the one the thread shows', async () => {
    await opened()
    sendMessage('written')
    await settled()

    expect(asked.at(-1)).toEqual({
      name: 'sessions.append',
      argument: { id: 'first', body: 'written' },
    })

    // Answered before the suite ends: the writes of a Session are a chain, and one left in
    // flight is one the next message of that Session would queue behind for ever.
    writing[0]!.keep({
      session: session('first', 'written', 2),
      entry: entry('first', 1, 'written'),
    })
    await settled()
  })
})

describe('Ordre des messages', () => {
  test('a burst is written one message at a time, in the order it was typed', async () => {
    await opened()

    sendMessage('one')
    sendMessage('two')
    sendMessage('three')
    await settled()

    // One in flight and no more: the place a message takes is read inside the transaction that
    // writes it, so two at once would be two readers of the same number.
    expect(writing.map((one) => one.body)).toEqual(['one'])

    writing[0]!.keep({ session: session('first', 'one', 2), entry: entry('first', 1, 'one') })
    await settled()
    expect(writing.map((one) => one.body)).toEqual(['one', 'two'])

    writing[1]!.keep({ session: session('first', 'one', 3), entry: entry('first', 2, 'two') })
    await settled()
    writing[2]!.keep({ session: session('first', 'one', 4), entry: entry('first', 3, 'three') })
    await settled()

    expect(sessionsSnapshot().entries.map((one) => one.body)).toEqual(['one', 'two', 'three'])
    expect(sessionsSnapshot().pending).toEqual([])
  })
})

describe('Échec d’enregistrement', () => {
  test('a refused message stays in the thread, unsaved, with its text and a way back', async () => {
    await opened()

    sendMessage('what the disk would not take')
    await settled()
    writing[0]!.refuse(new Error('the Profile could not be written to'))
    await settled()

    const [refused] = sessionsSnapshot().pending
    expect(refused?.state).toBe('failed')
    expect(refused?.reason).toBe('the Profile could not be written to')
    expect(refused?.body).toBe('what the disk would not take')
    // And nothing of it is in the thread: it was not kept, and it does not say it was.
    expect(sessionsSnapshot().entries).toEqual([])
  })

  test('retrying writes the same text again, and it becomes an entry', async () => {
    await opened()
    sendMessage('again')
    await settled()
    writing[0]!.refuse(new Error('the Profile could not be written to'))
    await settled()

    retryMessage(sessionsSnapshot().pending[0]!.key)
    await settled()
    expect(sessionsSnapshot().pending[0]?.state).toBe('saving')

    writing[1]!.keep({ session: session('first', 'again', 2), entry: entry('first', 1, 'again') })
    await settled()

    expect(sessionsSnapshot().entries.map((one) => one.body)).toEqual(['again'])
    expect(sessionsSnapshot().pending).toEqual([])
  })
})

describe('Brouillon non envoyé', () => {
  test('text nobody sent is neither a message nor a question asked of the engine', async () => {
    await opened()
    const before = asked.length

    sendMessage('   ')
    await settled()

    expect(asked).toHaveLength(before)
    expect(sessionsSnapshot().pending).toEqual([])
    expect(sessionsSnapshot().entries).toEqual([])
  })
})

describe('Titre dérivé du premier message', () => {
  test('the Session is created with the message, and wears the title the engine derived', async () => {
    answers.set('sessions.create', session('first', 'Draw the rest of the owl'))
    answers.set('sessions.list', [session('first', 'Draw the rest of the owl')])

    const made = await createSession('atlas', 'Draw the rest of the owl\nand the rest of it too')

    expect(made?.title).toBe('Draw the rest of the owl')
    expect(asked[0]).toEqual({
      name: 'sessions.create',
      argument: {
        projectId: 'atlas',
        firstMessage: 'Draw the rest of the owl\nand the rest of it too',
      },
    })
    // One use case and not two: the Session and its first message commit together.
    expect(asked.filter((one) => one.name === 'sessions.append')).toEqual([])
    expect(sessionsSnapshot().sessions[0]?.title).toBe('Draw the rest of the owl')
  })
})

describe('Renommage conservé', () => {
  test('a rename carries the version it was read at, and the list is read again', async () => {
    answers.set('sessions.list', [session('first', 'New session', 3)])
    await loadSessions('atlas')

    answers.set('sessions.rename', session('first', 'The one I named', 4))
    answers.set('sessions.list', [session('first', 'The one I named', 4)])
    expect(await renameSession('first', 'The one I named')).toBe(true)

    expect(asked.at(-3)).toEqual({
      name: 'sessions.rename',
      argument: { id: 'first', version: 3, title: 'The one I named' },
    })
    expect(sessionsSnapshot().sessions[0]?.title).toBe('The one I named')
  })

  test('a later message does not put a proposal back over it', async () => {
    answers.set('sessions.list', [{ ...session('first', 'The one I named'), titleSource: 'user' }])
    answers.set('sessions.read', { entries: [], nextAfter: null })
    await loadSessions('atlas')
    await openSession('first')

    sendMessage('something else entirely')
    await settled()
    writing[0]!.keep({
      // The engine answers with the Session it wrote, title and all: the store shows that and
      // never a title of its own making (design D4b-03).
      session: { ...session('first', 'The one I named', 2), titleSource: 'user' },
      entry: entry('first', 1, 'something else entirely'),
    })
    await settled()

    expect(sessionsSnapshot().sessions[0]?.title).toBe('The one I named')
  })
})

describe('Session archivée puis restaurée', () => {
  test('it leaves the list whole, and comes back to it', async () => {
    answers.set('sessions.list', [session('first', 'Put away')])
    await loadSessions('atlas')

    answers.set('sessions.archive', { ...session('first', 'Put away', 2), archivedAt: 1 })
    // Out of one list and into the other, which is the whole of what archiving is (D4b-06).
    answers.set('sessions.list', [])
    answers.set('sessions.list:archived', [{ ...session('first', 'Put away', 2), archivedAt: 1 }])
    await archiveSession('first')

    expect(asked.at(-3)).toEqual({
      name: 'sessions.archive',
      argument: { id: 'first', version: 1 },
    })
    expect(sessionsSnapshot().sessions).toEqual([])
    expect(sessionsSnapshot().archived.map((one) => one.title)).toEqual(['Put away'])

    answers.set('sessions.restore', session('first', 'Put away', 3))
    answers.set('sessions.list', [session('first', 'Put away', 3)])
    answers.set('sessions.list:archived', [])
    expect(await restoreSession('first')).toBe(true)
    expect(sessionsSnapshot().sessions.map((one) => one.title)).toEqual(['Put away'])
  })
})

describe('Aucun Projet actif', () => {
  test('creating a Session without a Project is refused in words, and nothing is created', async () => {
    const made = await createSession(null)

    expect(made).toBeNull()
    expect(sessionsSnapshot().refusal).toBe(NO_ACTIVE_PROJECT)
    // Nothing was asked of the engine at all: no Session, and no Project made to hold one.
    expect(asked).toEqual([])
  })
})
