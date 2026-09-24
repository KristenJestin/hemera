import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import type { SectionView } from './model.ts'
import { BUG, CONFLICT, GATE_FULL, SCOPE_MINE, STALE } from './spec-fixtures.ts'
import { SectionPart } from './section-part.tsx'

/**
 * One section of the Spec document: its mark, its name, the facts beside it, and the text edited where it is read —
 * saved when the caret leaves, `saved` in the meta line for a second, a preview of the Markdown
 * on the eye. Frozen, it is the text and a lock; in conflict, your text stays in the editor under
 * the banner.
 */

function sectionOf(sections: SectionView[], name: SectionView['name']): SectionView {
  return sections.find((section) => section.name === name)!
}

/**
 * The part with the section held, as the engine would hold it after a save. Given `agentWrites`,
 * the agent writes that text as a new version the moment the caret goes into the section.
 */
function Held({
  section: initial,
  editable,
  agentWrites,
  onSave,
  onApplyMine,
  onDiscardMine,
}: {
  section: SectionView
  editable: boolean
  agentWrites?: string | undefined
  onSave: (body: string, baseVersion: number) => void
  onApplyMine: (body: string) => void
  onDiscardMine: () => void
}): ReactNode {
  const [section, setSection] = useState(initial)
  return (
    <div
      className="max-w-xl"
      onFocusCapture={() => {
        if (agentWrites === undefined || section.body === agentWrites) return
        setSection({ ...section, body: agentWrites, version: section.version + 1 })
      }}
    >
      <SectionPart
        section={section}
        editable={editable}
        onSave={(body, baseVersion) => {
          onSave(body, baseVersion)
          setSection({
            ...section,
            body,
            version: section.version + 1,
            author: 'human',
            mark: 'human',
            pendingForAgent: true,
          })
        }}
        onApplyMine={(body) => {
          onApplyMine(body)
          setSection({
            ...section,
            body,
            version: (section.conflict?.current ?? section.version) + 1,
            author: 'human',
            mark: 'human',
            pendingForAgent: true,
            conflict: undefined,
          })
        }}
        onDiscardMine={() => {
          onDiscardMine()
          setSection({ ...section, mark: 'agent', conflict: undefined })
        }}
      />
    </div>
  )
}

const meta = {
  title: 'Blocks/Spec/SectionPart',
  component: Held,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  args: {
    section: sectionOf(GATE_FULL.sections, 'expected_outcome'),
    editable: true,
    onSave: fn(),
    onApplyMine: fn(),
    onDiscardMine: fn(),
  },
  argTypes: {
    section: { control: 'object', description: 'The section: body, version, author, mark.' },
    editable: { control: 'boolean', description: 'A draft at its current revision.' },
    agentWrites: { control: 'text', description: 'What the agent writes as the caret goes in.' },
    onSave: {
      description:
        'Your text, once, when the caret leaves it changed, and the version it opened on.',
    },
    onApplyMine: { description: 'Writes your text of a conflict on the current version.' },
    onDiscardMine: { description: 'Lets your text of a conflict go.' },
  },
} satisfies Meta<typeof Held>

export default meta

type Story = StoryObj<typeof meta>

/** Written by the agent: nothing among the facts, and the text reads as text. */
export const ByTheAgent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Expected outcome/ })).toBeVisible()
    await expect(canvas.queryByText('agent')).toBeNull()
    await expect(canvas.queryByText(/^v\d+$/)).toBeNull()
    await expect(canvas.getByRole('textbox', { name: 'Expected outcome' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /Save|Edit/ })).toBeNull()
  },
}

/** Edited by you and not yet read by the agent: `you · sent to the agent next turn`. */
export const ByYou: Story = {
  args: { section: sectionOf(BUG.sections, 'reproduction') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('you')).toBeVisible()
    await expect(canvas.getByText('sent to the agent next turn')).toBeVisible()
    await expect(canvas.getByText(/Replayed after the build/)).toBeVisible()
  },
}

/**
 * In-place edit and blur-save: the caret in the text, a sentence typed, the caret leaves — the
 * text is handed over once, the meta line says `you` and `saved` flashes in it.
 */
export const EditInPlace: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const text = canvas.getByRole('textbox', { name: 'Expected outcome' })
    await userEvent.click(text)
    await userEvent.keyboard('{Control>}{End}{/Control} Credit notes included.')
    await expect(args.onSave).not.toHaveBeenCalled()
    await userEvent.tab()
    await expect(args.onSave).toHaveBeenCalledTimes(1)
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.stringContaining('Credit notes included.'),
      2,
    )
    await expect(canvas.getByRole('status')).toHaveTextContent('saved')
    await expect(canvas.getByText('sent to the agent next turn')).toBeVisible()
    await expect(canvas.getByText('you')).toBeVisible()
    // And it goes: `saved` is a flash, not a state.
    await waitFor(() => expect(canvas.queryByRole('status')).toBeNull(), { timeout: 3000 })
  },
}

/**
 * Written under you: the agent writes the section while the caret is in it. Your text is handed
 * over with the version the edit was opened on, not the one the agent left — which is what lets
 * the engine refuse it as a conflict instead of writing over the agent (D7-12).
 */
export const WrittenUnderYou: Story = {
  args: { agentWrites: 'Every invoice of the month, in one file the accountant opens as is.' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const text = canvas.getByRole('textbox', { name: 'Expected outcome' })
    await userEvent.click(text)
    await userEvent.keyboard('{Control>}{End}{/Control} Credit notes included.')
    await userEvent.tab()
    await expect(args.onSave).toHaveBeenCalledTimes(1)
    await expect(args.onSave).toHaveBeenCalledWith(
      expect.stringContaining('Credit notes included.'),
      2,
    )
  },
}

/**
 * Left untouched while rewritten: the agent writes the section while the caret sits in it, and
 * the caret leaves without a key typed. Nothing is handed over — no save, so no conflict — and
 * the text shown is the agent's.
 */
export const LeftUntouchedWhileRewritten: Story = {
  args: { agentWrites: 'Every invoice of the month, in one file the accountant opens as is.' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const text = canvas.getByRole('textbox', { name: 'Expected outcome' })
    await userEvent.click(text)
    await userEvent.tab()
    await expect(args.onSave).not.toHaveBeenCalled()
    await expect(canvas.queryByRole('group', { name: 'Conflict' })).toBeNull()
    await expect(text).toHaveValue(
      'Every invoice of the month, in one file the accountant opens as is.',
    )
  },
}

/** Escape leaves the text as it was, and nothing is handed over. */
export const EscapeKeepsTheText: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const text = canvas.getByRole('textbox', { name: 'Expected outcome' })
    const before = sectionOf(GATE_FULL.sections, 'expected_outcome').body
    await userEvent.click(text)
    await userEvent.keyboard(' something I did not mean{Escape}')
    await expect(args.onSave).not.toHaveBeenCalled()
    await expect(text).toHaveValue(before)
  },
}

/** The eye shows the Markdown rendered, and gives the text back. */
export const Preview: Story = {
  args: { section: sectionOf(GATE_FULL.sections, 'behaviour') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const eye = canvas.getByRole('button', { name: /^Preview .* as Markdown$/ })
    await userEvent.click(eye)
    await expect(eye).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.getByText('Export', { selector: 'strong' })).toBeVisible()
    await userEvent.click(eye)
    await expect(canvas.getByRole('textbox', { name: 'Behaviour' })).toBeVisible()
  },
}

/** Nothing written yet: the area waits with a line saying who may write it. */
export const NotWritten: Story = {
  args: { section: sectionOf(BUG.sections, 'scope') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('empty')).toBeVisible()
    await expect(canvas.getByPlaceholderText(/Write it here, or let the agent/)).toBeVisible()
  },
}

/** Frozen: the text and a lock, no editing look at all. */
export const Frozen: Story = {
  args: { editable: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.getByText('frozen')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Preview .* as Markdown$/ })).toBeNull()
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

/** A conflict keeps the human's text: the banner inside the section, your text in the editor. */
export const Conflict: Story = {
  args: { section: sectionOf(CONFLICT.sections, 'scope') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('not saved')).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Scope, your text' })).toHaveValue(SCOPE_MINE)
  },
}

/** Compare shows the agent's text, and `Keep mine` writes yours on top of it. */
export const ConflictApplied: Story = {
  args: { section: sectionOf(CONFLICT.sections, 'scope') },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('The agent changed this part while you were writing yours.'),
    ).toBeVisible()
    const mine = canvas.getByRole('textbox', { name: 'Scope, your text' })
    await expect(mine).toHaveValue(SCOPE_MINE)
    await userEvent.click(canvas.getByRole('button', { name: 'Compare' }))
    await expect(canvas.getByText("The agent's text")).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Keep mine' }))
    await expect(args.onApplyMine).toHaveBeenCalledWith(SCOPE_MINE)
    await expect(canvas.queryByRole('group', { name: 'Conflict' })).toBeNull()
    await expect(canvas.getByText('you')).toBeVisible()
  },
}

/** Letting your text go keeps the current version, and the banner with it goes. */
export const ConflictDiscarded: Story = {
  args: { section: sectionOf(CONFLICT.sections, 'scope') },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Discard mine' }))
    await expect(args.onDiscardMine).toHaveBeenCalled()
    await expect(canvas.queryByRole('group', { name: 'Conflict' })).toBeNull()
    await expect(canvas.getByRole('textbox', { name: 'Scope' })).toHaveDisplayValue(
      /The currency is a column of the file/,
    )
  },
}
