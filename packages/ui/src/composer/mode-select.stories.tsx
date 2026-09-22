import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import {
  CLAUDE_MODES,
  MODE_ARG_TYPES,
  OPENCODE_MODES,
  SetMode,
} from './agent-model-menu-fixtures.tsx'
import { ModeSelect } from './mode-select.tsx'

/**
 * **Variant 3 of the mode — the dropdown.** The selector the composer used to carry, taking the
 * menu's props instead of its own.
 *
 * One line whatever the agent announced, which is the whole of the case for it: five modes cost
 * the list five lines of a panel that has about twenty, and a panel is not made of spare lines.
 * The case against it is the one the list was written for — the mode that is on is read off a
 * trigger, and what the other four are is behind a second press, inside a panel that was
 * already opened to answer a question.
 *
 * Nothing of the selector is drawn again here. An agent announces `{ id, label }`; the selector
 * has said `{ id, name }` since it was written for the composer, and a mode set in two places
 * has to be the same mode — so this is the translation and not a second control.
 */
const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Composer/Mode/Select',
  component: ModeSelect,
  render: (args) => <SetMode {...args} render={(props) => <ModeSelect {...props} />} />,
  parameters: { layout: 'padded' },
  args: {
    modes: CLAUDE_MODES,
    mode: 'plan-only',
    onModeChange: fn(),
  },
  argTypes: MODE_ARG_TYPES,
} satisfies Meta<typeof ModeSelect>

export default meta
type Story = StoryObj<typeof meta>

/** Every prop as a control, and the answer wired to a page that keeps it. */
export const Playground: Story = {}

/** Nothing set, something set, and two modes instead of five. */
export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex items-start gap-4">
      <ModeSelect modes={CLAUDE_MODES} mode={null} onModeChange={fn()} />
      <ModeSelect modes={CLAUDE_MODES} mode="bypass-permissions" onModeChange={fn()} />
      <ModeSelect modes={OPENCODE_MODES} mode="plan" onModeChange={fn()} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const triggers = canvas.getAllByRole('combobox', { name: 'Mode' })
    await expect(triggers).toHaveLength(3)
    // What is set is what the trigger reads, and the rest is behind a press.
    await expect(triggers[1]).toHaveTextContent('Bypass permissions')
    await expect(triggers[2]).toHaveTextContent('Plan')
  },
}

/** Enter opens the list, the arrows walk it, and Enter takes the one under the keys. */
export const Keyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const trigger = canvas.getByRole('combobox', { name: 'Mode' })

    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const list = await screen.findByRole('listbox')
    await expect(within(list).getAllByRole('option')).toHaveLength(5)

    await userEvent.keyboard('{Home}')
    await userEvent.keyboard('{Enter}')
    await expect(args.onModeChange).toHaveBeenCalledWith('ask-before-edits')
    await waitFor(() => {
      expect(canvas.getByRole('combobox', { name: 'Mode' })).toHaveTextContent('Ask before edits')
    })
  },
}
