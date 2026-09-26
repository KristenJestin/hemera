import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import type { SectionView } from './model.ts'
import { BUG, GATE_FULL, MID_PLAN, STALE } from './spec-fixtures.ts'
import { SectionPart } from './section-part.tsx'

/**
 * One section of the Spec document: its name alone as its heading, the facts beside it, and the
 * text read, its Markdown rendered. The agent writes it; nothing of it is edited by hand (issue
 * #135).
 */

/** The marks drawn beside a heading, which a heading no longer wears: empty and dot-sized. */
function dotsBeside(heading: HTMLElement): Element[] {
  return [...(heading.parentElement?.querySelectorAll('span') ?? [])].filter((span) => {
    const box = span.getBoundingClientRect()
    return span.textContent === '' && box.width > 0 && box.width <= 8 && box.height <= 8
  })
}

function sectionOf(sections: SectionView[], name: SectionView['name']): SectionView {
  return sections.find((section) => section.name === name)!
}

const meta = {
  title: 'Blocks/Spec/SectionPart',
  component: SectionPart,
  tags: ['autodocs', 'updated'],
  parameters: { layout: 'padded' },
  args: {
    section: sectionOf(GATE_FULL.sections, 'expected_outcome'),
    editable: true,
  },
  argTypes: {
    section: { control: 'object', description: 'The section: body, author, mark.' },
    editable: { control: 'boolean', description: 'A draft at its current revision.' },
  },
} satisfies Meta<typeof SectionPart>

export default meta

type Story = StoryObj<typeof meta>

/** Written by the agent: nothing among the facts, the text read, and nothing to edit. */
export const ByTheAgent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { name: /^Expected outcome/ })
    await expect(heading).toBeVisible()
    // The heading is the title alone: no state dot in its margin.
    await expect(dotsBeside(heading)).toEqual([])
    await expect(canvas.queryByText('agent')).toBeNull()
    await expect(canvas.queryByText(/^v\d+$/)).toBeNull()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** Its Markdown rendered, always: no eye to toggle and no source to see. */
export const Markdown: Story = {
  args: { section: sectionOf(GATE_FULL.sections, 'behaviour') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Export', { selector: 'strong' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /Preview/ })).toBeNull()
    await expect(canvas.queryByRole('textbox')).toBeNull()
  },
}

/** Written by you, before editing went: `you` among the facts, and the text read like the rest. */
export const ByYou: Story = {
  args: { section: sectionOf(BUG.sections, 'reproduction') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('you')).toBeVisible()
    await expect(dotsBeside(canvas.getByRole('heading', { name: /^Reproduction/ }))).toEqual([])
    await expect(canvas.queryByText('sent to the agent next turn')).toBeNull()
    await expect(canvas.getByText(/Replayed after the build/)).toBeVisible()
  },
}

/** Nothing written yet: a quiet line, and nothing that invites a hand to write it. */
export const NotWritten: Story = {
  args: { section: sectionOf(BUG.sections, 'scope') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('empty')).toBeVisible()
    await expect(canvas.getByText('Nothing written yet.')).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
  },
}

/** Being written by the agent: `writing…` among the facts. */
export const Writing: Story = {
  args: { section: sectionOf(MID_PLAN.sections, 'plan') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('writing…')).toBeVisible()
  },
}

/** Frozen: the text and a lock. */
export const Frozen: Story = {
  args: { editable: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.getByText('frozen')).toBeVisible()
  },
}

/** Copied by a Rework, and to review until the agent goes over its phase again. */
export const Stale: Story = {
  args: { section: sectionOf(STALE.sections, 'plan') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('to review')).toBeVisible()
  },
}
