/** The application's Settings page (#50): #46's sections, the one a route names shown. */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { AppSettingsPage, type AppSettingsPageProps } from '../src/renderer/app-settings.tsx'
import { SILENT_LINK } from './fake-link.ts'

const page = (more: Partial<AppSettingsPageProps>): string =>
  renderToStaticMarkup(
    createElement(AppSettingsPage, {
      link: SILENT_LINK,
      engineReady: true,
      section: 'appearance',
      onSection: () => undefined,
      theme: 'dark',
      onTheme: () => undefined,
      dataFolder: '/data',
      tools: { copy: () => undefined, chooseFolder: async () => null, showLog: () => undefined },
      ...more,
    }),
  )

describe('The application’s settings', () => {
  test('every section down the left, Appearance first with the theme chosen', () => {
    const markup = page({})
    for (const section of [
      'Appearance',
      'Agents',
      'Models by role',
      'Hemera Auto',
      'Notifications &amp; sounds',
      'Profile',
      'Developer',
    ]) {
      expect(markup).toContain(section)
    }
    expect(markup).toContain('aria-label="Theme"')
    expect(markup).toContain('Dark')
  })

  test('a section a link names is the one shown: the agents, on their way', () => {
    const markup = page({ section: 'agents' })
    // What a need's link reads to know where it led.
    expect(markup).toContain('data-settings-section="agents"')
    expect(markup).toContain('data-row-skeleton')
    expect(markup).not.toContain('aria-label="Theme"')
  })
})
