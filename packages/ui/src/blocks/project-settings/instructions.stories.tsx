import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { INSTRUCTIONS, READERS } from './agent-settings-fixtures.ts'
import { InstructionsSection } from './instructions.tsx'

/**
 * The Project's layer of instructions: for each repository, the instruction files it holds, each
 * opened by pressing it; and for each agent, whether it reads them by itself or Hemera sends them
 * to it. A repository with no file shows nothing in the agents' columns.
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
 * Acme: `api` holds both files, `web` AGENTS.md, `shared` CLAUDE.md, `billing` none. Claude Code
 * reads CLAUDE.md by itself, so Hemera sends it `web`'s AGENTS.md.
 */
export const Filled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table', { name: 'Instructions' })
    expect(within(table).getAllByRole('row')).toHaveLength(5)
    expect(
      within(table).getByRole('img', { name: 'Claude Code reads CLAUDE.md of api by itself' }),
    ).toBeInTheDocument()
    expect(
      within(table).getByRole('img', { name: 'Hemera sends AGENTS.md of web to Claude Code' }),
    ).toBeInTheDocument()
    const billing = within(table).getByRole('row', { name: /^billing/ })
    expect(within(billing).queryAllByRole('img')).toHaveLength(0)
    await userEvent.click(within(table).getByRole('button', { name: 'Open AGENTS.md of web' }))
    expect(args.onOpen).toHaveBeenCalledWith('web', 'AGENTS.md')
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

/** A long repository path ends in an ellipsis; the agents' columns stay where they are. */
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

/**
 * From the keyboard: a row's files in order, then the glyphs of its agents, each saying its legend;
 * Enter on a file opens it.
 */
export const Focused: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: 'Open CLAUDE.md of api' }).focus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: 'Open AGENTS.md of api' })).toHaveFocus()
    await userEvent.tab()
    expect(
      canvas.getByRole('img', { name: 'Claude Code reads CLAUDE.md of api by itself' }),
    ).toHaveFocus()
    canvas.getByRole('button', { name: 'Open AGENTS.md of web' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(args.onOpen).toHaveBeenCalledWith('web', 'AGENTS.md')
  },
}
