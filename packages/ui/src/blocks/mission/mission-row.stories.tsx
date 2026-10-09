import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { MissionRow, MissionRowSkeleton } from './mission-row.tsx'

/**
 * A mission named in a list. One line (the key, the title, when, the ball), or two when the last
 * event is said under the title; the marks and Building's percentage ride on the first line.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Mission/MissionRow',
  component: MissionRow,
  args: {
    missionKey: 'ACME-12',
    title: 'Export invoices as CSV from the billing page',
    when: '08:56',
    ball: 'you',
    onOpen: fn(),
  },
  decorators: [
    (Story) => (
      <ul className="w-full max-w-2xl border border-border">
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof MissionRow>

export default meta
type Story = StoryObj<typeof meta>

/** Today's row: nothing under the title. */
export const OneLine: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button'))
    expect(args.onOpen).toHaveBeenCalledOnce()
    expect(canvasElement.querySelector('[data-row-event]')).toBeNull()
  },
}

/** The last event in words, under the title. */
export const TwoLines: Story = {
  args: { event: 'Checks green after the second round' },
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('Checks green after the second round')).toBeInTheDocument()
  },
}

/** Marks, a percentage and the event together. */
export const Marked: Story = {
  args: {
    event: 'Task T2 started',
    percent: 40,
    marks: [{ kind: 'blocked', cause: 'ACME-9' }, { kind: 'outdated' }],
    ball: 'blocked',
  },
  play: ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.getByText('40%')).toBeInTheDocument()
    expect(canvas.getByText('Blocked by ACME-9')).toBeInTheDocument()
  },
}

/** Across Projects: the Project's letter leads. */
export const WithProject: Story = {
  args: { project: 'Acme', event: 'Spec frozen' },
}

/** A long title and a long event truncate in their places. */
export const Long: Story = {
  args: {
    title:
      'Export invoices as CSV from the billing page, with the customer filters kept and a progress for the long ones',
    event:
      'The reviewer asked for the progress of the long exports to be shown in the page header as well',
    marks: [{ kind: 'waiting', on: 'CI on acme/shop#52' }],
  },
  play: ({ canvasElement }) => {
    const row = canvasElement.querySelector('li')
    expect(row).not.toBeNull()
    if (row !== null) expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
  },
}

/** The row on its way, as two lines. */
export const SkeletonTwoLines: Story = {
  render: () => <MissionRowSkeleton twoLines />,
  play: ({ canvasElement }) => {
    expect(canvasElement.querySelector('[data-row-skeleton]')).not.toBeNull()
    expect(canvasElement.querySelector('[data-row-event]')).not.toBeNull()
  },
}
