import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { emulateReducedMotion, movesLess } from '../../.storybook/reduced-motion.ts'
import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import type { PhaseName, SpecTarget } from './model.ts'
import { BUG, MID_PLAN } from './spec-fixtures.ts'
import { type RailGroup, SpecRail, type StageChoice, railOf } from './spec-rail.tsx'

/**
 * The rail of the Spec panel: the parts of the Spec grouped by the phase that writes them, one
 * row each, what is on the stage on a plain selected surface. Every row says its own state
 * without being opened — written plainly, empty quietly, being written or to review by a tint —
 * and says it in a sentence in its tooltip (issue #135). At its end, after its count, a mark says
 * how far along it is: a check when done, a half circle when started, nothing when empty (issue
 * #150). A group opens on a header in the small type of a label, which puts the
 * whole phase on the stage; `Show all` shows under the hand and the keyboard. The arrows walk it
 * and Enter opens a row. No readiness at its foot (issue #135). Folded, it is the band the panel
 * folds to, each phase a block of glyphs.
 */

/** Every mark once, so the five of them are read side by side. */
const EVERY_MARK: RailGroup[] = [
  {
    phase: 'shape',
    state: 'finished',
    rows: [
      { target: 'problem', label: 'Problem', mark: 'agent' },
      { target: 'expected_outcome', label: 'Expected outcome', mark: 'empty' },
      { target: 'scope', label: 'Scope', mark: 'human' },
      { target: 'verification', label: 'Verification', mark: 'agent' },
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
  onSelect,
  onSelectGroup,
  folded = false,
}: {
  /** What the rail is called; two rails side by side need two names. */
  label?: string | undefined
  groups: RailGroup[]
  initial: SpecTarget
  following?: SpecTarget | undefined
  onSelect: (target: SpecTarget) => void
  onSelectGroup: (phase: PhaseName) => void
  /** Draws the band the panel folds to, rather than the rail of words. */
  folded?: boolean | undefined
}): ReactNode {
  const [current, setCurrent] = useState<StageChoice>({ part: initial })
  return (
    <TooltipProvider>
      <div className={folded ? 'flex h-screen w-mission-band flex-col' : 'flex h-screen'}>
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
          folded={folded}
        />
      </div>
    </TooltipProvider>
  )
}

const meta = {
  title: 'Blocks/Spec/SpecRail',
  component: Held,
  tags: ['autodocs', 'updated'],
  parameters: { layout: 'fullscreen' },
  args: {
    groups: EVERY_MARK,
    initial: 'questions',
    onSelect: fn(),
    onSelectGroup: fn(),
  },
  argTypes: {
    groups: { control: 'object', description: 'The groups and their rows, with their marks.' },
    initial: { control: 'text', description: 'The part on the stage.' },
    following: { control: 'text', description: 'The part the agent writes, which breathes.' },
    folded: { control: 'boolean', description: 'The band the panel folds to.' },
    onSelect: { description: 'Puts a part on the stage.' },
    onSelectGroup: { description: 'Puts every part of a phase on the stage.' },
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

/** The mark at the end of a row: `done`, `started`, or `none` when it wears none. */
function progressOf(row: HTMLElement): string {
  return row.querySelector('[data-progress]')?.getAttribute('data-progress') ?? 'none'
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
 * One row per state, each said in the row without opening it, and no dot anywhere (issue #135): a
 * part written is plain, its name in the foreground; a part still empty is quiet, its name muted
 * and `empty` in its accessible name; the part being written and one to review are each tinted
 * in their own colour; a part you edited wears nothing more than a written one. What is on the
 * stage wears a plain selected surface, and no rule. Each says its state in a sentence in its
 * tooltip.
 */
export const States: Story = {
  args: { initial: 'tasks' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(dotsIn(rail)).toEqual([])
    const row = (name: string): HTMLElement => canvas.getByRole('button', { name })
    const written = row('Problem')
    const empty = row('Expected outcome, empty')
    const edited = row('Scope')
    const review = row('Behaviour')
    const writing = row('Plan')
    // Written and current: plain — the foreground text, no tint, no edge, a check at its end and
    // `Done` its only sentence — and not the one on the stage, which the tasks are.
    await expect(tintOf(written)).toBe('none')
    await expect(getComputedStyle(written).borderLeftWidth).toBe('0px')
    await expect(written).toHaveAccessibleDescription('Done')
    await expect(written).not.toHaveAttribute('aria-current')
    await expect(selected(written)).toBe(false)
    // Empty: quiet, the name fainter than a written one's, nothing behind it, and said in its name.
    await expect(tintOf(empty)).toBe('none')
    await expect(getComputedStyle(empty).color).not.toBe(getComputedStyle(written).color)
    await expect(getComputedStyle(row('Questions, 1')).color).toBe(getComputedStyle(written).color)
    await expect(empty).not.toHaveAttribute('aria-describedby')
    // The two tints, each its own.
    const tints = [tintOf(writing), tintOf(review)]
    await expect(tints).not.toContain('none')
    await expect(new Set(tints).size).toBe(2)
    // Being written: the tint breathes, the text does not.
    const breath = writing.querySelector('[data-tint]')
    if (!movesLess()) {
      await expect(breath === null ? '' : getComputedStyle(breath).animationName).toBe('breathe')
    }
    await expect(getComputedStyle(writing).animationName).toBe('none')
    // Edited by you: no edge and no fill, the sentence alone.
    await expect(tintOf(edited)).toBe('none')
    await expect(getComputedStyle(edited).borderLeftWidth).toBe('0px')
    // Each state in a sentence.
    await expect(edited).toHaveAccessibleDescription('Done. Edited by you')
    await expect(review).toHaveAccessibleDescription('Started. To review')
    await expect(writing).toHaveAccessibleDescription('The agent is writing this')
    await tooltipSays(empty, 'Empty')
    await tooltipSays(edited, 'Done. Edited by you')
    await tooltipSays(review, 'Started. To review')
    await tooltipSays(writing, 'The agent is writing this')
    await tooltipSays(written, 'Done')
    // How far along each is, at its end: done, started — to review or being written — or nothing.
    await expect(progressOf(written)).toBe('done')
    await expect(progressOf(edited)).toBe('done')
    await expect(progressOf(review)).toBe('started')
    await expect(progressOf(writing)).toBe('started')
    await expect(progressOf(empty)).toBe('none')
    // On the stage, the part you edited wears the selected surface, and no rule.
    await userEvent.click(edited)
    await expect(edited).toHaveAttribute('aria-current', 'true')
    await expect(selected(edited)).toBe(true)
    await expect(ruled(edited)).toBe(false)
    await expect(getComputedStyle(edited).borderLeftWidth).toBe('0px')
    await expect(selected(row('Tasks, 0, empty'))).toBe(false)
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

/**
 * Each part says how far along it is at a glance, at the end of its row and without a dot (issue
 * #150), read from what is written and the phase that writes it. A feature being planned: the
 * shaped sections are done, their phase finished; the plan, being written, is started; the
 * stories and the question, written while `decompose` has not finished, are started too; the
 * tasks, not written, wear nothing and their name is muted. The counts stay.
 */
export const Progress: Story = {
  args: { groups: railOf(MID_PLAN), initial: 'plan', following: 'plan' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(dotsIn(rail)).toEqual([])
    const row = (name: string): HTMLElement => canvas.getByRole('button', { name })
    for (const name of ['Problem', 'Expected outcome', 'Scope', 'Verification', 'Behaviour']) {
      expect(progressOf(row(name))).toBe('done')
    }
    await expect(row('Problem')).toHaveAccessibleDescription('Done')
    await expect(progressOf(row('Plan'))).toBe('started')
    await expect(progressOf(row('Stories, 2'))).toBe('started')
    await expect(row('Stories, 2')).toHaveAccessibleDescription('Started')
    await expect(progressOf(row('Questions, 1'))).toBe('started')
    const tasks = row('Tasks, 0, empty')
    await expect(progressOf(tasks)).toBe('none')
    await expect(getComputedStyle(tasks).color).not.toBe(getComputedStyle(row('Problem')).color)
    // The mark stands at the end of the row, after the count, and is the glyph of the catalogue.
    const stories = row('Stories, 2')
    const mark = stories.querySelector('[data-progress]')!
    await expect(stories.lastElementChild).toBe(mark)
    await expect(mark.querySelector('.tabler-icon-circle-half-2')).not.toBeNull()
    await expect(row('Problem').querySelector('[data-progress] .tabler-icon-check')).not.toBeNull()
    await expect(stories).toHaveTextContent('Stories2')
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
    await expect(canvas.getByRole('button', { name: 'Tasks, 0, empty' })).toBeVisible()
  },
}

/** A bug: Reproduction in Shape, and never a Behaviour nor a Stories row. */
export const Bug: Story = {
  args: { groups: railOf(BUG), initial: 'reproduction' },
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

/** Whether something of the rail wears a rule on its left, which nothing unfolded does any more. */
function ruled(element: HTMLElement): boolean {
  return getComputedStyle(element, '::before').content !== 'none'
}

/** Whether something of the rail wears the selected surface of what is on the stage. */
function selected(element: HTMLElement): boolean {
  return getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)'
}

/**
 * The headers of the groups read as the headers of sections, not as rows: a smaller, heavier type
 * in the muted colour, a hairline above every group but the first, the rows set in under them.
 * `Show all` shows under the hand or the keyboard and only then, whatever is on the stage. A
 * group on the stage wears the selected surface on its header alone: no primary bar, and nothing on
 * the parts under it but their own states (issue #135).
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
    // A header is its glyph and its name: no state dot on any of them.
    for (const heading of [shape, plan, decompose]) {
      const dots = [...heading.querySelectorAll('span')].filter((span) => {
        const box = span.getBoundingClientRect()
        return span.textContent === '' && box.width > 0 && box.width <= 8 && box.height <= 8
      })
      expect(dots).toEqual([])
    }
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
    // Its group on the stage: the selected surface on the header alone, the hint gone with the
    // hand, and no word saying so.
    await userEvent.click(decompose)
    await userEvent.unhover(decompose)
    decompose.blur()
    await expect(decompose).toHaveAttribute('aria-current', 'true')
    await waitFor(() => expect(shown(decompose)).toBe(false))
    await expect(hintOf(decompose)).toHaveTextContent('Show all')
    await expect(canvas.queryByText('Showing all')).toBeNull()
    await expect(selected(decompose)).toBe(true)
    await expect(ruled(decompose)).toBe(false)
    const parts = within(canvas.getByRole('group', { name: 'Decompose' })).getAllByRole('listitem')
    for (const part of parts) {
      const button = within(part).getByRole('button')
      expect(ruled(button)).toBe(false)
      expect(selected(button)).toBe(false)
    }
    // Nothing else of the rail wears it.
    await expect(selected(onStage)).toBe(false)
    await expect(selected(problem)).toBe(false)
    await expect(selected(plan)).toBe(false)
    // Never cut: the longest name and its hint hold in the rail's width.
    await userEvent.hover(decompose)
    await waitFor(() => expect(shown(decompose)).toBe(true))
    await expect(decompose.scrollWidth).toBeLessThanOrEqual(decompose.clientWidth)
  },
}

/**
 * `Show all` chosen: the whole phase on the stage, its header on the selected surface and the
 * parts under it with nothing but their own states — no primary bar on any of them.
 */
export const GroupChosen: Story = {
  args: { groups: railOf(MID_PLAN) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const decompose = canvas.getByRole('button', {
      name: 'Decompose phase, pending, show all its parts',
    })
    await expect(selected(decompose)).toBe(false)
    await userEvent.click(decompose)
    await expect(args.onSelectGroup).toHaveBeenCalledWith('decompose')
    await expect(decompose).toHaveAttribute('aria-current', 'true')
    await expect(selected(decompose)).toBe(true)
    // The parts under it wear nothing of it, and the stage stays one stop of the tab order.
    const questions = canvas.getByRole('button', { name: /^Questions/ })
    await expect(selected(questions)).toBe(false)
    await expect(ruled(questions)).toBe(false)
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
 * accessible name and the tooltip, the state said beside the name. Nothing stands at its foot.
 */
export const Folded: Story = {
  args: { groups: EVERY_MARK, initial: 'tasks', folded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(canvas.queryByText('Expected outcome')).toBeNull()
    await expect(dotsIn(rail)).toEqual([])
    await expect(canvas.queryByRole('img', { name: /^Readiness/ })).toBeNull()
    await expect(canvas.queryByText(/^[0-9]+[/][0-9]+$/)).toBeNull()
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
    const tints = [tintOf(square('Plan')), tintOf(square('Behaviour'))]
    await expect(tints).not.toContain('none')
    await expect(new Set(tints).size).toBe(2)
    await expect(tintOf(square('Problem'))).toBe('none')
    // Edited by you: no edge on its square either, the tooltip says it.
    await expect(getComputedStyle(square('Scope')).borderLeftWidth).toBe('0px')
    // The name and the state, in the tooltip.
    await tooltipSays(square('Scope'), 'Scope · Done. Edited by you')
    await tooltipSays(square('Behaviour'), 'Behaviour · Started. To review')
    await tooltipSays(square('Problem'), 'Problem · Done')
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
 * No foot (issue #135): no readiness bar, no count of checks, no things before ready, no
 * `Mark ready` and no line of when the Spec was marked ready. What the draft lacks is the agent's
 * to say, and `Mark ready`'s — in the panel's footer — to refuse with.
 */
export const NoReadiness: Story = {
  args: { groups: railOf(MID_PLAN) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('img', { name: /^Readiness/ })).toBeNull()
    await expect(canvas.queryByText(/checks met/)).toBeNull()
    await expect(canvas.queryByRole('button', { name: /before ready/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
    await expect(canvas.queryByText(/Frozen on|Ready to freeze/)).toBeNull()
  },
}
