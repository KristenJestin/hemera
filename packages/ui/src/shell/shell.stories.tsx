import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { emulateReducedMotion } from '../../.storybook/reduced-motion.ts'
import {
  JOURNAL_ENTRY,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  SIDEBAR_RAIL,
  type ShellProject,
  type ShellSession,
} from './model.ts'
import { Shell } from './shell.tsx'

/**
 * The whole shell, with nothing real in it (design D2-01, D2-08).
 *
 * The stories are where this lot is validated: the same component the window mounts, driven by
 * fixtures instead of by a database, in both themes and with the system asking for less
 * movement. Every scenario of `specs/window-shell/spec.md` that a browser can settle is
 * settled here; the rest are in the end-to-end suite, where there is a real window to move.
 */
const PROJECTS: ShellProject[] = [
  { id: 'atlas', name: 'Atlas', tone: 'primary', pending: 5 },
  { id: 'notes', name: 'Notes', tone: 'info', pending: 0 },
  { id: 'docs', name: 'Hemera docs', tone: 'warning', pending: 1 },
  { id: 'shop', name: 'Legacy shop', tone: 'neutral', pending: 1 },
  { id: 'ml', name: 'ML playground', tone: 'success', pending: 0 },
]

const SESSIONS: ShellSession[] = [
  { id: 'csv', title: 'CSV invoice export' },
  { id: 'search', title: 'Full-text search' },
  { id: 'drizzle', title: 'Migrate to Drizzle 1.0' },
]

/** Twelve Projects, for the story that asks what a full bar does. */
const MANY: ShellProject[] = Array.from({ length: 12 }, (_, index) => ({
  id: `project-${index}`,
  name: `Project number ${index + 1}`,
  tone: PROJECTS[index % PROJECTS.length]!.tone,
  pending: index % 3,
}))

interface HarnessProps {
  projects?: ShellProject[]
  sessions?: ShellSession[]
  collapsed?: boolean
  width?: number
  /** Whether the bell has anything left to show, which is the dot it wears. */
  unseen?: boolean
}

/**
 * The state the application holds for the shell, held by the story instead.
 *
 * The shell owns nothing: which Project is active, how wide the sidebar is and whether it is
 * folded all live outside it. That is what lets lot 3 put them in a profile without the shell
 * knowing, and it is why a story can drive the whole window with four `useState`.
 */
function Harness({
  projects: given = PROJECTS,
  sessions = SESSIONS,
  collapsed: folded = false,
  width: opening = SIDEBAR_DEFAULT,
  unseen = true,
}: HarnessProps) {
  const [projects, setProjects] = useState(given)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projects[0]?.id ?? null)
  const [activeEntryId, setActiveEntryId] = useState(sessions[0]?.id ?? JOURNAL_ENTRY)
  const [collapsed, setCollapsed] = useState(folded)
  const [width, setWidth] = useState(opening)

  // What the application does when the Dialog is validated, in one line: the first Project
  // arrives, it is the active one, and the shell has a sidebar from that moment on.
  const add = () => {
    const created: ShellProject = { id: 'first', name: 'Atlas', tone: 'primary', pending: 0 }
    setProjects([...projects, created])
    setActiveProjectId(created.id)
  }

  return (
    <Shell
      projects={projects}
      activeProjectId={activeProjectId}
      onSelectProject={setActiveProjectId}
      onAddProject={add}
      notifications={<p className="text-muted-foreground">Notifications: lot 4.</p>}
      unseen={unseen}
      onOpenSettings={() => undefined}
      sessions={sessions}
      activeEntryId={activeEntryId}
      onSelectEntry={setActiveEntryId}
      onOpenCommand={() => undefined}
      commandShortcut="Ctrl+K"
      collapseShortcut="Ctrl+B"
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      width={width}
      onWidthChange={setWidth}
    >
      {activeProjectId === null ? (
        <div className="flex flex-col items-start gap-4 p-6">
          <h1 className="text-2xl font-medium">Welcome to Hemera</h1>
          <p className="text-muted-foreground">
            The page of a first launch, which the Home of lot 4 draws properly.
          </p>
          <Button onClick={add}>Create the first Project</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 p-6">
          <h1 className="text-2xl font-medium">Home: lot 4</h1>
          {Array.from({ length: 40 }, (_, line) => (
            <p key={line} className="text-muted-foreground">
              A line of content, so that there is something to scroll. Line {line + 1}.
            </p>
          ))}
        </div>
      )}
    </Shell>
  )
}

const meta = {
  tags: ['autodocs'],
  title: 'Shell/Shell',
  component: Harness,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    projects: { table: { disable: true } },
    sessions: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Collapsed: Story = {
  args: { collapsed: true },
  play: async ({ canvasElement }) => {
    const rail = within(canvasElement).getByRole('complementary')
    await waitFor(() => {
      expect(rail.getBoundingClientRect().width).toBeCloseTo(SIDEBAR_RAIL, 0)
    })
  },
}

/** Scenario « Segment gauche aligné sur la sidebar » of `specs/window-shell/spec.md`. */
export const SegmentAlignedOnTheSidebar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sidebar = canvas.getByRole('complementary')
    const brand = canvas.getByText('Hemera').parentElement!

    await waitFor(() => {
      expect(brand.getBoundingClientRect().width).toBeCloseTo(
        sidebar.getBoundingClientRect().width,
        0,
      )
    })

    await userEvent.click(canvas.getByRole('button', { name: 'Collapse the sidebar' }))
    await waitFor(
      () => {
        expect(sidebar.getBoundingClientRect().width).toBeCloseTo(SIDEBAR_RAIL, 0)
        expect(brand.getBoundingClientRect().width).toBeCloseTo(SIDEBAR_RAIL, 0)
      },
      { timeout: 3000 },
    )
  },
}

/** Scenario « Repli en rail et dépli » of `specs/window-shell/spec.md`. */
export const FoldsToARailAndBack: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sidebar = canvas.getByRole('complementary')

    // Where the middle of an icon sits before the fold. Folding moves the panel, never what is
    // drawn in it: the icons of the rail are the icons of the sidebar, in the same place.
    const middleOfJournal = (): number => {
      const box = canvas.getByRole('button', { name: 'Journal' }).querySelector('svg')!
      const { left, width } = box.getBoundingClientRect()
      return Math.round(left + width / 2)
    }
    const before = middleOfJournal()

    await userEvent.click(canvas.getByRole('button', { name: 'Collapse the sidebar' }))
    await waitFor(
      () => {
        expect(sidebar.getBoundingClientRect().width).toBeCloseTo(SIDEBAR_RAIL, 0)
      },
      { timeout: 3000 },
    )

    // Dead centre of the rail, and exactly where it already was.
    expect(middleOfJournal()).toBe(before)
    expect(middleOfJournal()).toBe(Math.round(SIDEBAR_RAIL / 2))

    // Folded, every icon still says what it is — to a screen reader by name, and to everyone
    // else in a tooltip beside the rail.
    const journal = canvas.getByRole('button', { name: 'Journal' })
    await userEvent.hover(journal)
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Journal')
    })
    await userEvent.unhover(journal)

    await userEvent.click(canvas.getByRole('button', { name: 'Expand the sidebar' }))
    await waitFor(
      () => {
        expect(sidebar.getBoundingClientRect().width).toBeCloseTo(SIDEBAR_DEFAULT, 0)
      },
      { timeout: 3000 },
    )
  },
}

/** The add button adds a Project, and does not ask a second time in a panel of its own. */
export const AddsAProject: Story = {
  play: async ({ canvasElement }) => {
    const add = within(canvasElement).getByRole('button', { name: 'Add a Project' })
    await userEvent.click(add)
    // Nothing opens: the press is the whole of it.
    expect(within(document.body).queryByRole('dialog')).toBeNull()
  },
}

/** Scenario « Changement de Projet actif » of `specs/window-shell/spec.md`. */
export const AnotherProjectBecomesActive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: /Atlas/ })).toHaveAttribute('aria-current', 'page')

    await userEvent.click(canvas.getByRole('button', { name: /Notes/ }))
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Notes/ })).toHaveAttribute('aria-current', 'page')
    })
    // One Project at a time, which is the whole of what the mark says.
    expect(canvas.getByRole('button', { name: /Atlas/ })).not.toHaveAttribute('aria-current')
  },
}

/** Scenario « Séparateur au clavier » of `specs/window-shell/spec.md`. */
export const SeparatorFromTheKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const separator = canvas.getByRole('separator', { name: 'Sidebar width' })

    expect(separator).toHaveAttribute('aria-valuenow', String(SIDEBAR_DEFAULT))
    expect(separator).toHaveAttribute('aria-valuemin', String(SIDEBAR_MIN))
    expect(separator).toHaveAttribute('aria-valuemax', String(SIDEBAR_MAX))

    separator.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => {
      expect(Number(separator.getAttribute('aria-valuenow'))).toBeLessThan(SIDEBAR_DEFAULT)
    })

    // Home and End take it to the bounds and stop there.
    await userEvent.keyboard('{Home}')
    await waitFor(() => {
      expect(separator).toHaveAttribute('aria-valuenow', String(SIDEBAR_MIN))
    })
    await userEvent.keyboard('{ArrowLeft}')
    expect(separator).toHaveAttribute('aria-valuenow', String(SIDEBAR_MIN))
  },
}

/** Scenario « Largeur hors bornes fournie » of `specs/window-shell/spec.md`. */
export const AWidthOutsideTheBounds: Story = {
  args: { width: SIDEBAR_MAX * 4 },
  play: async ({ canvasElement }) => {
    const separator = within(canvasElement).getByRole('separator', { name: 'Sidebar width' })
    // It opens at the default rather than at the nearest bound, and the console says why.
    expect(separator).toHaveAttribute('aria-valuenow', String(SIDEBAR_DEFAULT))
  },
}

/** Scenario « Overlay au-dessus de la coquille et focus rendu » of `specs/window-shell/spec.md`. */
export const OverlayOverTheShell: Story = {
  play: async ({ canvasElement }) => {
    const bell = within(canvasElement).getByRole('button', { name: /Notifications/ })
    await userEvent.click(bell)
    const panel = await waitFor(() => within(document.body).getByRole('dialog'))

    // Inside the shell, so it wears the theme the page is wearing, and over the chrome.
    expect(canvasElement.contains(panel)).toBe(true)
    expect(within(panel).getByText('Notifications: lot 4.')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    expect(document.activeElement).toBe(bell)
  },
}

/** Scenario « Un seul niveau de défilement » of `specs/window-shell/spec.md`. */
export const OneLevelOfScrolling: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const content = canvas.getByRole('main')
    const bar = canvasElement.querySelector('header')!
    const before = bar.getBoundingClientRect().top

    content.scrollTop = 200
    await waitFor(() => {
      expect(content.scrollTop).toBeGreaterThan(0)
    })

    // The chrome bar, the sidebar and the separator stay where they are.
    expect(bar.getBoundingClientRect().top).toBe(before)
    expect(canvas.getByRole('complementary').scrollTop).toBe(0)
  },
}

/** Scenario « Boutons de fenêtre hors de la barre » of `specs/window-shell/spec.md`. */
export const ManyProjects: Story = {
  args: { projects: MANY },
  play: async ({ canvasElement }) => {
    const bar = canvasElement.querySelector('header')!
    const strip = canvasElement.querySelector('nav[aria-label="Projects"]')!

    // Nothing of ours is laid outside the strip the platform left us, however many tabs there
    // are: the strip ends inside the bar, and what does not fit scrolls out of sight in it.
    expect(strip.getBoundingClientRect().right).toBeLessThanOrEqual(
      bar.getBoundingClientRect().right + 1,
    )
    expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth)
  },
}

/**
 * Scenario « Aucun Projet au démarrage » of `specs/project-workspaces/spec.md`.
 *
 * What the shell is before anything has been created: the mark, and the page. No tab to press,
 * no sidebar to list Sessions that do not exist, no bell for events nobody has made yet, and no
 * fold, because there is nothing to fold — the keystroke that opens the command still belongs
 * to the application, and the one that folded the sidebar has nothing left to reach.
 */
export const NoProjectYet: Story = {
  args: { projects: [], sessions: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('complementary')).toBeNull()
    expect(canvas.queryByRole('separator', { name: 'Sidebar width' })).toBeNull()
    expect(canvas.queryByRole('navigation', { name: 'Projects' })).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Notifications' })).toBeNull()

    // The mark is what is left of the bar, and the page has the rest.
    expect(canvas.getByText('Hemera')).toBeInTheDocument()
    // The fold is not drawn at all, at either label it could wear: it folds the sidebar, and
    // there is no sidebar. Neither is anything else in the bar an `IconButton`.
    expect(canvas.queryByRole('button', { name: 'Collapse the sidebar' })).toBeNull()
    expect(canvas.queryByRole('button', { name: 'Expand the sidebar' })).toBeNull()

    // And the keystroke it advertised reaches nothing either: the window is what it was.
    await userEvent.keyboard('{Control>}b{/Control}')
    expect(canvas.queryByRole('complementary')).toBeNull()
    expect(canvas.queryByRole('separator', { name: 'Sidebar width' })).toBeNull()

    // The page is framed on all four sides. The left edge is normally the sidebar's and the
    // separator's; with neither of them drawn the sheet carries it itself, set in and drawn
    // exactly as the right one is, so the two sides of the window read the same.
    const frame = getComputedStyle(canvas.getByRole('main'))
    expect(frame.marginLeft).toBe(frame.marginRight)
    expect(frame.borderLeftWidth).toBe(frame.borderRightWidth)
    expect(frame.borderTopLeftRadius).toBe(frame.borderTopRightRadius)
    expect(frame.borderBottomLeftRadius).toBe(frame.borderBottomRightRadius)
  },
}

/** Scenario « Premier Projet créé » of `specs/project-workspaces/spec.md`. */
export const TheFirstProjectArrives: Story = {
  args: { projects: [], sessions: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('complementary')).toBeNull()

    // The story stands in for the Dialog: what the shell is handed is a Project, and what it
    // does with it is grow a tab, a sidebar and a bell in one arrival.
    await userEvent.click(canvas.getByRole('button', { name: 'Create the first Project' }))

    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /Atlas/ })).toHaveAttribute('aria-current', 'page')
    })
    await waitFor(() => {
      expect(canvas.getByRole('complementary')).toBeInTheDocument()
    })
    expect(canvas.getByRole('button', { name: /Notifications/ })).toBeInTheDocument()
  },
}

/** Scenario « Rien à voir » of `specs/shell-navigation/spec.md`: the bell wears no dot. */
export const NothingToSee: Story = {
  args: { unseen: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Named for what it is, and nothing drawn on it: the dot and the name arrive together.
    expect(canvas.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: 'Notifications, some unseen' })).toBeNull()
  },
}

/** The same shell with the system asking for less movement: the end state, and no journey. */
export const ReducedMotion: Story = {
  play: async ({ canvasElement }) => {
    const restore = await emulateReducedMotion()
    try {
      const canvas = within(canvasElement)
      const sidebar = canvas.getByRole('complementary')
      await userEvent.click(canvas.getByRole('button', { name: 'Collapse the sidebar' }))
      await waitFor(() => {
        expect(sidebar.getBoundingClientRect().width).toBeCloseTo(SIDEBAR_RAIL, 0)
      })
    } finally {
      await restore?.()
    }
  },
}
