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

/**
 * What every component shows: a playground where every prop is a control, its variants side by
 * side, and its states side by side. A keyboard story comes on top where there is a keyboard.
 *
 * No story per theme: the toolbar swaps the theme on any story at any moment, so a story that
 * pinned one would only be saying something false about the component. The themes are covered
 * where it counts instead — the whole catalogue is run once per theme.
 */
const ALWAYS = ['Playground', 'Variants', 'States']

function storiesOf(folder: string): string[] {
  const source = readFileSync(
    join(designSystem, 'components', folder, `${folder}.stories.tsx`),
    'utf8',
  )
  return [...source.matchAll(/^export const (\w+): Story\b/gm)].map((match) => match[1]!)
}

const barrel = readFileSync(join(designSystem, 'index.ts'), 'utf8')
const preview = readFileSync(join(designSystem, '..', '.storybook', 'preview.tsx'), 'utf8')
const runner = ['vitest.config.ts', 'vitest.dark.config.ts'].map((file) =>
  readFileSync(join(designSystem, '..', file), 'utf8'),
)

describe('Stories complètes', () => {
  test.each(CATALOGUE)(
    '$name has its playground, variant and state stories',
    ({ name, folder }) => {
      const stories = storiesOf(folder)
      for (const required of ALWAYS) {
        expect(stories, `${name} has no ${required} story`).toContain(required)
      }
    },
  )

  test('a component whose story is taken away is named', () => {
    const stories = storiesOf('badge').filter((story) => story !== 'States')
    expect(ALWAYS.filter((required) => !stories.includes(required))).toEqual(['States'])
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

describe('Stories dans les deux thèmes', () => {
  test('the theme is a toolbar global, so any story can be seen in either', () => {
    expect(preview).toContain('globalTypes')
    expect(preview).toContain('theme')
    for (const value of ['light', 'dark']) {
      expect(preview, `the toolbar offers no ${value} theme`).toContain(`value: '${value}'`)
    }
  })

  test('the runner plays the whole catalogue once per theme', () => {
    const asked = runner.map((config) => /catalogue\('(\w+)'\)/.exec(config)![1])
    expect(asked).toEqual(['light', 'dark'])
  })

  test('no story pins a theme of its own', () => {
    const pinning = CATALOGUE.map((entry) => entry.folder)
      .filter((folder, index, folders) => folders.indexOf(folder) === index)
      .filter((folder) =>
        readFileSync(
          join(designSystem, 'components', folder, `${folder}.stories.tsx`),
          'utf8',
        ).includes('globals:'),
      )
    expect(pinning).toEqual([])
  })
})
