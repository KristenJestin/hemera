import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { FAILED_RUN, RUNS, STALE } from '../../blocks/project-settings/project-settings-fixtures.ts'
import { SettingsFixture } from './settings-fixtures.tsx'

/**
 * A Project's settings: its sections listed down the left, the one chosen beside them, and a
 * sheet slid in from the right where one thing of a section is written. Under the sheet's header,
 * which carries the trail `Acme › Settings`. Each story is the page full-bleed; the toolbar's
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
 * The frame at its fullest: a dozen sections, five repositories — one Git cannot read, one with
 * no remote, one left out of Workspaces — and twenty commands.
 */
export const Dense: Story = {
  args: { dense: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const nav = canvas.getByRole('navigation', { name: 'Settings of the Project' })
    expect(within(nav).getAllByRole('button')).toHaveLength(12)
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
      expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(4)
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
    const sheet = await canvas.findByRole('dialog', { name: 'billing' })
    expect(within(sheet).getByRole('alert')).toHaveTextContent('not a git repository')
  },
}

/** Where the Workspaces go and what their branches start with: empty fields show the defaults. */
export const Workspaces: Story = {
  args: { section: 'workspaces' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const prefix = canvas.getByRole('textbox', { name: 'Branch prefix' })
    expect(prefix).toHaveAttribute('placeholder', 'acme')
    await userEvent.type(prefix, 'team..acme')
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

/** A command's sheet: a line typed with shell syntax is refused as it is typed, the token named. */
export const CommandOpen: Story = {
  args: { section: 'commands', sheet: { kind: 'command', id: 'test' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sheet = await canvas.findByRole('dialog', { name: 'test' })
    expect(canvasElement.querySelector('[data-settings-page]')).toHaveAttribute('inert')
    const line = within(sheet).getByRole('textbox', { name: 'Line' })
    await userEvent.type(line, ' && pnpm lint')
    expect(await within(sheet).findByText(/“&&” is shell syntax/)).toBeVisible()
  },
}

/** A new command, from the head of the catalogue. */
export const CommandNew: Story = {
  args: { section: 'commands' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Add a command' }))
    const sheet = await canvas.findByRole('dialog', { name: 'New command' })
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Name' }), 'storybook')
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Line' }), 'pnpm storybook')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Add' }))
    await waitFor(() => {
      expect(canvas.queryByRole('dialog')).toBeNull()
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

/** What runs in the main checkout: live chips, a service to start, a command waiting for you. */
export const Services: Story = {
  args: { section: 'services', runs: [...RUNS, FAILED_RUN] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Running in the main checkout' })
    expect(within(list).getByRole('button', { name: 'docs, running' })).toBeVisible()
    expect(within(list).getByRole('button', { name: 'search, failed' })).toBeVisible()
    expect(within(list).getByRole('img', { name: 'Waiting for you' })).toBeVisible()
    await userEvent.click(within(list).getByRole('button', { name: 'Run db' }))
    expect(await within(list).findByRole('button', { name: 'db, running' })).toBeVisible()
  },
}

/** A save that meets a newer version of the Project: refused, in the engine's words, the draft kept. */
export const RefusedSave: Story = {
  args: { refuse: true, sheet: { kind: 'repository', id: 'api' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sheet = await canvas.findByRole('dialog', { name: 'api' })
    const branch = within(sheet).getByRole('textbox', { name: 'Base branch' })
    await userEvent.clear(branch)
    await userEvent.type(branch, 'develop')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(STALE)
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
 * From the keyboard: the list of sections, Enter on one; into its lines, Enter opens a sheet whose
 * title takes the focus; Escape closes it and the focus is back on the line.
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
    const sheet = await canvas.findByRole('dialog', { name: 'build' })
    await waitFor(() => {
      expect(within(sheet).getByRole('heading', { name: 'build' })).toHaveFocus()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(canvas.queryByRole('dialog')).toBeNull()
    })
    expect(build).toHaveFocus()
  },
}

/** Asked for less movement: the sheet is there at once, and the list's mark does not travel. */
export const ReducedMotion: Story = {
  args: { section: 'commands', sheet: { kind: 'command', id: 'build' } },
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <SettingsFixture {...args} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    const sheet = within(canvasElement).getByRole('dialog', { name: 'build' })
    expect(getComputedStyle(sheet).transform).toMatch(/none|matrix\(1, 0, 0, 1, 0, 0\)/)
  },
}
