/** What the Spec fields say about the key prefix: generic words, never a fixture's key. */

import { SpecFields } from '@hemera/ui'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

const none = (): undefined => undefined

const drawn = (prefix: string): string =>
  renderToStaticMarkup(
    createElement(SpecFields, {
      mode: 'local',
      modes: ['local', 'linked'],
      onMode: none,
      language: 'en',
      onLanguage: none,
      prefix,
      onPrefix: none,
    }),
  )

describe('The words under the Key prefix field', () => {
  test('say what the prefix does to the next missions without naming a fixture key', () => {
    const markup = drawn('HEM')
    expect(markup).toContain('the next ones use HEM.')
    expect(markup).not.toContain('ACME')
  })
})
