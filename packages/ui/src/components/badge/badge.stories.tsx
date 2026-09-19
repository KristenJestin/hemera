import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { IconCheck } from '../../icons.ts'
import { Badge } from './badge.tsx'

const TONES = [
  'neutral',
  'primary',
  'success',
  'warning',
  'destructive',
  'info',
  'define',
  'build',
  'free',
] as const

const meta = {
  tags: ['autodocs'],
  title: 'Components/Badge',
  component: Badge,
  args: { children: 'Ready' },
  argTypes: {
    tone: { control: 'inline-radio', options: TONES },
    children: { control: 'text', name: 'label' },
    icon: { table: { disable: true } },
    className: { table: { disable: true } },
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

/** Every tone on a control, with and without its icon. */
export const Playground: Story = {
  args: { tone: 'define' },
}

export const Variants: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      {TONES.map((tone) => (
        <Badge {...args} key={tone} tone={tone}>
          {tone}
        </Badge>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const badges = TONES.map((tone) => within(canvasElement).getByText(tone))
    // Every tone is its own pair of colours, so no two of them read the same.
    const pairs = badges.map((badge) => {
      const style = getComputedStyle(badge)
      return `${style.backgroundColor} on ${style.color}`
    })
    expect(new Set(pairs).size).toBe(TONES.length)
  },
}

export const States: Story = {
  // The controls belong to the playground: this story decides these props itself, and a panel
  // offering to change them would only be offering something that does not happen.
  parameters: { controls: { disable: true } },
  render: (args) => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge {...args} tone="success" icon={<IconCheck size="sm" />}>
        Passed
      </Badge>
      <Badge {...args} tone="neutral">
        Plain
      </Badge>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const withIcon = within(canvasElement).getByText('Passed')
    // The icon is drawn at a step of the icon scale and takes the badge's own colour.
    const icon = withIcon.querySelector('svg')!
    expect(getComputedStyle(icon).width).toBe('16px')
    expect(getComputedStyle(icon).color).toBe(getComputedStyle(withIcon).color)
  },
}
