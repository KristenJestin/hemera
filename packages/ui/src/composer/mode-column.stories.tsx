import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  CLAUDE_MODES,
  MODE_ARG_TYPES,
  OPENCODE_MODES,
  SetMode,
} from './agent-model-menu-fixtures.tsx'
import { ModeColumn } from './mode-column.tsx'

/**
 * **Variant 2 of the mode — the titled column.** The same list, with a quiet word over it and a
 * column of the panel to stand in.
 *
 * It is the variant that changes the panel rather than the control: asked for, the model stage
 * becomes two columns — the models on the left where the scrolling is, the effort and the mode
 * on the right where nothing scrolls. What it buys is the height a list of five modes takes off
 * the models when it stands under them; what it costs is the width those models had.
 *
 * The header is what makes it a section rather than a second list of models beside the first: a
 * column of rows with no word over it is a column nobody can tell the purpose of. It is quiet
 * on purpose — small, spaced, in the muted foreground — because it names the control and is
 * never one of its rows.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/Mode/Column',
  component: ModeColumn,
  render: (args) => (
    <div className="w-menu-agents">
      <SetMode {...args} render={(props) => <ModeColumn {...props} />} />
    </div>
  ),
  parameters: { layout: 'padded' },
  args: {
    modes: CLAUDE_MODES,
    mode: 'plan-only',
    onModeChange: fn(),
  },
  argTypes: MODE_ARG_TYPES,
} satisfies Meta<typeof ModeColumn>

export default meta
type Story = StoryObj<typeof meta>

/** Every prop as a control, and the answer wired to a page that keeps it. */
export const Playground: Story = {}

/** Nothing set, something set, two modes instead of five, and the column turned off. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-start gap-4">
      <ModeColumn modes={CLAUDE_MODES} mode={null} onModeChange={fn()} />
      <ModeColumn modes={CLAUDE_MODES} mode="bypass-permissions" onModeChange={fn()} />
      <ModeColumn modes={OPENCODE_MODES} mode="plan" onModeChange={fn()} />
      <ModeColumn modes={CLAUDE_MODES} mode="auto" onModeChange={fn()} disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A word over every one of them, which is what makes each a section and not a stray list.
    const sections = canvas.getAllByRole('listbox', { name: 'Mode' })
    await expect(sections).toHaveLength(4)
    // The word stands over the rows and is never read as one of them.
    const head = canvas.getAllByText('Mode')[0]!
    const first = within(sections[0]!).getAllByRole('option')[0]!
    await expect(head.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      first.getBoundingClientRect().top + 1,
    )
    await expect(getComputedStyle(head).textTransform).toBe('uppercase')
    await expect(
      within(sections[1]!).getByRole('option', { name: /Bypass permissions/ }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(within(sections[2]!).getAllByRole('option')).toHaveLength(2)
  },
}

/** Tab walks the rows of the column exactly as it walks the list; the header is not one. */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const section = canvas.getByRole('listbox', { name: 'Mode' })
    const offered = within(section).getAllByRole('option')

    offered[0]!.focus()
    await expect(offered[0]).toHaveFocus()
    await userEvent.tab()
    await expect(offered[1]).toHaveFocus()

    await userEvent.keyboard('{Enter}')
    await expect(args.onModeChange).toHaveBeenCalledWith('accept-edits')
    await waitFor(() => {
      expect(within(section).getByRole('option', { name: /Accept edits/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })
  },
}
