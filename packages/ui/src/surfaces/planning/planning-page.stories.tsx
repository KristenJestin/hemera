import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { PlanningScreen } from './planning-screen-fixture.tsx'

/**
 * The Planning page of a mission, the base of its frame while the Spec is written with the user.
 * The Spec leads, read in the middle at its measure, its eight sections in a rail on the left with
 * their state, and what changed since the last read marked where it changed, with Mark as read.
 * The right-hand rail holds everything the user may act on: the questions, newest wave first, the
 * Probes, the cold read, the dependencies and the vision, always there. Discuss and a Probe's
 * report open as views over the page. Freeze stands in the head only when it is offered.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Planning',
  component: PlanningScreen,
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'wave',
    onAnswer: fn(),
    onWaitOnSomeone: fn(),
    onCopyDraft: fn(),
    onAcceptProposed: fn(),
    onDismissProposed: fn(),
    onDiscuss: fn(),
    onOpenProbe: fn(),
    onDismissFinding: fn(),
    onRunColdRead: fn(),
    onDecideDependency: fn(),
    onGiveVision: fn(),
    onMarkRead: fn(),
    onKeepPlanning: fn(),
    onOpenMission: fn(),
    onSeenTicketChange: fn(),
    onSay: fn(),
    onAccept: fn(),
    onClose: fn(),
    onFreeze: fn(),
    onRetry: fn(),
  },
  decorators: [
    (Story) => (
      <div className="flex h-screen flex-col bg-surface-content">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PlanningScreen>

export default meta
type Story = StoryObj<typeof meta>

const page = (canvasElement: HTMLElement) => within(canvasElement)
const rail = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('complementary', { name: 'What calls for you' }))

/** The first read is on its way: skeletons where the sections and the Spec will be. */
export const Loading: Story = {
  args: { moment: 'loading' },
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    await expect(canvas.getByRole('region', { name: 'Spec' })).toHaveAttribute('aria-busy', 'true')
  },
}

/** The Spec could not be read: why, in words, and Try again. */
export const Error: Story = {
  args: { moment: 'error' },
  play: async ({ canvasElement, args }) => {
    const canvas = page(canvasElement)
    await expect(canvas.getByRole('alert')).toHaveTextContent('did not answer in time')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await expect(args.onRetry).toHaveBeenCalled()
  },
}

/** The Planner writes the first draft: its Now line, a section being written, nothing asked yet. */
export const PlannerWriting: Story = {
  args: { moment: 'writing' },
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    await expect(canvas.getByText(/Writes Impact/)).toBeVisible()
    const nav = within(canvas.getByRole('navigation', { name: 'Spec sections' }))
    await expect(nav.getByRole('img', { name: 'Being written' })).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'Questions' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Freeze' })).toBeNull()
  },
}

/** Two waves: one open, one waiting on someone, a changed answer, retired ones kept readable. */
export const WaveWaiting: Story = {
  play: async ({ canvasElement }) => {
    const canvas = rail(canvasElement)
    const questions = canvas.getByRole('region', { name: 'Questions' })
    const waves = within(questions).getAllByRole('list', { name: /^Wave/ })
    await expect(waves[0]).toHaveAccessibleName('Wave 2')
    await expect(canvas.getByRole('img', { name: 'Waiting on someone' })).toBeVisible()
    await expect(canvas.getByText('Now B, before A')).toBeVisible()
    await expect(canvas.getByText('Replaced by Q6')).toBeVisible()
    await expect(page(canvasElement).queryByRole('list', { name: 'Needs you' })).toBeNull()
  },
}

/** Answering by a press: the answer leaves at once, no Send. */
export const Answering: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = rail(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Only its owner/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith('Q5', { optionId: 'B' })
    const card = within(canvas.getByRole('article', { name: /^Q5/ }))
    await expect(card.queryByRole('button', { name: 'Send' })).toBeNull()
  },
}

/** Answering from the keyboard: Tab to an option, Enter, its ring visible. */
export const AnsweringByKeyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = rail(canvasElement)
    const option = canvas.getByRole('button', { name: /Anyone who can read it/ })
    option.focus()
    await expect(option.matches(':focus-visible')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith('Q5', { optionId: 'A' })
  },
}

/** A discussion on Q5, open over the page, the agent's decision proposed. */
export const DiscussionOpen: Story = {
  args: { moment: 'discussing', opened: 'discussion:question:Q5' },
  play: async ({ canvasElement }) => {
    const body = within(document.body)
    await waitFor(() =>
      expect(body.getByRole('group', { name: 'Proposed decision' })).toBeVisible(),
    )
    await expect(canvasElement.querySelector('[data-base]')).toHaveAttribute('inert')
  },
}

/** Discuss pressed: the view opens, Escape closes it and the focus returns to Discuss. */
export const Discussing: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = rail(canvasElement)
    const discuss = within(canvas.getByRole('article', { name: /^Q5/ })).getByRole('button', {
      name: 'Discuss',
    })
    await userEvent.click(discuss)
    await expect(args.onDiscuss).toHaveBeenCalledWith({ kind: 'question', id: 'Q5' })
    const body = within(document.body)
    // The view is closed once it has finished coming in, its field holding the focus.
    await waitFor(() => {
      const field = body.getByRole('textbox', { name: 'Your first message on Q5' })
      expect(field).toBeVisible()
      expect(field).toHaveFocus()
      expect(field.closest('[data-view]')?.getAnimations({ subtree: true })).toHaveLength(0)
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(discuss).toHaveFocus(), { timeout: 3000 })
  },
}

/** A Probe running beside two that ended, in the Probes card of the rail. */
export const ProbeRunning: Story = {
  args: { moment: 'probing' },
  play: async ({ canvasElement }) => {
    const canvas = rail(canvasElement)
    const probes = canvas.getByRole('region', { name: 'Probes' })
    await expect(within(probes).getAllByRole('button')).toHaveLength(3)
    await expect(page(canvasElement).getByText(/Waits for Probe #2/)).toBeVisible()
  },
}

/** A Probe that did not reproduce, its report open over the page. */
export const ProbeNotReproduced: Story = {
  args: { moment: 'probing', opened: 'probe:p3' },
  play: async () => {
    const body = within(document.body)
    await waitFor(() => expect(body.getByText('Not reproduced')).toBeVisible())
    await expect(body.getByText(/a title of emoji gives a file of the same name/)).toBeVisible()
  },
}

/** The cold read runs after the first completeness declaration. */
export const ColdReadRunning: Story = {
  args: { moment: 'coldReadRunning' },
  play: async ({ canvasElement }) => {
    const canvas = rail(canvasElement)
    await expect(canvas.getByRole('button', { name: /Cold read C1/ })).toBeVisible()
  },
}

/** The cold read reported on an earlier text, with findings to settle and Q8 asked from one. */
export const ColdReadFindings: Story = {
  args: { moment: 'findings' },
  play: async ({ canvasElement }) => {
    const canvas = rail(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /The cold read read an earlier text/ }),
    ).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Wave 3' })).toBeVisible()
  },
}

/** The cold read failed: why, and another pass to run. */
export const ColdReadFailed: Story = {
  args: { moment: 'coldReadFailed' },
  play: async ({ canvasElement, args }) => {
    const canvas = rail(canvasElement)
    await expect(canvas.getByText(/The cold read failed/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Run another cold read' }))
    await expect(args.onRunColdRead).toHaveBeenCalled()
    await expect(
      page(canvasElement).getByText('The cold read stopped without a report'),
    ).toBeVisible()
  },
}

/** A dependency on ACME-20 proposed by the Planner: Accept or Reject, in the rail. */
export const DependencyProposed: Story = {
  args: { moment: 'dependencyProposed' },
  play: async ({ canvasElement, args }) => {
    const canvas = rail(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Accept the dependency on ACME-20' }))
    await expect(args.onDecideDependency).toHaveBeenCalledWith('dep1', true)
  },
}

/** Back after a while: what changed marked in the text, one line on top with Mark as read. */
export const ChangedSinceLastRead: Story = {
  args: { moment: 'changed' },
  play: async ({ canvasElement, args }) => {
    const canvas = page(canvasElement)
    const spec = within(canvas.getByRole('region', { name: 'Spec' }))
    await expect(spec.getByText(/3 changes since your last read/)).toBeVisible()
    const nav = within(canvas.getByRole('navigation', { name: 'Spec sections' }))
    await expect(
      nav.getAllByRole('img', { name: 'Changed since your last read' }).length,
    ).toBeGreaterThan(0)
    await userEvent.click(spec.getByRole('button', { name: 'Mark as read' }))
    await expect(args.onMarkRead).toHaveBeenCalled()
  },
}

/** The vision, given twice: always a field in the rail. */
export const Vision: Story = {
  args: { moment: 'vision' },
  play: async ({ canvasElement }) => {
    const canvas = rail(canvasElement)
    await expect(canvas.getByRole('list', { name: 'Your vision so far' })).toBeVisible()
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Your vision' })).toBeVisible())
  },
}

/** Everything is settled for the agent: Freeze stands in the head. */
export const ReadyToFreeze: Story = {
  args: { moment: 'readyToFreeze' },
  play: async ({ canvasElement, args }) => {
    const canvas = page(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Freeze' }))
    await expect(args.onFreeze).toHaveBeenCalled()
  },
}

/** Freeze refused: each thing that blocks it, named, under the head. */
export const FreezeRefused: Story = {
  args: { moment: 'freezeRefused' },
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    const refusal = within(canvas.getByRole('list', { name: 'Why Freeze was refused' }))
    await expect(refusal.getAllByRole('listitem')).toHaveLength(2)
    await expect(refusal.getByText(/Your answer to Q8/)).toBeVisible()
  },
}

/** Frozen: the lock is in the track; the Spec read-only; nothing to answer, no vision. */
export const Frozen: Story = {
  args: { moment: 'frozen' },
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    await expect(canvas.queryByRole('region', { name: 'Questions' })).toBeNull()
    await expect(canvas.queryByRole('textbox', { name: 'Your vision' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Freeze' })).toBeNull()
  },
}

/** The ticket changed while the Spec is written: its difference and its state, in the rail. */
export const Outdated: Story = {
  args: { moment: 'outdated' },
  play: async ({ canvasElement }) => {
    const canvas = rail(canvasElement)
    await expect(canvas.getByRole('region', { name: 'acme/shop#41 changed' })).toBeVisible()
  },
}

/** The Planner read the request as belonging elsewhere: its answer, Keep planning. */
export const Triage: Story = {
  args: { moment: 'triaged' },
  play: async ({ canvasElement, args }) => {
    const canvas = rail(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Keep planning' }))
    await expect(args.onKeepPlanning).toHaveBeenCalled()
  },
}

/** The ticket answered a question that waits: the Planner proposes it; Accept, Edit, Dismiss. */
export const ProposedAnswer: Story = {
  args: { moment: 'proposedAnswer' },
  play: async ({ canvasElement, args }) => {
    const canvas = rail(canvasElement)
    const proposal = canvas.getByRole('group', { name: 'Proposed from the ticket' })
    await userEvent.click(within(proposal).getByRole('button', { name: 'Accept' }))
    await expect(args.onAcceptProposed).toHaveBeenCalledWith('pa1', null)
  },
}

/** Hemera started again in the middle: every answer and its state are where they were. */
export const Restarted: Story = {
  args: { moment: 'restarted' },
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    await expect(canvas.getByText(/Started again/)).toBeVisible()
    await expect(rail(canvasElement).getByText('Now B, before A')).toBeVisible()
  },
}

/** Long text in every field: it wraps and nothing overflows its column. */
export const LongText: Story = {
  args: { moment: 'long' },
  play: async ({ canvasElement }) => {
    const aside = page(canvasElement).getByRole('complementary', { name: 'What calls for you' })
    await expect(aside.scrollWidth).toBeLessThanOrEqual(aside.clientWidth)
  },
}

/** A new wave arrives: `--set moment=wave` plays it for the image sequence. */
export const WaveArriving: Story = {
  args: { moment: 'firstWave' },
  play: async ({ canvasElement }) => {
    await expect(rail(canvasElement).getAllByRole('list', { name: /^Wave/ })).toHaveLength(1)
  },
}

/** An answer's dot moves on: `--set moment=answerIntegrated` plays it for the image sequence. */
export const AnswerIntegrating: Story = {
  args: { moment: 'answerReceived' },
  play: async ({ canvasElement }) => {
    const card = rail(canvasElement).getByRole('article', { name: /^Q5/ })
    await expect(within(card).getByRole('img', { name: 'Received' })).toBeVisible()
  },
}

/** Freeze appears: `--set moment=readyToFreeze` plays it for the image sequence. */
export const FreezeAppearing: Story = {
  args: { moment: 'almostReady' },
  play: async ({ canvasElement }) => {
    await expect(page(canvasElement).queryByRole('button', { name: 'Freeze' })).toBeNull()
  },
}
