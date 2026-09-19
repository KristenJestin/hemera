/**
 * The five tones of a Project, declared twice and held to one list (design D4-07).
 *
 * The domain carries the tone and the design system draws it, and neither may import the other:
 * `packages/core` is pure and `packages/ui` is a leaf that knows nothing of Hemera. The
 * application is the one program that sees both, so this is where the two are checked against
 * each other.
 *
 * The check is a table from one to the other, and it is exhaustive both ways by construction: a
 * tone the shell gained is a key missing here, and a tone the domain lost is a value that no
 * longer exists. The design system is read for its type alone — an `import type` leaves nothing
 * behind at run time, and the theme it would otherwise pull in belongs to a browser.
 */

import { PROJECT_TONES, type ProjectTone } from '@hemera/core'
import type { ProjectTone as ShellTone } from '@hemera/ui'
import { describe, expect, test } from 'vite-plus/test'

/** Every tone the shell draws, against the one the domain calls it. */
const EQUIVALENT: Record<ShellTone, ProjectTone> = {
  primary: 'primary',
  info: 'info',
  success: 'success',
  warning: 'warning',
  neutral: 'neutral',
}

describe('Les tons du domaine et de la coquille sont les mêmes', () => {
  test('neither side carries a tone the other does not', () => {
    expect(Object.keys(EQUIVALENT).toSorted()).toEqual([...PROJECT_TONES].toSorted())
  })

  test('the domain offers the five tones in the order they are shown', () => {
    expect(PROJECT_TONES).toEqual(['primary', 'info', 'success', 'warning', 'neutral'])
  })
})
