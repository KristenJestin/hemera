/**
 * What a Project's settings page draws of what the engine answered: the Project's header, the
 * list of its sections, its repositories on their way and read, a repository Git cannot read, and
 * a Project that cannot be read at all.
 */

import { Unreadable, type Project } from '@hemera/ipc'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vite-plus/test'

import { LOADING_SETTINGS, type SettingsData } from '../src/renderer/settings-data.ts'
import { SettingsPage, sectionChosen, type SettingsTools } from '../src/renderer/settings-page.tsx'
import {
  TICKET_SECTIONS,
  TicketSection,
  isTicketSection,
  type TicketSectionProps,
} from '../src/renderer/ticket-sections.tsx'
import { SILENT_LINK } from './fake-link.ts'

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

const drawn = (
  data: SettingsData,
  more: Partial<ComponentProps<typeof SettingsPage>> = {},
): string =>
  renderToStaticMarkup(createElement(SettingsPage, { data, settings: null, tools: TOOLS, ...more }))

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
      'Models by role',
      'Cap and budget',
      'Instructions',
    ]) {
      expect(markup).toContain(`>${section}<`)
    }
    expect(markup).toContain('data-row-skeleton')
    expect(markup).toContain('aria-busy="true"')
    // Never run stands under the catalogue, not as a section of its own.
    expect(markup).not.toContain('>Never run<')
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

describe('The ticket, resource and living spec entries of a Project’s settings', () => {
  const ready: SettingsData = { ...LOADING_SETTINGS, project: { kind: 'ready', project: ACME } }

  test('the list gains Tickets and Specs, Exclusive resources and the Living spec entry', () => {
    const markup = drawn(ready)
    for (const entry of ['Tickets and Specs', 'Exclusive resources', 'Living spec']) {
      expect(markup).toContain(`>${entry}<`)
    }
  })

  test('a section the route names is the one shown first, drawn by the ticket slot', () => {
    const markup = drawn(ready, {
      section: 'resources',
      ticketSection: (id) => createElement('p', null, `The ${id} part`),
    })
    expect(markup).toContain('The resources part')
    expect(markup).not.toContain('data-repository="api"')
    const tickets = drawn(ready, {
      section: 'tickets',
      ticketSection: (id) => createElement('p', null, `The ${id} part`),
    })
    expect(tickets).toContain('The tickets part')
  })

  test('a section the page does not have leaves the first one shown', () => {
    expect(drawn(ready, { section: 'nowhere' })).toContain('data-repository="api"')
  })

  test('the Living spec entry opens the page and shows no section; the others show theirs', () => {
    expect(sectionChosen('livingSpec')).toEqual({ kind: 'livingSpec' })
    expect(sectionChosen('tickets')).toEqual({ kind: 'section', id: 'tickets' })
    expect(sectionChosen('repositories')).toEqual({ kind: 'section', id: 'repositories' })
    expect(sectionChosen('nowhere')).toBeNull()
  })

  test('a problem the window knows is said by its section’s glyph in the list', () => {
    const markup = drawn(ready, {
      problems: new Map([['tickets', 'GitHub cannot be reached']]),
    })
    expect(markup).toContain('aria-label="Tickets and Specs, GitHub cannot be reached"')
  })
})

describe('The ticket sections, composed', () => {
  const props = (section: TicketSectionProps['section']): TicketSectionProps => ({
    section,
    link: SILENT_LINK,
    engineReady: true,
    projectId: 'acme',
    project: ACME,
    catalogue: [],
    show: () => undefined,
    copy: () => undefined,
  })

  test('Tickets and Specs holds the providers, then the Spec settings; resources hold theirs', () => {
    expect(TICKET_SECTIONS).toEqual(['tickets', 'resources'])
    expect(isTicketSection('tickets')).toBe(true)
    expect(isTicketSection('resources')).toBe(true)
    expect(isTicketSection('models')).toBe(false)
    expect(renderToStaticMarkup(createElement(TicketSection, props('tickets')))).toBe('')
    expect(renderToStaticMarkup(createElement(TicketSection, props('resources')))).toBe('')
  })
})
