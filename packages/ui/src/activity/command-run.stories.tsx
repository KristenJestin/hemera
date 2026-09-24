import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { movesLess } from '../../.storybook/reduced-motion.ts'
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
      description: 'Where the process stands. A running process stays open; an ended one folds.',
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

/**
 * One fold, the run's own: its line, and one chevron at the end of it (trial of 23 September
 * 2026). The console inside used to draw a line of its own, so a running `dev` read `dev
 * Running` twice, under two chevrons.
 */
async function oneHeader(canvasElement: HTMLElement, word: string, name?: string): Promise<void> {
  const canvas = within(canvasElement)
  const folds = canvas.queryAllByRole('button', { expanded: true }).length
  const closed = canvas.queryAllByRole('button', { expanded: false }).length
  await expect(folds + closed, 'more than one fold in the run').toBe(1)
  // The name is counted where it is not also the kind or the command line.
  if (name !== undefined) await expect(canvas.getAllByText(name, { exact: true })).toHaveLength(1)
  await expect(canvas.getAllByText(new RegExp(`^${word}`))).toHaveLength(1)
}

/** A server that is up: the address is on the line, and one press opens it. */
export const AppRunning: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('pnpm dev')).toBeVisible()
    await oneHeader(canvasElement, 'Running', 'dev')
    // A running process is what the reader is waiting on: the run's line is open, and the output
    // is on the page without a press, as the log of that one line.
    await expect(canvas.getByRole('button', { name: /^dev Running/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(canvas.getByRole('log', { name: 'Output of dev' })).toBeVisible()
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
    const row = canvas.getByRole('button', { name: /Exited 0/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await oneHeader(canvasElement, 'Exited')
    // Opened, the output is right under the run's line: no second fold to open inside it.
    await userEvent.click(row)
    await expect(canvas.getByText(/1192 passed/)).toBeVisible()
    await oneHeader(canvasElement, 'Exited')
  },
}

/** A check that failed: the exit code carries the colour, and the output is read in place. */
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
    // The run's line is open on a failure, and what it holds is the log itself.
    await oneHeader(canvasElement, 'Exited', 'test')
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
    await userEvent.click(canvas.getByRole('button', { name: /Exited 0/ }))
    await expect(canvas.getByText(/project_commands 1ms/)).toBeVisible()
    await oneHeader(canvasElement, 'Exited')
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
    await userEvent.click(canvas.getByRole('button', { name: /^dev Stopped/ }))
    await expect(canvas.getByText(/\^C/)).toBeVisible()
    await oneHeader(canvasElement, 'Stopped', 'dev')
    // The console was released with the process: nothing says it again, not even as "Released".
    await expect(canvas.queryByText('Released')).toBeNull()
  },
}

/** A process that has written nothing yet: the run's line, and an empty log under it. */
export const Empty: Story = {
  args: { output: '', url: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await oneHeader(canvasElement, 'Running', 'dev')
    const log = canvas.getByRole('log', { name: 'Output of dev' })
    await expect(log).toBeInTheDocument()
    await expect(log.textContent).toBe('')
  },
}

/**
 * A failed run folds (recette 4 of 23 September 2026): it opens on its output, and once it is
 * over the fold is the reader's. It used to be held open for good, in the way of the thread.
 */
export const AFailedRunFolds: Story = {
  args: {
    name: 'bun',
    command: 'bun run check',
    kind: 'utility',
    state: 'failed',
    folder: '.',
    output: 'error: script "check" exited with code 1',
    url: undefined,
    exitCode: 1,
    oneOff: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^bun Exited 1/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => {
      expect(canvas.queryByText(/exited with code 1/)).toBeNull()
    })
  },
}

/** A running run stays open: a press on its line does not fold the process the reader waits on. */
export const ARunningRunStaysOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^dev Running/ })
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('log', { name: 'Output of dev' })).toBeVisible()
  },
}

/**
 * A check that runs, then exits with the code it is told: the line, and the button that ends it,
 * as a Session would.
 */
function EndingRun({ exitCode }: { exitCode: number }): ReactNode {
  const [over, setOver] = useState(false)
  const failed = exitCode !== 0
  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" onClick={() => setOver(true)}>
        End the run
      </button>
      <CommandRun
        name="check"
        command="pnpm check"
        kind="check"
        state={over ? (failed ? 'failed' : 'finished') : 'running'}
        folder="."
        output={over ? (failed ? 'Tests  3 failed (3)' : 'Tests  3 passed (3)') : 'Running...'}
        exitCode={over ? exitCode : undefined}
      />
    </div>
  )
}

/**
 * A run that exits 0 folds itself at that moment (recette 5 of 24 September 2026): held open
 * while it ran, folded on `collapse` once it is over — the output folds away rather than
 * vanishing — with its exit code on the line, and the reader can open it again.
 */
export const ARunThatEndsFolds: Story = {
  render: () => <EndingRun exitCode={0} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^check Running/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'End the run' }))
    await expect(canvas.getByText('Exited 0')).toBeVisible()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    if (!movesLess()) {
      // Mid-exit: the line already says it is folded, and the output is still in the page
      // folding away. An output that snapped shut would be gone here.
      await expect(canvas.getByText('pnpm check')).toBeInTheDocument()
    }
    await waitFor(() => {
      expect(canvas.queryByRole('log', { name: 'Output of check' })).toBeNull()
    })
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/3 passed/)).toBeVisible()
  },
}

/**
 * A run that exits non-zero stays open on its output, as decided in recette 4 of 23 September
 * 2026, and folds under the reader's next press.
 */
export const AFailedRunStaysOpen: Story = {
  render: () => <EndingRun exitCode={1} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /^check Running/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'End the run' }))
    await expect(canvas.getByText('Exited 1')).toBeVisible()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/3 failed/)).toBeVisible()
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
  },
}
