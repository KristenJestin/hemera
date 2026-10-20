import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ReviewScreen } from './screen.tsx'

/**
 * A round, as a view over the Review page (open question 76, settled by the mission frame: a
 * stack, its trail `Acme › ACME-12 › Review · round 2 › Round 2`). A round is a small Spec: its
 * questions by waves, then its points written like requirements, each with the ids it came from,
 * fix or behaviour change, its scenario or its decision. A point against the Spec has three ways
 * out; a point the Spec never asked for is offered as a mission of its own.
 */
const meta = {
  title: 'Explorations/Review/Round',
  component: ReviewScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'grilling',
    initial: { open: ['round:2'], shown: 'round:2' },
    onShip: fn(),
    onService: fn(),
    onRemark: fn(),
    onFix: fn(),
    onVerify: fn(),
    onTeam: fn(),
    onPull: fn(),
    onOpenDiff: fn(),
    onOpenLink: fn(),
    onCopy: fn(),
    onPoint: fn(),
    onOpenBuilding: fn(),
  },
} satisfies Meta<typeof ReviewScreen>

export default meta
type Story = StoryObj<typeof meta>

const viewOf = (canvasElement: HTMLElement, n: number): ReturnType<typeof within> =>
  within(within(canvasElement).getByRole('region', { name: `Round ${String(n)}` }))

/** Its questions as waves: the first answered and folded, the second open, one card at a time. */
export const GrillingWaves: Story = {
  play: async ({ canvasElement }) => {
    const view = viewOf(canvasElement, 2)
    await expect(view.getByRole('button', { name: /^Wave 1/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(view.getByText(/Should the progress stay hidden/)).toBeVisible()
    await expect(view.getByText(/Written once the questions are answered/)).toBeVisible()
    await expect(
      within(canvasElement).getByRole('navigation', { name: 'Where you are' }),
    ).toHaveTextContent('AcmeACME-12Review · round 2Round 2')
  },
}

/** A point against the Spec: why, then its three ways out; Clarify asks for the note. */
export const ConflictWithTheSpec: Story = {
  args: { moment: 'building' },
  play: async ({ canvasElement, args }) => {
    const view = viewOf(canvasElement, 2)
    await expect(view.getByText(/R4 says “past 10 000 rows/)).toBeVisible()
    await expect(view.getByRole('button', { name: 'Withdraw the remark' })).toBeVisible()
    await expect(view.getByRole('button', { name: 'Cancel the point' })).toBeVisible()
    await userEvent.click(view.getByRole('button', { name: 'Clarify with a note' }))
    const note = await waitFor(() => view.getByRole('textbox', { name: 'The note on P5' }))
    await userEvent.type(note, 'D5 replaces the row threshold.{Enter}')
    await expect(args.onPoint).toHaveBeenCalledWith(
      'P5',
      'clarify',
      'D5 replaces the row threshold.',
    )
  },
}

/** A point the Spec never asked for: Start a mission from this, instead of a point of the round. */
export const StartAMissionFromThis: Story = {
  args: { moment: 'building' },
  play: async ({ canvasElement, args }) => {
    const view = viewOf(canvasElement, 2)
    await userEvent.click(view.getByRole('button', { name: 'Start a mission from this' }))
    await expect(args.onPoint).toHaveBeenCalledWith('P7', 'mission', '')
  },
}

/** While it builds: the mission is in Building · round 2, whose page is a press away. */
export const BuildingRound: Story = {
  args: { moment: 'building' },
  play: async ({ canvasElement, args }) => {
    const view = viewOf(canvasElement, 2)
    await userEvent.click(view.getByRole('button', { name: /^Building · round 2/ }))
    await expect(args.onOpenBuilding).toHaveBeenCalled()
    await expect(view.getByRole('button', { name: /P4/ })).toHaveTextContent('F6 · F9')
  },
}

/** Back in Review: every point done, the conflict clarified with its note, the answers on the remarks. */
export const BackWithAnswers: Story = {
  args: { moment: 'back' },
  play: async ({ canvasElement }) => {
    const view = viewOf(canvasElement, 2)
    await expect(view.getAllByRole('img', { name: 'Done' }).length).toBeGreaterThanOrEqual(4)
    await expect(view.getByText(/Clarified: D5 replaces the row threshold of R4/)).toBeVisible()
  },
}

/** A closed round in the history: read only, the way it ended. */
export const ClosedRound: Story = {
  args: { moment: 'back', initial: { open: ['round:1'], shown: 'round:1' } },
  play: async ({ canvasElement }) => {
    const view = viewOf(canvasElement, 1)
    await expect(
      view.getByText(/Closed · sent yesterday 16:30 · back yesterday 18:05/),
    ).toBeVisible()
    await expect(view.queryByRole('button', { name: 'Clarify with a note' })).toBeNull()
  },
}
