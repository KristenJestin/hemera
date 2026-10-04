import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { BALL_LEGENDS, BallMark } from './ball-mark.tsx'

/**
 * Who has the ball, as one status mark: the running arc for the agent at work, the mark of what
 * waits for the user, the dotted ring for what waits outside, the mark of what is blocked, the
 * quietest ring when nothing runs. In a mission's header, and there alone, the agent at work is
 * Hemera's face. Its legend is a tooltip on the glyph.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Mission/BallMark',
  component: BallMark,
  args: { ball: 'agent', legend: true },
  argTypes: {
    ball: { control: 'inline-radio', options: ['agent', 'you', 'someone', 'blocked', 'idle'] },
    legend: { control: 'boolean' },
    face: { control: 'boolean' },
  },
  decorators: [
    (Story) => (
      <div className="p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BallMark>

export default meta
type Story = StoryObj<typeof meta>

/** Hovers the glyph and reads its legend. */
async function legendOf(glyph: HTMLElement): Promise<string> {
  await userEvent.hover(glyph)
  const tip = await waitFor(() => within(document.body).getByRole('tooltip'))
  const said = tip.textContent ?? ''
  await userEvent.unhover(glyph)
  return said
}

/** The agent works, in a list: the running arc, one family with every other row. */
export const Agent: Story = {
  play: async ({ canvasElement }) => {
    const glyph = within(canvasElement).getByRole('img', { name: BALL_LEGENDS.agent })
    expect(glyph.querySelector('[data-mark="running"]')).not.toBeNull()
    expect(await legendOf(glyph)).toBe('Agent working')
  },
}

/** The agent works, in the mission's header: Hemera's face, thinking; still under reduced motion. */
export const AgentInTheHeader: Story = {
  args: { face: true },
  play: async ({ canvasElement }) => {
    const glyph = within(canvasElement).getByRole('img', { name: BALL_LEGENDS.agent })
    expect(glyph.querySelector('[data-state="thinking"]')).not.toBeNull()
  },
}

/** It waits for the user: the status mark of what waits, the one tone that calls. */
export const You: Story = {
  args: { ball: 'you' },
  play: async ({ canvasElement }) => {
    const glyph = within(canvasElement).getByRole('img', { name: BALL_LEGENDS.you })
    expect(glyph.querySelector('[data-mark="waiting"]')).not.toBeNull()
    expect(await legendOf(glyph)).toBe('Needs you')
  },
}

/** It waits for somebody outside Hemera: the dotted ring of what has not started here. */
export const Someone: Story = {
  args: { ball: 'someone' },
  play: async ({ canvasElement }) => {
    const glyph = within(canvasElement).getByRole('img', { name: BALL_LEGENDS.someone })
    expect(glyph.querySelector('[data-mark="todo"]')).not.toBeNull()
  },
}

/** A dependency or a resource holds it: the mark of what is blocked. */
export const Blocked: Story = {
  args: { ball: 'blocked' },
  play: async ({ canvasElement }) => {
    const glyph = within(canvasElement).getByRole('img', { name: BALL_LEGENDS.blocked })
    expect(glyph.querySelector('[data-mark="blocked"]')).not.toBeNull()
  },
}

/** Nothing runs and nothing waits: the idle mark, the quietest ring; every row has a status. */
export const Idle: Story = {
  args: { ball: 'idle' },
  play: async ({ canvasElement }) => {
    const glyph = within(canvasElement).getByRole('img', { name: BALL_LEGENDS.idle })
    expect(glyph.querySelector('[data-mark="idle"]')).not.toBeNull()
  },
}

/** Beside a line that says the state: no legend, and nothing announced. */
export const Decorative: Story = {
  args: { legend: false },
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole('img')).toBeNull()
  },
}
