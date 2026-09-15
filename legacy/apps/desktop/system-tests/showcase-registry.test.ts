/**
 * The showcase registry, which can only be read by loading every component of the catalogue.
 *
 * That pulls the renderer in, so this lives with the suites that paint rather than with the
 * business suite, which runs where no addon was ever compiled. The structural half of the
 * rule - four files per component, an entry per component - is checked without loading
 * anything by `tools/components.ts`.
 */

import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { SHOWCASE } from '@hemera/ui/showcase'

const componentsRoot = resolve(
  import.meta.dir,
  '..',
  '..',
  '..',
  'packages',
  'ui',
  'src',
  'components',
)

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
