import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { type MarkState, StatusMark } from './status-mark.tsx'

/**
 * Where a task stands, as one small mark that changes in place: a dotted ring to do; a turning
 * arc while running; a circle that closes on ✓ or ✕; a dot that pulses when the task waits for
 * the user; a bar when it is blocked; a struck dotted ring when it is skipped. Every state is a
 * pose of the same strokes, so a change is a stroke moving, never one glyph swapped for another.
 * Its legend is a tooltip on the mark.
 */

/** How much of a stroke is drawn, from the dash motion writes on it: 0 to 1. */
function drawnOf(stroke: Element | null): number {
  if (stroke === null) return Number.NaN
  if (Number(getComputedStyle(stroke).opacity) === 0) return 0
  const dash = stroke.getAttribute('stroke-dasharray')
  return dash === null ? 1 : Number.parseFloat(dash)
}

/** The stroke of a mark that draws one state's figure. */
function strokeOf(mark: Element, figure: string): Element | null {
  return mark.querySelector(`[data-figure="${figure}"]`)
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

/** The figures a state draws, and the tone it draws them in. */
const POSES: Record<MarkState, { figures: string[]; tone: string; legend: string }> = {
  todo: { figures: ['dashed'], tone: 'text-muted-foreground', legend: 'To do' },
  running: { figures: ['ring'], tone: 'text-warning', legend: 'Running' },
  done: { figures: ['ring', 'check'], tone: 'text-success', legend: 'Done' },
  failed: { figures: ['ring', 'cross'], tone: 'text-destructive', legend: 'Failed' },
  waiting: { figures: ['ring', 'dot'], tone: 'text-warning', legend: 'Waiting for you' },
  blocked: { figures: ['ring', 'bar'], tone: 'text-destructive', legend: 'Blocked' },
  skipped: { figures: ['dashed', 'strike'], tone: 'text-muted-foreground', legend: 'Skipped' },
}

const ALL_FIGURES = ['dashed', 'ring', 'check', 'cross', 'dot', 'bar', 'strike']

/** What every state's story checks: its figures drawn, the others not, in its tone. */
function posed(state: MarkState): Story {
  const { figures, tone, legend } = POSES[state]
  return {
    args: { state },
    play: async ({ canvasElement }) => {
      const glyph = within(canvasElement).getByRole('img', { name: legend })
      const mark = glyph.querySelector<HTMLElement>('[data-mark]')!
      expect(getComputedStyle(mark).color).toBe(colourOf(canvasElement, tone))
      expect(mark.getBoundingClientRect().width).toBe(20)
      await waitFor(() => {
        for (const figure of ALL_FIGURES) {
          const drawn = drawnOf(strokeOf(mark, figure))
          if (figures.includes(figure)) expect(drawn, figure).toBeGreaterThan(0)
          else expect(drawn, figure).toBe(0)
        }
      })
    },
  }
}

const meta = {
  tags: ['autodocs'],
  title: 'Components/StatusMark',
  component: StatusMark,
  args: { state: 'running', legend: true },
  argTypes: {
    state: { control: 'inline-radio', options: Object.keys(POSES) },
    legend: { control: 'boolean' },
  },
  decorators: [
    (Story) => (
      <div className="p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StatusMark>

export default meta
type Story = StoryObj<typeof meta>

/** Nothing has started: a dotted ring, quiet. */
export const Todo: Story = posed('todo')

/**
 * Running: an arc of the ring, turning. Asked for less movement — as the runner of these stories
 * asks — it stands still.
 */
export const Running: Story = {
  ...posed('running'),
  play: async (context) => {
    await posed('running').play?.(context)
    const svg = context.canvasElement.querySelector('svg')!
    expect(getComputedStyle(svg).animationName).toBe(
      globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'turn',
    )
  },
}

/** Done: the circle closes on a ✓. */
export const Done: Story = posed('done')

/** Failed: the circle closes on a ✕. */
export const Failed: Story = posed('failed')

/** Waiting for the user: a dot in the closed circle, a ring leaving it while it waits. */
export const Waiting: Story = posed('waiting')

/** Blocked: a bar across the closed circle, the way is shut. */
export const Blocked: Story = posed('blocked')

/** Skipped: the dotted ring, struck through. */
export const Skipped: Story = posed('skipped')

/** The legend is a tooltip on the mark itself, reached by the hand and by the keyboard alike. */
export const Focused: Story = {
  args: { state: 'blocked' },
  play: async ({ canvasElement }) => {
    const mark = within(canvasElement).getByRole('img', { name: 'Blocked' })
    await userEvent.tab()
    expect(mark).toHaveFocus()
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Blocked')
    })
    await userEvent.tab()
    await waitFor(() => {
      expect(within(document.body).queryByRole('tooltip')).toBeNull()
    })
  },
}

/** Beside a line that already says its state: no legend, hidden from a screen reader. */
export const Unlabelled: Story = {
  args: { state: 'done', legend: false },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole('img')).toBeNull()
    expect(canvasElement.querySelector('[data-mark="done"]')).toHaveAttribute('aria-hidden', 'true')
  },
}
