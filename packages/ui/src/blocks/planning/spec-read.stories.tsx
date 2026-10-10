import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import {
  CHANGES,
  REQUIREMENTS,
  TASKS,
  WRITTEN,
} from '../../surfaces/planning/planning-fixtures.ts'
import { SpecRead } from './spec-read.tsx'

/**
 * The Spec as the Planning page reads it, in the middle at its measure: the seven prose sections
 * and the requirements in order, each with its state; requirements with their delta, the living
 * requirement a change touches, scenarios with their Proof block; the tasks folded at the end.
 * Nothing to edit: the Planner writes, the user reads and answers.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/SpecRead',
  component: SpecRead,
  args: {
    sections: WRITTEN,
    requirementsState: 'written',
    requirements: REQUIREMENTS,
    tasks: TASKS,
    changes: [],
  },
  decorators: [
    (Story) => (
      <div className="max-w-page p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SpecRead>

export default meta
type Story = StoryObj<typeof meta>

/** Written whole: eight sections, read and never edited. */
export const Written: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('heading', { level: 2 })).toHaveLength(8)
    await expect(canvas.getByRole('region', { name: 'Requirements' })).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
  },
}

/** The first draft: what is written, the section being written with Hemera's face, the rest empty. */
export const FirstDraft: Story = {
  args: {
    sections: WRITTEN.map((section, index) => ({
      ...section,
      state: index < 2 ? 'written' : index === 2 ? 'being_written' : 'empty',
      body: index < 2 ? section.body : '',
    })),
    requirementsState: 'empty',
    requirements: [],
    tasks: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status', { name: 'Hemera writes Impact' })).toBeVisible()
    await expect(canvas.getAllByText('Not written yet.').length).toBeGreaterThan(0)
  },
}

/** What changed since the last read wears a line and a dot where it changed. */
export const ChangedSinceLastRead: Story = {
  args: { changes: CHANGES },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('img', { name: 'Changed since your last read' })).toHaveLength(
      2,
    )
    await expect(canvas.getByRole('region', { name: 'Decisions' })).toHaveAttribute(
      'data-changed',
    )
  },
}

/** A modified requirement shows the living one it changes; a removed one is struck through. */
export const Deltas: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const removed = canvas.getByRole('listitem', { name: /^R4/ })
    await expect(within(removed).getByRole('img', { name: 'Removed' })).toBeVisible()
    await expect(removed).toHaveTextContent('itself still proposed')
    const modified = canvas.getByRole('listitem', { name: /^R2/ })
    await expect(within(modified).getByRole('img', { name: 'Modified' })).toBeVisible()
    await expect(modified).toHaveTextContent('Notes.R4')
  },
}

/** A Proof block with what a run prints today, its key line, and one verified by hand. */
export const Proofs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Seen today')).toBeVisible()
    await expect(canvas.getByText(/ENOENT/, { selector: '[data-key-line]' })).toBeVisible()
    await expect(canvas.getByText('Verified by hand')).toBeVisible()
    await expect(canvas.getByText('From Probe #1')).toBeVisible()
  },
}

/** The tasks, folded by default; opened, the graph as written, read-only. */
export const TasksOpened: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = canvas.getByRole('button', { name: /Tasks/ })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.queryByRole('list', { name: 'Task list' })).toBeNull()
    await userEvent.click(toggle)
    await waitFor(() => expect(canvas.getByRole('list', { name: 'Task list' })).toBeVisible())
    await expect(canvas.getByText(/after T1, T2/)).toBeVisible()
  },
}

const LONG =
  'When the user exports a note whose title is a whole sentence written by someone who pasted the first paragraph of a meeting into the title field, '

/** Long text everywhere: the prose keeps its measure, nothing overflows. */
export const LongText: Story = {
  args: {
    requirements: REQUIREMENTS.map((requirement) => ({
      ...requirement,
      text: `${LONG}${requirement.text}`,
    })),
    sections: WRITTEN.map((section) => ({ ...section, body: `${LONG}${section.body}` })),
  },
  play: async ({ canvasElement }) => {
    const region = within(canvasElement).getByRole('region', { name: 'Requirements' })
    await expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth)
  },
}
