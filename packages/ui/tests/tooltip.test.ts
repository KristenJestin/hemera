/**
 * What a tooltip refuses to hang on: a legend has to be reachable from the keyboard.
 */

import { describe, expect, test } from 'vite-plus/test'

import { refusedTag } from '../src/components/tooltip/focusable.ts'

describe('A tooltip hangs on something the keyboard can reach', () => {
  test.each(['div', 'span', 'p', 'img', 'svg'])('a tooltip on a <%s> is refused by name', (tag) => {
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
