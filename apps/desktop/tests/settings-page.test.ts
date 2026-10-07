/**
 * What a Project's settings page draws of what the engine answered: the Project's header, the
 * list of its sections, its repositories on their way and read, a repository Git cannot read, and
 * a Project that cannot be read at all.
 */

import { Unreadable, type Project } from '@hemera/ipc'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { LOADING_SETTINGS, type SettingsData } from '../src/renderer/settings-data.ts'
import { SettingsPage, type SettingsTools } from '../src/renderer/settings-page.tsx'

const repository = (id: string, path: string, lastFetchedAt: string | null = null) => ({
  id,
  projectId: 'acme',
  path,
  includedByDefault: true,
  remote: 'origin',
  baseBranch: 'develop',
  lastFetchedAt,
})

const ACME: Project = {
  id: 'acme',
  name: 'Acme',
  mainCheckout: '/work/acme',
  workspacesRoot: null,
  branchPrefix: null,
  keyPrefix: 'ACME',
  version: 1,
  createdAt: '2026-10-04T08:00:00.000Z',
  updatedAt: '2026-10-04T08:00:00.000Z',
  repositories: [repository('r-api', 'api'), repository('r-web', 'web')],
}

const TOOLS: SettingsTools = {
  chooseFolder: async () => null,
  checkLine: async () => null,
  copy: () => undefined,
  open: () => undefined,
  dataFolder: '/data',
}

const drawn = (data: SettingsData): string =>
  renderToStaticMarkup(createElement(SettingsPage, { data, settings: null, tools: TOOLS }))

describe('A Project’s settings page', () => {
  test('on its way: the list of sections, and the repositories in their own shape', () => {
    const markup = drawn(LOADING_SETTINGS)
    for (const section of [
      'Repositories',
      'Workspaces',
      'Commands',
      'Preparation',
      'Variables',
      'Services',
      'Never run',
      'Models by role',
      'Cap and budget',
      'Instructions',
    ]) {
      expect(markup).toContain(`>${section}<`)
    }
    expect(markup).toContain('data-row-skeleton')
    expect(markup).toContain('aria-busy="true"')
  })

  test('read: the Project’s name and main checkout, each repository with its base', () => {
    const markup = drawn({ ...LOADING_SETTINGS, project: { kind: 'ready', project: ACME } })
    expect(markup).toMatch(/<h1[^>]*>.*Acme.*<\/h1>/)
    expect(markup).toContain('/work/acme')
    expect(markup).toContain('data-repository="api"')
    expect(markup).toContain('data-repository="web"')
    expect(markup).toContain('origin/develop')
    expect(markup).toContain('never fetched')
    expect(markup).not.toContain('data-row-skeleton')
  })

  test('a repository Git cannot read says Git’s reason, and its section says so in the list', () => {
    const markup = drawn({
      ...LOADING_SETTINGS,
      project: { kind: 'ready', project: ACME },
      reads: new Map([
        ['r-web', { status: Unreadable.make({ reason: 'fatal: not a git repository' }) }],
      ]),
    })
    expect(markup).toContain('fatal: not a git repository')
    expect(markup).toContain('aria-label="Repositories, web cannot be read"')
  })

  test('a Project that cannot be read says why, in the engine’s words, with Try again', () => {
    const markup = drawn({
      ...LOADING_SETTINGS,
      project: { kind: 'failed', sentence: 'This Project no longer exists.' },
    })
    expect(markup).toContain('This Project no longer exists.')
    expect(markup).toContain('Try again')
  })
})
