import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CommandsPanel, type CommandPanelRun } from './commands-panel.tsx'

/**
 * The commands of a Session (design D6-12).
 *
 * The stories are what the panel is for: an application the agent started, still up, with its
 * address one press away; a check that is over; a one-off line the reader types; and a Session
 * that has run nothing. Whoever started the command, it is watched from here.
 */
const SERVER: CommandPanelRun = {
  id: 'run-dev',
  name: 'dev',
  command: 'pnpm dev',
  type: 'serve',
  state: 'running',
  folder: 'apps/desktop',
  output: 'vite v7.1.4\n\n  Local:   http://localhost:5173/',
  url: 'http://localhost:5173/',
}

const CHECK: CommandPanelRun = {
  id: 'run-check',
  name: 'check',
  command: 'pnpm check',
  type: 'test',
  state: 'finished',
  folder: '.',
  output: 'Test Files  155 passed (155)',
  exitCode: 0,
}

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Session/CommandsPanel',
  component: CommandsPanel,
  parameters: { layout: 'padded' },
  args: {
    runs: [SERVER, CHECK],
    onStop: fn(),
    onOpenUrl: fn(),
    onRun: fn(),
  },
  argTypes: {
    runs: { control: 'object', description: 'The runs of this Session, oldest first.' },
    onStop: { control: false, description: 'Stops one of them.' },
    onOpenUrl: { control: false, description: 'Opens the address a run published.' },
    onRun: { control: false, description: 'Runs a one-off line inside the Workspace root.' },
  },
} satisfies Meta<typeof CommandsPanel>

export default meta

type Story = StoryObj<typeof meta>

/** A server the agent started, still up: the count is what the reader came for. */
export const AppRunning: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('1 running')).toBeVisible()
    await expect(canvas.getAllByText('dev').length).toBeGreaterThan(0)
    await userEvent.click(canvas.getByRole('button', { name: 'http://localhost:5173/' }))
    await expect(args.onOpenUrl).toHaveBeenCalledWith('http://localhost:5173/')
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(args.onStop).toHaveBeenCalledWith('run-dev')
  },
}

/** A one-off line: it runs, it shows here, and nothing promotes it to the catalogue. */
export const OneOffLine: Story = {
  args: { runs: [CHECK] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const line = canvas.getByLabelText('Run a line')
    await userEvent.type(line, 'pnpm drizzle-kit generate')
    await userEvent.click(canvas.getByRole('button', { name: 'Run' }))
    await expect(args.onRun).toHaveBeenCalledWith('pnpm drizzle-kit generate')
    // The line is spent once it is run: what is in the box is a command that has not run yet.
    await expect(line).toHaveValue('')
  },
}

/** A Session that has run nothing: the panel says so, and offers the line anyway. */
export const Empty: Story = {
  args: { runs: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('No command has run in this Session.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Run' })).toBeDisabled()
  },
}

/** A process the reader stopped under the agent: it is over, and the line says how. */
export const Stopped: Story = {
  args: {
    runs: [{ ...SERVER, state: 'stopped', output: 'vite v7.1.4\n^C' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Stopped')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Stop' })).toBeNull()
  },
}
