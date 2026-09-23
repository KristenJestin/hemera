import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { LiveSpecPanel } from './spec-harness.tsx'
import { MAINTENANCE, MID_PLAN, ONE_QUESTION_LEFT } from './spec-fixtures.ts'

/**
 * The Spec panel alone, as it stands beside the chat: the head and the rail, the outline and the
 * stage, the readiness at the foot. The eight screens of the brief are drawn in their Session,
 * under `Surfaces/Session/Define`; these are the panel's own states and paths.
 */
const meta = {
  title: 'Blocks/Spec/SpecPanel',
  component: LiveSpecPanel,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="h-screen w-full max-w-3xl">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
  args: {
    spec: MID_PLAN,
    defaultItem: 'questions',
    onSaveSection: fn(),
    onApplyMine: fn(),
    onDiscardMine: fn(),
    onSaveStory: fn(),
    onAnswer: fn(),
    onMarkReady: fn(),
    onRework: fn(),
    onPickRevision: fn(),
    onTakeOver: fn(),
  },
  argTypes: {
    spec: { control: 'object', description: 'The Spec as the panel draws it.' },
    reader: { control: 'object', description: 'Present when this Session reads the draft.' },
    defaultItem: { control: 'text', description: 'What the stage shows first.' },
    defaultReworkOpen: { control: 'boolean', description: 'Whether Rework starts open.' },
  },
} satisfies Meta<typeof LiveSpecPanel>

export default meta

type Story = StoryObj<typeof meta>

/** A feature being planned: the question on the stage, three checks of seven. */
export const Feature: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Questions' })).toBeVisible()
    await expect(canvas.getByRole('group', { name: 'Readiness, 3 of 7 checks pass' })).toBeVisible()
  },
}

/** A `maintenance`: its own section is the invariants it keeps. */
export const Maintenance: Story = {
  args: { spec: MAINTENANCE, defaultItem: 'invariants' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: 'Invariants' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Behaviour/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Reproduction/ })).toBeNull()
  },
}

/**
 * Mark ready appearing: the last blocking question answered from the keyboard, the bar fills,
 * the sentence becomes `Ready to freeze` and `Mark ready` is offered — and pressed.
 */
export const LastQuestionAnswered: Story = {
  args: { spec: ONE_QUESTION_LEFT },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
    const answer = canvas.getByRole('button', { name: 'Answer…' })
    answer.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('Negative rows, marked by a type column.')
    await userEvent.tab()
    await expect(args.onAnswer).toHaveBeenCalledWith(
      'q-credit-notes',
      'Negative rows, marked by a type column.',
    )
    await expect(canvas.getByRole('group', { name: 'Readiness, 7 of 7 checks pass' })).toBeVisible()
    await expect(canvas.getByText('Ready to freeze')).toBeVisible()
    const mark = await canvas.findByRole('button', { name: 'Mark ready' })
    mark.focus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onMarkReady).toHaveBeenCalled()
    await expect(canvas.getByRole('button', { name: 'Rework' })).toBeVisible()
  },
}

/** A link of the sentence puts its target on the stage, and the keyboard on its row. */
export const GoToFromTheSentence: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'plan and decompose' }))
    await expect(canvas.getByRole('heading', { name: 'Plan' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Plan,/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  },
}
