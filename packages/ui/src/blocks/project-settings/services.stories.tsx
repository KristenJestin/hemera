import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ServicesSection, type SettingsRun } from './services.tsx'
import { FAILED_RUN, RUNNABLE, RUNS } from './project-settings-fixtures.ts'

/**
 * What runs in a Project's main checkout, as a table: each line its state, name, place, line and
 * time; pressing a live line opens its glance — its address, its last lines, Restart and Stop; a
 * service not running, with Start; a command run at each opening that waits for you, with Run and
 * Not now.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Project settings/Services',
  component: ServicesSection,
  parameters: { layout: 'fullscreen' },
  args: {
    runs: RUNS,
    commands: RUNNABLE,
    onRun: fn(),
    onStart: fn(),
    onAllow: fn(),
    onDecline: fn(),
    onRestart: fn(),
    onStop: fn(),
    onCopyUrl: fn(),
    onOpenUrl: fn(),
    onDetails: fn(),
  },
  argTypes: { runs: { table: { disable: true } }, commands: { table: { disable: true } } },
  decorators: [
    (Story) => (
      <div className="mx-auto flex w-full max-w-page flex-col p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ServicesSection>

export default meta
type Story = StoryObj<typeof meta>

const byId = (id: string): SettingsRun => RUNS.find((run) => run.id === id)!

/** Opens a chip's glance, and gives the glance back. */
async function glance(canvasElement: HTMLElement, name: RegExp): Promise<HTMLElement> {
  await userEvent.click(within(canvasElement).getByRole('button', { name }))
  return waitFor(() => within(document.body).getByRole('dialog'))
}

/** Two services live, one done, one not running, one waiting for you. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('list', { name: 'Running in the main checkout' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    // A live line is one control, which opens its glance: nothing to press beside it.
    const docs = canvasElement.querySelector<HTMLElement>('[data-run="docs"]')
    expect(docs).not.toBeNull()
    if (docs !== null) expect(within(docs).getAllByRole('button')).toHaveLength(1)
  },
}

/** A service starting: it breathes, and its glance has no address yet, only what it prints. */
export const Starting: Story = {
  args: { runs: [byId('mock-api')] },
  play: async ({ canvasElement }) => {
    const panel = await glance(canvasElement, /^mock-api, running/)
    expect(panel).toHaveTextContent('loading 214 fixtures…')
    expect(within(panel).queryByRole('button', { name: 'Copy the address' })).toBeNull()
    expect(within(panel).getByRole('button', { name: 'Stop' })).toBeVisible()
  },
}

/** A service ready: its glance holds its address, to copy and to open, and Restart and Stop. */
export const Ready: Story = {
  args: { runs: [byId('docs')] },
  play: async ({ canvasElement, args }) => {
    const panel = await glance(canvasElement, /^docs, running/)
    expect(panel).toHaveTextContent('http://localhost:6100')
    await userEvent.click(within(panel).getByRole('button', { name: 'Copy the address' }))
    expect(args.onCopyUrl).toHaveBeenCalledWith('docs')
    await userEvent.click(within(panel).getByRole('button', { name: 'Open the address' }))
    expect(args.onOpenUrl).toHaveBeenCalledWith('docs')
  },
}

/** A service that failed: the chip says so once; its glance holds its last lines and Restart. */
export const Failed: Story = {
  args: { runs: [FAILED_RUN] },
  play: async ({ canvasElement, args }) => {
    const panel = await glance(canvasElement, /^search, failed/)
    expect(panel).toHaveTextContent('EADDRINUSE')
    await userEvent.click(within(panel).getByRole('button', { name: 'Restart' }))
    expect(args.onRestart).toHaveBeenCalledWith('search')
  },
}

/** A command run at each opening that asks first: the waiting mark, Not now and Run. */
export const WaitingForPermission: Story = {
  args: { runs: [byId('db')] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('img', { name: 'Waiting for you' })).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Run db' }))
    expect(args.onAllow).toHaveBeenCalledWith('db')
    await userEvent.click(canvas.getByRole('button', { name: 'Not now' }))
    expect(args.onDecline).toHaveBeenCalledWith('db')
  },
}

/** A service of the main checkout that is not running: Start. */
export const NotRunning: Story = {
  args: { runs: [byId('admin')] },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Start admin' }))
    expect(args.onStart).toHaveBeenCalledWith('admin')
  },
}

/** Nothing runs: Hemera asleep, and a command of the catalogue to run. */
export const Empty: Story = {
  args: { runs: [] },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { name: 'Nothing runs' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Run a command' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'lint' }))
    expect(args.onRun).toHaveBeenCalledWith('lint')
  },
}

/** On their way: the chip's room and the line's shape. */
export const Loading: Story = {
  args: { runs: [], loading: true },
  play: async ({ canvasElement }) => {
    expect(canvasElement.querySelectorAll('[data-row-skeleton]')).toHaveLength(2)
  },
}

/** A long name and a long line: each ends in an ellipsis in its column. */
export const LongText: Story = {
  args: {
    runs: [
      ...RUNS,
      {
        ...FAILED_RUN,
        id: 'long',
        name: 'platform-api-and-background-workers',
        line: 'pnpm --filter @acme/platform-api-and-background-workers exec node dist/server.js --port 7700',
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const row = within(canvasElement).getByRole('button', {
      name: /^platform-api-and-background-workers, failed/,
    })
    const name = within(row).getByText('platform-api-and-background-workers')
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
  },
}

/** Asked for less movement: no mark turns, every state there at once. */
export const ReducedMotion: Story = {
  render: (args) => (
    <MotionConfig reducedMotion="always">
      <ServicesSection {...args} runs={[...RUNS, FAILED_RUN]} />
    </MotionConfig>
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getAllByRole('listitem')).toHaveLength(6)
  },
}
