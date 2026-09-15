import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { IconPlus, IconSettings, IconTrash } from '../../icons.ts'
import { Button, IconButton } from './button.tsx'

const meta = {
  title: 'Components/Button',
  component: Button,
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

const VARIANTS = ['primary', 'secondary', 'ghost', 'destructive'] as const
const SIZES = ['sm', 'md', 'lg'] as const

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {SIZES.map((size) => (
        <div key={size} className="flex items-center gap-2">
          {VARIANTS.map((variant) => (
            <Button key={variant} variant={variant} size={size}>
              {variant}
            </Button>
          ))}
          <IconButton variant="secondary" size={size} icon={<IconPlus />} aria-label="Add" />
          <IconButton variant="ghost" size={size} icon={<IconSettings />} aria-label="Settings" />
        </div>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getAllByRole('button')).toHaveLength(SIZES.length * (VARIANTS.length + 2))
    // A size is a step of the scale and not a number a caller passed in: one row per size,
    // and the first button of each row says how tall that step is.
    const rows = SIZES.map(
      (_size, row) => canvas.getAllByRole('button')[row * (VARIANTS.length + 2)]!,
    )
    expect(rows.map((button) => getComputedStyle(button).height)).toEqual(['24px', '32px', '40px'])
  },
}

export const States: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button variant="primary">Idle</Button>
      <Button variant="primary" state="loading">
        Working
      </Button>
      <Button variant="primary" state="success">
        Saved
      </Button>
      <Button variant="primary" state="error">
        Failed
      </Button>
      <Button variant="primary" disabled>
        Disabled
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Working and disabled are not the same thing: one keeps its focus, the other gives it up.
    // Base UI says so with `aria-disabled` rather than the attribute, which is what lets the
    // button stay in the tab order while it refuses to be pressed.
    const working = canvas.getByRole('button', { name: /working/i })
    expect(working).toHaveAttribute('aria-disabled', 'true')
    working.focus()
    expect(document.activeElement).toBe(working)
    expect(canvas.getByRole('status')).toBeInTheDocument()

    const disabled = canvas.getByRole('button', { name: /disabled/i })
    expect(disabled).toBeDisabled()
    disabled.focus()
    expect(document.activeElement).not.toBe(disabled)
  },
}

export const Keyboard: Story = {
  render: () => {
    const said: string[] = []
    return (
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => said.push('first')}>
          First
        </Button>
        <Button variant="secondary" disabled>
          Skipped
        </Button>
        <IconButton variant="secondary" icon={<IconTrash />} aria-label="Delete" />
        <output data-testid="said">{said.join(' ')}</output>
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const first = canvas.getByRole('button', { name: 'First' })
    const remove = canvas.getByRole('button', { name: 'Delete' })

    await userEvent.tab()
    expect(document.activeElement).toBe(first)
    // A visible focus ring, which is a real outline and not a colour nobody can see.
    await waitFor(() => {
      expect(getComputedStyle(first).boxShadow).not.toBe('none')
    })

    // The disabled one is stepped over; the next tab lands on the icon button.
    await userEvent.tab()
    expect(document.activeElement).toBe(remove)
  },
}

export const Light: Story = {
  args: { variant: 'primary', children: 'Play' },
  globals: { theme: 'light' },
}

export const Dark: Story = {
  args: { variant: 'primary', children: 'Play' },
  globals: { theme: 'dark' },
}
