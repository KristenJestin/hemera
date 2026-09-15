import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { IconCheck } from '../../icons.ts'
import { Badge } from './badge.tsx'

const meta = {
  title: 'Components/Badge',
  component: Badge,
  // A badge with nothing in it is not a badge; the stories that render their own tree
  // replace this, and the ones that do not have something to say.
  args: { children: 'Badge' },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

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

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {TONES.map((tone) => (
        <Badge key={tone} tone={tone}>
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
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="success" icon={<IconCheck size="sm" />}>
        Passed
      </Badge>
      <Badge tone="neutral">Plain</Badge>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const withIcon = within(canvasElement).getByText('Passed')
    // The icon is drawn at a step of the icon scale and takes the badge's own colour.
    const icon = withIcon.querySelector('svg')!
    expect(getComputedStyle(icon).width).toBe('14px')
    expect(getComputedStyle(icon).color).toBe(getComputedStyle(withIcon).color)
  },
}

export const Light: Story = {
  args: { tone: 'define', children: 'Define' },
  globals: { theme: 'light' },
}

export const Dark: Story = {
  args: { tone: 'define', children: 'Define' },
  globals: { theme: 'dark' },
}
