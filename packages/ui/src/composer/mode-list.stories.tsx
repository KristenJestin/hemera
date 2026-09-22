import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import {
  CLAUDE_MODES,
  MODE_ARG_TYPES,
  OPENCODE_MODES,
  SetMode,
  cutShort,
} from './agent-model-menu-fixtures.tsx'
import { ModeList } from './mode-list.tsx'

/**
 * **What the next turn may do without asking**: one line per mode, under the word that names
 * them, with the mark its own words earned and the one that is on checked.
 *
 * A mode is a sentence and not a step of a scale: "Ask before edits" and "Bypass permissions"
 * are the agent's own words, and five of them read across a panel are five sentences cut short.
 * What the list buys is that every one of them is read whole without anything being opened;
 * what it costs is five lines of the column it stands in, beside the models.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/ModeList',
  component: ModeList,
  render: (args) => <SetMode {...args} render={(props) => <ModeList {...props} />} />,
  parameters: { layout: 'padded' },
  args: {
    modes: CLAUDE_MODES,
    mode: 'plan-only',
    onModeChange: fn(),
  },
  argTypes: MODE_ARG_TYPES,
} satisfies Meta<typeof ModeList>

export default meta
type Story = StoryObj<typeof meta>

/** Every prop as a control, and the answer wired to a page that keeps it. */
export const Playground: Story = {}

/** Nothing set, something set, two modes instead of five, and the list turned off. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-4">
      <ModeList modes={CLAUDE_MODES} mode={null} onModeChange={fn()} />
      <ModeList modes={CLAUDE_MODES} mode="bypass-permissions" onModeChange={fn()} />
      <ModeList modes={OPENCODE_MODES} mode="plan" onModeChange={fn()} />
      <ModeList modes={CLAUDE_MODES} mode="accept-edits" onModeChange={fn()} disabled />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const lists = canvas.getAllByRole('listbox', { name: 'Mode' })
    await expect(lists).toHaveLength(4)

    const none = within(lists[0]!).getAllByRole('option')
    await expect(none.filter((one) => one.getAttribute('aria-selected') === 'true')).toHaveLength(0)
    // Whole, and not an ellipsis: an ellipsis on "Bypass permissions" is the reader guessing at
    // what the next turn is allowed to do.
    await expect(cutShort(lists[1]!)).toEqual([])
    // A row where every entry wore the same icon is a row read on its words alone: five marks,
    // and the check on the one that is set.
    await expect(lists[1]!.querySelectorAll('svg')).toHaveLength(6)
    await expect(within(lists[2]!).getAllByRole('option')).toHaveLength(2)
    const off = within(lists[3]!).getAllByRole('option')
    await expect(off.filter((one) => one.hasAttribute('disabled'))).toHaveLength(off.length)

    // The word over each list is written and never announced a second time: the list is already
    // a listbox called "Mode", and a landmark with the same name is one control said twice.
    await expect(canvas.getAllByText('Mode')).toHaveLength(4)
  },
}

/** Tab walks the list, and a press answers with the id and checks the line. */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const list = canvas.getByRole('listbox', { name: 'Mode' })
    const offered = within(list).getAllByRole('option')

    offered[0]!.focus()
    await expect(offered[0]).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onModeChange).toHaveBeenCalledWith('ask-before-edits')
    await waitFor(() => {
      expect(within(list).getByRole('option', { name: /Ask before edits/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })
  },
}
