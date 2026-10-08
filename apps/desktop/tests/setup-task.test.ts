/**
 * How the Project's page follows its setup (#53): read at once, read again on each change of this
 * Project's setup and once its changes are followed, and never an older answer over a newer one.
 */

import type { SetupStanding } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import type { Link } from '../src/renderer/link.ts'
import { followSetup } from '../src/renderer/setup-task.tsx'
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
