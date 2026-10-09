import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { FrozenGlyph, MarkGlyph, MissionMarks, TicketLink } from './mission-marks.tsx'
import { type MissionMarkView, markWords } from './vocabulary.ts'

/**
 * The marks a mission carries, as a list or the header draws them: a glyph with its legend, and
 * for the two marks whose cause must be read without pointing (blocked, waiting) the words next
 * to it. The frozen Spec and the ticket link are the two other small parts of the same row.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Mission/MissionMarks',
  component: MissionMarks,
  args: { marks: [] },
  decorators: [
    (Story) => (
      <div className="flex p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MissionMarks>

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

const EVERY_MARK: readonly MissionMarkView[] = [
  { kind: 'needsYou' },
  { kind: 'outdated' },
  { kind: 'outside', repository: 'acme/api' },
  { kind: 'fixing' },
]

/** The marks without a cause to read: one glyph each, the legend on hover. */
export const Glyphs: Story = {
  render: () => (
    <div className="flex gap-4">
      {EVERY_MARK.map((mark) => (
        <MarkGlyph key={mark.kind} mark={mark} />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await EVERY_MARK.reduce(async (before, mark) => {
      await before
      const glyph = canvasElement.querySelector<HTMLElement>(`[data-mark="${mark.kind}"]`)
      expect(glyph).not.toBeNull()
      if (glyph !== null) expect(await legendOf(glyph)).toBe(markWords(mark))
    }, Promise.resolve())
    expect(canvas.queryByText('Needs you')).toBeNull()
  },
}

/** Blocked and waiting are spelled: the cause is read on the line, not behind a tooltip. */
export const Spelled: Story = {
  args: {
    marks: [
      { kind: 'blocked', cause: 'ACME-9' },
      { kind: 'waiting', on: 'CI on acme/shop#52' },
    ],
  },
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Blocked by ACME-9')).toBeInTheDocument()
    expect(canvas.getByText('Waiting on CI on acme/shop#52')).toBeInTheDocument()
  },
}

/** Spelled and glyph marks side by side: only blocked and waiting carry their words. */
export const Mixed: Story = {
  args: {
    marks: [
      { kind: 'needsYou' },
      { kind: 'blocked', cause: 'shared database · ACME-9' },
      { kind: 'outdated' },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Blocked by shared database · ACME-9')).toBeInTheDocument()
    expect(canvas.queryByText('Needs you')).toBeNull()
    expect(canvas.queryByText('Outdated')).toBeNull()
    const glyph = canvasElement.querySelector<HTMLElement>('[data-mark="needsYou"]')
    expect(glyph).not.toBeNull()
    if (glyph !== null) expect(await legendOf(glyph)).toBe('Needs you')
  },
}

/** A cause as long as a sentence truncates in its place and never pushes the line wider. */
export const LongCause: Story = {
  decorators: [
    (Story) => (
      <div className="w-64">
        <Story />
      </div>
    ),
  ],
  args: {
    marks: [
      {
        kind: 'blocked',
        cause:
          'the shared staging database held by the nightly import of every customer · ACME-1234',
      },
    ],
  },
  play: ({ canvasElement }) => {
    const spelled = canvasElement.querySelector<HTMLElement>('[data-mark="blocked"]')
    expect(spelled).not.toBeNull()
    if (spelled !== null)
      expect(spelled.scrollWidth).toBeLessThanOrEqual(spelled.parentElement?.clientWidth ?? 0)
  },
}

/** The Spec is frozen: a lock with its legend. */
export const Frozen: Story = {
  render: () => <FrozenGlyph />,
  play: async ({ canvasElement }) => {
    const glyph = canvasElement.querySelector<HTMLElement>('span[aria-hidden="true"]')
    expect(glyph).not.toBeNull()
    if (glyph !== null) expect(await legendOf(glyph)).toBe('Spec frozen')
  },
}

/** The ticket is a button, not a link: it opens in the window's own way. */
export const Ticket: Story = {
  render: () => <TicketLink ticket="acme/shop#41" onOpen={() => {}} />,
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: /acme\/shop#41/ })).toBeInTheDocument()
    expect(canvas.queryByRole('link')).toBeNull()
  },
}
