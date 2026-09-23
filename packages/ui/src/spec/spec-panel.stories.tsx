import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { LiveSpecPanel } from './spec-harness.tsx'
import { BUG, MAINTENANCE, MID_PLAN, OLDER_REVISION } from './spec-fixtures.ts'

/**
 * The Spec panel alone, as it stands beside the chat: a head that stays on top — the key, the
 * sentence, the readiness — and under it the rail beside a stage that shows one part at a time,
 * following the agent until a row is chosen; `Show all` puts the whole document back. The screens of the brief are drawn in their Session,
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
    defaultShowAll: {
      control: 'boolean',
      description: 'Whether the stage starts on the whole document.',
    },
  },
} satisfies Meta<typeof LiveSpecPanel>

export default meta

type Story = StoryObj<typeof meta>

/**
 * A feature being planned: the rail beside one part, the stage following the agent onto the plan
 * it writes, and no phase rail and no long document.
 */
export const Feature: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const rail = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(within(rail).getByRole('group', { name: 'Plan' })).toHaveTextContent('open')
    await expect(canvas.getByRole('button', { name: 'Plan, being written' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    const stage = canvas.getByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Plan/ })).toBeVisible()
    // One part at a time: nothing of the other parts is on the stage.
    await expect(within(stage).queryByRole('heading', { name: /^Problem/ })).toBeNull()
    await expect(canvas.queryByText('Prototype')).toBeNull()
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
    await expect(canvas.queryByRole('button', { name: /^Behaviour/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Stories/ })).toBeNull()
  },
}

/** A `maintenance`: its own section is the invariants it keeps. */
export const Maintenance: Story = {
  args: { spec: MAINTENANCE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Invariants/ })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Behaviour/ })).toBeNull()
  },
}

/**
 * A row of the rail pins the stage: the chosen part stays on it, and the plan the agent writes
 * keeps breathing in the rail.
 */
export const RowChosen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Scope/ }))
    const stage = canvas.getByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Scope/ })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Scope/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(canvas.getByRole('button', { name: 'Plan, being written' })).not.toHaveAttribute(
      'aria-current',
    )
  },
}

/** A link of the readiness sentence puts its target on the stage. */
export const LinkFollowed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'the credit-note question' }))
    const stage = canvas.getByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Questions/ })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /^Questions/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  },
}

/** An open question of the register takes the thread to where it is asked. */
export const QuestionLinked: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Questions/ }))
    await userEvent.click(canvas.getByRole('button', { name: /^Answer in the chat: Credit notes/ }))
    await expect(args.onGoToQuestion).toHaveBeenCalledWith('q-credit-notes')
  },
}

/**
 * `Show all`: the whole document on the stage, grouped by phase, the part on the stage
 * highlighted; a row of the rail then only scrolls to its part.
 */
export const ShowAll: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Show all' }))
    const document = await canvas.findByRole('region', { name: 'Document of ATL-7' })
    await expect(within(document).getByRole('region', { name: 'Shape' })).toBeVisible()
    await expect(within(document).getByRole('heading', { name: /^Problem/ })).toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: /^Tasks/ }))
    const tasks = canvasElement.querySelector('[data-part="tasks"]')!
    await expect(tasks).toHaveAttribute('aria-current', 'location')
    await waitFor(() => expect(tasks).toBeVisible())
    await userEvent.click(canvas.getByRole('button', { name: 'Show all' }))
    await expect(canvas.getByRole('region', { name: 'Stage of ATL-7' })).toBeVisible()
  },
}

/**
 * An older revision picked: shown as it was frozen, with no editor, no `Rework` and no
 * `Mark ready`, and the sentence says which revision replaced it.
 */
export const OlderRevision: Story = {
  args: { spec: OLDER_REVISION },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Revision 1 · read only, as it was frozen')).toBeVisible()
    await expect(canvas.getByText(/revision 2 replaced it/)).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
  },
}
