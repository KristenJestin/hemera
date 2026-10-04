/** The application's Settings page, for now: the theme, chosen among the system's, light and dark. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { AppSettings } from '../src/renderer/app-settings.tsx'

describe('The application’s settings', () => {
  test('the theme chosen is shown, among the system’s, light and dark', () => {
    const markup = renderToStaticMarkup(
      createElement(AppSettings, { theme: 'dark', onTheme: () => undefined }),
    )
    expect(markup).toContain('aria-label="Theme"')
    expect(markup).toContain('Dark')
  })
})
