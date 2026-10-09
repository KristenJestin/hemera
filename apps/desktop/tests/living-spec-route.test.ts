/** The living spec in the window: the route draws the page, and waits for the engine. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { LivingSpecRoute } from '../src/renderer/living-spec-route.tsx'
import { SILENT_LINK } from './fake-link.ts'

const draw = (engineReady: boolean): string =>
  renderToStaticMarkup(
    createElement(LivingSpecRoute, {
      link: SILENT_LINK,
      engineReady,
      projectId: 'acme',
      projectName: 'Acme',
      actions: { openOrigin: () => undefined, openModels: () => undefined },
    }),
  )

describe('the living spec route', () => {
  test('it draws the page under its title, the domains loading', () => {
    const html = draw(true)
    expect(html).toContain('Living spec')
    expect(html).toContain('aria-label="Domains"')
    expect(html).toContain('aria-busy="true"')
  })

  test('it draws the same before the engine answers', () => {
    expect(draw(false)).toContain('aria-label="Domains"')
  })
})
