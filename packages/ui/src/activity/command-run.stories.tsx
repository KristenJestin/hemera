import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CommandRun } from './command-run.tsx'

/**
 * A command Hemera runs for a Session (design D6-12).
 *
 * The stories are the four ways a run is read: an application that is running and has just
 * published its address, a check that is over and exited clean, a one-off line run inside the
 * Workspace root, and a process the reader stopped. The address is the reason the block exists,
 * so it is on the line in every story that has one.
 */
const SERVER_OUTPUT = [
  'vite v7.1.4 building for development...',
  '',
  '  Local:   http://localhost:5173/',
  '  press h + enter to show help',
].join('\n')

const CHECK_OUTPUT = [
  '> hemera@0.0.0 check',
  '> pnpm typecheck && pnpm lint && pnpm test',
  '',
  'Test Files  155 passed (155)',
  '     Tests  1192 passed | 2 skipped (1194)',
].join('\n')

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Activity/CommandRun',
  component: CommandRun,
  parameters: { layout: 'padded' },
  args: {
    name: 'dev',
    command: 'pnpm dev',
    kind: 'app',
    state: 'running',
    folder: 'apps/desktop',
    output: SERVER_OUTPUT,
    url: 'http://localhost:5173/',
    onOpenUrl: fn(),
    onStop: fn(),
  },
  argTypes: {
    name: { control: 'text', description: 'The name the catalogue keeps it under.' },
    command: { control: 'text', description: 'The command line, as it was run.' },
    kind: {
      control: 'inline-radio',
      options: ['app', 'check', 'utility'],
      description: 'What the command is for.',
    },
    state: {
      control: 'inline-radio',
      options: ['running', 'finished', 'failed', 'stopped'],
      description: 'Where the process stands. A running process stays open.',
    },
    folder: { control: 'text', description: 'The folder it runs in.' },
    output: { control: 'text', description: 'What it has written so far.' },
    url: { control: 'text', description: 'The address its output named.' },
    exitCode: { control: 'number', description: 'What it exited with.' },
    oneOff: { control: 'boolean', description: 'A line run without being in the catalogue.' },
    onOpenUrl: { control: false, description: 'Opens the published address.' },
    onStop: { control: false, description: 'Stops the process.' },
  },
} satisfies Meta<typeof CommandRun>

export default meta

type Story = StoryObj<typeof meta>

/** A server that is up: the address is on the line, and one press opens it. */
export const AppRunning: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('pnpm dev')).toBeVisible()
    // Two badges say it: the run's own line and the terminal panel it holds.
    await expect(canvas.getAllByText('Running').length).toBeGreaterThan(0)
    // A running process is what the reader is waiting on: the run's line is open, and the console
    // inside it is open too, so the output is on the page without a press. The console is named
    // after its terminal, which is what tells the two open lines apart.
    await expect(canvas.getByRole('button', { name: 'dev Running' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(canvas.getByText(/press h \+ enter to show help/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'http://localhost:5173/' }))
    await expect(args.onOpenUrl).toHaveBeenCalledWith('http://localhost:5173/')
    await userEvent.click(canvas.getByRole('button', { name: 'Stop' }))
    await expect(args.onStop).toHaveBeenCalled()
  },
}

/** A check that is over: the exit code is read without opening anything. */
export const CheckExitedClean: Story = {
  args: {
    name: 'check',
    command: 'pnpm check',
    kind: 'check',
    state: 'finished',
    folder: '.',
    output: CHECK_OUTPUT,
    url: undefined,
    exitCode: 0,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Exited 0')).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Exited 0/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
}

/** A check that failed: the exit code carries the colour, and the output is one press away. */
export const CheckFailed: Story = {
  args: {
    name: 'test',
    command: 'pnpm test',
    kind: 'check',
    state: 'failed',
    folder: '.',
    output: 'Test Files  1 failed (1)\n      Tests  3 failed (3)',
    url: undefined,
    exitCode: 1,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Exited 1')).toBeVisible()
    // The run's line is open on a failure, and the console it holds was released, so it folds like
    // the rest of the turn: one press brings the output back.
    await userEvent.click(canvas.getByRole('button', { name: 'test Released' }))
    await expect(canvas.getByText(/3 failed/)).toBeVisible()
  },
}

/** A one-off line: it is marked as one, and nothing promotes it to the catalogue. */
export const OneOff: Story = {
  args: {
    name: 'pnpm drizzle-kit generate',
    command: 'pnpm drizzle-kit generate',
    kind: 'utility',
    state: 'finished',
    folder: 'apps/desktop',
    output: '1 tables\nproject_commands 1ms',
    url: undefined,
    exitCode: 0,
    oneOff: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('One-off')).toBeVisible()
    await expect(canvas.getByText('utility')).toBeVisible()
  },
}

/** A process the reader stopped: nothing exited, and the line says so. */
export const Stopped: Story = {
  args: {
    name: 'dev',
    state: 'stopped',
    output: `${SERVER_OUTPUT}\n^C`,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Stopped')).toBeVisible()
    // The name is exact: the fold's own line carries the word "Stopped", and what is asked for
    // is the press that would end a process that is already over.
    await expect(canvas.queryByRole('button', { name: 'Stop' })).toBeNull()
  },
}
