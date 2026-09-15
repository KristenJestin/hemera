import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconMessages, IconSettings, IconTimelineEvent } from '../../icons.ts'
import { Tabs } from './tabs.tsx'

const PLACES = [
  {
    value: 'sessions',
    label: 'Sessions',
    icon: <IconMessages size="sm" />,
    panel: <p className="text-muted-foreground">The Sessions of the Project.</p>,
  },
  {
    value: 'journal',
    label: 'Journal',
    icon: <IconTimelineEvent size="sm" />,
    panel: <p className="text-muted-foreground">What happened, in order.</p>,
  },
  {
    value: 'settings',
    label: 'Settings',
    icon: <IconSettings size="sm" />,
    panel: <p className="text-muted-foreground">The Project's own settings.</p>,
  },
]

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  args: { label: 'Places of the Project', items: PLACES, onValueChange: fn() },
  argTypes: {
    label: { control: 'text' },
    items: { table: { disable: true } },
    className: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="w-full p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tabs<string>>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex flex-col gap-6">
      <Tabs {...args} items={PLACES.map(({ icon: _icon, ...rest }) => rest)} />
      <Tabs {...args} />
    </div>
  ),
}

export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  args: { defaultValue: 'journal' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('tab', { name: /journal/i })).toHaveAttribute('aria-selected', 'true')
    expect(canvas.getByText('What happened, in order.')).toBeInTheDocument()
  },
}

/** Scenario « Tabs aux flèches » of `specs/window-shell/spec.md`. */
export const Keyboard: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const first = canvas.getByRole('tab', { name: /sessions/i })

    await userEvent.tab()
    expect(document.activeElement).toBe(first)

    // An arrow activates the neighbour and shows its panel; the mark goes with it.
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(canvas.getByRole('tab', { name: /journal/i })).toHaveAttribute('aria-selected', 'true')
    })
    expect(canvas.getByText('What happened, in order.')).toBeInTheDocument()
    expect(canvas.queryByText('The Sessions of the Project.')).toBeNull()
  },
}
