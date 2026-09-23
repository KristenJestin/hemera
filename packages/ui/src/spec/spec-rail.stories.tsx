import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import type { SpecTarget } from './model.ts'
import { BUG, MID_PLAN } from './spec-fixtures.ts'
import { type RailGroup, SpecRail, railOf } from './spec-rail.tsx'

/**
 * The rail of the Spec panel: the parts of the Spec grouped by the phase that writes them, one
 * quiet row each with its state dot, the row on the stage marked by a thin rule. The arrows walk
 * it and Enter opens a row; `Show all` puts the whole document on the stage.
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

/** The rail with the row on the stage and the toggle held, as the panel holds them. */
function Held({
  groups,
  initial,
  following,
  onSelect,
  onShowAllChange,
  folded = false,
}: {
  groups: RailGroup[]
  initial: SpecTarget
  following?: SpecTarget | undefined
  onSelect: (target: SpecTarget) => void
  onShowAllChange: (showAll: boolean) => void
  /** Draws the rail in a panel narrower than 560 pixels, where it folds to glyphs. */
  folded?: boolean | undefined
}): ReactNode {
  const [current, setCurrent] = useState(initial)
  const [showAll, setShowAll] = useState(false)
  return (
    <TooltipProvider>
      {/* The panel's own box, which the rail's container query reads. */}
      <div
        className={
          folded
            ? '@container flex h-screen w-full max-w-sm'
            : '@container flex h-screen w-full max-w-xl'
        }
      >
        <SpecRail
          label="Parts of ATL-7"
          groups={groups}
          current={current}
          following={following}
          onSelect={(target) => {
            setCurrent(target)
            onSelect(target)
          }}
          showAll={showAll}
          onShowAllChange={(next) => {
            setShowAll(next)
            onShowAllChange(next)
          }}
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
    onSelect: fn(),
    onShowAllChange: fn(),
  },
  argTypes: {
    groups: { control: 'object', description: 'The groups and their rows, with their marks.' },
    initial: { control: 'text', description: 'The part on the stage.' },
    following: { control: 'text', description: 'The part the agent writes, which breathes.' },
    folded: { control: 'boolean', description: 'A panel narrower than 560 pixels.' },
    onSelect: { description: 'Puts a part on the stage.' },
    onShowAllChange: { description: 'Switches the stage to the whole document and back.' },
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
    await expect(canvas.getByRole('group', { name: 'Plan' })).toHaveTextContent('Plan, open')
    await expect(
      canvas.getByRole('button', { name: 'Behaviour, written by the agent' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Tasks, 0, not written' })).toBeVisible()
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

/**
 * Rail navigation: one stop of the tab order, the arrows walk the rows without changing the
 * stage, Enter puts the row the keyboard is on onto the stage, Home and End jump.
 */
export const Keyboard: Story = {
  args: { groups: railOf(MID_PLAN) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Show all' })).toHaveFocus()
    await userEvent.tab()
    const questions = canvas.getByRole('button', { name: /^Questions/ })
    await expect(questions).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    await expect(canvas.getByRole('button', { name: /^Tasks/ })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}{ArrowUp}')
    const plan = canvas.getByRole('button', { name: /^Plan/ })
    await expect(plan).toHaveFocus()
    // Walking is not opening: the stage still shows the questions.
    await expect(args.onSelect).not.toHaveBeenCalled()
    await expect(questions).toHaveAttribute('aria-current', 'true')
    await userEvent.keyboard('{Enter}')
    await expect(args.onSelect).toHaveBeenCalledWith('plan')
    await expect(plan).toHaveAttribute('aria-current', 'true')
    await userEvent.keyboard('{Home}')
    await expect(canvas.getByRole('button', { name: /^Problem/ })).toHaveFocus()
    await userEvent.keyboard('{End}')
    await expect(questions).toHaveFocus()
  },
}

/**
 * Under 560 pixels of panel: a column of glyphs, the names hidden from the eye and kept as the
 * accessible name and the tooltip.
 */
export const Collapsed: Story = {
  args: { groups: railOf(MID_PLAN), initial: 'plan', folded: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    // The fold is a container query: what is asked is the width the browser laid out.
    await expect(rail.getBoundingClientRect().width).toBeLessThan(48)
    await expect(canvas.getByText('Expected outcome')).not.toBeVisible()
    const scope = canvas.getByRole('button', { name: 'Scope, edited by you' })
    await expect(scope).toBeVisible()
    scope.focus()
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('Scope')
  },
}

/** `Show all`: a pressed toggle, reported to the panel, and released the same way. */
export const ShowAllToggled: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('button', { name: 'Show all' })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(toggle)
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(args.onShowAllChange).toHaveBeenCalledWith(true)
    await userEvent.click(toggle)
    await expect(args.onShowAllChange).toHaveBeenLastCalledWith(false)
  },
}
