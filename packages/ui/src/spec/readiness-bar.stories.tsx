import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { ReadinessBar } from './readiness-bar.tsx'
import { BUG, FULL_GATE, MID_PLAN, READER } from './spec-fixtures.ts'

/**
 * How far the Spec is from ready: seven segments, the one sentence with its links, and `Mark
 * ready` once the bar is full — never before, and never drawn disabled.
 */
const meta = {
  title: 'Blocks/Spec/ReadinessBar',
  component: ReadinessBar,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="max-w-xl">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
  args: { readiness: READER.readiness, onGoTo: fn(), onMarkReady: fn() },
  argTypes: {
    readiness: { control: 'object', description: 'The seven checks and what is left.' },
    frozenOn: { control: 'text', description: 'When a `ready` Spec was frozen.' },
    onGoTo: { description: 'Puts the target of an item on the stage.' },
    onMarkReady: { description: 'The human click that freezes the Spec.' },
  },
} satisfies Meta<typeof ReadinessBar>

export default meta

type Story = StoryObj<typeof meta>

/** Four of seven: three things named, each a link to where it is fixed. */
export const Partial: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('group', { name: 'Readiness, 4 of 7 checks pass' })).toBeVisible()
    await expect(canvas.getByText('4/7')).toBeVisible()
    await expect(canvas.getByText(/3 things before ready/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'a task for S2' }))
    await expect(args.onGoTo).toHaveBeenCalledWith('tasks')
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
    // A failing segment names itself under the keyboard as well as under the pointer.
    const failing = canvas.getByRole('button', { name: 'coverage · S2 has no task' })
    failing.focus()
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(
      'coverage · S2 has no task',
    )
  },
}

/** Mid-plan, three of seven: the tasks do not exist before Decompose. */
export const MidPlan: Story = {
  args: { readiness: MID_PLAN.readiness },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('3/7')).toBeVisible()
    await expect(canvas.getByText(/4 things before ready/)).toBeVisible()
    await expect(canvas.getByText(/and 1 more/)).toBeVisible()
  },
}

/** A bug being shaped, two of seven: three items named, and the rest counted. */
export const Many: Story = {
  args: { readiness: BUG.readiness },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/and 2 more/)).toBeVisible()
  },
}

/** Every check passes: `Ready to freeze`, and `Mark ready` appears. */
export const Full: Story = {
  args: { readiness: FULL_GATE },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Ready to freeze')).toBeVisible()
    const mark = canvas.getByRole('button', { name: 'Mark ready' })
    await expect(mark).toBeEnabled()
    await userEvent.click(mark)
    await expect(args.onMarkReady).toHaveBeenCalled()
  },
}

/** Frozen: the bar full, and the sentence says since when. */
export const Frozen: Story = {
  args: { readiness: FULL_GATE, frozenOn: '23 Sep' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Frozen on 23 Sep/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
  },
}
