import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../components/button/button.tsx'
import { type NoticeItem, NoticeStack } from './notice.tsx'
import { LONG_TITLE, NOTICES } from './shell-fixtures.tsx'

/**
 * A notification while the window has the focus, in the sheet's corner: the mark of what
 * happened, the title, the Project and the mission under it, a line of detail. Pressing it
 * leads somewhere and takes it away; its × only takes it away.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Shell/Notification',
  component: NoticeStack,
  parameters: { layout: 'fullscreen' },
  args: { notices: NOTICES, onOpen: fn(), onDismiss: fn() },
  argTypes: { notices: { table: { disable: true } } },
  render: (args) => {
    const [notices, setNotices] = useState(args.notices)
    const [added, setAdded] = useState(0)
    const remove = (id: string): void =>
      setNotices((before) => before.filter((one) => one.id !== id))
    return (
      <div className="relative h-screen bg-surface-content p-8">
        <Button
          variant="secondary"
          onClick={() => {
            const next: NoticeItem = {
              id: `added-${String(added)}`,
              tone: 'you',
              project: 'Acme',
              missionKey: 'ACME-12',
              title: `Arrived ${String(added + 1)}`,
            }
            setAdded(added + 1)
            setNotices((before) => [...before, next])
          }}
        >
          Notify
        </Button>
        <NoticeStack
          notices={notices}
          onOpen={(id) => {
            args.onOpen(id)
            remove(id)
          }}
          onDismiss={(id) => {
            args.onDismiss(id)
            remove(id)
          }}
        />
      </div>
    )
  },
} satisfies Meta<typeof NoticeStack>

export default meta
type Story = StoryObj<typeof meta>

/** The four kinds, one above the other: what waits for you, what finished, what broke, what moved outside. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const region = within(canvasElement).getByRole('region', { name: 'Notifications' })
    for (const tone of ['you', 'done', 'failed', 'outside']) {
      expect(region.querySelector(`[data-notice="${tone}"]`)).not.toBeNull()
    }
  },
}

/** Pressed: it leads to its mission and leaves the stack. */
export const Opened: Story = {
  play: async ({ canvasElement, args }) => {
    const region = within(canvasElement).getByRole('region', { name: 'Notifications' })
    await userEvent.click(within(region).getByRole('button', { name: /^Shipped/ }))
    expect(args.onOpen).toHaveBeenCalledWith('n2')
    await waitFor(() => {
      expect(within(region).queryByRole('button', { name: /^Shipped/ })).toBeNull()
    })
  },
}

/** Its × pressed: it leaves the stack, and leads nowhere. */
export const Dismissed: Story = {
  play: async ({ canvasElement, args }) => {
    const region = within(canvasElement).getByRole('region', { name: 'Notifications' })
    await userEvent.click(within(region).getByRole('button', { name: 'Dismiss: Shipped' }))
    expect(args.onDismiss).toHaveBeenCalledWith('n2')
    expect(args.onOpen).not.toHaveBeenCalled()
  },
}

/** One arriving on a stack of three: it comes from under the edge and the others move up. */
export const Arriving: Story = {
  args: { notices: NOTICES.slice(0, 3) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Notify' }))
    const region = canvas.getByRole('region', { name: 'Notifications' })
    await waitFor(() => {
      expect(within(region).getByRole('button', { name: /^Arrived 1/ })).toBeVisible()
    })
  },
}

/** A long title and a long detail: each ends in an ellipsis, the width never grows. */
export const LongText: Story = {
  args: {
    notices: [
      {
        id: 'long',
        tone: 'you',
        project: 'Acme',
        missionKey: 'ACME-12',
        title: LONG_TITLE,
        detail: `${LONG_TITLE} — ${LONG_TITLE}`,
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const title = within(canvasElement).getByText(LONG_TITLE)
    expect(title.scrollWidth).toBeGreaterThan(title.clientWidth)
  },
}
