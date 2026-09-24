import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import type { PhaseName, ReadinessView, SpecTarget } from './model.ts'
import { BUG, FULL_GATE, MID_PLAN, READER } from './spec-fixtures.ts'
import { type RailGroup, SpecRail, type StageChoice, railOf } from './spec-rail.tsx'

/**
 * The rail of the Spec panel: the parts of the Spec grouped by the phase that writes them, one
 * quiet row each with its state dot, what is on the stage marked by a thin rule; a group's
 * heading is a row too, which puts the whole phase on the stage. The arrows walk it and Enter
 * opens a row. At its foot, how far the Spec is from ready: seven thin segments and one line,
 * whose things left open a popover of links, and `Mark ready` once every check passes. Folded,
 * it is the band of glyphs the panel folds to.
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

/**
 * The six marks, each said in words to whoever cannot see it; the row on the stage wears the
 * rule and nothing else.
 */
export const Marks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Scope, edited by you' })).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Verification, in conflict with your text' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Plan, being written' })).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Behaviour, stale after the rework' }),
    ).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Questions, 1, written by the agent' }),
    ).toHaveAttribute('aria-current', 'true')
  },
}

/** A feature being planned: Plan open, the plan breathing, no task before Decompose. */
export const Feature: Story = {
  args: { groups: railOf(MID_PLAN), initial: 'plan', following: 'plan' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('group', { name: 'Plan' })).toHaveTextContent('Plan phase, open')
    await expect(
      canvas.getByRole('button', { name: 'Behaviour, written by the agent' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Tasks, 0, not written' })).toBeVisible()
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

/** A group heading chosen: the whole phase on the stage, the heading wearing the rule. */
export const GroupChosen: Story = {
  args: { groups: railOf(MID_PLAN) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const decompose = canvas.getByRole('button', { name: 'Decompose phase, pending' })
    await userEvent.click(decompose)
    await expect(args.onSelectGroup).toHaveBeenCalledWith('decompose')
    await expect(decompose).toHaveAttribute('aria-current', 'true')
    await expect(canvas.getByRole('button', { name: /^Questions/ })).not.toHaveAttribute(
      'aria-current',
    )
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
    const decompose = canvas.getByRole('button', { name: 'Decompose phase, pending' })
    await expect(decompose).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    const plan = canvas.getByRole('button', { name: 'Plan, being written' })
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
    await expect(canvas.getByRole('button', { name: 'Shape phase, finished' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect(questions).toHaveFocus()
  },
}

/**
 * Folded, the band: a column of glyphs, the names hidden from the eye and kept as the accessible
 * name and the tooltip, and the readiness said as `3/7`.
 */
export const Folded: Story = {
  args: { groups: railOf(MID_PLAN), initial: 'plan', folded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByText('Expected outcome')).toBeNull()
    await expect(
      canvas.getByRole('img', { name: 'Readiness, 3 of 7 checks pass' }),
    ).toHaveTextContent('3/7')
    await expect(canvas.queryByRole('button', { name: /things before ready/ })).toBeNull()
    const scope = canvas.getByRole('button', { name: 'Scope, edited by you' })
    await expect(scope).toBeVisible()
    scope.focus()
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('Scope')
  },
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
    const scope = canvas.getAllByRole('button', { name: 'Scope, edited by you' })[0]!
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
