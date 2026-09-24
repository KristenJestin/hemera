import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { emulateReducedMotion, movesLess } from '../../.storybook/reduced-motion.ts'
import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import type { PhaseName, ReadinessView, SpecTarget } from './model.ts'
import { BUG, FULL_GATE, MID_PLAN, READER } from './spec-fixtures.ts'
import { type RailGroup, SpecRail, type StageChoice, railOf } from './spec-rail.tsx'

/**
 * The rail of the Spec panel: the parts of the Spec grouped by the phase that writes them, one
 * quiet row each, what is on the stage marked by a thin rule. A row says only what needs
 * attention, by a tint of the whole row, an edge on its left or a fainter name, and says it in a
 * sentence in its tooltip. A group opens on a header in the small type of a label, which puts the
 * whole phase on the stage; `Show all` shows under the hand and the keyboard. The arrows walk it
 * and Enter opens a row. At its foot, how far the Spec is from ready: seven thin segments and one
 * line, whose things left open a popover of links, and `Mark ready` once every check passes.
 * Folded, it is the band the panel folds to, each phase a block of glyphs.
 */

/** Every mark once, so the six of them are read side by side. */
const EVERY_MARK: RailGroup[] = [
  {
    phase: 'shape',
    state: 'finished',
    rows: [
      { target: 'problem', label: 'Problem', mark: 'agent' },
      { target: 'expected_outcome', label: 'Expected outcome', mark: 'empty' },
      { target: 'scope', label: 'Scope', mark: 'human' },
      { target: 'verification', label: 'Verification', mark: 'conflict' },
      { target: 'behaviour', label: 'Behaviour', mark: 'stale' },
    ],
  },
  { phase: 'plan', state: 'open', rows: [{ target: 'plan', label: 'Plan', mark: 'writing' }] },
  {
    phase: 'decompose',
    state: 'pending',
    rows: [
      { target: 'stories', label: 'Stories', mark: 'agent', count: 2 },
      { target: 'tasks', label: 'Tasks', mark: 'empty', count: 0 },
      { target: 'questions', label: 'Questions', mark: 'agent', count: 1 },
    ],
  },
]

/** Every part a Spec of any type can have, under the three phases the rail draws. */
const EVERY_PART: RailGroup[] = [
  {
    ...EVERY_MARK[0]!,
    rows: [
      ...EVERY_MARK[0]!.rows,
      { target: 'reproduction', label: 'Reproduction', mark: 'agent' },
      { target: 'invariants', label: 'Invariants', mark: 'agent' },
    ],
  },
  EVERY_MARK[1]!,
  EVERY_MARK[2]!,
]

/** The rail with what is on the stage held, as the panel holds it. */
function Held({
  label = 'Parts of ATL-7',
  groups,
  initial,
  following,
  readiness,
  frozenOn,
  replacedBy,
  onSelect,
  onSelectGroup,
  onMarkReady,
  folded = false,
}: {
  /** What the rail is called; two rails side by side need two names. */
  label?: string | undefined
  groups: RailGroup[]
  initial: SpecTarget
  following?: SpecTarget | undefined
  readiness: ReadinessView
  frozenOn?: string | undefined
  replacedBy?: number | undefined
  onSelect: (target: SpecTarget) => void
  onSelectGroup: (phase: PhaseName) => void
  onMarkReady: () => void
  /** Draws the band the panel folds to, rather than the rail of words. */
  folded?: boolean | undefined
}): ReactNode {
  const [current, setCurrent] = useState<StageChoice>({ part: initial })
  return (
    <TooltipProvider>
      <div className={folded ? 'flex h-screen w-spec-band flex-col' : 'flex h-screen'}>
        <SpecRail
          label={label}
          groups={groups}
          current={current}
          following={following}
          onSelect={(target) => {
            setCurrent({ part: target })
            onSelect(target)
          }}
          onSelectGroup={(phase) => {
            setCurrent({ group: phase })
            onSelectGroup(phase)
          }}
          readiness={readiness}
          frozenOn={frozenOn}
          replacedBy={replacedBy}
          onMarkReady={onMarkReady}
          folded={folded}
        />
      </div>
    </TooltipProvider>
  )
}

const meta = {
  title: 'Blocks/Spec/SpecRail',
  component: Held,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'fullscreen' },
  args: {
    groups: EVERY_MARK,
    initial: 'questions',
    readiness: MID_PLAN.readiness,
    onSelect: fn(),
    onSelectGroup: fn(),
    onMarkReady: fn(),
  },
  argTypes: {
    groups: { control: 'object', description: 'The groups and their rows, with their marks.' },
    initial: { control: 'text', description: 'The part on the stage.' },
    following: { control: 'text', description: 'The part the agent writes, which breathes.' },
    readiness: { control: 'object', description: 'The seven checks and what is left.' },
    frozenOn: { control: 'text', description: 'When a `ready` Spec was frozen.' },
    replacedBy: { control: 'number', description: 'The revision that replaced this one.' },
    folded: { control: 'boolean', description: 'The band the panel folds to.' },
    onSelect: { description: 'Puts a part on the stage.' },
    onSelectGroup: { description: 'Puts every part of a phase on the stage.' },
    onMarkReady: { description: 'The human click that freezes the Spec.' },
  },
} satisfies Meta<typeof Held>

export default meta

type Story = StoryObj<typeof meta>

/** The spans of a rail's rows no bigger than a dot: a state dot, which no row wears any more. */
function dotsIn(rail: HTMLElement): Element[] {
  return [...rail.querySelectorAll('[data-row] span')].filter((span) => {
    const box = span.getBoundingClientRect()
    return box.width > 0 && box.width <= 8 && box.height <= 8
  })
}

/** The background of the tint behind a row, `none` when the row has none. */
function tintOf(row: HTMLElement): string {
  const tint = row.querySelector('[data-tint]')
  return tint === null ? 'none' : getComputedStyle(tint).backgroundColor
}

/** Puts the keyboard on a row and waits for its tooltip to say that; the one before may linger. */
async function tooltipSays(row: HTMLElement, said: string): Promise<void> {
  row.focus()
  await waitFor(() =>
    expect(
      within(document.body)
        .getAllByRole('tooltip')
        .map((tooltip) => tooltip.textContent),
    ).toContain(said),
  )
  row.blur()
}

/**
 * One row per state, and no dot anywhere: a part written and current carries nothing, a part
 * still empty has a fainter name, the part being written, one to review and one whose text
 * differs from yours are each tinted in their own colour, and a part you edited wears an edge on
 * its left. Each says its state in a sentence, in its tooltip and as its accessible description.
 */
export const States: Story = {
  args: { initial: 'tasks' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(dotsIn(rail)).toEqual([])
    const row = (name: string): HTMLElement => canvas.getByRole('button', { name })
    const written = row('Problem')
    const empty = row('Expected outcome')
    const edited = row('Scope')
    const differs = row('Verification')
    const review = row('Behaviour')
    const writing = row('Plan')
    // Written and current: nothing, no tint, no edge, no sentence.
    await expect(tintOf(written)).toBe('none')
    await expect(getComputedStyle(written).borderLeftWidth).toBe('0px')
    await expect(written).not.toHaveAttribute('aria-describedby')
    // Empty: the name fainter than a written one's, and nothing behind it.
    await expect(tintOf(empty)).toBe('none')
    await expect(getComputedStyle(empty).color).not.toBe(getComputedStyle(written).color)
    // The three tints, each its own.
    const tints = [tintOf(writing), tintOf(review), tintOf(differs)]
    await expect(tints).not.toContain('none')
    await expect(new Set(tints).size).toBe(3)
    // Being written: the tint breathes, the text does not.
    const breath = writing.querySelector('[data-tint]')
    if (!movesLess()) {
      await expect(breath === null ? '' : getComputedStyle(breath).animationName).toBe('breathe')
    }
    await expect(getComputedStyle(writing).animationName).toBe('none')
    // Edited by you: an edge on the left and no fill.
    await expect(tintOf(edited)).toBe('none')
    await expect(getComputedStyle(edited).borderLeftWidth).toBe('2px')
    // Each state in a sentence.
    await expect(empty).toHaveAccessibleDescription('Empty')
    await expect(edited).toHaveAccessibleDescription('Edited by you')
    await expect(differs).toHaveAccessibleDescription("Your text and the agent's differ")
    await expect(review).toHaveAccessibleDescription('To review')
    await expect(writing).toHaveAccessibleDescription('The agent is writing this')
    await tooltipSays(empty, 'Empty')
    await tooltipSays(edited, 'Edited by you')
    await tooltipSays(differs, "Your text and the agent's differ")
    await tooltipSays(review, 'To review')
    await tooltipSays(writing, 'The agent is writing this')
    await tooltipSays(written, 'Problem')
  },
}

/**
 * Under reduced motion the tint of the part being written holds still, and stays: the state is
 * said by the colour, not by the breath.
 */
export const StatesStill: Story = {
  args: { initial: 'tasks' },
  play: async ({ canvasElement }) => {
    const restore = await emulateReducedMotion()
    if (restore === null) return
    try {
      const writing = within(canvasElement).getByRole('button', { name: 'Plan' })
      const tint = writing.querySelector('[data-tint]')
      expect(tint).not.toBeNull()
      await waitFor(() => {
        expect(tint === null ? '' : getComputedStyle(tint).animationName).toBe('none')
      })
      expect(tintOf(writing)).not.toBe('none')
    } finally {
      await restore()
    }
  },
}

/** A phase whose every part is to review says so on its header too, with the same tint. */
export const PhaseToReview: Story = {
  args: {
    groups: [
      EVERY_MARK[0]!,
      { phase: 'plan', state: 'stale', rows: [{ target: 'plan', label: 'Plan', mark: 'stale' }] },
      EVERY_MARK[2]!,
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const plan = within(canvas.getByRole('group', { name: 'Plan' })).getAllByRole('button')[0]!
    const shape = within(canvas.getByRole('group', { name: 'Shape' })).getAllByRole('button')[0]!
    await expect(tintOf(shape)).toBe('none')
    await expect(tintOf(plan)).toBe(tintOf(canvas.getByRole('button', { name: 'Behaviour' })))
    await expect(plan).toHaveAccessibleDescription('To review')
  },
}

/** A feature being planned: Plan open, the plan breathing, no task before Decompose. */
export const Feature: Story = {
  args: { groups: railOf(MID_PLAN), initial: 'plan', following: 'plan' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      within(canvas.getByRole('group', { name: 'Plan' })).getByRole('button', {
        name: 'Plan phase, open, show all its parts',
      }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Behaviour' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Tasks, 0' })).toBeVisible()
  },
}

/** A bug: Reproduction in Shape, and never a Behaviour nor a Stories row. */
export const Bug: Story = {
  args: { groups: railOf(BUG), initial: 'reproduction', readiness: BUG.readiness },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^Reproduction/ })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Behaviour/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Stories/ })).toBeNull()
  },
}

/** The hint at the end of a header, `Show all`. */
function hintOf(header: HTMLElement): HTMLElement {
  const hint = header.querySelector<HTMLElement>('[data-hint]')
  if (hint === null) throw new Error('A header of the rail has no hint.')
  return hint
}

/** Whether the hint of a header can be seen: it is there all along, and fades in. */
function shown(header: HTMLElement): boolean {
  return getComputedStyle(hintOf(header)).opacity === '1'
}

/** Whether something of the rail wears the rule of what is on the stage. */
function ruled(element: HTMLElement): boolean {
  return getComputedStyle(element, '::before').content !== 'none'
}

/**
 * The headers of the groups read as the headers of sections, not as rows: a smaller, heavier type
 * in the muted colour, a hairline above every group but the first, the rows set in under them.
 * `Show all` shows under the hand or the keyboard and only then, whatever is on the stage. A
 * group on the stage wears the rule on its header and on every part under it, and nothing else.
 */
export const GroupHeaders: Story = {
  args: { groups: railOf(MID_PLAN), initial: 'plan' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const shape = canvas.getByRole('button', { name: 'Shape phase, finished, show all its parts' })
    const plan = canvas.getByRole('button', { name: 'Plan phase, open, show all its parts' })
    const decompose = canvas.getByRole('button', {
      name: 'Decompose phase, pending, show all its parts',
    })
    const problem = canvas.getByRole('button', { name: 'Problem' })
    const onStage = canvas.getByRole('button', { name: 'Plan' })
    const header = getComputedStyle(shape)
    const row = getComputedStyle(problem)
    await expect(header.fontSize).not.toBe(row.fontSize)
    await expect(Number(header.fontWeight)).toBeGreaterThan(Number(row.fontWeight))
    await expect(header.color).not.toBe(getComputedStyle(onStage).color)
    // The rows are set in under their header.
    await expect(problem.getBoundingClientRect().left).toBeGreaterThan(
      shape.getBoundingClientRect().left,
    )
    // A hairline above every group but the first.
    const top = (name: string): string =>
      getComputedStyle(canvas.getByRole('group', { name })).borderTopWidth
    await expect(top('Shape')).toBe('0px')
    await expect(top('Plan')).toBe('1px')
    await expect(top('Decompose')).toBe('1px')
    // The hint: hidden at rest, shown under the hand and under the keyboard.
    await expect(hintOf(shape)).toHaveTextContent('Show all')
    await expect(shown(shape)).toBe(false)
    await userEvent.hover(shape)
    await waitFor(() => expect(shown(shape)).toBe(true))
    await userEvent.unhover(shape)
    await waitFor(() => expect(shown(shape)).toBe(false))
    plan.focus()
    await waitFor(() => expect(shown(plan)).toBe(true))
    plan.blur()
    await waitFor(() => expect(shown(plan)).toBe(false))
    // Its group on the stage: the rule on the header and on every part under it, the hint gone
    // with the hand, and no word saying so.
    const rule = getComputedStyle(onStage, '::before').backgroundColor
    await userEvent.click(decompose)
    await userEvent.unhover(decompose)
    decompose.blur()
    await expect(decompose).toHaveAttribute('aria-current', 'true')
    await waitFor(() => expect(shown(decompose)).toBe(false))
    await expect(hintOf(decompose)).toHaveTextContent('Show all')
    await expect(canvas.queryByText('Showing all')).toBeNull()
    await expect(ruled(decompose)).toBe(true)
    await expect(getComputedStyle(decompose, '::before').backgroundColor).toBe(rule)
    const parts = within(canvas.getByRole('group', { name: 'Decompose' })).getAllByRole('listitem')
    for (const part of parts) {
      const button = within(part).getByRole('button')
      expect(ruled(button)).toBe(true)
      expect(getComputedStyle(button, '::before').backgroundColor).toBe(rule)
    }
    // Nothing else of the rail wears it.
    await expect(ruled(onStage)).toBe(false)
    await expect(ruled(problem)).toBe(false)
    await expect(ruled(plan)).toBe(false)
    // Never cut: the longest name and its hint hold in the rail's width.
    await userEvent.hover(decompose)
    await waitFor(() => expect(shown(decompose)).toBe(true))
    await expect(decompose.scrollWidth).toBeLessThanOrEqual(decompose.clientWidth)
    await expect(getComputedStyle(decompose).color).toBe(header.color)
  },
}

/** A group header chosen: the whole phase on the stage, the header wearing the rule. */
export const GroupChosen: Story = {
  args: { groups: railOf(MID_PLAN) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const decompose = canvas.getByRole('button', {
      name: 'Decompose phase, pending, show all its parts',
    })
    await expect(ruled(decompose)).toBe(false)
    await userEvent.click(decompose)
    await expect(args.onSelectGroup).toHaveBeenCalledWith('decompose')
    await expect(decompose).toHaveAttribute('aria-current', 'true')
    await expect(ruled(decompose)).toBe(true)
    // The parts under it wear the rule, and the stage stays one stop of the tab order.
    const questions = canvas.getByRole('button', { name: /^Questions/ })
    await expect(ruled(questions)).toBe(true)
    await expect(questions).not.toHaveAttribute('aria-current')
  },
}

/**
 * Rail navigation: one stop of the tab order, the arrows walk the rows and the group headings
 * without changing the stage, Enter puts what the keyboard is on onto the stage — a row, or a
 * whole phase — Home and End jump.
 */
export const Keyboard: Story = {
  args: { groups: railOf(MID_PLAN) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    const questions = canvas.getByRole('button', { name: /^Questions/ })
    await expect(questions).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    await expect(canvas.getByRole('button', { name: /^Tasks/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    const decompose = canvas.getByRole('button', {
      name: 'Decompose phase, pending, show all its parts',
    })
    await expect(decompose).toHaveFocus()
    // The keyboard on a header shows what it does.
    await waitFor(() => expect(shown(decompose)).toBe(true))
    await userEvent.keyboard('{ArrowUp}')
    const plan = canvas.getByRole('button', { name: 'Plan' })
    await expect(plan).toHaveFocus()
    // Walking is not opening: the stage still shows the questions.
    await expect(args.onSelect).not.toHaveBeenCalled()
    await expect(questions).toHaveAttribute('aria-current', 'true')
    await userEvent.keyboard('{Enter}')
    await expect(args.onSelect).toHaveBeenCalledWith('plan')
    await expect(plan).toHaveAttribute('aria-current', 'true')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(args.onSelectGroup).toHaveBeenCalledWith('decompose')
    await expect(decompose).toHaveAttribute('aria-current', 'true')
    await userEvent.keyboard('{Home}')
    await expect(
      canvas.getByRole('button', { name: 'Shape phase, finished, show all its parts' }),
    ).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect(questions).toHaveFocus()
  },
}

/**
 * Folded, the band keeps the hierarchy: each phase a block, its glyph in a tinted square, the
 * smaller glyphs of its parts right under it and set in, and a gap and a hairline before the next
 * phase. The tints of the rows fill the squares of the parts; the names leave the eye and stay the
 * accessible name and the tooltip, the state said beside the name. The readiness is said as `3/7`.
 */
export const Folded: Story = {
  args: { groups: EVERY_MARK, initial: 'tasks', folded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(canvas.queryByText('Expected outcome')).toBeNull()
    await expect(dotsIn(rail)).toEqual([])
    await expect(
      canvas.getByRole('img', { name: 'Readiness, 3 of 7 checks pass' }),
    ).toHaveTextContent('3/7')
    await expect(canvas.queryByRole('button', { name: /things before ready/ })).toBeNull()
    const blocks = ['Shape', 'Plan', 'Decompose'].map((name) => canvas.getByRole('group', { name }))
    for (const [index, block] of blocks.entries()) {
      const [phase, ...parts] = within(block).getAllByRole('button')
      if (phase === undefined) throw new Error('A phase of the band has no square.')
      // The phase's glyph in a tinted square, a step larger than the glyphs of its parts.
      expect(getComputedStyle(phase).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
      const phaseBox = phase.getBoundingClientRect()
      const phaseGlyph = glyphWidthOf(phase)
      let above = phaseBox.bottom
      for (const part of parts) {
        const box = part.getBoundingClientRect()
        // Right under the phase, tight, and set in.
        expect(box.top - above).toBeLessThan(4)
        expect(box.left).toBeGreaterThan(phaseBox.left)
        expect(glyphWidthOf(part)).toBeLessThan(phaseGlyph)
        above = box.bottom
      }
      // A clear gap and a hairline before the next phase.
      const next = blocks[index + 1]
      if (next !== undefined) {
        expect(next.getBoundingClientRect().top - above).toBeGreaterThan(8)
        expect(getComputedStyle(next).borderTopWidth).toBe('1px')
      }
    }
    // The tints land on the squares of the parts, one colour per state.
    const square = (name: string): HTMLElement => canvas.getByRole('button', { name })
    const tints = [
      tintOf(square('Plan')),
      tintOf(square('Behaviour')),
      tintOf(square('Verification')),
    ]
    await expect(tints).not.toContain('none')
    await expect(new Set(tints).size).toBe(3)
    await expect(tintOf(square('Problem'))).toBe('none')
    await expect(getComputedStyle(square('Scope')).borderLeftWidth).toBe('2px')
    // The name and the state, in the tooltip.
    await tooltipSays(square('Scope'), 'Scope · Edited by you')
    await tooltipSays(square('Behaviour'), 'Behaviour · To review')
    await tooltipSays(square('Problem'), 'Problem')
    // A phase's square says what it does.
    await tooltipSays(canvas.getByRole('button', { name: /^Shape phase/ }), 'Shape · show all')
  },
}

/** How wide the glyph of a row is drawn. */
function glyphWidthOf(row: HTMLElement): number {
  return row.querySelector('[data-icon]')?.getBoundingClientRect().width ?? 0
}

/** The `data-icon` of each row of a rail, the group headings among them, in order. */
function iconsOf(rail: HTMLElement): string[] {
  return [...rail.querySelectorAll('[data-row]')].map(
    (row) => row.querySelector('[data-icon]')?.getAttribute('data-icon') ?? '',
  )
}

/**
 * Every phase and every part wears a glyph of its own (brief revision 4b): the three phase
 * headings and the eleven parts a Spec of any type can have are fourteen different glyphs, the
 * same ones folded as unfolded, where the glyph stands before the name.
 */
export const EveryIcon: Story = {
  args: { groups: EVERY_PART, initial: 'plan' },
  render: (args) => (
    <div className="flex">
      <Held {...args} label="Parts of ATL-7, unfolded" />
      <Held {...args} label="Parts of ATL-7, folded" folded />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const unfolded = iconsOf(canvas.getByRole('navigation', { name: 'Parts of ATL-7, unfolded' }))
    const folded = iconsOf(canvas.getByRole('navigation', { name: 'Parts of ATL-7, folded' }))
    await expect(unfolded).toHaveLength(14)
    await expect(unfolded).not.toContain('')
    await expect(new Set(unfolded).size).toBe(14)
    await expect(folded).toEqual(unfolded)
    // The glyph stands before the name.
    const scope = canvas.getAllByRole('button', { name: 'Scope' })[0]!
    await expect(scope.firstElementChild).toHaveAttribute('data-icon', 'IconBorderOuter')
    await expect(scope).toHaveTextContent('Scope')
  },
}

/**
 * The foot, partial: seven thin segments, three filled, and `3/7 · 4 things before ready` — no
 * `Mark ready`, never drawn disabled.
 */
export const FootPartial: Story = {
  args: { groups: railOf(MID_PLAN) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Readiness, 3 of 7 checks pass' })).toBeVisible()
    await expect(canvas.getByText('3/7')).toBeVisible()
    await expect(canvas.getByRole('button', { name: '4 things before ready' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
  },
}

/** The things left open a popover of links, each putting its part on the stage. */
export const FootLinks: Story = {
  args: { groups: railOf(MID_PLAN), readiness: READER.readiness },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: '3 things before ready' }))
    const page = within(document.body)
    const list = await page.findByRole('dialog', { name: 'Things before ready' })
    // The attestation has no part in the document: it is said, not linked.
    // The popover comes down into place; what is asked is where it lands.
    await waitFor(() => expect(within(list).getByText('the attestation')).toBeVisible())
    await expect(within(list).queryByRole('button', { name: 'the attestation' })).toBeNull()
    await userEvent.click(within(list).getByRole('button', { name: 'a task for S2' }))
    await expect(args.onSelect).toHaveBeenCalledWith('tasks')
    await expect(canvas.getByRole('button', { name: /^Tasks/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  },
}

/** The foot, full: `Ready to freeze`, and `Mark ready` sits under it. */
export const FootFull: Story = {
  args: { groups: railOf(MID_PLAN), readiness: FULL_GATE },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Readiness, 7 of 7 checks pass' })).toBeVisible()
    await expect(canvas.getByText('Ready to freeze')).toBeVisible()
    const mark = canvas.getByRole('button', { name: 'Mark ready' })
    await expect(mark).toBeEnabled()
    await userEvent.click(mark)
    await expect(args.onMarkReady).toHaveBeenCalled()
  },
}

/**
 * An obsolete request refused: the Spec changed between the gate shown and the click, so it was
 * not frozen; the foot says why, under `Mark ready`.
 */
export const FootRefused: Story = {
  args: {
    groups: railOf(MID_PLAN),
    readiness: {
      ...FULL_GATE,
      refused:
        'ATL-7 changed since its gate was shown: read the gate again before marking it ready.',
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent(/changed since its gate was shown/)
    await expect(canvas.getByRole('button', { name: 'Mark ready' })).toBeVisible()
  },
}

/** Frozen: the bar full, and the line says since when. */
export const FootFrozen: Story = {
  args: { groups: railOf(MID_PLAN), readiness: FULL_GATE, frozenOn: '23 Sep' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Frozen on 23 Sep/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
  },
}

/** An older revision: frozen too, and the line names the revision that replaced it. */
export const FootReplaced: Story = {
  args: { groups: railOf(MID_PLAN), readiness: FULL_GATE, frozenOn: '22 Sep', replacedBy: 2 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Frozen on 22 Sep · read only, revision 2 replaced it'),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
  },
}
