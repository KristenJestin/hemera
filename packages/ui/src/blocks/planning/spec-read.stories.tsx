import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ComponentProps } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import {
  CHANGES,
  REQUIREMENTS,
  TASKS,
  WAVES,
  WRITTEN,
} from '../../surfaces/planning/planning-fixtures.ts'
import { openBySection } from './planning-types.ts'
import { SectionsNav, SpecRead } from './spec-read.tsx'

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
    open: new Map(),
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

/**
 * Every section written and no question open: each wears the green check, which means settled.
 */
export const SectionsSettled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const decisions = canvas.getByRole('region', { name: 'Decisions' })
    await expect(within(decisions).getByRole('img', { name: 'Settled' })).toBeVisible()
  },
}

/**
 * Decisions and Requirements written while questions are open on them: in progress, with the
 * count, on the heading and in the list; never the green check until they are answered and taken
 * into account.
 */
export const SectionsWithQuestionsOpen: Story = {
  args: { open: openBySection(WAVES) },
  render: (args) => (
    <div className="flex gap-8">
      <div className="w-settings-nav shrink-0">
        <SectionsNav
          sections={args.sections}
          requirementsState={args.requirementsState}
          changes={args.changes}
          tasks={args.tasks}
          open={args.open}
        />
      </div>
      <SpecRead {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const decisions = canvas.getByRole('region', { name: 'Decisions' })
    await expect(
      within(decisions).getByRole('img', { name: 'Written · 1 question open' }),
    ).toBeVisible()
    await expect(within(decisions).queryByRole('img', { name: 'Settled' })).toBeNull()
    const requirements = canvas.getByRole('region', { name: 'Requirements' })
    await expect(
      within(requirements).getByRole('img', { name: 'Written · 2 questions open' }),
    ).toBeVisible()
    const nav = within(canvas.getByRole('navigation', { name: 'Spec sections' }))
    await expect(nav.getByRole('img', { name: 'Written · 2 questions open' })).toBeVisible()
    await expect(nav.getAllByRole('img', { name: 'Settled' })).toHaveLength(6)
  },
}

/** The Spec in its own scroll, its sections down the left: what a click on the list scrolls. */
const scrolled = (args: ComponentProps<typeof SpecRead>) => (
  <div className="flex gap-8">
    <div className="w-settings-nav shrink-0">
      <SectionsNav
        sections={args.sections}
        requirementsState={args.requirementsState}
        changes={args.changes}
        tasks={args.tasks}
        open={args.open}
      />
    </div>
    <div data-scroller="" className="h-notice min-w-0 flex-1 overflow-auto">
      <SpecRead {...args} />
    </div>
  </div>
)

/** Whether an element's top shows inside the box that scrolls it. */
const shownIn = (element: Element, scroller: Element): boolean => {
  const box = element.getBoundingClientRect()
  const room = scroller.getBoundingClientRect()
  return box.top >= room.top && box.top < room.bottom
}

/**
 * A click on a section of the list brings the Spec to it and gives its heading the focus. Under
 * reduced motion — what the stories play — the jump is instant: the section is there when the
 * click has returned, and the Spec's reading position moved with it.
 */
export const ListScrollsToTheSectionClicked: Story = {
  render: scrolled,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scroller = canvasElement.querySelector<HTMLElement>('[data-scroller]')!
    const nav = within(canvas.getByRole('navigation', { name: 'Spec sections' }))
    const risks = canvas.getByRole('region', { name: 'Risks & trade-offs' })
    await expect(shownIn(risks, scroller)).toBe(false)
    await userEvent.click(nav.getByRole('button', { name: /Risks & trade-offs/ }))
    await expect(shownIn(risks, scroller)).toBe(true)
    await expect(scroller.scrollTop).toBeGreaterThan(0)
    await expect(within(risks).getByRole('heading', { name: /Risks & trade-offs/ })).toHaveFocus()
    await userEvent.click(nav.getByRole('button', { name: /Why/ }))
    await expect(scroller.scrollTop).toBe(0)
    await expect(canvas.getByRole('heading', { name: /Why/ })).toHaveFocus()
  },
}

/** The Tasks entry of the list brings the user to the fold's button, which takes the focus. */
export const ListScrollsToTheTasks: Story = {
  render: scrolled,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scroller = canvasElement.querySelector<HTMLElement>('[data-scroller]')!
    const toggle = canvas.getByRole('button', { name: /Tasks/, expanded: false })
    await expect(shownIn(toggle, scroller)).toBe(false)
    const nav = within(canvas.getByRole('navigation', { name: 'Spec sections' }))
    await userEvent.click(nav.getByRole('button', { name: /Tasks/ }))
    await expect(shownIn(toggle, scroller)).toBe(true)
    await expect(toggle).toHaveFocus()
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
    await expect(canvas.getByRole('region', { name: 'Decisions' })).toHaveAttribute('data-changed')
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
    requirements: REQUIREMENTS.map((requirement) =>
      Object.assign({}, requirement, { text: `${LONG}${requirement.text}` }),
    ),
    sections: WRITTEN.map((section) =>
      Object.assign({}, section, { body: `${LONG}${section.body}` }),
    ),
  },
  play: async ({ canvasElement }) => {
    const region = within(canvasElement).getByRole('region', { name: 'Requirements' })
    await expect(region.scrollWidth).toBeLessThanOrEqual(region.clientWidth)
  },
}
