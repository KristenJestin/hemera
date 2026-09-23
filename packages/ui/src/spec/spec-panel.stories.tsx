import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { LiveSpecPanel } from './spec-harness.tsx'
import { BUG, MAINTENANCE, MID_PLAN } from './spec-fixtures.ts'

/**
 * The Spec panel alone, as it stands beside the chat: a head that stays on top — the key, the
 * sentence, the readiness — and the Spec under it as one document grouped by phase, the part the
 * agent writes highlighted and scrolled to. The screens of the brief are drawn in their Session,
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
    onSaveSection: fn(),
    onApplyMine: fn(),
    onDiscardMine: fn(),
    onSaveStory: fn(),
    onAnswer: fn(),
    onGoToQuestion: fn(),
    onMarkReady: fn(),
    onRework: fn(),
    onPickRevision: fn(),
    onTakeOver: fn(),
  },
  argTypes: {
    spec: { control: 'object', description: 'The Spec as the panel draws it.' },
    reader: { control: 'object', description: 'Present when this Session reads the draft.' },
    defaultReworkOpen: { control: 'boolean', description: 'Whether Rework starts open.' },
  },
} satisfies Meta<typeof LiveSpecPanel>

export default meta

type Story = StoryObj<typeof meta>

/**
 * A feature being planned: three groups, `Plan` open and breathing, the plan being written
 * highlighted as the part the agent is on, and no phase rail and no outline.
 */
export const Feature: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Shape' })).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Plan' })).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Decompose' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: /^Plan ?, open/ })).toBeVisible()
    await expect(canvas.queryByText('Prototype')).toBeNull()
    const plan = canvasElement.querySelector('[data-part="plan"]')!
    await expect(plan).toHaveAttribute('aria-current', 'location')
    await expect(
      canvas.getByRole('group', { name: /^Readiness ?, 3 of 7 checks pass/ }),
    ).toBeVisible()
  },
}

/** A bug: Reproduction in Shape, and Behaviour and Stories never drawn. */
export const Bug: Story = {
  args: { spec: BUG },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Reproduction/ })).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: /^Behaviour/ })).toBeNull()
    await expect(canvas.queryByRole('heading', { name: /^Stories/ })).toBeNull()
  },
}

/** A `maintenance`: its own section is the invariants it keeps. */
export const Maintenance: Story = {
  args: { spec: MAINTENANCE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Invariants/ })).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: /^Behaviour/ })).toBeNull()
  },
}

/** A link of the readiness sentence moves the focus to its target and scrolls to it. */
export const LinkFollowed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'the credit-note question' }))
    const questions = canvasElement.querySelector('[data-part="questions"]')!
    await expect(questions).toHaveAttribute('aria-current', 'location')
    await waitFor(() => expect(questions).toBeVisible())
    await expect(canvasElement.querySelector('[data-part="plan"]')).not.toHaveAttribute(
      'aria-current',
    )
  },
}

/** An open question of the register takes the thread to where it is asked. */
export const QuestionLinked: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Answer in the chat: Credit notes/ }))
    await expect(args.onGoToQuestion).toHaveBeenCalledWith('q-credit-notes')
  },
}
