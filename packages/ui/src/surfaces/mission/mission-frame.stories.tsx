import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { LONG_TITLE } from '../../shell/shell-cast.ts'
import { MissionFixture, MissionStageFixture } from './mission-shell-fixture.tsx'

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

/** The text of a mark, as a glyph's name or in words, wherever the header says it. */
function says(canvasElement: HTMLElement, words: string): boolean {
  const canvas = within(canvasElement)
  return (
    canvas.queryAllByRole('img', { name: words }).length > 0 ||
    canvas.queryAllByText(words).length > 0
  )
}

const FROM_A_STAGE = {
  tags: ['!autodocs'],
  parameters: { layout: 'fullscreen' },
} as const

/** Planning: the Spec not frozen yet, Freeze as its action, the stage track at its first step, the needs at the top. */
export const MissionPlanning: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-14" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Freeze' })).toBeVisible()
    expect(canvas.getByRole('button', { name: 'Cancel' })).toBeVisible()
    expect(
      within(canvas.getByRole('list', { name: 'Needs you' })).getAllByRole('listitem'),
    ).toHaveLength(2)
    expect(canvas.queryByRole('img', { name: 'Spec frozen' })).toBeNull()
    const track = canvas.getByRole('list', { name: 'Stage' })
    expect(within(track).getAllByRole('listitem')).toHaveLength(6)
    expect(within(track).getByText('Planning').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    )
  },
}

/** A need of the top list unfolds to its card, in place, and the card answers. */
export const MissionNeedUnfolded: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-14" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [first] = canvas.getAllByRole('button', { name: 'Answer here' })
    await userEvent.click(first!)
    await waitFor(() => {
      expect(canvas.getByRole('button', { name: 'Admins only' })).toBeVisible()
    })
  },
}

/** Ready, frozen, blocked by a dependency: Launch, the lock on the track, and the cause written out. */
export const MissionBlockedByDependency: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-16" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Launch' })).toBeVisible()
    expect(canvas.getByRole('img', { name: 'Spec frozen' })).toBeInTheDocument()
    expect(says(canvasElement, 'Blocked by ACME-9')).toBe(true)
    expect(canvas.queryByRole('list', { name: 'Needs you' })).toBeNull()
  },
}

/** Building, blocked by a shared resource another mission holds. */
export const MissionBlockedByResource: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-17" />,
  play: async ({ canvasElement }) => {
    expect(says(canvasElement, 'Blocked by shared database · ACME-15')).toBe(true)
    expect(within(canvasElement).queryByRole('button', { name: 'Launch' })).toBeNull()
    expect(within(canvasElement).getByText('Building')).toBeVisible()
  },
}

/** Review, round 1: Ship, a repository changed outside Hemera, a fix under way, a need, and the ticket it comes from. */
export const MissionReview: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-12" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByRole('button', { name: 'Ship' })).toBeVisible()
    expect(says(canvasElement, 'web changed outside Hemera')).toBe(true)
    expect(says(canvasElement, 'Fixing')).toBe(true)
    expect(canvas.getByRole('button', { name: /acme\/shop#41/ })).toBeInTheDocument()
    expect(canvas.getByText('Review · round 1')).toBeVisible()
  },
}

/** Shipping: no action of its own, waiting on someone, said with what it waits on. */
export const MissionWaiting: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-18" />,
  play: async ({ canvasElement }) => {
    expect(says(canvasElement, 'Waiting on CI on acme/shop#52')).toBe(true)
    expect(
      within(canvasElement).getAllByRole('img', { name: 'Waiting on someone' }).length,
    ).toBeGreaterThan(0)
  },
}

/** Ready but outdated: the glyph opens what moved as a view over the base, and Back finds the base. */
export const MissionOutdated: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-19" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(says(canvasElement, 'Outdated')).toBe(true)
    await userEvent.click(canvas.getByRole('button', { name: 'What changed' }))
    const view = await waitFor(() => canvas.getByRole('region', { name: 'What changed' }))
    expect(view).toBeVisible()
    expect(view).toHaveTextContent(/The ticket gained a second acceptance line/)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(canvasElement.querySelector('[data-base]')).not.toHaveAttribute('inert')
    })
  },
}

/** Cancel asks once, says what stops and what is kept; Keep it going leaves everything as it was. */
export const MissionCancelling: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-15" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }))
    const dialog = await within(document.body).findByRole('dialog', { name: 'Cancel ACME-15?' })
    expect(dialog).toHaveTextContent(/stops its sessions, commands, services and delivery steps/)
    expect(dialog).toHaveTextContent(/stay until you confirm the cleanup/)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it going' }))
    await waitFor(() => {
      expect(within(document.body).queryByRole('dialog')).toBeNull()
    })
  },
}

/** Done and Cancelled: no Cancel, no action; the track of a cancelled mission is its one step. */
export const MissionOver: Story = {
  ...FROM_A_STAGE,
  render: () => (
    <>
      <MissionStageFixture missionKey="ACME-9" />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Cancel' })).toBeNull()
    expect(canvas.getByRole('img', { name: 'Spec frozen' })).toBeInTheDocument()
  },
}

export const MissionCancelled: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-4" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('button', { name: 'Cancel' })).toBeNull()
    const track = canvas.getByRole('list', { name: 'Stage' })
    expect(within(track).getAllByRole('listitem')).toHaveLength(1)
    expect(within(track).getByText('Cancelled')).toBeVisible()
  },
}

/** A refused Freeze says why, in words, under the header. */
export const MissionFreezeRefused: Story = {
  ...FROM_A_STAGE,
  render: () => (
    <MissionStageFixture missionKey="ACME-14" notice="The Spec changed since you read it." />
  ),
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).getByRole('alert')).toHaveTextContent(
      'The Spec changed since you read it.',
    )
  },
}

/** The Spec link is there only when a Spec view is registered. */
export const MissionWithoutSpecView: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-14" specView={false} />,
  play: async ({ canvasElement }) => {
    expect(within(canvasElement).queryByRole('button', { name: /^Spec/ })).toBeNull()
  },
}

/** At 1366×768, a long title and the longest causes: the title gives way, the header's end stays whole. */
export const MissionLongCauses: Story = {
  ...FROM_A_STAGE,
  globals: { viewport: { value: 'laptop', isRotated: false } },
  render: () => <MissionStageFixture missionKey="ACME-17" title={LONG_TITLE} longCause />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const title = canvas.getByRole('heading', { level: 1 })
    expect(getComputedStyle(title).textOverflow).toBe('ellipsis')
    expect(canvas.getByRole('button', { name: 'Cancel' })).toBeVisible()
    expect(says(canvasElement, 'Blocked by the shared database of the billing service · ACME-15')).toBe(true)
  },
}

/** Over a stage's page, a view stands and goes: the page under it is the one that was there. */
export const MissionStageViewsOverBase: Story = {
  ...FROM_A_STAGE,
  render: () => <MissionStageFixture missionKey="ACME-19" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const base = canvasElement.querySelector<HTMLElement>('[data-base]')!
    await userEvent.click(canvas.getByRole('button', { name: 'What changed' }))
    await waitFor(() => {
      expect(base).toHaveAttribute('inert')
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Back to the page' }))
    await waitFor(() => {
      expect(base).not.toHaveAttribute('inert')
    })
    expect(canvas.getByText('The Ready page')).toBeVisible()
  },
}
