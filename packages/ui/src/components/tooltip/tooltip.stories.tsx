import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { IconSettings } from '../../icons.ts'
import { IconButton } from '../button/button.tsx'
import { Tooltip } from './tooltip.tsx'

const meta = {
  tags: ['autodocs'],
  title: 'Components/Tooltip',
  component: Tooltip,
  args: {
    label: 'Settings',
    children: <IconButton variant="ghost" icon={<IconSettings />} aria-label="Settings" />,
  },
  argTypes: {
    label: { control: 'text' },
    keys: { control: 'text' },
    side: { control: 'select', options: ['top', 'right', 'bottom', 'left'] },
    quote: { control: 'boolean' },
    disabled: { control: 'boolean' },
    children: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

/** Under the hand: the name of the control, at once, and gone when the hand leaves. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Settings' })
    await userEvent.hover(trigger)
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Settings')
    })
    await userEvent.unhover(trigger)
    await waitFor(() => {
      expect(within(document.body).queryByRole('tooltip')).toBeNull()
    })
  },
}

/** With the keystroke that does the same thing, drawn as keys beside the name. */
export const WithKeys: Story = {
  args: {
    keys: 'Ctrl+,',
    children: <IconButton variant="ghost" icon={<IconSettings />} aria-label="Open the settings" />,
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Open the settings' })
    await userEvent.hover(trigger)
    const tip = await waitFor(() => within(document.body).getByRole('tooltip'))
    expect(within(tip).getByText('Ctrl')).toBeInTheDocument()
    await userEvent.unhover(trigger)
    await waitFor(() => {
      expect(within(document.body).queryByRole('tooltip')).toBeNull()
    })
  },
}

/** A quote rather than a name: a measure of its own, two lines at most, then an ellipsis. */
export const Quote: Story = {
  args: {
    side: 'right',
    quote: true,
    label:
      'The export should list every invoice of the month with its amounts before and after tax, one line per invoice, so nobody has to type them again by hand.',
    children: <IconButton variant="ghost" icon={<IconSettings />} aria-label="A quoted message" />,
  },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'A quoted message' })
    await userEvent.hover(trigger)
    const tip = await waitFor(() => within(document.body).getByRole('tooltip'))
    const text = tip.firstElementChild!
    const lines =
      text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)
    expect(Math.round(lines)).toBe(2)
    expect(text.scrollHeight).toBeGreaterThan(text.clientHeight)
    expect(tip.getBoundingClientRect().width).toBeLessThanOrEqual(
      parseFloat(getComputedStyle(document.documentElement).fontSize) * 20 + 1,
    )
    await userEvent.unhover(trigger)
    await waitFor(() => {
      expect(within(document.body).queryByRole('tooltip')).toBeNull()
    })
  },
}

/** Reached from the keyboard: the focus opens it as the hand does, and takes it away again. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Settings' })
    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)
    await waitFor(() => {
      expect(within(document.body).getByRole('tooltip')).toHaveTextContent('Settings')
    })
    await userEvent.tab()
    await waitFor(() => {
      expect(within(document.body).queryByRole('tooltip')).toBeNull()
    })
  },
}

/** Off, for a control that already wears its label: the control stays where it is. */
export const Disabled: Story = {
  args: { disabled: true },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('button', { name: 'Settings' }))
    expect(within(document.body).queryByRole('tooltip')).toBeNull()
  },
}
