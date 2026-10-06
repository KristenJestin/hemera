/** Where the window is and how it moves: routes, a mission's base and the views over it. */

import { describe, expect, test } from 'vite-plus/test'

import {
  START,
  close,
  focusOf,
  frameOf,
  go,
  linkedSettings,
  open,
  placeOf,
  sectionOf,
  show,
  trailOf,
  type Names,
} from '../src/renderer/navigation.ts'

const names: Names = {
  project: (id) => (id === 'acme' ? 'Acme' : undefined),
  view: (id) => ({ spec: 'Spec', 'round:1': 'Round 1' })[id] ?? id,
  chat: (id) => (id === 'invoices' ? 'Invoices export' : undefined),
}

const labels = (navigation: typeof START) => trailOf(navigation, names).map((crumb) => crumb.label)

const ACME_12 = { kind: 'mission', projectId: 'acme', key: 'ACME-12' } as const

describe('The window’s routes', () => {
  test('the window opens on Home, and its trail says Home', () => {
    expect(START.route).toEqual({ kind: 'home' })
    expect(labels(START)).toEqual(['Home'])
    expect(placeOf(START.route)).toEqual({ kind: 'home' })
  })

  test('Settings is a page of its own, marked at the foot of the sidebar', () => {
    const settings = go(START, { kind: 'settings' })
    expect(labels(settings)).toEqual(['Settings'])
    expect(placeOf(settings.route)).toEqual({ kind: 'settings' })
    expect(sectionOf(settings.route)).toBe('appearance')
  })

  test('a link opens Settings at its section', () => {
    const agents = go(START, { kind: 'settings', section: 'agents' })
    expect(labels(agents)).toEqual(['Settings'])
    expect(sectionOf(agents.route)).toBe('agents')
  })

  test('a link opens Settings with the focus on its section’s heading; the list moves no focus', () => {
    const linked = go(START, linkedSettings('hemera-auto'))
    expect(sectionOf(linked.route)).toBe('hemera-auto')
    expect(focusOf(linked.route)).toBe(true)
    expect(focusOf(go(START, { kind: 'settings', section: 'models' }).route)).toBe(false)
    expect(focusOf(go(START, { kind: 'settings' }).route)).toBe(false)
  })

  test('Home filtered to a Project says it after Home, which leads back to every need', () => {
    const filtered = go(START, { kind: 'home', projectId: 'acme' })
    const trail = trailOf(filtered, names)
    expect(trail.map((crumb) => crumb.label)).toEqual(['Home', 'Acme'])
    expect(trail[0]?.step).toEqual({ go: { kind: 'home' } })
    expect(trail[1]?.step).toBeUndefined()
    expect(placeOf(filtered.route)).toEqual({ kind: 'home' })
  })

  test('Settings opened at a section is still Settings in the trail and the sidebar', () => {
    const models = go(START, { kind: 'settings', section: 'models' })
    expect(labels(models)).toEqual(['Settings'])
    expect(placeOf(models.route)).toEqual({ kind: 'settings' })
  })

  test('a Project’s page says its name; its settings lead back to it and keep it marked', () => {
    const page = go(START, { kind: 'project', id: 'acme' })
    expect(labels(page)).toEqual(['Acme'])
    const settings = go(page, { kind: 'projectSettings', id: 'acme' })
    const trail = trailOf(settings, names)
    expect(trail.map((crumb) => crumb.label)).toEqual(['Acme', 'Settings'])
    expect(trail[0]?.step).toEqual({ go: { kind: 'project', id: 'acme' } })
    expect(trail[1]?.step).toBeUndefined()
    expect(placeOf(settings.route)).toEqual({ kind: 'project', id: 'acme' })
  })

  test('a new Project’s setup is a page under it: the Project, then Setup; the Project marked', () => {
    const setup = go(START, { kind: 'projectSetup', id: 'acme' })
    const trail = trailOf(setup, names)
    expect(trail.map((crumb) => crumb.label)).toEqual(['Acme', 'Setup'])
    expect(trail[0]?.step).toEqual({ go: { kind: 'project', id: 'acme' } })
    expect(placeOf(setup.route)).toEqual({ kind: 'project', id: 'acme' })
  })

  test('a Chat is a page under its Project: its title after the Project’s, its row marked', () => {
    const chat = go(START, { kind: 'chat', projectId: 'acme', id: 'invoices' })
    const trail = trailOf(chat, names)
    expect(trail.map((crumb) => crumb.label)).toEqual(['Acme', 'Invoices export'])
    expect(trail[0]?.step).toEqual({ go: { kind: 'project', id: 'acme' } })
    expect(placeOf(chat.route)).toEqual({ kind: 'chat', id: 'invoices' })
    const unknown = go(START, { kind: 'chat', projectId: 'acme', id: 'elsewhere' })
    expect(trailOf(unknown, names).at(-1)?.label).toBe('Chat')
  })
})

describe('A mission’s base and the views over it', () => {
  test('views opened over the base are crumbs after the mission, in the order of the stack', () => {
    const stacked = open(open(go(START, ACME_12), 'round:1'), 'spec')
    expect(labels(stacked)).toEqual(['Acme', 'ACME-12', 'Round 1', 'Spec'])
    expect(trailOf(stacked, names)[1]).toMatchObject({ mono: true, step: { show: null } })
    expect(frameOf(stacked, 'ACME-12').open).toEqual(['round:1', 'spec'])
  })

  test('a crumb of the stack goes back down to its view; the mission’s crumb to the base', () => {
    const stacked = open(open(go(START, ACME_12), 'round:1'), 'spec')
    expect(labels(show(stacked, 'round:1'))).toEqual(['Acme', 'ACME-12', 'Round 1'])
    expect(labels(show(stacked, null))).toEqual(['Acme', 'ACME-12'])
  })

  test('closing the last view finds the base alone again', () => {
    const opened = open(go(START, ACME_12), 'spec')
    expect(frameOf(close(opened, 'spec'), 'ACME-12').open).toEqual([])
  })

  test('a mission left for another page finds its views again when the window comes back', () => {
    const opened = open(go(START, ACME_12), 'spec')
    const away = go(opened, { kind: 'home' })
    expect(labels(away)).toEqual(['Home'])
    expect(labels(go(away, ACME_12))).toEqual(['Acme', 'ACME-12', 'Spec'])
  })

  test('outside a mission, opening a view changes nothing', () => {
    const page = go(START, { kind: 'project', id: 'acme' })
    expect(open(page, 'spec')).toBe(page)
  })
})
