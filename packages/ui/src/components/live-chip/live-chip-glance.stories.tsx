import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconTerminal } from '../../icons.ts'
import { LetterAvatar } from '../letter-avatar/letter-avatar.tsx'
import { LiveChip, type LiveChipProps } from './live-chip.tsx'
import type { LiveGlance } from './live-chip-glance.tsx'

/**
 * What pressing a live chip opens: a glance at everything about what goes on — its name and its
 * type, its state with its mark, its duration, a service's address with copy and open, the step it
 * is on or the last lines it printed — and what can be done about it: Restart, Stop, Run again,
 * and ⓘ for its details. A page shows the chip and nothing beside it: every action is here.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/LiveChipGlance',
  component: LiveChip,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="flex h-screen items-start p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LiveChip>

export default meta
type Story = StoryObj<typeof meta>

const NOW = Date.now()

/** The callbacks of a glance, each a spy. */
function actions(): Pick<
  LiveGlance,
  'onRestart' | 'onStop' | 'onRunAgain' | 'onDetails' | 'onCopyUrl' | 'onOpenUrl'
> {
  return {
    onRestart: fn(),
    onStop: fn(),
    onRunAgain: fn(),
    onDetails: fn(),
    onCopyUrl: fn(),
    onOpenUrl: fn(),
  }
}

/** Opens the chip's glance by pressing it, and gives the glance back. */
async function opened(canvasElement: HTMLElement, name: RegExp): Promise<HTMLElement> {
  await userEvent.click(within(canvasElement).getByRole('button', { name }))
  return waitFor(() => within(document.body).getByRole('dialog'))
}

/** The actions a glance offers, by name, ⓘ included. */
function offered(glance: HTMLElement): string[] {
  return within(glance)
    .queryAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '')
}

/** A chip and its glance. */
function glanced(
  props: Omit<LiveChipProps, 'glance'>,
  glance: LiveGlance,
  check: (glance: HTMLElement) => Promise<void> | void,
): Story {
  return {
    args: { ...props, glance },
    play: async ({ canvasElement }) => {
      const panel = await opened(canvasElement, new RegExp(`^${props.name},`))
      expect(panel).toHaveTextContent(props.name)
      expect(panel).toHaveTextContent(glance.type)
      await check(panel)
    },
  }
}

/** A command at work: its state and seconds, the step it is on, Restart and Stop, ⓘ. */
export const RunRunning: Story = glanced(
  {
    name: 'test',
    icon: <IconTerminal size="sm" />,
    state: 'running',
    startedAt: NOW - 84_000,
    endedAt: null,
  },
  { kind: 'run', type: 'Command · pnpm test', step: 'Running 128 of 342 tests', ...actions() },
  (glance) => {
    expect(glance).toHaveTextContent(/Running for \d+s/)
    expect(glance).toHaveTextContent('Running 128 of 342 tests')
    expect(offered(glance)).toEqual(['Restart', 'Stop', 'Details'])
  },
)

/** A command that failed: the last lines it printed, Run again, ⓘ. */
export const RunFailed: Story = glanced(
  {
    name: 'test',
    icon: <IconTerminal size="sm" />,
    state: 'failed',
    startedAt: NOW - 12_000,
    endedAt: NOW,
  },
  {
    kind: 'run',
    type: 'Command · pnpm test',
    output: [
      'FAIL  tests/invoices-export.test.ts',
      '  expected 3 rows, received 2',
      'Tests  1 failed | 341 passed',
    ],
    ...actions(),
  },
  async (glance) => {
    expect(glance).toHaveTextContent('Failed after 12s')
    expect(glance).toHaveTextContent('expected 3 rows, received 2')
    expect(offered(glance)).toEqual(['Run again', 'Details'])
    await userEvent.click(within(glance).getByRole('button', { name: 'Run again' }))
  },
)

/** A command done: Run again and ⓘ, nothing to stop. */
export const RunFinished: Story = glanced(
  {
    name: 'build',
    icon: <IconTerminal size="sm" />,
    state: 'finished',
    startedAt: NOW - 84_000,
    endedAt: NOW,
  },
  { kind: 'run', type: 'Command · pnpm build', output: ['✓ built in 4.2s'], ...actions() },
  (glance) => {
    expect(glance).toHaveTextContent('Done in 84s')
    expect(offered(glance)).toEqual(['Run again', 'Details'])
  },
)

/** A service at work: its address with copy and open, Restart and Stop, ⓘ. */
export const ServiceRunning: Story = glanced(
  {
    name: 'web',
    icon: <IconTerminal size="sm" />,
    state: 'running',
    startedAt: NOW - 412_000,
    endedAt: null,
  },
  { kind: 'service', type: 'Service · pnpm dev', url: 'http://localhost:5173', ...actions() },
  async (glance) => {
    expect(glance).toHaveTextContent('http://localhost:5173')
    expect(offered(glance)).toEqual([
      'Copy the address',
      'Open the address',
      'Restart',
      'Stop',
      'Details',
    ])
    await userEvent.click(within(glance).getByRole('button', { name: 'Copy the address' }))
  },
)

/** A service with no activity for five minutes: said in words, Restart and Stop. */
export const ServiceStuck: Story = glanced(
  {
    name: 'api',
    icon: <IconTerminal size="sm" />,
    state: 'stuck',
    startedAt: NOW - 412_000,
    endedAt: null,
  },
  {
    kind: 'service',
    type: 'Service · pnpm --filter api dev',
    url: 'http://localhost:3000',
    ...actions(),
  },
  (glance) => {
    expect(glance).toHaveTextContent('No activity for 5 minutes')
    expect(offered(glance)).toContain('Restart')
  },
)

/** A service stopped: Restart brings it back. */
export const ServiceStopped: Story = glanced(
  {
    name: 'web',
    icon: <IconTerminal size="sm" />,
    state: 'stopped',
    startedAt: NOW - 3_000,
    endedAt: NOW,
  },
  { kind: 'service', type: 'Service · pnpm dev', ...actions() },
  (glance) => {
    expect(glance).toHaveTextContent('Stopped after 3s')
    expect(offered(glance)).toEqual(['Restart', 'Details'])
  },
)

/** A helper at work: the step it is on, and ⓘ alone — nobody stops a helper by hand. */
export const HelperRunning: Story = glanced(
  {
    name: 'Reviewer',
    icon: <LetterAvatar name="Reviewer" />,
    state: 'running',
    startedAt: NOW - 84_000,
    endedAt: null,
  },
  { kind: 'helper', type: 'Helper', step: 'Reading the changes of api', ...actions() },
  (glance) => {
    expect(glance).toHaveTextContent('Reading the changes of api')
    expect(offered(glance)).toEqual(['Details'])
  },
)

/** A helper done: what it said last, ⓘ. */
export const HelperFinished: Story = glanced(
  {
    name: 'Reviewer',
    icon: <LetterAvatar name="Reviewer" />,
    state: 'finished',
    startedAt: NOW - 84_000,
    endedAt: NOW,
  },
  {
    kind: 'helper',
    type: 'Helper',
    output: ['Two remarks on the export: see the review.'],
    ...actions(),
  },
  (glance) => {
    expect(offered(glance)).toEqual(['Details'])
  },
)

/** A Probe at work: ⓘ alone. */
export const ProbeRunning: Story = glanced(
  {
    name: 'export',
    icon: <IconTerminal size="sm" />,
    state: 'running',
    startedAt: NOW - 9_000,
    endedAt: null,
  },
  { kind: 'probe', type: 'Probe · invoices export', step: 'Comparing 3 invoices', ...actions() },
  (glance) => {
    expect(offered(glance)).toEqual(['Details'])
  },
)

/** A Probe that failed: Run again and ⓘ. */
export const ProbeFailed: Story = glanced(
  {
    name: 'export',
    icon: <IconTerminal size="sm" />,
    state: 'failed',
    startedAt: NOW - 9_000,
    endedAt: NOW,
  },
  {
    kind: 'probe',
    type: 'Probe · invoices export',
    output: ['2 of 3 invoices exported'],
    ...actions(),
  },
  (glance) => {
    expect(offered(glance)).toEqual(['Run again', 'Details'])
  },
)

/** From the keyboard: Enter opens the glance, Escape closes it, the focus goes back to the chip. */
export const Keyboard: Story = {
  args: {
    name: 'test',
    icon: <IconTerminal size="sm" />,
    state: 'running',
    startedAt: NOW - 84_000,
    endedAt: null,
    glance: { kind: 'run', type: 'Command · pnpm test', ...actions() },
  },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByRole('button', { name: /^test,/ })
    await userEvent.tab()
    expect(chip).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(within(document.body).getByRole('dialog')).toBeVisible()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    expect(chip).toHaveFocus()
  },
}
