/**
 * What a tooltip refuses to hang on.
 *
 * Each suite is named after the scenario of `specs/window-shell/spec.md` it covers.
 */

import { describe, expect, test } from 'vite-plus/test'

import { refusedTag } from '../src/components/tooltip/focusable.ts'

describe('Tooltip au clavier', () => {
  test.each(['div', 'span', 'p', 'img'])('a tooltip on a <%s> is refused by name', (tag) => {
    expect(refusedTag(tag)).toBe(tag)
  })

  test.each(['button', 'a', 'input', 'summary'])(
    'a tooltip on a <%s> is a tooltip the keyboard can reach',
    (tag) => {
      expect(refusedTag(tag)).toBeNull()
    },
  )

  test('a component is left to say for itself what it renders', () => {
    const Control = (): null => null
    expect(refusedTag(Control)).toBeNull()
  })
})
