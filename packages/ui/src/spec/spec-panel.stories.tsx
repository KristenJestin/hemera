import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { LiveSpecPanel } from './spec-harness.tsx'
import { BUG, MAINTENANCE, MID_PLAN, OLDER_REVISION } from './spec-fixtures.ts'

/**
 * The Spec panel alone, in a Session's row beside a stand-in for the chat. Folded by default to a
 * band — the rail's glyphs, their tints and `1/7` — and unfolded by the band, a glyph, or the agent
 * starting on a part, unless the hand folded it. Unfolded, a head that stays on top and the rail
 * beside a stage that shows one part, or every part of one phase, following the agent until a row
 * is chosen; the readiness at the rail's foot. The screens of the brief are drawn in their
 * Session, under `Surfaces/Session/Define`; these are the panel's own states and paths.
 */
const meta = {
  title: 'Blocks/Spec/SpecPanel',
  component: LiveSpecPanel,
  tags: ['autodocs'],
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
    arrives: {
      control: 'boolean',
      description: 'Whether the Spec was just created here, and the panel arrives unfolding.',
    },
    agentWrites: {
      control: 'text',
      description: 'A part the agent can be made to start on, from the stand-in chat.',
    },
    onFoldChange: { description: 'Told each time the panel folds or unfolds.' },
  },
} satisfies Meta<typeof LiveSpecPanel>

export default meta

type Story = StoryObj<typeof meta>

/** The width the panel stands at now, in pixels. */
function panelWidth(canvasElement: HTMLElement): number {
  return within(canvasElement).getByRole('region', { name: 'Spec ATL-7' }).getBoundingClientRect()
    .width
}

/** The band's own width, read from the theme's rem: three of them. */
const BAND = 48

/**
 * Folded, as a Session opens it: a band of glyphs beside the chat, each phase a block over the
 * glyphs of its parts, and the readiness as `1/7`. No head and no stage: the chat has the width.
 */
export const Folded: Story = {
  args: { defaultFolded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(panelWidth(canvasElement)).toBe(BAND)
    const band = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(within(band).getByRole('button', { name: 'Plan' })).toBeVisible()
    await expect(
      within(band).getByRole('button', { name: 'Plan phase, open, show all its parts' }),
    ).toBeVisible()
    await expect(
      within(band).getByRole('img', { name: 'Readiness, 1 of 7 checks met' }),
    ).toHaveTextContent('1/7')
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
    await expect(panelWidth(canvasElement)).toBeGreaterThan(BAND)
    await expect(canvas.getByRole('heading', { name: 'CSV invoice export' })).toBeVisible()
    await expect(canvas.getByText('Plan · the agent is writing the plan')).toBeVisible()
    const rail = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(
      within(rail).getByRole('button', { name: 'Plan phase, open, show all its parts' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Plan' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    const stage = canvas.getByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Plan/ })).toBeVisible()
    // One part at a time: nothing of the other parts is on the stage.
    await expect(within(stage).queryByRole('heading', { name: /^Problem/ })).toBeNull()
    await expect(canvas.queryByText('Prototype')).toBeNull()
    await expect(
      within(rail).getByRole('img', { name: 'Readiness, 1 of 7 checks met' }),
    ).toBeVisible()
    await expect(within(rail).getByRole('button', { name: '4 things before ready' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Show all' })).toBeNull()
  },
}

/**
 * Just created from the agent's proposal (issue #130): the panel arrives, opening from nothing to
 * its unfolded width on its own spring rather than standing there, and lands unfolded on the
 * part the agent is on.
 */
export const Arrives: Story = {
  args: { arrives: true, defaultFolded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const { panel } = boxesOf(canvasElement)
    const row = panel.parentElement!.getBoundingClientRect().width
    await waitFor(() => expect(panel.getBoundingClientRect().width).toBeCloseTo(row * 0.45, 0))
    await expect(canvas.getByRole('heading', { name: 'CSV invoice export' })).toBeVisible()
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
    await waitFor(() => expect(panelWidth(canvasElement)).toBeGreaterThan(BAND))
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
    await expect(canvas.getByRole('button', { name: 'Tasks, 0' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await waitFor(() => expect(panelWidth(canvasElement)).toBeGreaterThan(BAND))
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
    await waitFor(() => expect(panelWidth(canvasElement)).toBe(BAND))
    // The fold button is gone with the head: the keyboard is on the band's unfold button.
    await expect(canvas.getByRole('button', { name: 'Unfold the Spec' })).toHaveFocus()
    await waitFor(() => expect(canvas.queryByRole('region', { name: 'Stage of ATL-7' })).toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: 'Let the agent write the tasks' }))
    // The agent is writing, and the band says so; the panel waits for the hand.
    await expect(canvas.getByRole('button', { name: 'Tasks, 0' })).toHaveAccessibleDescription(
      'The agent is writing this',
    )
    await expect(args.onFoldChange).toHaveBeenCalledTimes(1)
    await expect(canvas.queryByRole('region', { name: 'Stage of ATL-7' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Unfold the Spec' }))
    await expect(args.onFoldChange).toHaveBeenLastCalledWith(false)
    const stage = await canvas.findByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Tasks/ })).toBeVisible()
    // And unfolded, on the row of what is on the stage.
    await expect(canvas.getByRole('button', { name: 'Tasks, 0' })).toHaveFocus()
  },
}

/** Where the chat and the panel stand on one frame, in pixels. */
interface Frame {
  chat: number
  chatRight: number
  panel: number
  panelLeft: number
}

/** The two boxes of the Session's row: the chat stand-in, and the panel beside it. */
interface Row {
  chat: Element
  panel: HTMLElement
}

function boxesOf(canvasElement: HTMLElement): Row {
  const panel = within(canvasElement).getByRole('region', { name: 'Spec ATL-7' })
  return { chat: panel.previousElementSibling!, panel }
}

/**
 * The frames an action moves the row through: the one before it, every frame while it happens,
 * and every frame after it until nothing has moved for twenty.
 */
async function framesOf(canvasElement: HTMLElement, action: () => Promise<void>): Promise<Frame[]> {
  const { chat, panel } = boxesOf(canvasElement)
  const measure = (): Frame => {
    const left = chat.getBoundingClientRect()
    const right = panel.getBoundingClientRect()
    return { chat: left.width, chatRight: left.right, panel: right.width, panelLeft: right.left }
  }
  const frames = [measure()]
  let acted = false
  const sampled = new Promise<Frame[]>((resolve) => {
    let still = 0
    const sample = (): void => {
      const now = measure()
      still = acted && frames.at(-1)!.chat === now.chat ? still + 1 : 0
      frames.push(now)
      if (still < 20) requestAnimationFrame(sample)
      else resolve(frames)
    }
    requestAnimationFrame(sample)
  })
  await action()
  acted = true
  return sampled
}

/** The chat's widths from the first frame it moved on to where it landed. */
function moved(frames: Frame[]): number[] {
  const widths = frames.map((frame) => frame.chat)
  return widths.slice(widths.findIndex((width) => width !== widths[0]) - 1)
}

/**
 * The panel pushes the chat as it opens (brief revision 4b): the slot's own width moves, and the
 * chat, which takes the rest of the row, narrows with it on every frame from the first one of the
 * unfold, and widens with it on every frame of the fold. It is never a jump — the first width the
 * chat moves to is one on the way — and the panel never stands over the chat: its left edge is
 * on or past the chat's right edge on every frame.
 */
export const ChatPushedAsItOpens: Story = {
  args: { defaultFolded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const opening = await framesOf(canvasElement, () =>
      userEvent.click(canvas.getByRole('button', { name: 'Unfold the Spec' })),
    )
    const narrowing = moved(opening)
    const [full, first] = narrowing
    const narrowest = narrowing.at(-1)!
    await expect(narrowest).toBeLessThan(full!)
    // Down on every frame, and never back up.
    await expect(narrowing).toEqual(narrowing.toSorted((a, b) => b - a))
    // Through the widths in between: the first move is a step, not the landing.
    await expect(first).toBeGreaterThan(narrowest)
    // How many frames play this spring is the runner's frame rate, not the product's — a loaded
    // Chromium gives two or three. A row of widths in between is the claim; their count is not.
    await expect(
      narrowing.filter((width) => width < full! && width > narrowest).length,
    ).toBeGreaterThan(0)
    await expect(opening.filter((frame) => frame.panelLeft < frame.chatRight)).toEqual([])
    await expect(opening.at(-1)!.panel).toBeGreaterThan(BAND)

    const closing = await framesOf(canvasElement, () =>
      userEvent.click(canvas.getByRole('button', { name: 'Fold the Spec' })),
    )
    const widening = moved(closing)
    const widest = widening.at(-1)!
    await expect(widest).toBeGreaterThan(widening[0]!)
    // Up on every frame, and never back down.
    await expect(widening).toEqual(widening.toSorted((a, b) => a - b))
    await expect(widening[1]).toBeLessThan(widest)
    // How many frames play this spring is the runner's frame rate, not the product's — a loaded
    // Chromium gives two or three. A row of widths in between is the claim; their count is not.
    await expect(
      widening.filter((width) => width > widening[0]! && width < widest).length,
    ).toBeGreaterThan(0)
    await expect(closing.filter((frame) => frame.panelLeft < frame.chatRight)).toEqual([])
    await expect(closing.at(-1)!.panel).toBe(BAND)
    await expect(widest).toBe(full)
  },
}

/**
 * Told to move less, the width lands at once: on the frame after the hand unfolds it, the panel is
 * at its unfolded width — a share of the row — and the chat has the rest.
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
    const { chat, panel } = boxesOf(canvasElement)
    const row = panel.parentElement!.getBoundingClientRect().width
    await expect(panel.getBoundingClientRect().width).toBeCloseTo(row * 0.45, 0)
    await expect(chat.getBoundingClientRect().width).toBeCloseTo(row * 0.55, 0)
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
    await expect(canvas.getByRole('button', { name: 'Plan' })).not.toHaveAttribute('aria-current')
  },
}

/**
 * A group heading of the rail puts every part of its phase on the stage, one under the other,
 * as they are; a row then puts its part back alone.
 */
export const GroupOnStage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const shape = canvas.getByRole('button', { name: 'Shape phase, finished, show all its parts' })
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
    await expect(canvas.getByText('An earlier version · read only, as it was frozen')).toBeVisible()
    await expect(canvas.getByText(/a newer version replaced it/)).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
  },
}
