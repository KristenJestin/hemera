/**
 * What the catalogue claims about itself: nine components, each with the stories the lot says
 * every component has. A component whose stories are missing is a component nobody validated.
 *
 * Each suite is named after the scenario of `specs/design-system/spec.md` it covers.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

const designSystem = join(import.meta.dirname, '..', 'src')

interface Catalogued {
  /** The component as the application imports it. */
  name: string
  /** The folder under `src/components` its stories live in. */
  folder: string
  /**
   * Whether it has a keyboard surface at all. A badge and a loading grid are things to read,
   * not things to operate: asking them for a keyboard story would be asking for a lie.
   */
  keyboard: boolean
}

/** The nine, and no tenth: the lot delivers exactly this list. */
const CATALOGUE: Catalogued[] = [
  { name: 'Button', folder: 'button', keyboard: true },
  { name: 'IconButton', folder: 'button', keyboard: true },
  { name: 'Badge', folder: 'badge', keyboard: false },
  { name: 'Input', folder: 'field', keyboard: true },
  { name: 'Textarea', folder: 'field', keyboard: true },
  { name: 'Select', folder: 'select', keyboard: true },
  { name: 'Menu', folder: 'menu', keyboard: true },
  { name: 'Dialog', folder: 'dialog', keyboard: true },
  { name: 'Loading', folder: 'loading', keyboard: false },
]

/** A story per variant, per state, and one in each theme; a keyboard story where there is one. */
const ALWAYS = ['Variants', 'States', 'Light', 'Dark']

function storiesOf(folder: string): string[] {
  const source = readFileSync(
    join(designSystem, 'components', folder, `${folder}.stories.tsx`),
    'utf8',
  )
  return [...source.matchAll(/^export const (\w+): Story\b/gm)].map((match) => match[1]!)
}

const barrel = readFileSync(join(designSystem, 'index.ts'), 'utf8')

describe('Stories complètes', () => {
  test.each(CATALOGUE)('$name has its variant, state and theme stories', ({ name, folder }) => {
    const stories = storiesOf(folder)
    for (const required of ALWAYS) {
      expect(stories, `${name} has no ${required} story`).toContain(required)
    }
  })

  test('a component whose story is taken away is named', () => {
    const stories = storiesOf('badge').filter((story) => story !== 'Dark')
    expect(ALWAYS.filter((required) => !stories.includes(required))).toEqual(['Dark'])
  })
})

describe('Parcours clavier de chaque composant', () => {
  test.each(CATALOGUE.filter((entry) => entry.keyboard))(
    '$name has a story that walks it with the keyboard',
    ({ name, folder }) => {
      expect(storiesOf(folder), `${name} has no Keyboard story`).toContain('Keyboard')
    },
  )
})

/** The components the design system hands out, types left aside. */
function exportedComponents(source: string): string[] {
  return [...source.matchAll(/export \{([^}]*)\}/g)]
    .flatMap((block) => block[1]!.split(','))
    .map((name) => name.trim())
    .filter((name) => name !== '' && !name.startsWith('type '))
}

describe('Neuf composants accessibles écrits maison', () => {
  test('the design system hands out exactly the nine, and nothing beside them', () => {
    // `DialogClose` is not a tenth component: it is the dialog's own way of saying that a
    // button of the caller's closes it, and it has no appearance of its own.
    const parts = ['DialogClose']
    expect(exportedComponents(barrel).toSorted()).toEqual(
      [...CATALOGUE.map((entry) => entry.name), ...parts].toSorted(),
    )
  })
})
