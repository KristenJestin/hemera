/**
 * What the window holds about the Spec a `define` Session writes (design D7-05, D7-07, D7-10,
 * D7-11, D7-12).
 *
 * The bridge is replaced by one that answers from a script and pushes what the engine would push,
 * because what is under test is the store: which use case it asks, what it keeps of an answer,
 * and what it does with a refusal. The use cases themselves are tested in the engine.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { EditBuffer, EngineEvent, SpecSnapshot } from '@hemera/ipc'
import {
  answerQuestion,
  closeSpec,
  createSpec,
  discardMine,
  forgetSpecRefusal,
  listenToSpecs,
  markReady,
  openSpec,
  rework,
  saveSection,
  saveStory,
  selectRevision,
  specSnapshot,
  takeOver,
} from '#renderer/spec-store.ts'

/** A Spec whose `scope` is at `version`, the Session that writes it, and the revision shown. */
function snapshot(version: number, writer = 'writer', number = 1): SpecSnapshot {
  return {
    spec: {
      id: 'spec-7',
      projectId: 'atlas',
      key: 'ATL-7',
      slug: 'csv-invoice-export',
      status: 'draft',
      priority: null,
      workspaceId: null,
      currentRevisionId: 'rev-1',
      writerSessionId: writer,
      contentVersion: version,
      createdAt: 0,
      updatedAt: 0,
    },
    revision: {
      id: `rev-${String(number)}`,
      specId: 'spec-7',
      number,
      title: 'CSV invoice export',
      type: 'feature',
      changeSummary: null,
      changeReason: null,
      createdBy: 'human',
      attestedContentVersion: null,
      createdAt: 0,
    },
    sections: [
      {
        id: 'scope',
        revisionId: `rev-${String(number)}`,
        name: 'scope',
        body: `Agent scope, v${String(version)}.`,
        version,
        author: 'agent',
        sessionId: 'writer',
        updatedAt: 0,
      },
    ],
    stories: [],
    criteria: [],
    tasks: [],
    dependencies: [],
    taskStories: [],
    questions: [],
    phases: [],
  }
}

function buffer(body: string, baseVersion: number): EditBuffer {
  return { specId: 'spec-7', name: 'scope', body, baseVersion, updatedAt: 0 }
}

/** What was asked of the bridge, in the order it was asked. */
let asked: { name: string; argument: { revision?: number } }[] = []

/** What the bridge answers, per channel: a value, or an error to throw. */
let answers: Map<string, SpecSnapshot | EditBuffer[] | Error | object>

/** While set, a `specs.read` answers what it was asked for only once this settles. */
let holding: Promise<void> | null = null

/** What the engine would push; set once the store listens. */
let push: (event: EngineEvent) => void = () => undefined

/** The Projects the store said changed, in order. */
let told: string[] = []

let stop: () => void = () => undefined

/** The answers of an open Spec whose `scope` is at `version`, with the buffers kept. */
function reads(version: number, buffers: EditBuffer[] = [], writer = 'writer'): void {
  answers.set('specs.read', snapshot(version, writer))
  answers.set('specs.revisions', [snapshot(version).revision])
  answers.set('specs.buffers.read', buffers)
  answers.set('journal.read', { entries: [], nextBefore: null })
}

const names = (): string[] => asked.map((one) => one.name)

const argumentOf = (name: string) => asked.find((one) => one.name === name)?.argument

/** Lets a read started by a pushed event come back. */
async function settled(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

beforeEach(() => {
  asked = []
  told = []
  holding = null
  answers = new Map()
  // The one place a test reaches into the page: the preload is not there, so the bridge is.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      hemera: {
        invoke: async (name: string, argument: { revision?: number }) => {
          asked.push({ name, argument })
          // An older revision is answered under its own name, so a script can hold both.
          const answer =
            argument.revision === undefined
              ? answers.get(name)
              : answers.get(`${name}@${String(argument.revision)}`)
          if (holding !== null && name === 'specs.read') await holding
          if (answer instanceof Error) throw answer
          return await Promise.resolve(answer)
        },
        on: (listener: (event: EngineEvent) => void) => {
          push = listener
          return () => undefined
        },
      },
    },
  })
  stop = listenToSpecs((projectId) => told.push(projectId))
})

afterEach(() => {
  stop()
  closeSpec()
})

describe('A Spec is opened with everything the panel draws', () => {
  test('its revision, its revisions, its buffers and its Journal', async () => {
    reads(2)

    await openSpec('spec-7')

    expect(names().toSorted()).toEqual([
      'journal.read',
      'specs.buffers.read',
      'specs.read',
      'specs.revisions',
    ])
    expect(argumentOf('journal.read')).toEqual({ projectId: 'atlas', specId: 'spec-7', limit: 200 })
    expect(specSnapshot().snapshot?.spec.key).toBe('ATL-7')
    expect(specSnapshot().snapshot?.spec.contentVersion).toBe(2)
  })
})

describe('A human edit is recorded and reaches the agent', () => {
  test('a save is sent from its Session with the version it is handed', async () => {
    reads(2)
    await openSpec('spec-7')
    answers.set('specs.writeSection', snapshot(3))
    asked = []

    expect(await saveSection('writer', 'scope', 'My scope.', 2)).toBe(true)

    expect(asked[0]).toEqual({
      name: 'specs.writeSection',
      argument: {
        specId: 'spec-7',
        sessionId: 'writer',
        name: 'scope',
        body: 'My scope.',
        baseVersion: 2,
      },
    })
    expect(names()).toContain('specs.read')
    expect(specSnapshot().refusal).toBeNull()
  })
})

describe('A conflict keeps the human’s text', () => {
  test('a save refused on a section that moved keeps the text in a buffer', async () => {
    reads(2)
    await openSpec('spec-7')
    answers.set(
      'specs.writeSection',
      new Error('the scope section changed since version 1: it is at version 2'),
    )
    answers.set('specs.buffers.save', [buffer('My scope.', 1)])
    reads(2, [buffer('My scope.', 1)])
    asked = []

    expect(await saveSection('writer', 'scope', 'My scope.', 1)).toBe(false)

    expect(names().slice(0, 3)).toEqual(['specs.writeSection', 'specs.read', 'specs.buffers.save'])
    expect(argumentOf('specs.buffers.save')).toEqual({
      specId: 'spec-7',
      name: 'scope',
      body: 'My scope.',
      baseVersion: 1,
    })
    expect(specSnapshot().buffers).toEqual([buffer('My scope.', 1)])
    expect(specSnapshot().refusal).toBeNull()
  })

  test('a kept text is read again when the Spec is opened after a relaunch', async () => {
    reads(2, [buffer('My scope.', 1)])

    await openSpec('spec-7')

    expect(specSnapshot().buffers[0]?.body).toBe('My scope.')
  })

  test('applying mine saves it on the version the conflict names as current', async () => {
    reads(2, [buffer('My scope.', 1)])
    await openSpec('spec-7')
    answers.set('specs.writeSection', snapshot(3))
    reads(3)
    asked = []

    expect(await saveSection('writer', 'scope', 'My scope, again.', 2)).toBe(true)

    expect(argumentOf('specs.writeSection')).toEqual({
      specId: 'spec-7',
      sessionId: 'writer',
      name: 'scope',
      body: 'My scope, again.',
      baseVersion: 2,
    })
    expect(specSnapshot().buffers).toEqual([])
  })

  test('discarding lets the kept text go, and the Spec is read again', async () => {
    reads(2, [buffer('My scope.', 1)])
    await openSpec('spec-7')
    answers.set('specs.buffers.discard', [])
    reads(2)
    asked = []

    expect(await discardMine('scope')).toBe(true)

    expect(asked[0]).toEqual({
      name: 'specs.buffers.discard',
      argument: { specId: 'spec-7', name: 'scope' },
    })
    expect(specSnapshot().buffers).toEqual([])
  })

  test('any other refusal of a save is said, and no buffer is written', async () => {
    reads(2)
    await openSpec('spec-7')
    answers.set('specs.writeSection', new Error('ATL-7 is ready: only a draft is written'))
    asked = []

    expect(await saveSection('writer', 'scope', 'My scope.', 2)).toBe(false)

    expect(names()).not.toContain('specs.buffers.save')
    expect(specSnapshot().refusal).toBe('ATL-7 is ready: only a draft is written')
  })
})

describe('An obsolete request is refused', () => {
  test('Mark ready sends the revision and the content version of the snapshot on screen', async () => {
    reads(4)
    await openSpec('spec-7')
    answers.set('specs.markReady', snapshot(4))

    expect(await markReady()).toBe(true)

    expect(argumentOf('specs.markReady')).toEqual({
      specId: 'spec-7',
      expectedRevisionId: 'rev-1',
      expectedContentVersion: 4,
    })
  })

  test('a refused click keeps the refusal and reads the Spec again', async () => {
    reads(4)
    await openSpec('spec-7')
    answers.set(
      'specs.markReady',
      new Error('ATL-7 changed since its gate was shown: read the gate again.'),
    )
    reads(5)
    asked = []

    expect(await markReady()).toBe(false)

    expect(names()).toContain('specs.read')
    expect(specSnapshot().snapshot?.spec.contentVersion).toBe(5)
    expect(specSnapshot().refusal).toBe(
      'ATL-7 changed since its gate was shown: read the gate again.',
    )
  })
})

describe('Rework creates a complete new draft', () => {
  test('the reason given is sent with the revision the Spec was frozen on', async () => {
    reads(4)
    await openSpec('spec-7')
    answers.set('specs.reopen', snapshot(4))

    await rework('  Credit notes keep their number.  ')

    expect(argumentOf('specs.reopen')).toEqual({
      specId: 'spec-7',
      expectedRevisionId: 'rev-1',
      reason: 'Credit notes keep their number.',
    })
  })

  test('an empty reason is sent as none', async () => {
    reads(4)
    await openSpec('spec-7')
    answers.set('specs.reopen', snapshot(4))

    await rework('   ')

    expect(argumentOf('specs.reopen')).toEqual({
      specId: 'spec-7',
      expectedRevisionId: 'rev-1',
      reason: undefined,
    })
  })
})

describe('A second Session reads but does not write', () => {
  test('Take over moves the write right to this Session, as the engine answers', async () => {
    reads(2)
    await openSpec('spec-7')
    answers.set('specs.transferWrite', snapshot(2, 'reader'))
    reads(2, [], 'reader')
    asked = []

    expect(await takeOver('reader')).toBe(true)

    expect(asked[0]).toEqual({
      name: 'specs.transferWrite',
      argument: { specId: 'spec-7', sessionId: 'reader' },
    })
    expect(specSnapshot().snapshot?.spec.writerSessionId).toBe('reader')
  })

  test('a write by another Session is read live, and its Project told', async () => {
    reads(2)
    await openSpec('spec-7')
    reads(3)

    push({ event: 'spec.changed', specId: 'spec-7', projectId: 'atlas' })
    await settled()

    expect(specSnapshot().snapshot?.sections[0]?.version).toBe(3)
    expect(told).toEqual(['atlas'])
  })

  test('a change to another Spec is not read, and its Project is told all the same', async () => {
    reads(2)
    await openSpec('spec-7')
    asked = []

    push({ event: 'spec.changed', specId: 'spec-8', projectId: 'atlas' })
    await settled()

    expect(asked).toEqual([])
    expect(told).toEqual(['atlas'])
  })
})

describe('An old revision is readable and not editable', () => {
  test('picking revision 1 reads it by number, and the current one alongside', async () => {
    reads(2)
    await openSpec('spec-7')
    const current = snapshot(2, 'writer', 2)
    answers.set('specs.read', { ...current, spec: { ...current.spec, currentRevisionId: 'rev-2' } })
    answers.set('specs.read@1', snapshot(1))
    asked = []

    await selectRevision(1)

    expect(asked.filter((one) => one.name === 'specs.read').map((one) => one.argument)).toEqual([
      { specId: 'spec-7' },
      { specId: 'spec-7', revision: 1 },
    ])
    expect(specSnapshot().revision).toBe(1)
    expect(specSnapshot().snapshot?.revision.number).toBe(1)
  })
})

describe('A question is answered in the chat', () => {
  test('an option picked is sent as the answer to that question of the open Spec', async () => {
    reads(2)
    await openSpec('spec-7')
    answers.set('specs.answerQuestion', snapshot(2))

    expect(await answerQuestion('q-date', { optionId: 'issue' })).toBe(true)

    expect(argumentOf('specs.answerQuestion')).toEqual({
      specId: 'spec-7',
      questionId: 'q-date',
      optionId: 'issue',
      text: undefined,
    })
  })
})

describe('Accepting the proposal creates the Spec', () => {
  test('the Spec is created from the Session and opened beside it', async () => {
    answers.set('specs.create', { session: {}, snapshot: snapshot(0) })
    reads(0)

    expect(await createSpec('writer', 'feature', 'CSV invoice export')).toBe(true)

    expect(asked[0]).toEqual({
      name: 'specs.create',
      argument: { sessionId: 'writer', type: 'feature', title: 'CSV invoice export' },
    })
    expect(specSnapshot().snapshot?.spec.key).toBe('ATL-7')
  })
})

describe('A refusal stays with the Session it was made in', () => {
  test('a proposal refused is said, and forgotten when the window opens another Session', async () => {
    answers.set('specs.create', new Error('The Session "Invoices" already defines a Spec.'))

    expect(await createSpec('writer', 'feature', 'CSV invoice export')).toBe(false)
    expect(specSnapshot().refusal).toBe('The Session "Invoices" already defines a Spec.')

    forgetSpecRefusal()

    expect(specSnapshot().refusal).toBeNull()
  })
})

describe('A story is written back onto the story it was edited in', () => {
  const stories = (ids: string[]): SpecSnapshot => ({
    ...snapshot(2),
    stories: ids.map((id, at) => ({
      id,
      revisionId: 'rev-1',
      title: id,
      narrative: `The ${id} story.`,
      priority: null,
      rank: String(at),
    })),
  })
  const edited = { key: 'S2', title: 'credit', narrative: 'Mine.', criteria: [] }

  test('a story edited in the list it was opened on is written, the others as they were', async () => {
    reads(2)
    answers.set('specs.read', stories(['export', 'credit']))
    await openSpec('spec-7')
    answers.set('specs.writeStories', stories(['export', 'credit']))

    expect(await saveStory('writer', edited, ['export', 'credit'])).toBe(true)

    expect(argumentOf('specs.writeStories')).toEqual({
      specId: 'spec-7',
      sessionId: 'writer',
      stories: [
        {
          id: 'export',
          title: 'export',
          narrative: 'The export story.',
          priority: null,
          criteria: [],
        },
        { id: 'credit', title: 'credit', narrative: 'Mine.', priority: null, criteria: [] },
      ],
    })
  })

  test('a story edited while the list moved is not written over another', async () => {
    reads(2)
    answers.set('specs.read', stories(['export', 'refund', 'credit']))
    await openSpec('spec-7')
    asked = []

    expect(await saveStory('writer', edited, ['export', 'credit'])).toBe(false)

    expect(names()).not.toContain('specs.writeStories')
    expect(names()).toContain('specs.read')
    expect(specSnapshot().refusal).toContain('your edit was not saved')
  })
})

describe('An older read of the Spec never replaces a newer one', () => {
  test('a read answered after a later one is dropped', async () => {
    reads(2)
    await openSpec('spec-7')
    let release: () => void = () => undefined
    holding = new Promise((resolve) => {
      release = resolve
    })
    reads(3)
    push({ event: 'spec.changed', specId: 'spec-7', projectId: 'atlas' })
    holding = null
    reads(4)
    push({ event: 'spec.changed', specId: 'spec-7', projectId: 'atlas' })
    await settled()
    expect(specSnapshot().snapshot?.spec.contentVersion).toBe(4)

    release()
    await settled()

    expect(specSnapshot().snapshot?.spec.contentVersion).toBe(4)
  })
})
