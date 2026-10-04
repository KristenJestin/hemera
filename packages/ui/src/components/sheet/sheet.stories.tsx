import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { IconFileText, IconListCheck } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { type SheetView, SheetStack } from './sheet.tsx'

/**
 * The sheets every view of the window opens in: slid in from the right over a scrim, a stack of
 * them, each with its head — icon, title, actions, expand and × — its body, and a foot when it holds
 * a form. Escape and × close the one on top, the scrim leaves them all, and the focus goes back to
 * what opened the first.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Components/Sheet',
  component: StackFixture,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof StackFixture>

export default meta
type Story = StoryObj<typeof meta>

interface StackFixtureProps {
  /** The sheets open as the story starts, oldest first. */
  initial?: readonly string[] | undefined
}

/** A page with the button that opens a sheet, and the stack over it, as a renderer holds it. */
function StackFixture({ initial = [] }: StackFixtureProps) {
  const [open, setOpen] = useState<readonly string[]>(initial)
  const shown = open.at(-1) ?? null
  const push = (id: string): void =>
    setOpen((before) => [...before.filter((one) => one !== id), id])
  const views: SheetView[] = [
    {
      id: 'task',
      title: 'T2 · Stream the rows',
      icon: <IconListCheck size="sm" />,
      width: 'narrow',
      actions: (
        <Button variant="secondary" size="sm" onClick={() => push('spec')}>
          Open the Spec
        </Button>
      ),
      body: (
        <p className="px-6 py-5 text-base">
          The rows are written as they are read, so a long export never holds them all at once.
        </p>
      ),
    },
    {
      id: 'spec',
      title: 'Spec',
      icon: <IconFileText size="sm" />,
      width: 'wide',
      body: (
        <div className="flex max-w-measure flex-col gap-3 px-6 py-5">
          {Array.from({ length: 30 }, (_, index) => (
            <p key={index} className="text-base">
              Line {index + 1} of the Spec, frozen yesterday at 17:02.
            </p>
          ))}
        </div>
      ),
    },
  ]
  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-surface-content">
      <div
        className="flex flex-1 items-start p-8"
        data-base=""
        inert={shown !== null ? true : undefined}
        aria-hidden={shown !== null ? true : undefined}
      >
        <Button onClick={() => push('task')}>Open T2</Button>
      </div>
      <SheetStack
        views={views}
        open={open}
        shown={shown}
        onShow={(id) =>
          setOpen((before) => (id === null ? [] : before.slice(0, before.indexOf(id) + 1)))
        }
        onClose={(id) => setOpen((before) => before.slice(0, before.indexOf(id)))}
        scrimLabel="Back to the page"
      />
    </div>
  )
}

/** A sheet opened from the page: narrow, solid, over the scrim, its title taking the focus. */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open T2' }))
    const sheet = await canvas.findByRole('region', { name: 'T2 · Stream the rows' })
    expect(sheet).toHaveAttribute('data-grown', 'false')
    expect(canvasElement.querySelector('[data-base]')).toHaveAttribute('inert')
    await waitFor(() => {
      expect(within(sheet).getByRole('heading', { name: 'T2 · Stream the rows' })).toHaveFocus()
    })
  },
}

/** Expanded: the sheet grows to the whole width on its expand, and back. */
export const Expanded: Story = {
  args: { initial: ['task'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const sheet = canvas.getByRole('region', { name: 'T2 · Stream the rows' })
    await userEvent.click(canvas.getByRole('button', { name: 'Expand T2 · Stream the rows' }))
    expect(sheet).toHaveAttribute('data-grown', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse T2 · Stream the rows' }))
    expect(sheet).toHaveAttribute('data-grown', 'false')
  },
}

/** A sheet opened from a sheet comes on top; × shows the one under it. */
export const Stacked: Story = {
  args: { initial: ['task'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open the Spec' }))
    expect(await canvas.findByRole('region', { name: 'Spec' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Close Spec' }))
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-view="spec"]')).toBeNull()
    })
    expect(canvas.getByRole('region', { name: 'T2 · Stream the rows' })).toBeVisible()
  },
}

/** The focus goes back to what opened the first sheet once the last one closes. */
export const FocusReturn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const opener = canvas.getByRole('button', { name: 'Open T2' })
    opener.focus()
    await userEvent.keyboard('{Enter}')
    await canvas.findByRole('region', { name: 'T2 · Stream the rows' })
    await userEvent.click(canvas.getByRole('button', { name: 'Close T2 · Stream the rows' }))
    await waitFor(() => {
      expect(opener).toHaveFocus()
    })
  },
}

/** A press on the scrim leaves the sheets altogether, the whole stack with them. */
export const ScrimPressed: Story = {
  args: { initial: ['task', 'spec'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Back to the page' }))
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-view]')).toBeNull()
    })
    expect(canvasElement.querySelector('[data-base]')).not.toHaveAttribute('inert')
  },
}

/** Escape closes the sheet on top, then the next, down to the page. */
export const Escape: Story = {
  args: { initial: ['task', 'spec'] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => {
      expect(canvas.getByRole('heading', { name: 'Spec' })).toHaveFocus()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-view="spec"]')).toBeNull()
    })
    await waitFor(() => {
      expect(canvas.getByRole('heading', { name: 'T2 · Stream the rows' })).toHaveFocus()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-view]')).toBeNull()
    })
  },
}
