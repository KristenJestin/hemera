import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useEffect, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconTerminal } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { LetterAvatar } from '../letter-avatar/letter-avatar.tsx'
import { LiveChip, type LiveChipProps, type LiveState } from './live-chip.tsx'

/**
 * What goes on, as one chip: a run, a helper and a Probe are the same chip and differ only by what
 * fills its icon slot — the type of what runs: a command's icon, a helper's letter avatar. Neutral;
 * its seconds in a room kept for three digits; while it works, a tint of its own breathes across
 * it; every change from working plays one sweep in the colour of the state it changes to, and the
 * icon gives way to that state's glyph. Its legend is its tooltip. No × on the chip: stopping a
 * run belongs to the line of the page it stands on.
 */

/** A minute and a half ago, for a chip that is still at work. */
const AGO = Date.now() - 84_000

/** An ended chip, `seconds` long. */
function lasted(seconds: number): Pick<LiveChipProps, 'startedAt' | 'endedAt'> {
  return { startedAt: 0, endedAt: seconds * 1000 }
}

/** Reads the colour a theme class resolves to on this page, off a probe. */
function colourOf(room: HTMLElement, className: string): string {
  const probe = document.createElement('span')
  probe.className = className
  room.append(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

/** Reads the background a theme class resolves to on this page, off a probe. */
function fillOf(room: HTMLElement, className: string): string {
  const probe = document.createElement('span')
  probe.className = className
  room.append(probe)
  const fill = getComputedStyle(probe).backgroundColor
  probe.remove()
  return fill
}

/** Hovers the chip and reads its legend. */
async function legendOf(chip: HTMLElement): Promise<string> {
  await userEvent.hover(chip)
  const tip = await waitFor(() => within(document.body).getByRole('tooltip'))
  const said = tip.textContent ?? ''
  await userEvent.unhover(chip)
  await waitFor(() => {
    expect(within(document.body).queryByRole('tooltip')).toBeNull()
  })
  return said
}

const meta = {
  tags: ['autodocs'],
  title: 'Components/LiveChip',
  component: LiveChip,
  args: {
    name: 'test',
    icon: <IconTerminal size="sm" />,
    state: 'running',
    startedAt: AGO,
    endedAt: null,
    onPress: fn(),
  },
  argTypes: {
    name: { control: 'text' },
    state: {
      control: 'inline-radio',
      options: ['running', 'stuck', 'finished', 'failed', 'stopped'],
    },
    startedAt: { control: 'number' },
    endedAt: { control: 'number' },
    icon: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LiveChip>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Working: a neutral chip whose tint breathes — the running tone, its own and not the warning of a
 * stuck chip — its icon in place and its seconds ticking. Asked for less movement — as the runner
 * of these stories asks — the tint stands still.
 */
export const Running: Story = {
  play: async ({ canvasElement, args }) => {
    const chip = within(canvasElement).getByRole('button', { name: 'test, running' })
    const breath = chip.querySelector('[data-breath]')
    expect(breath).not.toBeNull()
    expect(getComputedStyle(breath!).backgroundColor).toBe(fillOf(canvasElement, 'bg-info-muted'))
    expect(getComputedStyle(breath!).backgroundColor).not.toBe(
      fillOf(canvasElement, 'bg-warning-muted'),
    )
    expect(getComputedStyle(breath!).animationName).toBe(
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'breathe',
    )
    expect(chip.querySelector('[data-end]')).toBeNull()
    expect(chip).toHaveTextContent(/\d+s$/)
    expect(await legendOf(chip)).toBe('test · running')
    await userEvent.click(chip)
    expect(args.onPress).toHaveBeenCalled()
  },
}

/**
 * Stuck (proposed, to validate): a session with no event for five minutes in the middle of a
 * turn. The breath stops — nothing is moving, so nothing on the chip moves — the seconds go on,
 * and its icon gives way to a paused clock in the warning tone. The legend says it in words.
 */
export const Stuck: Story = {
  args: { name: 'Reviewer', state: 'stuck', startedAt: Date.now() - 412_000 },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByRole('button', { name: 'Reviewer, no activity' })
    expect(chip.querySelector('[data-breath]')).toBeNull()
    const mark = chip.querySelector<HTMLElement>('[data-end="stuck"]')
    expect(mark).not.toBeNull()
    expect(getComputedStyle(mark!).color).toBe(colourOf(canvasElement, 'text-warning'))
    expect(chip).toHaveTextContent(/41\ds$/)
    expect(await legendOf(chip)).toBe('Reviewer · no activity for 5 minutes')
  },
}

/** Done: neutral again, a ✓ in place of its icon, the only thing coloured. */
export const Finished: Story = {
  args: { name: 'build', state: 'finished', ...lasted(84) },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByRole('button', { name: 'build, done' })
    expect(chip.querySelector('[data-breath]')).toBeNull()
    const mark = chip.querySelector<HTMLElement>('[data-end="finished"]')!
    expect(getComputedStyle(mark).color).toBe(colourOf(canvasElement, 'text-success'))
    expect(chip).toHaveTextContent(/84s$/)
    expect(await legendOf(chip)).toBe('build · done in 84s')
  },
}

/** Failed: a ✕ in place of its icon. */
export const Failed: Story = {
  args: { name: 'test', state: 'failed', ...lasted(12) },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByRole('button', { name: 'test, failed' })
    const mark = chip.querySelector<HTMLElement>('[data-end="failed"]')!
    expect(getComputedStyle(mark).color).toBe(colourOf(canvasElement, 'text-destructive'))
    expect(await legendOf(chip)).toBe('test · failed after 12s')
  },
}

/** Stopped by hand: a quiet stop glyph, no tint. */
export const Stopped: Story = {
  args: { name: 'dev', state: 'stopped', ...lasted(3) },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByRole('button', { name: 'dev, stopped' })
    const mark = chip.querySelector<HTMLElement>('[data-end="stopped"]')!
    expect(getComputedStyle(mark).color).toBe(colourOf(canvasElement, 'text-muted-foreground'))
  },
}

/**
 * A helper's chip: its letter avatar in the slot, and no × anywhere — nobody stops a helper by
 * hand. Its chip is the same height as a run's.
 */
export const Helper: Story = {
  render: (args) => (
    <div className="flex items-center gap-1.5">
      <LiveChip {...args} name="dev" />
      <LiveChip {...args} name="Reviewer" icon={<LetterAvatar name="Reviewer" />} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const run = canvas.getByRole('button', { name: 'dev, running' })
    const helper = canvas.getByRole('button', { name: 'Reviewer, running' })
    expect(helper.getBoundingClientRect().height).toBe(run.getBoundingClientRect().height)
    expect(canvas.queryByRole('button', { name: /stop/i })).toBeNull()
    expect(helper).not.toHaveTextContent('×')
  },
}

/**
 * Seconds with fixed-width digits, in a room kept for three of them: 9s, 99s and 999s take the
 * same width, so the chip does not grow as a digit arrives; past 999s it widens once.
 */
export const Seconds: Story = {
  render: (args) => (
    <div className="flex flex-col items-start gap-1.5">
      {[9, 99, 999, 1000].map((seconds) => (
        <LiveChip key={seconds} {...args} name="build" state="finished" {...lasted(seconds)} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const times = [9, 99, 999, 1000].map((seconds) => canvas.getByText(`${String(seconds)}s`))
    const room = times.map((time) => time.getBoundingClientRect().width)
    expect(room[1]).toBe(room[0])
    expect(room[2]).toBe(room[0])
    expect(room[3]).toBeGreaterThan(room[0]!)
    expect(getComputedStyle(times[0]!).fontVariantNumeric).toBe('tabular-nums')
  },
}

/**
 * A long name ends in "…" at the chip's widest; the seconds are never cut, and the whole name is
 * in the legend.
 */
export const LongName: Story = {
  args: {
    name: 'pnpm --filter @acme/api exec vitest run tests/invoices-export.test.ts',
    state: 'finished',
    ...lasted(112),
  },
  play: async ({ canvasElement, args }) => {
    const chip = within(canvasElement).getByRole('button', { name: /, done$/ })
    const name = within(chip).getByText(args.name)
    const time = within(chip).getByText('112s')
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
    expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
    expect(time.scrollWidth).toBeLessThanOrEqual(time.clientWidth)
    expect(time.getBoundingClientRect().right).toBeLessThanOrEqual(
      chip.getBoundingClientRect().right,
    )
    expect(await legendOf(chip)).toContain(args.name)
  },
}

/** Where each change from working lands, and the sweep it plays in that state's colour. */
const SWEEPS: Record<Exclude<LiveState, 'running'>, string> = {
  stuck: 'bg-warning-muted',
  finished: 'bg-success-muted',
  failed: 'bg-destructive-muted',
  stopped: 'bg-accent',
}

/**
 * A chip that starts working and changes to `to` a moment later, as a user would see it; Replay
 * plays the change again.
 */
function Change({ to, ...args }: LiveChipProps & { to: LiveState }): ReactNode {
  const [round, setRound] = useState(0)
  const [state, setState] = useState<LiveState>('running')
  const [startedAt] = useState(() => Date.now() - 84_000)
  const [endedAt, setEndedAt] = useState<number | null>(null)
  useEffect(() => {
    setState('running')
    setEndedAt(null)
    const later = setTimeout(() => {
      setState(to)
      if (to !== 'stuck') setEndedAt(Date.now())
    }, 1200)
    return () => clearTimeout(later)
  }, [to, round])
  return (
    <div className="flex items-center gap-3">
      <LiveChip {...args} state={state} startedAt={startedAt} endedAt={endedAt} />
      <Button variant="secondary" size="sm" onClick={() => setRound((one) => one + 1)}>
        Replay
      </Button>
    </div>
  )
}

/** A change from working, played: the chip lands on `to`, its glyph in place of its icon. */
function change(to: Exclude<LiveState, 'running'>): Story {
  return {
    args: { name: 'test' },
    render: (args) => <Change {...args} to={to} />,
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement)
      expect(canvas.getByRole('button', { name: 'test, running' })).toBeInTheDocument()
      const chip = await waitFor(
        () => canvas.getByRole('button', { name: new RegExp(`^test, (?!running)`) }),
        { timeout: 3000 },
      )
      expect(chip.querySelector(`[data-end="${to}"]`)).not.toBeNull()
      expect(chip.querySelector('[data-breath]')).toBeNull()
      expect(chip.dataset.sweepTone).toBe(to)
      expect(fillOf(canvasElement, SWEEPS[to])).not.toBe(fillOf(canvasElement, 'bg-card'))
    },
  }
}

/** Working, then stuck: one sweep in the warning tone, and the paused clock. */
export const RunningToStuck: Story = change('stuck')

/** Working, then done: one sweep in the success tone, and the ✓. */
export const RunningToFinished: Story = change('finished')

/** Working, then failed: one sweep in the destructive tone, and the ✕. */
export const RunningToFailed: Story = change('failed')

/** Working, then stopped: one quiet sweep in the neutral accent, and the stop glyph. */
export const RunningToStopped: Story = change('stopped')
