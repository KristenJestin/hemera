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
  tags: ['updated'],
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
      <p className="flex items-center gap-3 text-primary">
        <icons.IconCheck aria-label="A check in the primary colour" />
        <icons.IconAlertTriangle weight="filled" aria-label="A filled warning" />
      </p>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // A size is a step of the icon scale, never a number the caller passed in.
    const drawn = canvas.getAllByLabelText('IconCheck')
    expect(drawn.map((icon) => getComputedStyle(icon).width)).toEqual(['16px', '18px', '22px'])

    // The colour is whatever the text around it is: an icon names no colour of its own. A
    // filled one says so by its fill and an outlined one by its stroke, which is the whole
    // difference between the two weights.
    const outlined = canvas.getByLabelText('A check in the primary colour')
    const filled = canvas.getByLabelText('A filled warning')
    const inherited = getComputedStyle(outlined.parentElement!).color
    expect(getComputedStyle(outlined).stroke).toBe(inherited)
    expect(getComputedStyle(outlined).fill).toBe('none')
    expect(getComputedStyle(filled).fill).toBe(inherited)
    expect(canvas.getAllByLabelText('IconBrandHemeraAuto')).toHaveLength(3)
    expect(canvas.getAllByLabelText('IconBrandTypeSafe')).toHaveLength(3)
    expect(
      canvas.getAllByLabelText('IconBrandHemeraAuto')[0]?.querySelectorAll('path'),
    ).toHaveLength(4)
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

    // The families come with the bundle: nothing here was installed on this machine. The wait
    // is for the bundle's own files to arrive, which on a cold browser is not instant.
    expect(getComputedStyle(prose).fontFamily).toContain('Inter Variable')
    expect(getComputedStyle(code).fontFamily).toContain('Fira Code Variable')
    await document.fonts.ready
    expect(document.fonts.check('1rem "Inter Variable"')).toBe(true)
    expect(document.fonts.check('1rem "Fira Code Variable"')).toBe(true)
  },
}

/** What WCAG calls the relative luminance of a colour, which is what a ratio is made of. */
function luminanceOf(colour: string): number {
  const hex = colour.trim().replace('#', '')
  const channel = (at: number): number => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

/** The contrast of two colours, the way the checker of the catalogue counts it. */
function contrastOf(one: string, other: string): number {
  const first = luminanceOf(one)
  const second = luminanceOf(other)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

/** A role of the theme, read off the document the way every component reads it. */
function roleOf(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name)
}

/**
 * What dragging across a text leaves behind (trial of 22 September 2026).
 *
 * The selection is made here rather than drawn as a coloured box, because `::selection` is the
 * one surface of the theme no markup can stand in for: a browser paints it and nothing else
 * can. The story selects its own paragraph so the reader sees the real thing in whichever
 * theme the toolbar is on, and the run — which plays the whole catalogue once per theme —
 * measures the two roles against each other on both.
 *
 * It was `--primary-muted` over whatever was underneath, which in the dark theme is a tenth of
 * a magenta over black and reads as nothing. A selection carries its own two colours now, and
 * is the one thing in the theme that has to: the text it covers can be any colour the page had.
 */
export const Selection: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <p data-testid="selected" className="max-w-prose text-base">
        Drag across this line: selected text keeps its own two colours, so a comment, a command and
        a line of a diff are all read the same way once they are under the hand.
      </p>
      <p className="max-w-prose font-mono text-sm text-muted-foreground">
        git rebase --onto dev feature/lot-1
      </p>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const paragraph = within(canvasElement).getByTestId('selected')
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    await expect(selection?.toString()).toContain('selected text keeps its own two colours')

    // The two roles are declared, and they answer for themselves: a selection is the one fill of
    // the theme that cannot know what it is drawn over, so it carries the foreground with it.
    const background = roleOf('--selection')
    const foreground = roleOf('--selection-foreground')
    await expect(background, 'the theme declares no selection fill').not.toBe('')
    await expect(contrastOf(background, foreground)).toBeGreaterThanOrEqual(4.5)
    // And it is a colour rather than a wash: a fill the page shows through has no contrast of
    // its own, which is exactly what the dark theme was left with.
    await expect(background).toMatch(/^#[0-9a-f]{6}$/i)
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
    // And it settles, wherever the click sent it. Which of the two ends it lands on is not
    // the point and is not always the same: the story is re-run in place as it is edited.
    await waitFor(() => {
      expect(getComputedStyle(panel).transform).toBe('none')
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
    } finally {
      await restore()
    }
  },
}
