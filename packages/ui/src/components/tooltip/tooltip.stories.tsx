import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { IconBell, IconSettings } from '../../icons.ts'
import { IconButton } from '../button/button.tsx'
import { Tooltip, TooltipProvider } from './tooltip.tsx'

function bell() {
  return <IconButton variant="ghost" icon={<IconBell />} aria-label="Notifications" />
}

const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Components/Tooltip',
  component: Tooltip,
  args: { label: 'Notifications', children: bell() },
  argTypes: {
    label: { control: 'text' },
    keys: { control: 'text' },
    side: { control: 'select', options: ['top', 'right', 'bottom', 'left'] },
    quote: {
      control: 'boolean',
      description: 'Whether the label quotes a text: two lines at most.',
    },
    children: { table: { disable: true } },
  },
  // The shared delay is the point of the component, and it comes from a provider: a tooltip
  // rendered outside one keeps Base UI's own per-trigger delay and is not what ships.
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="p-12">
          <Story />
        </div>
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Playground: Story = {}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-center gap-4">
      <Tooltip {...args} label="Above" side="top">
        {bell()}
      </Tooltip>
      <Tooltip {...args} label="Beside" side="right">
        {bell()}
      </Tooltip>
      <Tooltip {...args} label="Below" side="bottom">
        {bell()}
      </Tooltip>
    </div>
  ),
}

/** A sentence quoted by a mark of the thread, much longer than two lines of its measure. */
const QUOTED =
  'Invoices should export with HT and TTC amounts per line. Today the CSV only has totals, and accounting re-keys everything by hand every month, which is where the mistakes come from.'

/**
 * A quote rather than a name (issue #149): what a mark of the thread stands for, in a measure of
 * its own, two lines at most, then an ellipsis — not one line as wide as the page it covers.
 */
export const Quote: Story = {
  parameters: { controls: { disable: true } },
  render: (args) => (
    <Tooltip {...args} label={QUOTED} side="right" quote>
      <IconButton variant="ghost" icon={<IconBell />} aria-label="A message of the thread" />
    </Tooltip>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'A message of the thread' })
    await userEvent.hover(trigger)
    const tip = await waitFor(() => within(document.body).getByRole('tooltip'))
    const text = tip.firstElementChild!
    const lines =
      text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)
    // Two lines, and the rest cut: a quote this long would be four without its clamp.
    expect(Math.round(lines)).toBe(2)
    expect(text.scrollHeight).toBeGreaterThan(text.clientHeight)
    // A measure of its own, far narrower than the page.
    expect(tip.getBoundingClientRect().width).toBeLessThanOrEqual(
      parseFloat(getComputedStyle(document.documentElement).fontSize) * 20 + 1,
    )
    await userEvent.unhover(trigger)
  },
}

export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex items-center gap-4">
      <Tooltip {...args} label="Settings">
        <IconButton variant="ghost" icon={<IconSettings />} aria-label="Settings" />
      </Tooltip>
      <Tooltip {...args} label="Settings" keys="Ctrl+,">
        <IconButton variant="ghost" icon={<IconSettings />} aria-label="Open the settings" />
      </Tooltip>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Open the settings' })
    await userEvent.hover(trigger)
    const tip = await waitFor(() => within(document.body).getByRole('tooltip'))
    // The keystroke is drawn as keys, the way the menus draw theirs.
    expect(within(tip).getByText('Ctrl')).toBeInTheDocument()
    // Gone before the story ends: the accessibility pass judges what is on the page then.
    await userEvent.unhover(trigger)
    await waitFor(() => {
      expect(within(document.body).queryByRole('tooltip')).toBeNull()
    })
  },
}

/** Scenario « Tooltip au clavier » of `specs/window-shell/spec.md`. */
export const Keyboard: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <Tooltip {...args} label="Notifications">
      {bell()}
    </Tooltip>
  ),
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Notifications' })

    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Notifications')
    })

    // And it goes away with the focus, rather than staying behind on a page nobody is on.
    await userEvent.tab()
    await waitFor(() => {
      expect(within(document.body).queryByRole('tooltip')).toBeNull()
    })
  },
}
