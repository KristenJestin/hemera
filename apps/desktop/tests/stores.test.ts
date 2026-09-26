/**
 * What the window holds about the Projects and their Journal (design D4-11).
 *
 * The bridge is replaced by one that answers from a script, because what is under test is the
 * store and not the channel: which use case it asks, what it does with an answer, and what it
 * does with a refusal. The channels themselves are tested where they are declared.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import type { JournalEntry, Project } from '@hemera/ipc'
import {
  journalSnapshot,
  loadEarlier,
  filterJournal,
  openJournal,
} from '#renderer/journal-store.ts'
import { loadUnseen, markAllSeen, notificationsSnapshot } from '#renderer/notifications-store.ts'
import {
  archiveProject,
  createProject,
  forgetRefusal,
  loadProjects,
  projectsSnapshot,
  renameProject,
  updateRepository,
} from '#renderer/projects-store.ts'
import { readPortless, toolsSnapshot } from '#renderer/tools-store.ts'

/** One Project, as the engine answers with one. */
function project(id: string, name: string, version = 1): Project {
  return {
    id,
    name,
    tone: 'primary',
    createdAt: 0,
    updatedAt: 0,
    archivedAt: null,
    version,
    mainPath: `/tmp/${id}`,
    repositories: [],
    workspacesRoot: null,
    branchPrefix: null,
    included: [],
    specPrefix: 'SPEC',
    repositoryIcons: {},
  }
}

/** One entry of the Journal, as a page holds one. */
function entry(sequence: number, projectId: string | null): JournalEntry {
  return {
    sequence,
    type: 'project.created',
    entityKind: projectId === null ? 'profile' : 'project',
    entityId: projectId ?? 'profile',
    source: 'ui',
    author: 'human',
    occurredAt: '2026-09-18T10:00:00.000Z',
    projectId,
    payload: {},
    seenAt: null,
    sessionId: null,
    specId: null,
    revisionId: null,
    phaseId: null,
  }
}

/** What was asked of the bridge, in the order it was asked. */
let asked: { name: string; argument: unknown }[] = []

/** What the bridge answers, per channel: a value, or something to throw. */
let answers: Map<string, unknown>

beforeEach(() => {
  asked = []
  answers = new Map()
  // The one place a test reaches into the page: the preload is not there, so the bridge is.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      hemera: {
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- stands in for the preload's bridge, whose job is to carry an argument it never reads
        invoke: async (name: string, argument: unknown) => {
          asked.push({ name, argument })
          const answer = answers.get(name)
          if (answer instanceof Error) throw answer
          return await Promise.resolve(answer)
        },
      },
    },
  })
})

afterEach(() => {
  forgetRefusal()
})

describe('Le store des Projets porte ce que le moteur a répondu', () => {
  test('the list is what came back, never what the page had and patched', async () => {
    answers.set('projects.list', [project('atlas', 'Atlas')])

    expect(await loadProjects()).toBe(true)
    expect(projectsSnapshot().projects.map((one) => one.name)).toEqual(['Atlas'])
    expect(projectsSnapshot().loaded).toBe(true)
  })

  test('creating one asks the use case, then asks for the list again', async () => {
    answers.set('projects.create', project('atlas', 'Atlas'))
    answers.set('projects.list', [project('atlas', 'Atlas')])

    await createProject({ name: 'Atlas', tone: 'primary', mainPath: '/tmp/atlas' })

    // Asked again rather than appended to: the engine is the authority on the order and on the
    // version of every Project in it.
    expect(asked.map((one) => one.name)).toEqual(['projects.create', 'projects.list'])
  })

  test('a change carries the version it was read at', async () => {
    answers.set('projects.archive', project('atlas', 'Atlas', 4))
    answers.set('projects.list', [])

    await archiveProject(project('atlas', 'Atlas', 3))

    expect(asked[0]?.argument).toEqual({ id: 'atlas', version: 3 })
  })

  test('the Spec prefix is changed with the identity, on the version it was read at', async () => {
    answers.set('projects.update', project('atlas', 'Atlas', 4))
    answers.set('projects.list', [project('atlas', 'Atlas', 4)])

    await renameProject(project('atlas', 'Atlas', 3), {
      name: 'Atlas',
      tone: 'primary',
      specPrefix: 'ATX',
    })

    expect(asked[0]).toEqual({
      name: 'projects.update',
      argument: { id: 'atlas', version: 3, name: 'Atlas', tone: 'primary', specPrefix: 'ATX' },
    })
  })

  test('a repository is rewritten at once, path, icon and inclusion, on the version read', async () => {
    answers.set('repositories.update', project('atlas', 'Atlas', 5))
    answers.set('projects.list', [project('atlas', 'Atlas', 5)])

    const went = await updateRepository(project('atlas', 'Atlas', 4), './api', {
      path: './sources/api',
      icon: 'server',
      included: false,
    })

    expect(went).toBe(true)
    expect(asked[0]).toEqual({
      name: 'repositories.update',
      argument: {
        id: 'atlas',
        version: 4,
        relativePath: './api',
        newPath: './sources/api',
        icon: 'server',
        included: false,
      },
    })
  })

  test("a repository's new path refused is the engine's sentence, kept for its dialog", async () => {
    answers.set('repositories.update', new Error('./sources/api is already declared'))

    const went = await updateRepository(project('atlas', 'Atlas', 4), './api', {
      path: './sources/api',
      icon: null,
      included: true,
    })

    expect(went).toBe(false)
    expect(projectsSnapshot().refusal).toBe('./sources/api is already declared')
  })

  test('a refusal is kept in the words it came in, and the list is left alone', async () => {
    answers.set('projects.list', [project('atlas', 'Atlas')])
    await loadProjects()

    answers.set('projects.archive', new Error('the Project is not at that version any more'))
    const went = await archiveProject(project('atlas', 'Atlas', 1))

    expect(went).toBe(false)
    expect(projectsSnapshot().refusal).toBe('the Project is not at that version any more')
    // Nothing on screen says the change went through.
    expect(projectsSnapshot().projects.map((one) => one.name)).toEqual(['Atlas'])
  })
})

describe('Portless is asked of the machine once', () => {
  test('the first opening asks the engine, and every one after it has the answer', async () => {
    answers.set('commands.portless', { installed: true })

    await readPortless()
    await readPortless()

    expect(toolsSnapshot().portlessInstalled).toBe(true)
    expect(asked.filter((one) => one.name === 'commands.portless')).toHaveLength(1)
  })
})

describe('Le store du Journal avance par curseur', () => {
  test('a page replaces what was there, and the next one is appended', async () => {
    answers.set('journal.read', { entries: [entry(9, 'atlas'), entry(8, 'atlas')], nextBefore: 8 })
    await openJournal('atlas')

    answers.set('journal.read', { entries: [entry(7, 'atlas')], nextBefore: null })
    await loadEarlier('atlas')

    expect(journalSnapshot().entries.map((one) => one.sequence)).toEqual([9, 8, 7])
    expect(journalSnapshot().nextBefore).toBeNull()
    // The second page was asked for from the cursor the first one answered with.
    expect(asked[1]?.argument).toEqual({ projectId: 'atlas', before: 8 })
  })

  test('there is nothing to ask for once the last page has said so', async () => {
    answers.set('journal.read', { entries: [entry(9, 'atlas')], nextBefore: null })
    await openJournal('atlas')
    await loadEarlier('atlas')

    expect(asked).toHaveLength(1)
  })

  test('a filter is a new question, so the page starts again from the most recent', async () => {
    answers.set('journal.read', { entries: [entry(9, 'atlas')], nextBefore: 9 })
    await openJournal('atlas')

    answers.set('journal.read', { entries: [entry(4, 'atlas')], nextBefore: null })
    await filterJournal('atlas', { kind: 'profile', byYou: true })

    expect(asked[1]?.argument).toEqual({
      projectId: 'atlas',
      kinds: ['profile'],
      authors: ['human'],
    })
    expect(journalSnapshot().entries.map((one) => one.sequence)).toEqual([4])
  })
})

describe('La cloche est une vue sur le Journal', () => {
  test('the counts arrive as pairs and are held as a map', async () => {
    answers.set('journal.unseen', {
      entries: [entry(9, 'atlas'), entry(8, 'orion')],
      byProject: [
        ['atlas', 1],
        ['orion', 1],
      ],
    })

    await loadUnseen()

    expect(notificationsSnapshot().unseen).toBe(true)
    expect(notificationsSnapshot().byProject.get('atlas')).toBe(1)
  })

  test('marking all read goes up to the newest there is, and never further', async () => {
    answers.set('journal.unseen', { entries: [entry(9, 'atlas')], byProject: [['atlas', 1]] })
    await loadUnseen()

    answers.set('journal.markSeen', undefined)
    answers.set('journal.unseen', { entries: [], byProject: [] })
    await markAllSeen()

    // An entry written between the press and the write is one the user has not seen.
    expect(asked[1]?.argument).toEqual({ upTo: 9 })
    expect(notificationsSnapshot().unseen).toBe(false)
  })

  test('an empty bell asks for nothing', async () => {
    answers.set('journal.unseen', { entries: [], byProject: [] })
    await loadUnseen()
    await markAllSeen()

    expect(asked.map((one) => one.name)).toEqual(['journal.unseen'])
  })
})
