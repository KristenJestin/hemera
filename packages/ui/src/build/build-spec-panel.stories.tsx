import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { READY } from '../spec/spec-fixtures.ts'
import { BuildSpecPanel } from './build-spec-panel.tsx'

/**
 * The frozen Spec opened from a build (D10-12; scenario "The Spec is read only in a build"): the
 * Spec panel's rail and stage on the revision the build works from, and no edit control at all —
 * no editor, no Rework, no Mark ready. It is closed rather than folded. Beside a stand-in for the
 * build view it pushes.
 */
const meta = {
  title: 'Blocks/Build/BuildSpecPanel',
  component: BuildSpecPanel,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="@container flex h-screen min-h-0 bg-background text-foreground">
          <div className="flex-1 p-6 text-sm text-muted-foreground">
            The build view stands here.
          </div>
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
  args: { spec: READY, onClose: fn() },
  argTypes: {
    spec: { control: 'object', description: 'The frozen revision the build works from.' },
    onClose: { action: 'closed' },
  },
} satisfies Meta<typeof BuildSpecPanel>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Read only: the problem on the stage with no editor, the rail's foot saying the build works from
 * it, and nothing that would change it.
 */
export const ReadOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Spec ATL-7' })).toBeVisible()
    await expect(canvas.getByText('read only')).toBeVisible()
    await expect(canvas.getByText('Frozen on 23 Sep · the build works from it')).toBeVisible()
    await expect(canvas.queryByRole('textbox')).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Rework' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Fold/ })).toBeNull()
  },
}

/** The tasks of the contract on the stage, as the build was handed them. */
export const Tasks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Tasks, 4' }))
    const stage = within(canvas.getByRole('region', { name: 'Stage of ATL-7' }))
    await expect(stage.getByRole('heading', { name: /^Tasks · 4/ })).toBeVisible()
    await expect(stage.getByText('The file imports into the ledger')).toBeVisible()
  },
}

/** The keyboard: the rail walked with the arrows, and Close, which the page answers. */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const close = canvas.getByRole('button', { name: 'Close the Spec' })
    close.focus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Problem' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect(canvas.getByRole('button', { name: 'Expected outcome' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    close.focus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onClose).toHaveBeenCalled()
  },
}
