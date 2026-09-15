/**
 * What the catalogue claims about itself: twelve components, each with the stories the lot says
 * every component has, and the six pieces of the shell beside them. A component whose stories
 * are missing is a component nobody validated.
 *
 * Nine of the twelve are lot 1's; Tooltip, Popover and Tabs arrive with the shell of lot 2,
 * which is why the inventory counts to twelve now (`openspec/changes/lot-2-coquille`).
 *
 * Each suite is named after the scenario of `specs/design-system/spec.md` or of
 * `specs/window-shell/spec.md` it covers.
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

/** The twelve, and no thirteenth: the two lots deliver exactly this list. */
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
  { name: 'Tooltip', folder: 'tooltip', keyboard: true },
  { name: 'Popover', folder: 'popover', keyboard: true },
  { name: 'Tabs', folder: 'tabs', keyboard: true },
]

/** The pieces of the shell, which are components with a story each and no catalogue entry. */
const SHELL = ['shell', 'chrome-bar', 'sidebar', 'gutter']

/**
 * What every component shows: a playground where every prop is a control, its variants side by
 * side, and its states side by side. A keyboard story comes on top where there is a keyboard.
 *
 * No story per theme: the toolbar swaps the theme on any story at any moment, so a story that
 * pinned one would only be saying something false about the component. The themes are covered
 * where it counts instead — the whole catalogue is run once per theme.
 */
const ALWAYS = ['Playground', 'Variants', 'States']

function storiesIn(path: string): string[] {
  return [...readFileSync(path, 'utf8').matchAll(/^export const (\w+): Story\b/gm)].map(
    (match) => match[1]!,
  )
}

function storiesOf(folder: string): string[] {
  return storiesIn(join(designSystem, 'components', folder, `${folder}.stories.tsx`))
}

const barrel = readFileSync(join(designSystem, 'index.ts'), 'utf8')
const preview = readFileSync(join(designSystem, '..', '.storybook', 'preview.tsx'), 'utf8')
const runner = ['vitest.config.ts', 'vitest.dark.config.ts'].map((file) =>
  readFileSync(join(designSystem, '..', file), 'utf8'),
)
const shared = readFileSync(join(designSystem, '..', 'vitest.shared.ts'), 'utf8')
const manager = readFileSync(join(designSystem, '..', '.storybook', 'manager.ts'), 'utf8')

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

describe('Douze composants accessibles écrits maison', () => {
  test('the design system hands out exactly the twelve, and the shell beside them', () => {
    // Neither `DialogClose` nor `Kbd` is a thirteenth component: the first is the dialog's own
    // way of saying that a button of the caller's closes it, and the second is a keystroke
    // drawn as keys, which every one of the twelve that shows one borrows.
    const parts = ['DialogClose', 'Kbd', 'TooltipProvider']
    const shell = ['Shell', 'ContentArea', 'OverlayRoot', 'ChromeBar', 'Sidebar', 'Gutter']
    // The bounds and the named entries of the sidebar are values of the theme, not components:
    // the application needs them to hand the shell a width and to say which place it is on.
    const values = [
      'JOURNAL_ENTRY',
      'PROJECT_SETTINGS_ENTRY',
      'SIDEBAR_DEFAULT',
      'SIDEBAR_MAX',
      'SIDEBAR_MIN',
      'SIDEBAR_RAIL',
    ]
    expect(exportedComponents(barrel).toSorted()).toEqual(
      [...CATALOGUE.map((entry) => entry.name), ...parts, ...shell, ...values].toSorted(),
    )
  })
})

describe('Coquille montrée en Storybook', () => {
  test.each(SHELL)('%s has a story of its own', (piece) => {
    expect(storiesIn(join(designSystem, 'shell', `${piece}.stories.tsx`))).toContain('Playground')
  })
})

describe('Stories dans les deux thèmes', () => {
  test('the theme is a toolbar global, so any story can be seen in either', () => {
    expect(preview).toContain('globalTypes')
    expect(preview).toContain('theme')
    for (const value of ['light', 'dark', 'both']) {
      expect(preview, `the toolbar offers no ${value} theme`).toContain(`value: '${value}'`)
    }
  })

  test('both is for the eye: it wears the class on a wrapper, not on the document', () => {
    expect(preview).toContain("chosen !== 'both'")
    expect(preview).toContain('className="dark')
  })

  test('the chrome of Storybook follows the same global the story does', () => {
    expect(manager).toContain('GLOBALS_UPDATED')
    expect(manager).toContain('setOptions')
    expect(manager).toContain('themes.dark')
  })

  test('each run is named after the theme it played, so a contrast failure names it', () => {
    // The two projects are the whole matrix: a violation that only exists on black is reported
    // under `storybook-dark`, which is what tells the reader which theme to go and look at.
    expect(shared).toContain('storybook-${theme}')
    expect(shared).toContain("theme: 'light' | 'dark'")
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
