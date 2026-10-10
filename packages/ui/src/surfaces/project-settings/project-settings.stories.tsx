import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { FAILED_RUN, RUNS, STALE } from '../../blocks/project-settings/project-settings-fixtures.ts'
import { SettingsFixture } from './settings-fixtures.tsx'

/**
 * A Project's settings: its sections listed down the left, the one chosen beside them, and the
 * design system's dialog, centred, where one thing of a section is written. Under the window's
 * header, which carries the trail `Acme › Settings`. Each story is the page full-bleed; the toolbar's
 * viewports give its two sizes.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Project settings',
  component: SettingsFixture,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsFixture>

export default meta
type Story = StoryObj<typeof meta>

/** Acme as it is lived in: its repositories, one of them not fetched since Monday. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Settings of the Project' })
    expect(within(nav).getByRole('button', { name: 'Repositories' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const list = canvas.getByRole('list', { name: 'Repositories' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(list).toHaveTextContent('not fetched since Monday')
  },
}

/** The setup launched from the settings, at any time: its button at the header's end. */
export const SetUp: Story = {
  args: { setUp: { onStart: fn() } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Set up with an agent' }))
    expect(args.setUp?.onStart).toHaveBeenCalled()
  },
}

/** No agent can run the setup, or its launch was refused: why, beside the button. */
export const SetUpRefused: Story = {
  args: {
    setUp: { onStart: fn(), refused: 'Claude Code is not signed in', unavailable: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Claude Code is not signed in')).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Set up with an agent' })).toBeDisabled()
  },
}

/** A long refusal of the launch: it wraps beside the button, read whole, never cut. */
export const SetUpRefusedAtLength: Story = {
  args: {
    setUp: {
      onStart: fn(),
      refused:
        'The setup agent could not start: Hemera could not write to its profile, the disk holding its data folder is full. Free some room on that disk, or move the data folder to another one from the application’s settings, then launch the setup again.',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const said = canvas.getByRole('status')
    expect(said).toHaveTextContent(/then launch the setup again\.$/)
    // Read whole: nothing of it cut, nothing past the window's edge, the button beside it.
    expect(said.scrollWidth).toBeLessThanOrEqual(said.clientWidth)
    const edge = document.documentElement.clientWidth
    expect(said.getBoundingClientRect().right).toBeLessThanOrEqual(edge)
    const button = canvas.getByRole('button', { name: 'Set up with an agent' })
    expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(edge)
  },
}

/** A Project just added from a folder: one repository, nothing else written; each section says so. */
export const Empty: Story = {
  args: { empty: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Commands' }))
    expect(await canvas.findByRole('heading', { name: 'No command yet' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Services' }))
    expect(await canvas.findByRole('heading', { name: 'Nothing runs' })).toBeVisible()
  },
}

/**
 * The frame at its fullest: fourteen sections, five repositories — one Git cannot read, one with
 * no remote, one left out of Workspaces — and twenty commands.
 */
export const Dense: Story = {
  args: { dense: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Settings of the Project' })
    // Never run stands under the catalogue, not as a section of its own.
    expect(within(nav).getAllByRole('button')).toHaveLength(14)
    // The problem is found from any section: its glyph is in the list.
    expect(
      within(nav).getByRole('button', { name: 'Repositories, billing cannot be read' }),
    ).toBeInTheDocument()
    expect(canvas.getAllByRole('listitem')).toHaveLength(5)
    await userEvent.click(within(nav).getByRole('button', { name: 'Commands' }))
    expect(
      within(await canvas.findByRole('list', { name: 'Commands' })).getAllByRole('listitem'),
    ).toHaveLength(20)
  },
}

/** Everything on its way: each section holds its rows' own shape, the list of sections is there. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('list', { busy: true })).toBeInTheDocument()
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
    await userEvent.click(canvas.getByRole('button', { name: 'Commands' }))
    await waitFor(() => {
      // The catalogue's four rows, then the three of Never run under it.
      expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(7)
    })
  },
}

/** The Project could not be read: said where the section would be, in words, and Try again. */
export const Error: Story = {
  args: { error: '~/work/acme is not readable: permission denied.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('alert')).toHaveTextContent('Hemera could not read Acme')
    expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

/** The repositories, one of which Git cannot read: its own words where its base would be. */
export const Unreadable: Story = {
  args: { dense: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvasElement.querySelector('[data-repository="billing"]')
    expect(row).toHaveTextContent('fatal: not a git repository')
    await userEvent.click(canvas.getByRole('button', { name: /^billing/ }))
    const dialog = await within(document.body).findByRole('dialog', { name: 'billing' })
    expect(within(dialog).getByRole('alert')).toHaveTextContent('not a git repository')
  },
}

/**
 * Where the Workspaces go and what their branches start with: empty fields show the defaults, and
 * under them the folder and the branch they make for ACME-12.
 */
export const Workspaces: Story = {
  args: { section: 'workspaces' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const prefix = canvas.getByRole('textbox', { name: 'Branch prefix' })
    expect(prefix).toHaveAttribute('placeholder', 'acme/')
    expect(canvasElement.querySelector('[data-example-branch]')).toHaveTextContent('acme/ACME-12')
    expect(canvasElement.querySelector('[data-example-folder]')).toHaveTextContent(
      '~/hemera-workspaces/acme/ACME-12',
    )
    await userEvent.type(prefix, 'team..acme/')
    expect(await canvas.findByText(/is not a branch name Git accepts: it holds “..”/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Back to the default prefix' }))
    expect(prefix).toHaveValue('')
  },
}

/** The command catalogue: a line per command, its roles read down the columns. */
export const Commands: Story = {
  args: { section: 'commands' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Commands' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(9)
    expect(within(list).getByRole('button', { name: /^db\b.*asks before running/ })).toBeVisible()
  },
}

/** A command's dialog: a line typed with shell syntax is refused as it is typed, the token named. */
export const CommandOpen: Story = {
  args: { section: 'commands', form: { kind: 'command', id: 'test' } },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'test' })
    const line = within(dialog).getByRole('textbox', { name: 'Line' })
    await userEvent.type(line, ' && pnpm lint')
    expect(await within(dialog).findByText(/“&&” is shell syntax/)).toBeVisible()
  },
}

/** A new command, from the head of the catalogue. */
export const CommandNew: Story = {
  args: { section: 'commands' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add a command' }))
    const dialog = await within(document.body).findByRole('dialog', { name: 'New command' })
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'storybook')
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Line' }), 'pnpm storybook')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    expect(
      within(canvas.getByRole('list', { name: 'Commands' })).getAllByRole('listitem'),
    ).toHaveLength(10)
  },
}

/** The preparation recipe: its steps in order, one whose source is not in the main checkout. */
export const Preparation: Story = {
  args: { section: 'preparation' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const steps = canvas.getByRole('list', { name: 'Steps' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(5)
    expect(steps).toHaveTextContent('not in the main checkout')
  },
}

/** The variables, masked; the eye shows one value, and hides it again. */
export const Variables: Story = {
  args: { section: 'variables' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const show = canvas.getByRole('button', { name: 'Show the value of DATABASE_URL' })
    await userEvent.click(show)
    expect(await canvas.findByText('postgres://acme@localhost:5432/acme_{workspace}')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Hide the value of DATABASE_URL' }))
    expect(canvas.queryByText('postgres://acme@localhost:5432/acme_{workspace}')).toBeNull()
  },
}

/** What runs in the main checkout, as a table: live lines, a service to start, a command waiting for you. */
export const Services: Story = {
  args: { section: 'services', runs: [...RUNS, FAILED_RUN] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Running in the main checkout' })
    expect(within(list).getByRole('button', { name: /^docs, running/ })).toBeVisible()
    expect(within(list).getByRole('button', { name: /^search, failed/ })).toBeVisible()
    expect(within(list).getByRole('img', { name: 'Waiting for you' })).toBeVisible()
    await userEvent.click(within(list).getByRole('button', { name: 'Run db' }))
    expect(await within(list).findByRole('button', { name: /^db, running/ })).toBeVisible()
  },
}

/**
 * The commands never run in Acme, whoever asks, under the catalogue in the Commands section, since
 * they are commands too: a line each, its bin at its end. No section of its own.
 */
export const NeverRun: Story = {
  args: { section: 'commands' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Settings of the Project' })
    expect(within(nav).queryByRole('button', { name: 'Never run' })).toBeNull()
    expect(canvas.getByRole('list', { name: 'Commands' })).toBeVisible()
    const list = canvas.getByRole('list', { name: 'Never run' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
  },
}

/** A command added to the list from its dialog; one already refused is said so under its field. */
export const NeverRunAdd: Story = {
  args: { section: 'commands' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Refuse a command' }))
    const dialog = await within(document.body).findByRole('dialog', { name: 'Never run' })
    const field = within(dialog).getByRole('textbox', { name: 'Command' })
    await userEvent.type(field, 'terraform apply')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(await within(dialog).findByText('“terraform apply” is already refused.')).toBeVisible()
    await userEvent.clear(field)
    await userEvent.type(field, 'kubectl delete namespace acme')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(
        within(canvas.getByRole('list', { name: 'Never run' })).getAllByRole('listitem'),
      ).toHaveLength(5)
    })
  },
}

/**
 * The model of each role in Acme: two overridden, each with its ×; the others on the application's
 * model, said in the quiet tone under "App default". The trigger is the model picker's slot.
 */
export const ModelsByRole: Story = {
  args: { section: 'models' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('button', { name: /^Back to the app default for/ })).toHaveLength(2)
    expect(canvas.getAllByText('App default')).toHaveLength(4)
  },
}

/** The cap and the budget of a mission: empty fields show the application's values. */
export const CapAndBudget: Story = {
  args: { section: 'budget' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('textbox', { name: 'Sub-agents at once' })).toHaveAttribute(
      'placeholder',
      '3',
    )
    expect(canvas.getByRole('textbox', { name: 'Launches' })).toHaveValue('24')
  },
}

/** The instruction files of each repository, and how each agent gets them. */
export const Instructions: Story = {
  args: { section: 'instructions' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Instructions' })
    expect(
      within(list).getByRole('img', { name: 'Codex reads AGENTS.md of api by itself' }),
    ).toBeInTheDocument()
  },
}

/** The agent sections of a Project just added: nothing refused, every role on the app's model. */
export const AgentSectionsEmpty: Story = {
  args: { empty: true, section: 'commands' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Nothing refused' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Models by role' }))
    expect(await canvas.findAllByText('App default')).toHaveLength(6)
    await userEvent.click(canvas.getByRole('button', { name: 'Instructions' }))
    expect(await canvas.findByRole('heading', { name: 'No instruction file' })).toBeVisible()
  },
}

/** A save that meets a newer version of the Project: refused, in the engine's words, the draft kept. */
export const RefusedSave: Story = {
  args: { refuse: true, form: { kind: 'repository', id: 'api' } },
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'api' })
    const branch = within(dialog).getByRole('textbox', { name: 'Base branch' })
    await userEvent.clear(branch)
    await userEvent.type(branch, 'develop')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(STALE)
    expect(branch).toHaveValue('develop')
  },
}

/** A long path and a long line in every field that holds one: each ends in an ellipsis. */
export const LongText: Story = {
  args: { long: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvasElement.querySelector(
      '[data-repository="services/platform-api-and-background-workers"]',
    )
    expect(row).not.toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Commands' }))
    const test = await canvas.findByRole('button', { name: /^test\b.*Test/ })
    const line = within(test).getByText(/--reporter=verbose/)
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
  },
}

/** Hemera itself: one repository, the main checkout, its base `dev`. */
export const Hemera: Story = {
  args: { project: 'hemera' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent('Hemera')
    expect(canvas.getByRole('list', { name: 'Repositories' })).toHaveTextContent('origin/dev')
  },
}

/**
 * From the keyboard: the list of sections, Enter on one; into its lines, Enter opens its form in a dialog
 * which takes the focus; Escape closes it and the focus is back on the line.
 */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Settings of the Project' })
    within(nav).getByRole('button', { name: 'Repositories' }).focus()
    await userEvent.tab()
    const workspaces = within(nav).getByRole('button', { name: 'Workspaces' })
    expect(workspaces).toHaveFocus()
    await waitFor(() => {
      expect(getComputedStyle(workspaces, '::after').opacity).toBe('1')
    })
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    expect(within(nav).getByRole('button', { name: 'Commands' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const build = await canvas.findByRole('button', { name: /^build\b.*Build/ })
    build.focus()
    await userEvent.keyboard('{Enter}')
    const dialog = await within(document.body).findByRole('dialog', { name: 'build' })
    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    expect(build).toHaveFocus()
  },
}

/** Asked for less movement: the form's dialog is there at once, and the list's mark does not travel. */
export const ReducedMotion: Story = {
  args: { section: 'commands', form: { kind: 'command', id: 'build' } },
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <SettingsFixture {...args} />
    </MotionConfig>
  ),
  play: async () => {
    const dialog = await within(document.body).findByRole('dialog', { name: 'build' })
    expect(dialog).toBeVisible()
  },
}
