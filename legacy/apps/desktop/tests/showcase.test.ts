import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { CHANNEL_OVERRIDE_VARIABLE, resolveChannel } from '@hemera/runtime'
import { canReach, routeFromArguments, routeOrDefault, routesOf } from '#ui/navigation.ts'
import { windowTitleOf } from '#entry/window-title.ts'

const desktop = resolve(import.meta.dir, '..')

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

  test('the route asked for on the command line is honoured only where it exists', () => {
    expect(routeFromArguments(['bun', 'main.tsx', '--route', 'showcase'], 'dev')).toBe('showcase')
    expect(routeFromArguments(['bun', 'main.tsx', '--route=showcase'], 'dev')).toBe('showcase')
    // A prod package falls back whatever was typed: the page is not in it to reach.
    expect(routeFromArguments(['bun', 'main.tsx', '--route=showcase'], 'prod')).toBe('sessions')
    expect(routeFromArguments(['bun', 'main.tsx'], 'dev')).toBe('sessions')
    expect(routeFromArguments(['bun', 'main.tsx', '--route'], 'dev')).toBe('sessions')
    expect(routeFromArguments(['bun', 'main.tsx', '--route=nowhere'], 'dev')).toBe('sessions')
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

  test('the window names the channel of a development instance, and only that one', () => {
    expect(windowTitleOf('Hemera', 'dev')).toBe('Hemera (dev)')
    expect(windowTitleOf('Hemera', 'prod')).toBe('Hemera')
  })

  test('the start announces the channel and the profile it opened', () => {
    // `main.tsx` stays the entry everyone launches; the application it loads is `app.tsx`,
    // so that a load failing for want of a system library is caught before any of this runs.
    const application = readFileSync(join(desktop, 'src', 'entry', 'app.tsx'), 'utf8')
    expect(application).toContain('windowTitleOf(')
    // Through the log rather than the console: a package started from an icon has neither.
    expect(application).toMatch(/log\.info\(`channel \$\{instance\.channel\}/)
    expect(application).toContain('profile ${instance.directory}')

    const entry = readFileSync(join(desktop, 'src', 'entry', 'main.tsx'), 'utf8')
    expect(entry).toContain("import('./app.tsx')")
    expect(entry).toContain('missingLibraryDiagnostic')
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
