/**
 * How the Project's page follows its setup (#53): read at once, read again on each change of this
 * Project's setup and once its changes are followed, and never an older answer over a newer one.
 */

import type { EditedChange, SetupCard, SetupStanding } from '@hemera/ipc'
import type { SetupKind } from '@hemera/ui'
import { describe, expect, test } from 'vite-plus/test'

import type { Link } from '../src/renderer/link.ts'
import { setupEntriesOf } from '../src/renderer/setup-cards.ts'
import { type CardAnswer, cardAnswers, followSetup } from '../src/renderer/setup-task.tsx'
import { SILENT_LINK } from './fake-link.ts'

const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

/** A link whose standing reads the test answers by hand, in the order it chooses. */
const held = () => {
  const answers: Array<(standing: SetupStanding) => void> = []
  let opened: (() => void) | undefined
  let changed: ((change: { readonly projectId: string }) => void) | undefined
  const link: Link = {
    ...SILENT_LINK,
    setupCards: async () => [],
    projectSessions: async () => [],
    setupStanding: () =>
      new Promise<SetupStanding>((resolve) => {
        answers.push(resolve)
      }),
    onSetupChanges: (listener, _onEnd, onOpen) => {
      changed = listener
      opened = onOpen
      return () => undefined
    },
  }
  return {
    link,
    answers,
    open: () => opened?.(),
    change: (projectId: string) => changed?.({ projectId }),
  }
}

describe('The Project’s page follows its setup', () => {
  test('reads it at once, and again once its changes are followed', async () => {
    const main = held()
    const shown: string[] = []
    followSetup(
      main.link,
      'acme',
      (seen) => shown.push(seen.standing.state),
      () => undefined,
    )
    expect(main.answers).toHaveLength(1)
    main.open()
    expect(main.answers).toHaveLength(2)
    main.change('web')
    expect(main.answers).toHaveLength(2)
    main.change('acme')
    expect(main.answers).toHaveLength(3)
  })

  test('an answer older than the last shown is dropped', async () => {
    const main = held()
    const shown: string[] = []
    followSetup(
      main.link,
      'acme',
      (seen) => shown.push(seen.standing.state),
      () => undefined,
    )
    main.change('acme')
    const [first, second] = main.answers
    second?.({ state: 'working', sentence: null })
    await settled()
    first?.({ state: 'none', sentence: null })
    await settled()
    expect(shown).toEqual(['working'])
  })

  test('stopped, it shows nothing more', async () => {
    const main = held()
    const shown: string[] = []
    const stop = followSetup(
      main.link,
      'acme',
      (seen) => shown.push(seen.standing.state),
      () => undefined,
    )
    stop()
    main.answers[0]?.({ state: 'working', sentence: null })
    await settled()
    expect(shown).toEqual([])
  })
})

describe('Edit and Discuss on a setup card reach the engine (#185)', () => {
  const FRENCH: SetupCard = {
    id: 'l1',
    projectId: 'acme',
    batch: 'b1',
    change: { kind: 'specLanguage', language: 'fr', source: 'README.md' },
    title: 'Set the Spec language to fr',
    details: [],
    state: 'pending',
    refusal: null,
    discussion: null,
    createdAt: '2026-10-06T16:00:00.000Z',
    decidedAt: null,
  }

  /** The page's answers to its cards, as React would give them after each change of its state. */
  const page = (
    edit: (cards: ReadonlyArray<string>, changes: ReadonlyArray<EditedChange>) => Promise<void>,
  ) => {
    const answers = new Map<SetupKind, CardAnswer>()
    const edited: Array<[ReadonlyArray<string>, ReadonlyArray<EditedChange>]> = []
    const discussed: Array<[ReadonlyArray<string>, string]> = []
    let reads = 0
    const link: Link = {
      ...SILENT_LINK,
      editSetupCards: async (cardIds, changes) => {
        edited.push([cardIds, changes])
        await edit(cardIds, changes)
        return []
      },
      discussSetupCards: async (cardIds, note) => {
        discussed.push([cardIds, note])
      },
    }
    const on = () =>
      cardAnswers({
        link,
        cards: [FRENCH],
        entries: setupEntriesOf([FRENCH]),
        answers,
        setAnswer: (kind, answer) => {
          if (answer === null) answers.delete(kind)
          else answers.set(kind, answer)
        },
        reread: () => {
          reads += 1
        },
        answer: (work) => {
          void work.then(() => {
            reads += 1
          })
        },
      })
    return { on, answers, edited, discussed, reads: () => reads }
  }

  test('Edit, then Save, sends the edited language to the link, and the cards are read again', async () => {
    const shown = page(async () => undefined)
    shown.on().onEdit('specLanguage')
    expect(shown.answers.get('specLanguage')).toEqual({
      state: 'editing',
      draft: { kind: 'specLanguage', items: [{ id: 'l1', tag: 'fr', source: 'README.md' }] },
    })
    shown.on().onDraft('specLanguage', {
      kind: 'specLanguage',
      items: [{ id: 'l1', tag: 'de', source: 'README.md' }],
    })
    shown.on().onSave('specLanguage')
    await settled()
    expect(shown.edited).toEqual([
      [
        ['l1'],
        [{ from: 'l1', proposal: { kind: 'specLanguage', language: 'de', source: 'README.md' } }],
      ],
    ])
    expect(shown.answers.has('specLanguage')).toBe(false)
    expect(shown.reads()).toBe(1)
  })

  test('Cancel leaves the card as it was: nothing reaches the link', () => {
    const shown = page(async () => undefined)
    shown.on().onEdit('specLanguage')
    shown.on().onCancel('specLanguage')
    expect(shown.answers.has('specLanguage')).toBe(false)
    expect(shown.edited).toEqual([])
  })

  test('an edit the engine refuses keeps the editor open, with its reason', async () => {
    const shown = page(() => Promise.reject(new Error('de-XX is not a language tag')))
    shown.on().onEdit('specLanguage')
    shown.on().onSave('specLanguage')
    await settled()
    expect(shown.answers.get('specLanguage')).toMatchObject({
      state: 'editing',
      refused: 'de-XX is not a language tag',
    })
  })

  test('Discuss, then Send, sends the user’s words on the kind’s waiting cards', async () => {
    const shown = page(async () => undefined)
    shown.on().onDiscuss('specLanguage')
    expect(shown.answers.get('specLanguage')).toEqual({ state: 'discussing' })
    shown.on().onSend('specLanguage', 'The README is in German.')
    await settled()
    expect(shown.discussed).toEqual([[['l1'], 'The README is in German.']])
    expect(shown.answers.has('specLanguage')).toBe(false)
    expect(shown.reads()).toBe(1)
  })

  test('the card shows what the page holds: the editor and its draft, or the discussion field', () => {
    const shown = page(async () => undefined)
    shown.on().onEdit('specLanguage')
    const [editing] = shown.on().cards
    expect(editing?.status).toEqual({ state: 'editing', refused: undefined })
    expect(editing?.draft).toEqual({
      kind: 'specLanguage',
      items: [{ id: 'l1', tag: 'fr', source: 'README.md' }],
    })
    shown.on().onDiscuss('specLanguage')
    expect(shown.on().cards[0]?.status).toEqual({ state: 'discussing' })
  })
})
