import type { Meta, StoryObj } from '@storybook/react-vite'
import { motion } from 'motion/react'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { emulateReducedMotion } from '../.storybook/reduced-motion.ts'
import { Button } from './components/button/button.tsx'
import * as icons from './icons.ts'
import { useTransition } from './motion.ts'

/**
 * What the components are made of, laid out so it can be looked at: the roles of the theme,
 * the type scale, and the one motion preset. This is the page the lot is validated on, beside
 * the nine components themselves.
 */
const meta = {
  title: 'Foundations',
  parameters: { layout: 'padded' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const SURFACES = [
  { name: 'background', className: 'bg-background text-foreground' },
  { name: 'card', className: 'bg-card text-card-foreground' },
  { name: 'muted', className: 'bg-muted text-muted-foreground' },
  { name: 'accent', className: 'bg-accent text-accent-foreground' },
  { name: 'primary', className: 'bg-primary text-primary-foreground' },
  { name: 'destructive', className: 'bg-destructive text-destructive-foreground' },
]

const TONES = [
  { name: 'primary', className: 'bg-primary-muted text-primary-muted-foreground' },
  { name: 'success', className: 'bg-success-muted text-success-muted-foreground' },
  { name: 'warning', className: 'bg-warning-muted text-warning-muted-foreground' },
  { name: 'destructive', className: 'bg-destructive-muted text-destructive-muted-foreground' },
  { name: 'info', className: 'bg-info-muted text-info-muted-foreground' },
  { name: 'define', className: 'bg-mission-define-muted text-mission-define-muted-foreground' },
  { name: 'build', className: 'bg-mission-build-muted text-mission-build-muted-foreground' },
  { name: 'free', className: 'bg-mission-free-muted text-mission-free-muted-foreground' },
]

export const Colours: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {SURFACES.map((role) => (
          <div
            key={role.name}
            className={`flex h-10 items-center rounded-md border border-border px-3 text-sm ${role.className}`}
          >
            {role.name}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {TONES.map((tone) => (
          <div
            key={tone.name}
            className={`flex h-8 items-center rounded-sm px-2 text-xs ${tone.className}`}
          >
            {tone.name}
          </div>
        ))}
      </div>
    </div>
  ),
}

/** Every icon of the catalogue is a component; the sizes are the type's own. */
const CATALOGUE = Object.entries(icons).filter(([name]) => name.startsWith('Icon'))

export const Icons: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['sm', 'md', 'lg'] as const).map((size) => (
        <div key={size} className="flex flex-wrap items-center gap-3 text-muted-foreground">
          {CATALOGUE.map(([name, Icon]) => (
            <Icon key={name} size={size} aria-label={name} />
          ))}
        </div>
      ))}
      <p className="text-primary">
        <icons.IconCheck aria-label="A check in the primary colour" />
      </p>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A size is a step of the icon scale, never a number the caller passed in.
    const drawn = canvas.getAllByLabelText('IconCheck')
    expect(drawn.map((icon) => getComputedStyle(icon).width)).toEqual(['14px', '16px', '20px'])

    // The colour is whatever the text around it is: an icon names no colour of its own.
    const coloured = canvas.getByLabelText('A check in the primary colour')
    expect(getComputedStyle(coloured).color).toBe(getComputedStyle(coloured.parentElement!).color)
    expect(getComputedStyle(coloured).stroke).toBe(getComputedStyle(coloured).color)
  },
}

const SIZES = ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl']

export const Typography: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {SIZES.map((size) => (
        <p key={size} className={size}>
          Hemera keeps the work of an agent where you can see it — {size}
        </p>
      ))}
      <code className="font-mono text-sm">git rebase --onto dev feature/lot-1</code>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const prose = canvas.getByText(/text-base/)
    const code = canvas.getByText(/git rebase/)

    // The families come with the bundle: nothing here was installed on this machine.
    expect(getComputedStyle(prose).fontFamily).toContain('Inter Variable')
    expect(getComputedStyle(code).fontFamily).toContain('Fira Code Variable')
    await waitFor(() => {
      expect(document.fonts.check('1rem "Inter Variable"')).toBe(true)
      expect(document.fonts.check('1rem "Fira Code Variable"')).toBe(true)
    })
  },
}

function Pressable() {
  const transition = useTransition()
  const [moved, setMoved] = useState(false)
  return (
    <div className="flex flex-col items-start gap-4">
      <Button variant="primary" onClick={() => setMoved((was) => !was)}>
        Move the panel
      </Button>
      <motion.div
        data-testid="panel"
        className="h-10 w-24 rounded-md bg-primary-muted"
        initial={false}
        animate={{ opacity: moved ? 1 : 0.4, y: moved ? 0 : 12 }}
        transition={transition}
      />
    </div>
  )
}

export const Motion: Story = {
  render: () => <Pressable />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /move the panel/i }))
    const panel = canvas.getByTestId('panel')
    // It travels: at some point on the way it is neither where it was nor where it is going.
    await waitFor(() => {
      expect(getComputedStyle(panel).transform).not.toBe('none')
    })
    await waitFor(() => {
      expect(getComputedStyle(panel).opacity).toBe('1')
    })
  },
}

/**
 * The same panel under a system that asked for less movement: it is simply where it belongs,
 * with nothing in between. `MotionConfig` is what the catalogue's decorator sets from the
 * story's own parameter, so this can be looked at beside the story that animates.
 */
export const ReducedMotion: Story = {
  render: () => <Pressable />,
  play: async ({ canvasElement }) => {
    const restore = await emulateReducedMotion()
    if (restore === null) return
    try {
      const canvas = within(canvasElement)
      await userEvent.click(canvas.getByRole('button', { name: /move the panel/i }))
      const panel = canvas.getByTestId('panel')
      // No travel to catch: the panel is where it belongs, and the journey took no time.
      await waitFor(() => {
        expect(getComputedStyle(panel).transform).toBe('none')
      })
      await waitFor(() => {
        expect(getComputedStyle(panel).opacity).toBe('1')
      })
    } finally {
      await restore()
    }
  },
}
