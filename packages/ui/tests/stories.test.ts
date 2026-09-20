/**
 * What the catalogue claims about itself: the components anything may use, the pieces of the
 * shell, and the surfaces a lot draws with them — each with the stories the lot says they all
 * have. A component whose stories are missing is a component nobody validated.
 *
 * Three families, and the split is what a reader needs to find anything: `Components/` is what
 * is reusable and knows nothing of Hemera, `Shell/` is the window's own layout, `Surfaces/` is
 * the Project, the Journal and the composer drawn as themselves. A surface is not a component:
 * it exists in one place, and it is made of components.
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

/** The reusable catalogue: the twelve of lots 1 and 2, and the four lot 4 earned. */
const CATALOGUE: Catalogued[] = [
  { name: 'Button', folder: 'button', keyboard: true },
  { name: 'IconButton', folder: 'button', keyboard: true },
  { name: 'Badge', folder: 'badge', keyboard: false },
  { name: 'Input', folder: 'field', keyboard: true },
  { name: 'Textarea', folder: 'field', keyboard: true },
  { name: 'Select', folder: 'select', keyboard: true },
  { name: 'Menu', folder: 'menu', keyboard: true },
  { name: 'Dialog', folder: 'dialog', keyboard: true },
  { name: 'AlertDialog', folder: 'alert-dialog', keyboard: true },
  { name: 'Loading', folder: 'loading', keyboard: false },
  { name: 'Tooltip', folder: 'tooltip', keyboard: true },
  { name: 'Popover', folder: 'popover', keyboard: true },
  { name: 'Tabs', folder: 'tabs', keyboard: true },
  // Lot 4: the frame every surface is drawn on, the card of a form, the list of named things,
  // and the five tones of a Project.
  { name: 'Frame', folder: 'frame', keyboard: false },
  { name: 'Card', folder: 'card', keyboard: false },
  { name: 'List', folder: 'list', keyboard: true },
  { name: 'Timeline', folder: 'timeline', keyboard: false },
  { name: 'ToneSwatches', folder: 'tone-swatches', keyboard: true },
]

/** The pieces of the shell, which are components with a story each and no catalogue entry. */
const SHELL = ['shell', 'chrome-bar', 'sidebar', 'gutter', 'command-palette']

/** The surfaces of lot 4, one folder per domain: a story file each, and the same discipline. */
const SURFACES = {
  project: ['project-dialog', 'project-settings'],
  journal: ['journal'],
  composer: ['composer', 'prompt-input'],
  // Lot 4b: the thread of a Session, and the scrolling that follows its live edge.
  message: ['message'],
  'message/scroller': ['scroller'],
  // Lot 4b: the Session itself — its head, its archives, and its rows in the sidebar.
  session: ['session-header', 'archived-sessions', 'sidebar-sessions'],
  home: ['home'],
  settings: ['settings'],
  notifications: ['notifications'],
}

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

function sourceOf(folder: string): string {
  return readFileSync(join(designSystem, 'components', folder, `${folder}.stories.tsx`), 'utf8')
}

function unique<T>(value: T, index: number, all: T[]): boolean {
  return all.indexOf(value) === index
}

/** Every surface as a `[folder, file]` pair, which is how the two suites below walk them. */
const SURFACE_FILES = Object.entries(SURFACES).flatMap(([folder, files]) =>
  files.map((file) => [folder, file] as const),
)

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

/**
 * What a reader of the catalogue is owed on everything it shows: the props as controls, the
 * callbacks reported as actions, and a page of documentation generated from the two.
 *
 * Checked on the source rather than on a running Storybook, for the same reason the inventory
 * itself is: a story file that forgot them is a component the catalogue shows and nobody can
 * try.
 */
describe('Catalogue essayable', () => {
  test.each(CATALOGUE.map((entry) => entry.folder).filter(unique))(
    '%s documents itself and offers its props as controls',
    (folder) => {
      const source = sourceOf(folder)
      expect(source, `${folder} has no autodocs tag`).toContain("tags: ['autodocs']")
      expect(source, `${folder} declares no argTypes`).toContain('argTypes:')
    },
  )

  test.each(SURFACE_FILES)(
    '%s/%s documents itself and offers its props as controls',
    (folder, file) => {
      const source = readFileSync(join(designSystem, folder, `${file}.stories.tsx`), 'utf8')
      expect(source, `${folder}/${file} has no autodocs tag`).toContain("tags: ['autodocs']")
      expect(source, `${folder}/${file} declares no argTypes`).toContain('argTypes:')
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

describe('Catalogue, coquille et surfaces, et rien d’autre', () => {
  test('the design system hands out exactly what the three families declare', () => {
    // Neither `DialogClose` nor `Kbd` is a component of its own: the first is the dialog's own
    // way of saying that a button of the caller's closes it, the second is a keystroke drawn as
    // keys, which every component that shows one borrows, and `CardRow` is a row of a card and
    // nothing outside one.
    const parts = [
      'DialogClose',
      'Kbd',
      'TooltipProvider',
      'CardRow',
      'FrameHeader',
      'FrameFooter',
      'ListItem',
      'TimelineDays',
      'TimelineSection',
      'TimelineStop',
    ]
    const shell = [
      'Shell',
      'ContentArea',
      'OverlayRoot',
      'ChromeBar',
      'Sidebar',
      'Gutter',
      'CommandPalette',
    ]
    const surfaces = [
      'ProjectDialog',
      'ProjectSettings',
      'RepositoryList',
      'DangerZone',
      'Journal',
      'JournalEntry',
      'JournalFilters',
      'DaySeparator',
      'LoadEarlier',
      'Composer',
      'ComposerActions',
      'ComposerAttachments',
      'MentionMenu',
      'WorkspacePill',
      // Lot 4b: what a Session is written in, and the thread it is written into.
      'PromptInput',
      'MessageGroup',
      'MessageRow',
      'MessageBubble',
      'MessageHeader',
      'MessageFooter',
      'MessageDaySeparator',
      'LiveMarker',
      'MessageScroller',
      'NavigationRail',
      'LatestPill',
      // Lot 4b: the Session as a surface — renamed in place, archived, restored, listed.
      'SessionHeader',
      'SessionEmpty',
      'ArchivedSessions',
      'SidebarSessionEntry',
      'SidebarSessions',
      'SessionsFrame',
      'Greeting',
      'QuickActions',
      'ActivityFrame',
      'EmptyProject',
      'FirstLaunch',
      'Settings',
      'AppearanceSection',
      'ProfileSection',
      'ArchivedProjects',
      'NotificationBell',
      'NotificationList',
    ]
    // The form hook, its fields and the schemas they check against. Not components of the
    // catalogue: a field of a form is drawn by `Input` like everything else, and what these add
    // is the binding — which is the one thing a story cannot show on its own.
    const forms = [
      'PathField',
      'SubmitButton',
      'SuggestInput',
      'TextField',
      'ToneField',
      'useAppForm',
      'withForm',
    ]
    const schemas = [
      'NAME_LIMIT',
      'folderSchema',
      'nameSchema',
      'projectFormSchema',
      'relativePathSchema',
      'tonesSchema',
    ]
    // The bounds, the named entries of the sidebar and the nested radius are values of the
    // theme, not components: the application needs them to hand the shell a width and to say
    // which place it is on.
    const values = [
      'EMPTY_DRAFT',
      'EVERYWHERE_PREFIX',
      'HOME_ENTRY',
      'JOURNAL_ENTRY',
      'NESTED_RADIUS',
      'PROJECT_SETTINGS_ENTRY',
      'PROJECT_TONES',
      'SIDEBAR_DEFAULT',
      'SIDEBAR_MAX',
      'SIDEBAR_MIN',
      'SIDEBAR_RAIL',
      // Lot 4b: what an untitled Session is called, the rule that decides it, and the commands
      // the palette is handed. None of the three draws anything.
      'NEW_SESSION_TITLE',
      'shownTitle',
      'sessionCommands',
    ]
    expect(exportedComponents(barrel).toSorted()).toEqual(
      [
        ...CATALOGUE.map((entry) => entry.name),
        ...parts,
        ...shell,
        ...surfaces,
        ...values,
        ...forms,
        ...schemas,
      ].toSorted(),
    )
  })
})

describe('Coquille montrée en Storybook', () => {
  test.each(SHELL)('%s has a story of its own', (piece) => {
    expect(storiesIn(join(designSystem, 'shell', `${piece}.stories.tsx`))).toContain('Playground')
  })
})

describe('Surfaces du lot 4 montrées en Storybook', () => {
  test.each(SURFACE_FILES)(
    '%s/%s has its playground, variant and state stories',
    (folder, file) => {
      const stories = storiesIn(join(designSystem, folder, `${file}.stories.tsx`))
      for (const required of ALWAYS) {
        expect(stories, `${folder}/${file} has no ${required} story`).toContain(required)
      }
    },
  )
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
      .filter(unique)
      .filter((folder) => sourceOf(folder).includes('globals:'))
    expect(pinning).toEqual([])
  })
})
