import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { IconGitBranch } from '../../icons.ts'
import { IconButton } from '../button/button.tsx'
import { Popover } from './popover.tsx'

const meta = {
  tags: ['autodocs'],
  title: 'Components/Popover',
  component: Popover,
  args: {
    title: 'Branches',
    trigger: <IconButton variant="ghost" icon={<IconGitBranch />} aria-label="Branches" />,
    children: <p className="text-muted-foreground">api is on main, up to date.</p>,
  },
  argTypes: {
    title: { control: 'text' },
    side: { control: 'select', options: ['top', 'right', 'bottom', 'left'] },
    align: { control: 'select', options: ['start', 'center', 'end'] },
    trigger: { table: { disable: true } },
    children: { table: { disable: true } },
  },
  decorators: [
    (Story) => (
      <div className="p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

/** Closed: the trigger, and nothing else on the page. */
export const Closed: Story = {
  play: async () => {
    expect(within(document.body).queryByRole('dialog')).toBeNull()
  },
}

/** Open, named by its title; a click outside closes it, because one way out is a trap. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Branches' }))
    const panel = await waitFor(() => within(document.body).getByRole('dialog'))
    expect(panel).toHaveAccessibleName('Branches')
    expect(within(panel).getByText('api is on main, up to date.')).toBeInTheDocument()
    await userEvent.click(document.body)
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/** From the keyboard: Enter opens it, Escape closes it, and the focus comes back to the trigger. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Branches' })
    await userEvent.tab()
    expect(document.activeElement).toBe(trigger)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(within(document.body).getByRole('dialog')).toBeInTheDocument()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
    expect(document.activeElement).toBe(trigger)
  },
}
