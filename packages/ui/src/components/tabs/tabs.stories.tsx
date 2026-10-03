import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { IconFolder, IconGitBranch, IconSettings } from '../../icons.ts'
import { Tabs } from './tabs.tsx'

const PLACES = [
  {
    value: 'repositories',
    label: 'Repositories',
    icon: <IconFolder size="sm" />,
    panel: <p className="text-muted-foreground">api, web and shared.</p>,
  },
  {
    value: 'branches',
    label: 'Branches',
    icon: <IconGitBranch size="sm" />,
    panel: <p className="text-muted-foreground">Every branch of every repository.</p>,
  },
  {
    value: 'settings',
    label: 'Settings',
    icon: <IconSettings size="sm" />,
    panel: <p className="text-muted-foreground">What Acme does on its own.</p>,
  },
]

const meta = {
  tags: ['autodocs'],
  title: 'Components/Tabs',
  component: Tabs,
  parameters: { layout: 'padded' },
  args: { label: 'Places of Acme', items: PLACES, onValueChange: fn() },
  argTypes: {
    label: { control: 'text' },
    iconsOnly: { control: 'boolean' },
    items: { table: { disable: true } },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Tabs<string>>

export default meta
type Story = StoryObj<typeof meta>

/** The colour a theme class resolves to on this page, read off a probe rather than written. */
function colourOf(room: HTMLElement, className: string): string {
  const probe = document.createElement('span')
  probe.className = className
  room.append(probe)
  const colour = getComputedStyle(probe).color
  probe.remove()
  return colour
}

/** The first place chosen: its tab in the foreground, the mark under it, its panel shown. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chosen = canvas.getByRole('tab', { name: /repositories/i })
    expect(chosen).toHaveAttribute('aria-selected', 'true')
    expect(canvas.getByText('api, web and shared.')).toBeInTheDocument()
    expect(getComputedStyle(chosen).color).toBe(colourOf(canvasElement, 'text-foreground'))
  },
}

/** Another place chosen: the mark stands on its tab, and only its panel is shown. */
export const Selected: Story = {
  args: { defaultValue: 'branches' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const chosen = canvas.getByRole('tab', { name: /branches/i })
    expect(chosen).toHaveAttribute('aria-selected', 'true')
    expect(canvas.getByText('Every branch of every repository.')).toBeInTheDocument()
    const mark = canvasElement.querySelector<HTMLElement>('[data-sliding-mark]')!
    // motion writes the mark's box on its own frame, after the list has said which tab it is on.
    await waitFor(() => {
      expect(mark.dataset['slidingMark']).toBe('branches')
      const tab = chosen.getBoundingClientRect()
      const box = mark.getBoundingClientRect()
      expect(box.left).toBeCloseTo(tab.left, 0)
      expect(box.width).toBeCloseTo(tab.width, 0)
    })
  },
}

/** For a box narrower than the words: the icons alone, each tab still named by its label. */
export const IconsOnly: Story = {
  args: { iconsOnly: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const branches = canvas.getByRole('tab', { name: 'Branches' })
    expect(canvas.queryByText('Branches')).toBeNull()
    await userEvent.click(branches)
    await waitFor(() => {
      expect(branches).toHaveAttribute('aria-selected', 'true')
    })
  },
}

/** From the keyboard: the arrows walk the strip and show the panel of the tab they land on. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.tab()
    expect(document.activeElement).toBe(canvas.getByRole('tab', { name: /repositories/i }))
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => {
      expect(canvas.getByRole('tab', { name: /branches/i })).toHaveAttribute(
        'aria-selected',
        'true',
      )
    })
    expect(canvas.getByText('Every branch of every repository.')).toBeInTheDocument()
  },
}
