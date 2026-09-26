/**
 * What the window holds about the Spec a `define` Session writes (design D7-05, D7-07, D7-10,
 * D7-11, D7-12).
 *
 * The bridge is replaced by one that answers from a script and pushes what the engine would push,
 * because what is under test is the store: which use case it asks, what it keeps of an answer,
 * and what it does with a refusal. The use cases themselves are tested in the engine.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { EngineEvent, SpecLaunches, SpecSnapshot } from '@hemera/ipc'
import {
  answerQuestion,
  askForBuild,
  closeSpec,
  createSpec,
  declineSpecProposal,
  forgetSpecRefusal,
  listenToSpecs,
  markReady,
  openSpec,
  rework,
  retryBuild,
  selectRevision,
  specSnapshot,
  startBuild,
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
    briefedAt: null,
    phases: [],
  }
}

/** What was asked of the bridge, in the order it was asked. */
let asked: { name: string; argument: { revision?: number } }[] = []

/** What the bridge answers, per channel: a value, or an error to throw. */
let answers: Map<string, SpecSnapshot | Error | object>

/** While set, a `specs.read` answers what it was asked for only once this settles. */
let holding: Promise<void> | null = null

/** What the engine would push; set once the store listens. */
let push: (event: EngineEvent) => void = () => undefined

/** The Projects the store said changed, in order. */
let told: string[] = []

let stop: () => void = () => undefined

/**
 * A launch as the engine answers it: the Workspace the Spec is set on, the ones a build may be
 * started in, where the launch stands, and the step its Workspace runs while it waits (D8-12).
 */
function launches(over: Partial<SpecLaunches> = {}): SpecLaunches {
  return {
    launch: null,
    workspace: null,
    workspaces: [
      { id: 'main', name: 'main' },
      { id: 'w-1', name: 'csv-invoice' },
    ],
    step: null,
    ...over,
  }
}

/** The answers of an open Spec whose `scope` is at `version`. */
function reads(version: number, writer = 'writer'): void {
  answers.set('specs.read', snapshot(version, writer))
  answers.set('specs.revisions', [snapshot(version).revision])
  answers.set('journal.read', { entries: [], nextBefore: null })
  answers.set('launches.forSpec', launches())
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
  test('its revision, its revisions and its Journal, and no edit buffer', async () => {
    reads(2)

    await openSpec('spec-7')

    expect(names().toSorted()).toEqual([
      'journal.read',
      'launches.forSpec',
      'specs.read',
      'specs.revisions',
    ])
    expect(argumentOf('journal.read')).toEqual({ projectId: 'atlas', specId: 'spec-7', limit: 200 })
    expect(specSnapshot().snapshot?.spec.key).toBe('ATL-7')
    expect(specSnapshot().snapshot?.spec.contentVersion).toBe(2)
  })
})

describe('An obsolete request is refused', () => {
  test('Mark ready sends the revision and the content version of the snapshot on screen', async () => {
    reads(4)
    await openSpec('spec-7')
    answers.set('specs.markReady', snapshot(4))

    expect(await markReady('writer')).toBe(true)

    expect(argumentOf('specs.markReady')).toEqual({
      specId: 'spec-7',
      expectedRevisionId: 'rev-1',
      expectedContentVersion: 4,
      sessionId: 'writer',
    })
  })

  test('a refused click keeps the refusal for the readiness bar and reads the Spec again', async () => {
    reads(4)
    await openSpec('spec-7')
    answers.set(
      'specs.markReady',
      new Error('ATL-7 changed since its gate was shown: read the gate again.'),
    )
    reads(5)
    asked = []

    expect(await markReady('writer')).toBe(false)

    expect(names()).toContain('specs.read')
    expect(specSnapshot().snapshot?.spec.contentVersion).toBe(5)
    expect(specSnapshot().readyRefused).toBe(
      'ATL-7 changed since its gate was shown: read the gate again.',
    )
    // Said by the bar it was pressed on, and not a second time under the thread.
    expect(specSnapshot().refusal).toBe(null)
  })

  test('the next act that goes through forgets the refused click', async () => {
    reads(4)
    await openSpec('spec-7')
    answers.set('specs.markReady', new Error('ATL-7 changed since its gate was shown.'))
    await markReady('writer')
    answers.set('specs.transferWrite', snapshot(4))

    expect(await takeOver('reader')).toBe(true)

    expect(specSnapshot().readyRefused).toBe(null)
  })
})

describe('Rework creates a complete new draft', () => {
  test('the reason given is sent with the revision the Spec was frozen on', async () => {
    reads(4)
    await openSpec('spec-7')
    answers.set('specs.reopen', snapshot(4))

    await rework('writer', '  Credit notes keep their number.  ')

    expect(argumentOf('specs.reopen')).toEqual({
      specId: 'spec-7',
      expectedRevisionId: 'rev-1',
      reason: 'Credit notes keep their number.',
      sessionId: 'writer',
    })
  })

  test('an empty reason is sent as none', async () => {
    reads(4)
    await openSpec('spec-7')
    answers.set('specs.reopen', snapshot(4))

    await rework('writer', '   ')

    expect(argumentOf('specs.reopen')).toEqual({
      specId: 'spec-7',
      expectedRevisionId: 'rev-1',
      reason: undefined,
      sessionId: 'writer',
    })
  })
})

describe('A second Session reads but does not write', () => {
  test('Take over moves the write right to this Session, as the engine answers', async () => {
    reads(2)
    await openSpec('spec-7')
    answers.set('specs.transferWrite', snapshot(2, 'reader'))
    reads(2, 'reader')
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

describe('Declining the proposal asks the engine', () => {
  test('Not now sends the proposal to the engine, and answers what it was refused with', async () => {
    answers.set('specs.declineProposal', {})

    expect(await declineSpecProposal('writer', '4f1c')).toBeNull()
    expect(asked.at(-1)).toEqual({
      name: 'specs.declineProposal',
      argument: { sessionId: 'writer', proposalId: '4f1c' },
    })

    answers.set('specs.declineProposal', new Error('This proposal was already answered.'))
    expect(await declineSpecProposal('writer', '4f1c')).toBe('This proposal was already answered.')
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

describe('The build of a frozen Spec is read and reached', () => {
  const held = {
    id: 'l-1',
    specId: 'spec-7',
    revisionId: 'rev-1',
    workspaceId: 'w-1',
    state: 'waiting',
    sessionId: null,
    detail: null,
    createdAt: '2026-09-25T09:00:00.000Z',
    updatedAt: '2026-09-25T09:00:00.000Z',
  } as const

  test('its launch, the Workspace it is set on and the ones a build may use are read whole', async () => {
    reads(2)
    answers.set(
      'launches.forSpec',
      launches({
        launch: { ...held },
        workspace: { id: 'w-1', name: 'csv-invoice' },
        step: 'install',
      }),
    )

    await openSpec('spec-7')

    expect(argumentOf('launches.forSpec')).toEqual({ specId: 'spec-7' })
    expect(specSnapshot().launches?.launch?.state).toBe('waiting')
    // The step belongs to the Workspace and is read beside the launch, not inside it (D8-05).
    expect(specSnapshot().launches?.step).toBe('install')
    expect(specSnapshot().launches?.workspace?.name).toBe('csv-invoice')
    expect(specSnapshot().launches?.workspaces.map((one) => one.id)).toEqual(['main', 'w-1'])
  })

  test('a change to the launch of the Spec on screen reads the panel again', async () => {
    reads(2)
    await openSpec('spec-7')
    asked = []

    push({ event: 'launch.changed', specId: 'spec-7', projectId: 'atlas' })
    await settled()

    expect(names()).toContain('launches.forSpec')
    expect(names()).toContain('specs.read')
  })

  test('a change to another Spec leaves this one where it is', async () => {
    reads(2)
    await openSpec('spec-7')
    asked = []

    push({ event: 'launch.changed', specId: 'spec-9', projectId: 'atlas' })
    await settled()

    expect(names()).toEqual([])
  })

  test('a build is asked for in a named Workspace, then the panel is read again', async () => {
    reads(2)
    await openSpec('spec-7')
    asked = []

    expect(await askForBuild('w-1')).toBe(true)

    expect(argumentOf('launches.request')).toEqual({ specId: 'spec-7', workspaceId: 'w-1' })
    expect(names()).toContain('launches.forSpec')
  })

  test('starting the build asks for the Workspace the Spec is set on', async () => {
    reads(2)
    await openSpec('spec-7')
    asked = []

    expect(await startBuild()).toBe(true)

    expect(argumentOf('launches.start')).toEqual({ specId: 'spec-7' })
  })

  test('retrying starts the launch that is on screen again', async () => {
    reads(2)
    answers.set('launches.forSpec', launches({ launch: { ...held, state: 'failed' } }))
    await openSpec('spec-7')
    asked = []

    expect(await retryBuild()).toBe(true)

    expect(argumentOf('launches.retry')).toEqual({ launchId: 'l-1' })
  })

  test('a retry with no launch on screen asks nothing', async () => {
    reads(2)
    await openSpec('spec-7')
    asked = []

    expect(await retryBuild()).toBe(false)
    expect(names()).toEqual([])
  })
})
