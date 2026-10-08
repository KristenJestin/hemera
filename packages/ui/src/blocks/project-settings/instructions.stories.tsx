import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { INSTRUCTIONS, MANY_READERS, READERS } from './agent-settings-fixtures.ts'
import { InstructionsSection } from './instructions.tsx'

/**
 * The Project's layer of instructions: a line per repository with the instruction files it holds,
 * each opened by pressing it, and on each file the marks of the agents that read it by themselves.
 * One sentence says that Hemera sends a file to the others. Its width never follows how many
 * agents there are: the list stays readable however many agents Hemera comes to support.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Instructions',
  component: InstructionsSection,
  parameters: { layout: 'fullscreen' },
  args: { repositories: INSTRUCTIONS, agents: READERS, onOpen: fn() },
  argTypes: {
    repositories: { table: { disable: true } },
    agents: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InstructionsSection>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Acme: `api` holds both files, `web` AGENTS.md, `shared` CLAUDE.md, `billing` none. Claude Code's
 * mark stands on CLAUDE.md, Codex's and OpenCode's on AGENTS.md; Hemera sends `web`'s AGENTS.md to
 * Claude Code, which the sentence under the list says once.
 */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Instructions' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
    expect(canvas.queryByRole('columnheader')).toBeNull()
    expect(
      within(list).getByRole('img', { name: 'Claude Code reads CLAUDE.md of api by itself' }),
    ).toBeInTheDocument()
    expect(
      within(list).getByRole('img', { name: 'Codex reads AGENTS.md of web by itself' }),
    ).toBeInTheDocument()
    expect(canvas.getByText(/Hemera sends one of its files to the agents/)).toBeVisible()
    await userEvent.click(within(list).getByRole('button', { name: 'Open AGENTS.md of web' }))
    expect(args.onOpen).toHaveBeenCalledWith('web', 'AGENTS.md')
  },
}

/** Twelve agents: the line of each repository is as wide as with three. */
export const ManyAgents: Story = {
  args: { agents: MANY_READERS },
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole('list', { name: 'Instructions' })
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth)
  },
}

/** No file can be opened yet: each file is said by its name, not offered as a button. */
export const NotOpened: Story = {
  render: (args) => <InstructionsSection repositories={args.repositories} agents={args.agents} />,
  play: async ({ canvasElement }) => {
    const list = within(canvasElement).getByRole('list', { name: 'Instructions' })
    expect(within(list).queryByRole('button', { name: /^Open / })).toBeNull()
    expect(within(list).getAllByText('AGENTS.md').length).toBeGreaterThan(0)
  },
}

/** No repository holds an instruction file: the section says so. */
export const Empty: Story = {
  args: { repositories: INSTRUCTIONS.map((one) => ({ ...one, files: [] })) },
  play: async ({ canvasElement }) => {
    expect(
      within(canvasElement).getByRole('heading', { name: 'No instruction file' }),
    ).toBeVisible()
  },
}

/** The rows on their way: each holds a row's own shape. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(3)
  },
}

/** A long repository path ends in an ellipsis; its files stay where they are. */
export const LongText: Story = {
  args: {
    repositories: [
      ...INSTRUCTIONS,
      { repository: 'services/platform-api-and-background-workers', files: ['AGENTS.md'] },
    ],
  },
  play: async ({ canvasElement }) => {
    const path = within(canvasElement).getByText('services/platform-api-and-background-workers')
    expect(getComputedStyle(path).textOverflow).toBe('ellipsis')
  },
}

/** From the keyboard: a line's files in order, then its agents' marks, each saying its legend. */
export const Focused: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: 'Open CLAUDE.md of api' }).focus()
    await userEvent.tab()
    expect(
      canvas.getByRole('img', { name: 'Claude Code reads CLAUDE.md of api by itself' }),
    ).toHaveFocus()
    canvas.getByRole('button', { name: 'Open AGENTS.md of web' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(args.onOpen).toHaveBeenCalledWith('web', 'AGENTS.md')
  },
}
