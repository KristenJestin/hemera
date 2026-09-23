import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import type { StageItem } from './model.ts'
import { BUG, MID_PLAN } from './spec-fixtures.ts'
import { type OutlineRow, SpecOutline } from './spec-outline.tsx'
import { rowsOf } from './spec-panel.tsx'

/**
 * The outline of a Spec: the type's sections, a line, the three lists; each row with its mark,
 * the one on the stage filled with the accent. The arrows walk it and Enter opens a row.
 */

/** Every mark once, so the six of them are read side by side. */
const EVERY_MARK: OutlineRow[] = [
  { item: 'problem', label: 'Problem', mark: 'agent' },
  { item: 'expected_outcome', label: 'Expected outcome', mark: 'empty' },
  { item: 'scope', label: 'Scope', mark: 'human' },
  { item: 'verification', label: 'Verification', mark: 'conflict' },
  { item: 'behaviour', label: 'Behaviour', mark: 'stale' },
  { item: 'plan', label: 'Plan', mark: 'writing' },
  { item: 'stories', label: 'Stories', mark: 'agent', count: 2, separated: true },
  { item: 'tasks', label: 'Tasks', mark: 'empty', count: 0 },
  { item: 'questions', label: 'Questions', mark: 'agent', count: 1 },
]

/** The outline with the row on the stage held, as the panel holds it. */
function Held({
  rows,
  initial,
  onSelect,
}: {
  rows: OutlineRow[]
  initial: StageItem
  onSelect: (item: StageItem) => void
}): ReactNode {
  const [current, setCurrent] = useState(initial)
  return (
    <div className="w-outline">
      <SpecOutline
        label="Outline of ATL-7"
        rows={rows}
        current={current}
        onSelect={(item) => {
          setCurrent(item)
          onSelect(item)
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Blocks/Spec/SpecOutline',
  component: Held,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: { rows: EVERY_MARK, initial: 'questions', onSelect: fn() },
  argTypes: {
    rows: { control: 'object', description: 'The rows, in order, with their marks and counts.' },
    initial: { control: 'text', description: 'The row on the stage.' },
    onSelect: { description: 'Puts a row on the stage.' },
  },
} satisfies Meta<typeof Held>

export default meta

type Story = StoryObj<typeof meta>

/**
 * The six marks: written by the agent, not written, edited by you, in conflict, stale, being
 * written — each said in words to whoever cannot see it.
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
      canvas.getByRole('button', { name: 'Questions, 1, written by the agent' }),
    ).toHaveAttribute('aria-current', 'true')
  },
}

/** A feature being planned: no task before Decompose. */
export const Feature: Story = {
  args: { rows: rowsOf(MID_PLAN) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('button', { name: 'Behaviour, written by the agent' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Tasks, 0, not written' })).toBeVisible()
  },
}

/** A bug: `Reproduction` in the contract, and never a `Behaviour` row. */
export const Bug: Story = {
  args: { rows: rowsOf(BUG), initial: 'reproduction' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /^Reproduction/ })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Behaviour/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Stories/ })).toBeNull()
  },
}

/**
 * Outline navigation: one stop of the tab order, the arrows walk the rows without changing the
 * stage, Enter puts the row the keyboard is on onto the stage.
 */
export const Keyboard: Story = {
  args: { rows: rowsOf(MID_PLAN) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
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
