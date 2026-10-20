import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { IconGitBranch } from '../../icons.ts'
import { Button, IconButton } from '../button/button.tsx'
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

/**
 * As wide as the row it hangs off, a picker at the end of a list: under its trigger, against the
 * row's start edge, never shifted sideways onto what is beside it. It turns upward only when there
 * is no room below, and keeps the same edge.
 */
export const AsWideAsItsRow: Story = {
  args: {
    title: undefined,
    label: 'Start a service',
    fit: 'row',
    className: 'flex w-full',
    trigger: <Button variant="ghost">Start a service…</Button>,
  },
  decorators: [
    (Story) => (
      <div className="ml-auto w-view-narrow">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Start a service…' })
    await userEvent.click(trigger)
    const panel = await waitFor(() => within(document.body).getByRole('dialog'))
    // SAFETY: the trigger is rendered inside the anchor's wrapper, which is its parent element.
    const row = (trigger.parentElement as HTMLElement).getBoundingClientRect()
    await waitFor(() => {
      const box = panel.getBoundingClientRect()
      expect(Math.abs(box.left - row.left)).toBeLessThan(1)
      expect(Math.abs(box.width - row.width)).toBeLessThan(1)
      expect(box.top).toBeGreaterThan(row.bottom)
    })
  },
}
