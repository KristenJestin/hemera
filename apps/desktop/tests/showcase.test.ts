import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { SHOWCASE } from '@hemera/ui/showcase'

import { CHANNEL_OVERRIDE_VARIABLE, resolveChannel } from '@hemera/runtime'
import { canReach, routeOrDefault, routesOf } from '../src/ui/navigation.ts'

const desktop = resolve(import.meta.dir, '..')
const componentsRoot = resolve(desktop, '..', '..', 'packages', 'ui', 'src', 'components')

describe('Composant sans démonstration', () => {
  test('every component of the catalogue has an entry', () => {
    const folders = readdirSync(componentsRoot).filter((entry) => !entry.endsWith('.ts'))
    const registered = new Set(SHOWCASE.map((entry) => entry.component))
    for (const folder of folders) {
      const component = folder
        .split('-')
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join('')
      expect(registered.has(component)).toBe(true)
    }
  })

  test('every entry demonstrates at least one case', () => {
    for (const entry of SHOWCASE) {
      expect(entry.cases.length).toBeGreaterThan(0)
      for (const demonstration of entry.cases) {
        expect(demonstration.name.length).toBeGreaterThan(0)
        expect(typeof demonstration.render).toBe('function')
      }
    }
  })
})

describe('Démonstration inaccessible en production', () => {
  test('a prod package exposes no route to the page', () => {
    expect(routesOf('prod')).toEqual(['sessions'])
    expect(canReach('showcase', 'prod')).toBe(false)
    expect(routeOrDefault('showcase', 'prod')).toBe('sessions')
  })

  test('a dev package exposes the page', () => {
    expect(routesOf('dev')).toContain('showcase')
    expect(canReach('showcase', 'dev')).toBe(true)
    expect(routeOrDefault('showcase', 'dev')).toBe('showcase')
  })

  test('no navigation entry or shortcut names the page outside its own folder', () => {
    const screens = readdirSync(join(desktop, 'src', 'ui')).filter((entry) => entry.endsWith('.ts'))
    for (const screen of screens) {
      const source = readFileSync(join(desktop, 'src', 'ui', screen), 'utf8')
      // The route is named where routes are declared; nothing else may link to it.
      if (screen === 'navigation.ts') continue
      expect(source).not.toContain('showcase')
    }
  })
})

describe("Développement à côté de l'installation", () => {
  test('a development run always carries the dev channel', () => {
    expect(resolveChannel({ packaged: 'prod', env: {}, development: true })).toBe('dev')
    expect(
      resolveChannel({
        packaged: 'prod',
        env: { [CHANNEL_OVERRIDE_VARIABLE]: 'prod' },
        development: true,
      }),
    ).toBe('dev')
  })

  test('a package carries the channel it was assembled with', () => {
    expect(resolveChannel({ packaged: 'prod', env: {}, development: false })).toBe('prod')
    expect(resolveChannel({ packaged: 'dev', env: {}, development: false })).toBe('dev')
  })

  test('the reserved variable overrides the channel, and an unknown value is ignored', () => {
    expect(
      resolveChannel({
        packaged: 'prod',
        env: { [CHANNEL_OVERRIDE_VARIABLE]: 'dev' },
        development: false,
      }),
    ).toBe('dev')
    expect(
      resolveChannel({
        packaged: 'prod',
        env: { [CHANNEL_OVERRIDE_VARIABLE]: 'staging' },
        development: false,
      }),
    ).toBe('prod')
  })
})
