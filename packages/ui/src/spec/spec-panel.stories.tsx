import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { LiveSpecPanel } from './spec-harness.tsx'
import { BUG, MAINTENANCE, MID_PLAN, OLDER_REVISION } from './spec-fixtures.ts'

/**
 * The Spec panel alone, in a Session's row beside a stand-in for the chat. Folded by default to a
 * band — the rail's glyphs, their dots and `3/7` — and unfolded by the band, a glyph, or the agent
 * starting on a part, unless the hand folded it. Unfolded, a head that stays on top and the rail
 * beside a stage that shows one part, or every part of one phase, following the agent until a row
 * is chosen; the readiness at the rail's foot. The screens of the brief are drawn in their
 * Session, under `Surfaces/Session/Define`; these are the panel's own states and paths.
 */
const meta = {
  title: 'Blocks/Spec/SpecPanel',
  component: LiveSpecPanel,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
  args: {
    spec: MID_PLAN,
    defaultFolded: false,
    onFoldChange: fn(),
    onSaveSection: fn(),
    onApplyMine: fn(),
    onDiscardMine: fn(),
    onSaveStory: fn(),
    onAnswer: fn(),
    onGoToQuestion: fn(),
    onMarkReady: fn(),
    onRework: fn(),
    onPickRevision: fn(),
    onTakeOver: fn(),
  },
  argTypes: {
    spec: { control: 'object', description: 'The Spec as the panel draws it.' },
    reader: { control: 'object', description: 'Present when this Session reads the draft.' },
    defaultReworkOpen: { control: 'boolean', description: 'Whether Rework starts open.' },
    defaultFolded: { control: 'boolean', description: 'Whether it starts folded to its band.' },
    agentWrites: {
      control: 'text',
      description: 'A part the agent can be made to start on, from the stand-in chat.',
    },
    onFoldChange: { description: 'Told each time the panel folds or unfolds.' },
  },
} satisfies Meta<typeof LiveSpecPanel>

export default meta

type Story = StoryObj<typeof meta>

/** The width the panel's sheet stands at now, in pixels. */
function sheetWidth(canvasElement: HTMLElement): number {
  return within(canvasElement).getByRole('region', { name: 'Spec ATL-7' }).getBoundingClientRect()
    .width
}

/** The band's own width, read from the theme's rem: three of them. */
const BAND = 48

/**
 * Folded, as a Session opens it: a band of glyphs beside the chat, each with its state dot, the
 * dot of each phase, and the readiness as `3/7`. No head and no stage: the chat has the width.
 */
export const Folded: Story = {
  args: { defaultFolded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(sheetWidth(canvasElement)).toBe(BAND)
    const band = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(within(band).getByRole('button', { name: 'Plan, being written' })).toBeVisible()
    await expect(within(band).getByRole('button', { name: 'Plan phase, open' })).toBeVisible()
    await expect(
      within(band).getByRole('img', { name: 'Readiness, 3 of 7 checks pass' }),
    ).toHaveTextContent('3/7')
    // The names leave the eye and stay the accessible name.
    await expect(canvas.queryByText('Expected outcome')).toBeNull()
    await expect(canvas.queryByRole('region', { name: 'Stage of ATL-7' })).toBeNull()
    await expect(canvas.queryByRole('heading', { name: 'CSV invoice export' })).toBeNull()
  },
}

/**
 * Unfolded: a feature being planned, the head with its one sentence, the rail beside one part,
 * the stage following the agent onto the plan it writes, and the readiness at the rail's foot.
 */
export const Unfolded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(sheetWidth(canvasElement)).toBeGreaterThan(BAND)
    await expect(canvas.getByRole('heading', { name: 'CSV invoice export' })).toBeVisible()
    await expect(canvas.getByText('Plan · the agent is writing the plan')).toBeVisible()
    const rail = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(within(rail).getByRole('group', { name: 'Plan' })).toHaveTextContent('open')
    await expect(canvas.getByRole('button', { name: 'Plan, being written' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    const stage = canvas.getByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Plan/ })).toBeVisible()
    // One part at a time: nothing of the other parts is on the stage.
    await expect(within(stage).queryByRole('heading', { name: /^Problem/ })).toBeNull()
    await expect(canvas.queryByText('Prototype')).toBeNull()
    await expect(
      within(rail).getByRole('img', { name: 'Readiness, 3 of 7 checks pass' }),
    ).toBeVisible()
    await expect(within(rail).getByRole('button', { name: '4 things before ready' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Show all' })).toBeNull()
  },
}

/** A bug: Reproduction in Shape, and Behaviour and Stories never drawn. */
export const Bug: Story = {
  args: { spec: BUG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Reproduction/ })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Behaviour/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Stories/ })).toBeNull()
  },
}

/** A `maintenance`: its own section is the invariants it keeps. */
export const Maintenance: Story = {
  args: { spec: MAINTENANCE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Invariants/ })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Behaviour/ })).toBeNull()
  },
}

/** A glyph of the band pressed: the panel unfolds, and the stage shows that part. */
export const GlyphChosen: Story = {
  args: { defaultFolded: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Scope/ }))
    await expect(args.onFoldChange).toHaveBeenCalledWith(false)
    const stage = await canvas.findByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Scope/ })).toBeVisible()
    await waitFor(() => expect(sheetWidth(canvasElement)).toBeGreaterThan(BAND))
  },
}

/**
 * The agent starts on a part while the panel is folded: it unfolds on its own, and the part the
 * agent writes is on the stage.
 */
export const UnfoldsWhenTheAgentWrites: Story = {
  args: { defaultFolded: true, agentWrites: 'tasks' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('region', { name: 'Stage of ATL-7' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Let the agent write the tasks' }))
    await expect(args.onFoldChange).toHaveBeenCalledWith(false)
    const stage = await canvas.findByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Tasks/ })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Tasks, 0, being written' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await waitFor(() => expect(sheetWidth(canvasElement)).toBeGreaterThan(BAND))
  },
}

/**
 * Folded by the hand, the panel stays folded when the agent starts on a part; unfolded by the
 * hand, it shows the part the agent writes.
 */
export const HandFoldWins: Story = {
  args: { agentWrites: 'tasks' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Fold the Spec' }))
    await expect(args.onFoldChange).toHaveBeenLastCalledWith(true)
    await waitFor(() => expect(sheetWidth(canvasElement)).toBe(BAND))
    // The fold button is gone with the head: the keyboard is on the band's unfold button.
    await expect(canvas.getByRole('button', { name: 'Unfold the Spec' })).toHaveFocus()
    await waitFor(() => expect(canvas.queryByRole('region', { name: 'Stage of ATL-7' })).toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: 'Let the agent write the tasks' }))
    // The agent is writing, and the band says so; the panel waits for the hand.
    await expect(canvas.getByRole('button', { name: 'Tasks, 0, being written' })).toBeVisible()
    await expect(args.onFoldChange).toHaveBeenCalledTimes(1)
    await expect(canvas.queryByRole('region', { name: 'Stage of ATL-7' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Unfold the Spec' }))
    await expect(args.onFoldChange).toHaveBeenLastCalledWith(false)
    const stage = await canvas.findByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Tasks/ })).toBeVisible()
    // And unfolded, on the row of what is on the stage.
    await expect(canvas.getByRole('button', { name: 'Tasks, 0, being written' })).toHaveFocus()
  },
}

/** The widths the boxes stand at on each frame, until they have not changed for twenty. */
function framesOf(boxes: HTMLElement[]): Promise<number[][]> {
  return new Promise((resolve) => {
    const frames: number[][] = []
    let still = 0
    const sample = (): void => {
      const now = boxes.map((box) => box.getBoundingClientRect().width)
      const last = frames.at(-1)
      still =
        last !== undefined && last.every((width, index) => width === now[index]) ? still + 1 : 0
      frames.push(now)
      if (still < 20) requestAnimationFrame(sample)
      else resolve(frames)
    }
    requestAnimationFrame(sample)
  })
}

/**
 * The width is what moves, and the chat follows once: while the sheet opens over it frame after
 * frame, the slot the chat is laid against stays the band and takes the unfolded width once, when
 * the sheet has landed. Folding, the slot is the band again at once, and the sheet closes over it.
 */
export const ChatFollowsOnce: Story = {
  args: { defaultFolded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sheet = canvas.getByRole('region', { name: 'Spec ATL-7' })
    const slot = sheet.parentElement!
    await userEvent.click(canvas.getByRole('button', { name: 'Unfold the Spec' }))
    const opening = await framesOf([sheet, slot])
    const landed = opening.at(-1)![0]!
    // The sheet went through the widths in between: it moved, and did not jump.
    await expect(
      opening.filter(([width]) => width! > BAND && width! < landed).length,
    ).toBeGreaterThan(3)
    // The slot had two widths only, the band and the landed one: the chat was laid out once.
    await expect([...new Set(opening.map(([, width]) => width))]).toEqual([BAND, landed])
    await userEvent.click(canvas.getByRole('button', { name: 'Fold the Spec' }))
    const closing = await framesOf([sheet, slot])
    await expect([...new Set(closing.map(([, width]) => width))]).toEqual([BAND])
    await expect(closing.at(-1)![0]).toBe(BAND)
  },
}

/**
 * Told to move less, the width lands at once: on the frame after the hand unfolds it, the sheet is
 * at its unfolded width — a share of the row — and the slot the chat is laid against follows it.
 *
 * `MotionConfig` says the preference rather than the browser's media query, which motion reads
 * once when a component mounts: a story that emulated it afterwards would test a tree that never
 * heard.
 */
export const ReducedMotion: Story = {
  args: { defaultFolded: true },
  decorators: [
    (Story) => (
      <MotionConfig reducedMotion="always">
        <Story />
      </MotionConfig>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Unfold the Spec' }))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const sheet = canvas.getByRole('region', { name: 'Spec ATL-7' })
    const slot = sheet.parentElement!
    const row = slot.parentElement!
    const landed = sheet.getBoundingClientRect().width
    await expect(landed).toBeCloseTo(row.getBoundingClientRect().width * 0.45, 0)
    await waitFor(() => expect(slot.getBoundingClientRect().width).toBe(landed))
  },
}

/**
 * A row of the rail pins the stage: the chosen part stays on it, and the plan the agent writes
 * keeps breathing in the rail.
 */
export const RowChosen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Scope/ }))
    const stage = canvas.getByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Scope/ })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Scope/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(canvas.getByRole('button', { name: 'Plan, being written' })).not.toHaveAttribute(
      'aria-current',
    )
  },
}

/**
 * A group heading of the rail puts every part of its phase on the stage, one under the other,
 * as they are; a row then puts its part back alone.
 */
export const GroupOnStage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const shape = canvas.getByRole('button', { name: 'Shape phase, finished' })
    await userEvent.click(shape)
    await expect(shape).toHaveAttribute('aria-current', 'true')
    const stage = canvas.getByRole('region', { name: 'Stage of ATL-7' })
    const parts = [/^Problem/, /^Expected outcome/, /^Scope/, /^Verification/, /^Behaviour/]
    await Promise.all(
      parts.map((part) => expect(within(stage).getByRole('heading', { name: part })).toBeVisible()),
    )
    await expect(within(stage).queryByRole('heading', { name: /^Plan/ })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: /^Tasks/ }))
    await expect(within(stage).getByRole('heading', { name: /^Tasks/ })).toBeVisible()
    await expect(within(stage).queryByRole('heading', { name: /^Problem/ })).toBeNull()
    await expect(shape).not.toHaveAttribute('aria-current')
  },
}

/** A thing left before ready, in the popover of the rail's foot, puts its target on the stage. */
export const LinkFollowed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: '4 things before ready' }))
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'the credit-note question' }))
    const stage = canvas.getByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Questions/ })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Questions/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  },
}

/** An open question of the register takes the thread to where it is asked. */
export const QuestionLinked: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Questions/ }))
    await userEvent.click(canvas.getByRole('button', { name: /^Answer in the chat: Credit notes/ }))
    await expect(args.onGoToQuestion).toHaveBeenCalledWith('q-credit-notes')
  },
}

/**
 * An older revision picked: shown as it was frozen, with no editor, no `Rework` and no
 * `Mark ready`, and the foot says which revision replaced it.
 */
export const OlderRevision: Story = {
  args: { spec: OLDER_REVISION },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Revision 1 · read only, as it was frozen')).toBeVisible()
    await expect(canvas.getByText(/revision 2 replaced it/)).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
  },
}
