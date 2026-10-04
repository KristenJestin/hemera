import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { LONG_TITLE, MissionFixture } from '../../shell/shell-fixtures.tsx'

/**
 * The frame of a mission on its Review page: the header, the base that keeps its state, and the
 * views opened over it from where they belong — a task from its row, a round from the rounds,
 * the diff from the changes, the Spec from the header. Under the sheet's header, which carries
 * the trail: the views are a stack, and the breadcrumb says it.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Mission',
  component: MissionFixture,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof MissionFixture>

export default meta
type Story = StoryObj<typeof meta>

/** The base alone: the header with the face that has the ball, the Review page under it. */
export const AtBase: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent(/Export invoices/)
    expect(canvas.getByRole('img', { name: 'Needs you' })).toBeInTheDocument()
    expect(canvas.getByRole('list', { name: 'Your remarks' })).toBeInTheDocument()
    expect(canvas.getByRole('list', { name: 'Services' })).toBeInTheDocument()
    expect(canvasElement.querySelector('[data-view]')).toBeNull()
  },
}

/** The Spec opened from the header: a wide sheet over the base, solid, its crumb added to the trail. */
export const ViewOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Spec · frozen/ }))
    const view = await waitFor(() => canvas.getByRole('region', { name: 'Spec' }))
    expect(view).toBeVisible()
    expect(canvas.getByRole('navigation', { name: 'Where you are' })).toHaveTextContent(
      'AcmeACME-12Review · round 1Spec',
    )
    expect(canvasElement.querySelector('[data-base]')).toHaveAttribute('inert')
    // Solid: the sheet's own surface, not the base seen through it.
    expect(getComputedStyle(view).backgroundColor).not.toMatch(/rgba\(.*, 0\)|transparent/)
    expect(getComputedStyle(view).opacity).toBe('1')
  },
}

/** A press on the scrim beside a stack of sheets: back to the base, all the sheets gone. */
export const ScrimPressed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Round 1 ?4 points/ }))
    await userEvent.click(
      await waitFor(() => canvas.getByRole('button', { name: 'Open the Spec' })),
    )
    await waitFor(() => {
      expect(canvas.getByRole('region', { name: 'Spec' })).toBeVisible()
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Back to the page' }))
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-view]')).toBeNull()
    })
    expect(canvasElement.querySelector('[data-base]')).not.toHaveAttribute('inert')
  },
}

/** A task opened from its row: narrow beside the base, and the row is the chosen one when it closes. */
export const TaskOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /T5 ?Count the rows/ }))
    await waitFor(() => {
      expect(canvas.getByRole('region', { name: /T5 · Count the rows/ })).toBeVisible()
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-task="T5"]')).toHaveAttribute(
        'aria-current',
        'true',
      )
    })
  },
}

/** A view from a view: the round from the rounds, the Spec from the round; the trail says the way, Back goes down one. */
export const Stacked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Round 1 ?4 points/ }))
    await userEvent.click(
      await waitFor(() => canvas.getByRole('button', { name: 'Open the Spec' })),
    )
    const way = canvas.getByRole('navigation', { name: 'Where you are' })
    await waitFor(() => {
      expect(way).toHaveTextContent('AcmeACME-12Review · round 1Round 1Spec')
    })
    await userEvent.click(within(way).getByRole('button', { name: /Round 1/ }))
    await waitFor(() => {
      expect(canvas.queryByRole('region', { name: 'Spec' })).toBeNull()
    })
    expect(canvas.getByRole('region', { name: 'Round 1' })).toBeVisible()
  },
}

/** The diff from the changes: the same sheet as every view, at its width; its expand grows it to the frame's, and folds it back. */
export const Expanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Diff' }))
    const view = await waitFor(() => canvas.getByRole('region', { name: 'Diff' }))
    const body = canvasElement.querySelector<HTMLElement>('[data-base]')!.parentElement!
    await waitFor(() => {
      expect(view.getBoundingClientRect().width).toBeLessThan(body.getBoundingClientRect().width)
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Expand Diff' }))
    await waitFor(() => {
      expect(view.getBoundingClientRect().width).toBe(body.getBoundingClientRect().width)
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse Diff' }))
    await waitFor(() => {
      expect(view.getBoundingClientRect().width).toBeLessThan(body.getBoundingClientRect().width)
    })
  },
}

/** Going back finds the base intact: its scroll, the requirement it had open, the task it had chosen. */
export const BaseKept: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const base = canvasElement.querySelector<HTMLElement>('[data-base]')!
    await userEvent.click(canvas.getByRole('button', { name: /R2 Name the file/ }))
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: /T4 ?Build the file/ })).toBeVisible()
    })
    // Scrolled once the rows have grown: the fold is instant under reduced motion, but the layout
    // that follows it is the browser's next frame.
    await waitFor(() => {
      base.scrollTop = base.scrollHeight
      expect(base.scrollTop).toBeGreaterThan(0)
    })
    const scrolled = base.scrollTop
    // Opened from the header's menu, which stands outside the scrolled base.
    await userEvent.click(canvas.getByRole('button', { name: 'More for ACME-12' }))
    await userEvent.click(
      await waitFor(() => within(document.body).getByRole('menuitem', { name: 'Memory' })),
    )
    await waitFor(() => {
      expect(base).toHaveAttribute('inert')
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(base).not.toHaveAttribute('inert')
    })
    expect(base.scrollTop).toBe(scrolled)
    expect(canvas.getByRole('button', { name: /R2 Name the file/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

/** From the keyboard: a task row takes Enter, the view takes the focus, then its expand, its ×, which gives it back to the row. */
export const Focused: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /T5 ?Count the rows/ })
    row.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(canvas.getByRole('heading', { name: /^T5/, level: 2 })).toHaveFocus()
    })
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: /^Expand T5/ })).toHaveFocus()
    await userEvent.tab()
    expect(canvas.getByRole('button', { name: /^Close T5/ })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => {
      expect(row).toHaveFocus()
    })
  },
}

/** A long title: it ends in an ellipsis, and the header's end stays where it is. */
export const LongTitle: Story = {
  args: { title: LONG_TITLE },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { level: 1 })
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
    expect(canvas.getByRole('button', { name: 'Ship' })).toBeVisible()
  },
}
