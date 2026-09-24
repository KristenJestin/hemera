/**
 * What the catalogue claims about itself: the components anything may use, the composed pieces
 * a feature draws with them, the pieces of the shell and the surfaces a lot assembles — each
 * with the stories the lot says they all have, and with the badge that says whether the lot in
 * flight created it or changed it. A component whose stories are missing is a component nobody
 * validated.
 *
 * Five roots, and the split is what a reader needs to find anything (`AGENTS.md`):
 * `Foundations/` is the tokens, the icons and the motion, `Components/` is what is reusable and
 * knows nothing of Hemera, `Blocks/` is the composed pieces that are not a screen, `Surfaces/`
 * is the Project, the Journal and the Session drawn as themselves, and `Shell/` is the window's
 * own layout. A surface is not a component: it exists in one place, and it is made of
 * components. The order of the roots, and of what sits inside them, is forced by `storySort`.
 *
 * Each suite is named after the scenario of `specs/design-system/spec.md` or of
 * `specs/window-shell/spec.md` it covers.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

const designSystem = join(import.meta.dirname, '..', 'src')
const repositoryRoot = join(import.meta.dirname, '..', '..', '..')

/** Every story file of the catalogue, wherever it sits under `src`. */
function storyFilesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? storyFilesIn(join(directory, entry.name))
      : entry.name.endsWith('.stories.tsx')
        ? [join(directory, entry.name)]
        : [],
  )
}

const STORY_FILES = storyFilesIn(designSystem)

/** A file as Git names it, which is always with forward slashes. */
function asGitPath(file: string): string {
  return relative(repositoryRoot, file).replaceAll('\\', '/')
}

/**
 * The title a story file files itself under, which is the entry it shows up as.
 *
 * Read from the meta and not from the whole file: a story whose fixtures carry a Session wears
 * a `title:` argument of its own, and only one of them is the file's entry.
 */
function titleOf(file: string): string {
  const source = readFileSync(file, 'utf8')
  return /title: '([^']*)'/.exec(source.slice(source.indexOf('const meta')))![1]!
}

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
  // HEM-17: where a piece of work stands, said as a dot. A thing to read and not a thing to
  // operate, so there is no keyboard story to ask of it.
  { name: 'StatusDot', folder: 'status-dot', keyboard: false },
  // Lot 20, recette of 24 September 2026: a box to tick, drawn in the theme, which every box of
  // the application is instead of the platform's own.
  { name: 'Checkbox', folder: 'checkbox', keyboard: true },
]

/** The pieces of the shell, which are components with a story each and no catalogue entry. */
const SHELL = ['shell', 'chrome-bar', 'sidebar', 'gutter', 'command-palette']

/**
 * The story files of lot 4 and of this lot, one folder per domain: the entries the catalogue
 * shows as a screen or a composed piece, with the same discipline whatever root they sit under.
 */
const SURFACES = {
  // Recette 1 of lot 20: the dialogs a repository and a command are added and edited in.
  project: [
    'project-dialog',
    'project-settings',
    'preparation-editor',
    'repository-dialog',
    'command-dialog',
  ],
  journal: ['journal'],
  composer: ['composer', 'prompt-input'],
  // The thread of a Session (HEM-57): the messages, the viewport they are read in, and the
  // Session as a surface. One folder per domain and not per screen, as the lot asks.
  message: ['message'],
  'message/scroller': ['scroller'],
  // `activity-row` is a block of a Session and not an entry of its own, so it is walked for its
  // documentation and its controls and left out of the three stories a surface entry owes.
  session: ['session', 'session-page', 'activity-row'],
  home: ['home'],
  settings: ['settings'],
  notifications: ['notifications'],
  // Lot 20: what a Workspace is made of: the card, its creation, its preparation, the list of a
  // Project's Workspaces and their cleanup, the variables and the services.
  workspace: [
    'workspace-card',
    'create-workspace-dialog',
    'preparation-steps',
    'workspace-list',
    'cleanup-dialog',
    'variables-editor',
    'service-list',
  ],
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

/**
 * The entries whose states are named after the states they show, rather than gathered under one
 * `States`.
 *
 * `AGENTS.md` asks for one story per state, named after the state, and the composer is where
 * that bites: `Variants` and `States` were "the box with nothing in it" and "the box with
 * something in it", which is two states wearing two names that do not say so. They are `Empty`
 * and `Ready`, and the two the trial of 22 September 2026 added are `Sending` and `Blocked`.
 */
const NAMED_STATES = new Map([
  ['composer/composer', ['Playground', 'Empty', 'Ready', 'Sending', 'Blocked']],
  ['workspace/variables-editor', ['Project', 'Workspace', 'Empty', 'Keyboard']],
  [
    'workspace/service-list',
    [
      'Starting',
      'Ready',
      'Unanswered',
      'PortConflict',
      'Failed',
      'TwoInstances',
      'ProjectScoped',
      'Empty',
      'Keyboard',
    ],
  ],
  [
    'workspace/workspace-card',
    ['Main', 'PickedFolder', 'Preparing', 'Ready', 'Failed', 'Cleaned', 'Loading', 'GitError'],
  ],
  [
    'workspace/create-workspace-dialog',
    ['Proposed', 'RepositoryLeftOut', 'Refused', 'GitMissing', 'Invalid', 'Keyboard'],
  ],
  [
    'workspace/preparation-steps',
    [
      'Pending',
      'Running',
      'Done',
      'Skipped',
      'Failed',
      'Resumed',
      'LinkRefused',
      'RunFailed',
      'Keyboard',
    ],
  ],
  ['workspace/workspace-list', ['MainOnly', 'Filled', 'Creating', 'Keyboard']],
  [
    'workspace/cleanup-dialog',
    ['Confirm', 'RefusedRunningService', 'RefusedGit', 'RefusedBuildSession', 'Keyboard'],
  ],
  // Lot 20: the recipe of a Project, with nothing in it, in order, being added to, and walked.
  ['project/preparation-editor', ['Empty', 'Filled', 'Adding', 'Keyboard']],
  // Recette 1 of lot 20: the settings of a Project, one section at a time, each its story.
  [
    'project/project-settings',
    [
      'Complete',
      'General',
      'Repositories',
      'Workspaces',
      'Commands',
      'Preparation',
      'Variables',
      'Refused',
      'Keyboard',
    ],
  ],
  ['project/repository-dialog', ['Add', 'Edit', 'Invalid', 'Refused', 'Keyboard']],
  [
    'project/command-dialog',
    [
      'Add',
      'Edit',
      'Portless',
      'PortlessNameInvalid',
      'PortlessMissing',
      'PortlessInLine',
      'Refused',
      'Keyboard',
    ],
  ],
])

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

/** Every tag a story file declares, wherever it writes it: the meta and the stories alike. */
function tagsOf(source: string): string[] {
  return [...source.matchAll(/tags: \[([^\]]*)\]/g)].flatMap((declared) =>
    [...(declared[1] ?? '').matchAll(/'([^']+)'/g)].map((tag) => tag[1]!),
  )
}

function unique<T>(value: T, index: number, all: T[]): boolean {
  return all.indexOf(value) === index
}

/** Every surface as a `[folder, file]` pair, which is how the two suites below walk them. */
const SURFACE_FILES = Object.entries(SURFACES).flatMap(([folder, files]) =>
  files.map((file) => [folder, file] as const),
)

/**
 * The story file that carries a surface entry, when one screen is drawn by more than one file.
 * `Surfaces/Session` is the head and the row, the page, and the whole Session an agent fills —
 * one entry of the sidebar, three story files — and the three stories every entry has, its
 * playground, its variants and its states, live with the page, which is the screen itself.
 */
const ENTRY_FILES = SURFACE_FILES.filter(
  ([folder, file]) => folder !== 'session' || file === 'session-page',
)

const barrel = readFileSync(join(designSystem, 'index.ts'), 'utf8')
const preview = readFileSync(join(designSystem, '..', '.storybook', 'preview.tsx'), 'utf8')
const runner = ['vitest.config.ts', 'vitest.dark.config.ts'].map((file) =>
  readFileSync(join(designSystem, '..', file), 'utf8'),
)
const shared = readFileSync(join(designSystem, '..', 'vitest.shared.ts'), 'utf8')
const manager = readFileSync(join(designSystem, '..', '.storybook', 'manager.ts'), 'utf8')
const main = readFileSync(join(designSystem, '..', '.storybook', 'main.ts'), 'utf8')

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
      expect(tagsOf(source), `${folder} has no autodocs tag`).toContain('autodocs')
      expect(source, `${folder} declares no argTypes`).toContain('argTypes:')
    },
  )

  test.each(SURFACE_FILES)(
    '%s/%s documents itself and offers its props as controls',
    (folder, file) => {
      const source = readFileSync(join(designSystem, folder, `${file}.stories.tsx`), 'utf8')
      expect(tagsOf(source), `${folder}/${file} has no autodocs tag`).toContain('autodocs')
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
  test('the design system hands out exactly what the catalogue declares', () => {
    // Neither `DialogClose` nor `Kbd` is a component of its own: the first is the dialog's own
    // way of saying that a button of the caller's closes it, the second is a keystroke drawn as
    // keys, which every component that shows one borrows, and `CardRow` is a row of a card and
    // nothing outside one. `toolKindLabel` is no component either: it is the words a native
    // call's line is read by, which a permission card about that call is headed with as well.
    const parts = [
      'toolKindLabel',
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
      'PreparationEditor',
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
      // HEM-57: the thread of a Session, the viewport it is read in, and its own surface. The
      // day separator of a thread is `MessageDaySeparator`: the Journal already hands out a
      // `DaySeparator`, and one barrel cannot export two things under one word. The two ways
      // a line of a thread is made are `MessageText` — what somebody typed — and `AgentText`,
      // which is the Markdown an agent is still writing (D5-14).
      'AgentText',
      'MessageGroup',
      'MessageRow',
      'MessageText',
      'MessageBubble',
      'MessageHeader',
      'MessageFooter',
      'MessageDaySeparator',
      'LiveMarker',
      'MessageScroller',
      'NavigationRail',
      'LatestPill',
      'SessionHeader',
      'SessionEmpty',
      'ArchivedSessions',
      'SidebarSessionEntry',
      'PromptInput',
      'Greeting',
      'QuickActions',
      'SessionsFrame',
      'ActivityFrame',
      'EmptyProject',
      'FirstLaunch',
      'Settings',
      'AppearanceSection',
      'ProfileSection',
      'ArchivedProjects',
      'NotificationBell',
      'NotificationList',
      // HEM-17: a turn with an agent, from the call it makes to the gate it stops at. The blocks
      // of a turn (its calls, its thoughts, its console, its changes), the permission card and
      // the line an answer leaves, what the agent advertises and the reader sets, the agents this
      // machine has, and what a Session says about itself in its details.
      'Disclosure',
      'ThoughtBlock',
      'ToolCallCard',
      'TerminalOutput',
      'DiffBlock',
      'PermissionRequest',
      'DecisionSummary',
      // The agent, its model and its effort are one control since the trial of 22 September
      // 2026: three selectors in the foot of the composer, plus the agent's own at the far end
      // of the row, wrapped onto a second line as soon as a model had a long name, and the frame
      // changed height while it was being read. `AgentSelector`, `ModelSelector` and
      // `EffortSelector` went with it.
      'AgentModelMenu',
      'ModeSelector',
      // The row that stands at the end of the thread while a turn runs, built on the live
      // marker the thread already had.
      'ActivityRow',
      'UsageMeter',
      'BlockedBanner',
      'AgentsSection',
      'PlanPanel',
      'SessionDetails',
      'StoppedTurn',
      'ResumeFallbackBanner',
      // HEM-18: Hemera lends the agent its own tools. A call to one of them is a block of the
      // thread with the mark that tells it from a native call, a command it runs is a block of
      // its own, and the Session says what it runs and what it works from in its details.
      'HemeraToolCall',
      'CommandRun',
      'CommandProposal',
      'CommandsPanel',
      'ContextView',
      'BareModeState',
      'CommandList',
      // Lot 20: the variables, the services and the details of a run of a Workspace.
      'VariablesEditor',
      'ServiceList',
      'RunDetails',
      // Lot 20: a Workspace with what Git says of it, the dialog that creates one, its
      // preparation step by step, the Workspaces of a Project, and the cleanup that keeps the
      // branches.
      'WorkspaceCard',
      'CreateWorkspaceDialog',
      'PreparationSteps',
      'WorkspaceList',
      'CleanupDialog',
      // Lot 19: the Spec panel of a `define` Session, its rail and its parts, and the three
      // blocks of the thread: what the agent was handed, a question of the Spec asked in the
      // chat, and the agent proposing a Spec in a `free` Session.
      'SpecPanel',
      'SpecPart',
      'SpecStage',
      'SpecRail',
      'SpecHead',
      'SectionPart',
      'StoriesPart',
      'TasksPart',
      'QuestionsPart',
      'ConflictBanner',
      'ReaderBar',
      'ReworkDialog',
      'MissionBrief',
      'SpecQuestion',
      'CreateSpecProposal',
      // The shell the Spec panel stands in, which any mission's panel opens in beside the chat,
      // and the rail it is fed with.
      'MissionPanel',
      'MissionRail',
      // Recette 1 of lot 20: every addition and every edit of the settings is a dialog.
      'CommandDialog',
      'RepositoryDialog',
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
      // Lot 20: the seven command types, their scopes, their icons and their labels (D8-07).
      'COMMAND_SCOPES',
      'COMMAND_TYPES',
      'COMMAND_TYPE_ICONS',
      'COMMAND_TYPE_LABELS',
      'EMPTY_DRAFT',
      'EVERYWHERE_PREFIX',
      'HOME_ENTRY',
      'JOURNAL_ENTRY',
      'NESTED_RADIUS',
      'PROJECT_SETTINGS_ENTRY',
      'PROJECT_TONES',
      // Recette 1 of lot 20: the icons a repository may be drawn with.
      'REPOSITORY_ICONS',
      'SIDEBAR_DEFAULT',
      'SIDEBAR_MAX',
      'SIDEBAR_MIN',
      'SIDEBAR_RAIL',
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
  test.each(ENTRY_FILES)('%s/%s has its playground, variant and state stories', (folder, file) => {
    const stories = storiesIn(join(designSystem, folder, `${file}.stories.tsx`))
    for (const required of NAMED_STATES.get(`${folder}/${file}`) ?? ALWAYS) {
      expect(stories, `${folder}/${file} has no ${required} story`).toContain(required)
    }
  })
})

/**
 * The five roots of the sidebar, and the one thing a title shared by several files cannot
 * survive: two of them declaring the same story name, which Storybook refuses by handing the
 * same story id out twice. The `Surfaces/Session` entry is where that bites — the head and the
 * row, the page and the whole Session an agent fills make one entry — so the stories of an
 * entry that more than one file feeds are named after the state they show.
 */
describe('Les cinq racines du catalogue', () => {
  const ROOTS = ['Foundations', 'Components', 'Blocks', 'Surfaces', 'Shell']

  /**
   * The order is not the alphabet's: a reader is given the five roots in the order above, and,
   * inside them, the alphabetical order — except for the one name the sort lists, a surface's
   * first story `Complete`, which is what the UI gate opens. Every name the sort declares, in the
   * order it declares them, is the sidebar; an author who adds or moves a root changes this.
   */
  test('the sort gives the five roots in order, and a surface its gate story first', () => {
    const settings = preview.slice(preview.indexOf('storySort'))
    // The declared order is what the `order` array says, and nothing else in the block: the
    // method beside it names no entry of the sidebar.
    const order = settings.slice(settings.indexOf('order: ['))
    const declared = [...order.matchAll(/'([A-Za-z]+)'/g)].map((match) => match[1]!)
    expect(declared).toEqual([
      'Foundations',
      'Components',
      'Blocks',
      'Surfaces',
      'Session',
      'Complete',
      'Shell',
    ])
    // The alphabet, asked for rather than hoped for: Storybook keeps the index's own order for
    // every name the list above does not mention, so the method is what makes the rule true.
    expect(settings).toContain("method: 'alphabetical'")
  })

  test('every story file is filed under one of the five roots', () => {
    const stray = STORY_FILES.filter((file) => !ROOTS.includes(titleOf(file).split('/')[0]!))
    expect(stray.map(asGitPath)).toEqual([])
  })

  test('a primitive is one word under Components, and a block three under Blocks', () => {
    const mislaid = STORY_FILES.filter((file) => {
      const [root, , third] = titleOf(file).split('/')
      if (root === 'Blocks') return third === undefined
      return (root === 'Components' || root === 'Shell') && third !== undefined
    })
    expect(mislaid.map(asGitPath)).toEqual([])
  })

  test('two files under one title declare two different stories', () => {
    const seen = new Map<string, string>()
    const twice = STORY_FILES.flatMap((file) =>
      storiesIn(file).flatMap((story) => {
        const id = `${titleOf(file)}--${story}`
        const first = seen.get(id)
        seen.set(id, file)
        return first === undefined ? [] : [`${id}: ${asGitPath(first)} and ${asGitPath(file)}`]
      }),
    )
    expect(twice).toEqual([])
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
      .filter(unique)
      .filter((folder) => sourceOf(folder).includes('globals:'))
    expect(pinning).toEqual([])
  })
})

/**
 * The badges of the sidebar, which are how a lot's stories are found in the catalogue rather
 * than read out of a diff.
 *
 * A story file the lot created wears `new`, one whose component the lot changed wears `updated`.
 * The badge belongs to the lot that touches the design system and not to the component: the
 * first thing such a lot does is take the previous lot's badges off, and a branch that changes
 * nothing of this package carries no badge change at all — which is what keeps a PR that is not
 * about the interface from showing up in the catalogue. Git is the only thing that can say
 * whether a badge was earned, so the test asks Git, and where Git cannot answer (a checkout of
 * `dev`, a shallow clone) there is nothing to refuse.
 */
describe('Badges du lot en cours', () => {
  const BADGES = ['new', 'updated']

  /** The package, as Git names it: what a branch has to touch for a badge to be its business. */
  const PACKAGE = `${asGitPath(join(import.meta.dirname, '..'))}/`

  /**
   * Whether the badges are this branch's business at all.
   *
   * A branch that changes nothing of this package is asked nothing: the badges of the lot
   * before stay where they are, and a PR that is not about the interface shows up nowhere in
   * the catalogue — which is the whole point of a badge that belongs to a lot rather than to a
   * component.
   */
  function badgesAreTheBranchsBusiness(touched: Set<string>): boolean {
    return [...touched].some((path) => path.startsWith(PACKAGE))
  }

  /**
   * What this branch did to a file, told by Git, or `null` when Git cannot tell.
   *
   * A checkout of `dev` itself, a shallow clone and a folder without Git all answer nothing,
   * and then there is nothing to check.
   */
  function touchedByTheBranch(): Set<string> | null {
    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' })
    try {
      const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()
      if (branch === 'dev' || branch === 'main' || branch === 'HEAD') return null
      const base = git(['merge-base', 'dev', 'HEAD']).trim()
      const committed = git(['diff', '--name-only', base]).split('\n')
      const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n')
      return new Set(
        [...committed, ...untracked].map((path) => path.trim()).filter((path) => path !== ''),
      )
    } catch {
      return null
    }
  }

  test('the sidebar draws the two badges of a lot, and nothing else', () => {
    expect(main, 'the addon that draws the badges is not declared').toContain(
      'storybook-addon-tag-badges',
    )
    expect(manager, 'the manager configures no badge').toContain('tagBadges')
    for (const badge of BADGES) {
      expect(manager, `the manager draws no ${badge} badge`).toContain(`tags: '${badge}'`)
    }
    expect(manager, 'the addon default set is back, and nobody asked for it').not.toContain(
      'defaultConfig',
    )
  })

  test('a story file declares no tag that nothing reads', () => {
    const unknown = STORY_FILES.flatMap((file) =>
      tagsOf(readFileSync(file, 'utf8'))
        .filter((tag) => tag !== 'autodocs' && !BADGES.includes(tag))
        .map((tag) => `${asGitPath(file)}: ${tag}`),
    )
    expect(unknown).toEqual([])
  })

  test('a branch that changes nothing of the design system is asked nothing', () => {
    // A PR about the engine, the IPC or the tools carries no badge diff: the rule only bites
    // where the interface was touched, which is what keeps the catalogue out of unrelated PRs.
    expect(badgesAreTheBranchsBusiness(new Set(['tools/boundaries.ts']))).toBe(false)
    expect(
      badgesAreTheBranchsBusiness(new Set(['apps/desktop/src/main/channels.ts', 'README.md'])),
    ).toBe(false)
    expect(badgesAreTheBranchsBusiness(new Set([`${PACKAGE}src/message/message.tsx`]))).toBe(true)
  })

  test('a badge the branch did not earn is refused', () => {
    const touched = touchedByTheBranch()
    if (touched === null) return
    if (!badgesAreTheBranchsBusiness(touched)) return
    const lying = STORY_FILES.filter((file) => {
      const worn = tagsOf(readFileSync(file, 'utf8')).some((tag) => BADGES.includes(tag))
      return worn && !touched.has(asGitPath(file))
    }).map(asGitPath)
    expect(lying, 'the badge of the lot before, on files this branch never touched').toEqual([])
  })
})
