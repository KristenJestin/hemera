import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { PlanningExploration } from './screen.tsx'

/**
 * #193, the recommended proposal: a Planning page that tells at a glance what waits for the user,
 * what happens now, and where the Spec stands. The Spec keeps the middle and its sections the
 * left; the header loses its Now line. The rail reads top to bottom as three questions: the
 * Planning card (what happens: Hemera's face in the expression of what happens, one line, the
 * chips of what runs, the four steps), For you (what waits: permissions, questions, findings, one
 * line per kind, the questions open one at a time), and the rest folded one quiet line each.
 */
const meta = {
  title: 'Explorations/Planning/For you',
  component: PlanningExploration,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'questionsWaiting',
    layout: 'for-you',
    onAnswer: fn(() => Promise.resolve()),
    onWaitOnSomeone: fn(() => Promise.resolve()),
    onCopyDraft: fn(),
    onAcceptProposed: fn(() => Promise.resolve()),
    onDismissProposed: fn(() => Promise.resolve()),
    onDiscuss: fn(),
    onOpenProbe: fn(),
    onDismissFinding: fn(() => Promise.resolve()),
    onRunColdRead: fn(() => Promise.resolve()),
    onDecideDependency: fn(() => Promise.resolve()),
    onGiveVision: fn(() => Promise.resolve()),
    onMarkRead: fn(() => Promise.resolve()),
    onKeepPlanning: fn(() => Promise.resolve()),
    onOpenMission: fn(),
    onAskInChat: fn(),
    onSeenTicketChange: fn(() => Promise.resolve()),
    onPermission: fn(),
    onFreeze: fn(),
  },
  decorators: [
    (Story) => (
      <div className="flex h-screen flex-col bg-surface-content">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PlanningExploration>

export default meta
type Story = StoryObj<typeof meta>

const card = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: 'Planning' }))
const forYou = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: 'For you' }))
const rest = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: 'Everything else' }))
/** Whether an element shows in the window, at least its top. */
const inView = (element: Element): boolean => {
  const box = element.getBoundingClientRect()
  return box.top >= 0 && box.top < window.innerHeight
}

/**
 * The first minutes: the Planner reads before it writes. The face reads, the card says what it
 * reads and what it does next; nothing waits for the user, and nothing under the title looks
 * like it leads anywhere.
 */
export const ReadingAtTheStart: Story = {
  args: { moment: 'reading' },
  play: async ({ canvasElement }) => {
    const planning = card(canvasElement)
    await expect(planning.getByRole('img', { name: 'Reading' })).toBeVisible()
    await expect(planning.getByRole('status')).toHaveTextContent(/^Reads the living spec/)
    await expect(planning.getByText(/Next: write Why and Goals/)).toBeVisible()
    await expect(forYou(canvasElement).getByText('Nothing waits for you')).toBeVisible()
    await expect(
      within(canvasElement).queryByRole('button', { name: /Reads the living spec/ }),
    ).toBeNull()
  },
}

/**
 * Eight questions in two waves: two answered, one waiting on someone, five to answer. The face
 * waits for an answer; the questions stand open, the first to answer whole and the others one
 * line each; the answered ones are one line under the rest.
 */
export const QuestionsWaiting: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      card(canvasElement).getByRole('img', { name: 'Waiting for your answer' }),
    ).toBeVisible()
    const waiting = forYou(canvasElement)
    await expect(waiting.getByRole('button', { name: /Questions/ })).toHaveTextContent(
      '5 to answer · 1 waits on someone',
    )
    await expect(waiting.getByRole('article', { name: /^Q3/ })).toBeVisible()
    await expect(waiting.getByRole('button', { name: /^Q4/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(waiting.getByRole('button', { name: /^Q6.*Waits on someone/ })).toBeVisible()
    await expect(rest(canvasElement).getByRole('button', { name: /Answered/ })).toHaveTextContent(
      '2',
    )
  },
}

/**
 * Choosing an answer keeps the view where the user is: Q3 folds to its line in place, Q4 opens
 * right under it with the focus, and nothing above moves.
 */
export const AnsweringKeepsTheView: Story = {
  play: async ({ canvasElement, args }) => {
    const waiting = forYou(canvasElement)
    const q3 = waiting.getByRole('article', { name: /^Q3/ })
    const top = q3.getBoundingClientRect().top
    await userEvent.click(within(q3).getByRole('button', { name: /Every field/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith('Q3', { optionId: 'A' })
    await waitFor(() => expect(waiting.getByRole('article', { name: /^Q4/ })).toHaveFocus())
    const q4 = waiting.getByRole('article', { name: /^Q4/ })
    await expect(inView(q4)).toBe(true)
    await expect(
      Math.abs(waiting.getByRole('article', { name: /^Q3/ }).getBoundingClientRect().top - top),
    ).toBeLessThan(2)
    await userEvent.click(within(q4).getByRole('button', { name: /Anyone who can read it/ }))
    await waitFor(() => expect(waiting.getByRole('article', { name: /^Q5/ })).toHaveFocus())
  },
}

/** A question line opens it, in place of the one that stood open. */
export const OpeningAnotherQuestion: Story = {
  play: async ({ canvasElement }) => {
    const waiting = forYou(canvasElement)
    await userEvent.click(waiting.getByRole('button', { name: /^Q7/ }))
    await waitFor(() => expect(waiting.getByRole('article', { name: /^Q7/ })).toBeVisible())
    await expect(waiting.getByRole('button', { name: /^Q3/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  },
}

/**
 * Every question answered; the Planner takes them in. The face thinks, the card says what the
 * Planner does, nothing waits for the user, and the answers are one line under the rest.
 */
export const AnswersTakenIntoAccount: Story = {
  args: { moment: 'takingAnswers' },
  play: async ({ canvasElement }) => {
    await expect(card(canvasElement).getByRole('img', { name: 'Thinking' })).toBeVisible()
    await expect(card(canvasElement).getByRole('status')).toHaveTextContent(/^Takes your answers/)
    await expect(forYou(canvasElement).getByText('Nothing waits for you')).toBeVisible()
    await expect(rest(canvasElement).getByRole('button', { name: /Answered/ })).toHaveTextContent(
      '8 · 5 being taken into account',
    )
  },
}

/**
 * The cold read reported seven findings, a paragraph each: five to settle are one line in For you,
 * the two settled one line under the rest. Freeze stands disabled with what is left.
 */
export const ColdReadWithManyFindings: Story = {
  args: { moment: 'coldReadFindings' },
  play: async ({ canvasElement }) => {
    const line = forYou(canvasElement).getByRole('button', { name: /Cold read C1/ })
    await expect(line).toHaveTextContent('5 findings to settle')
    await expect(line).toHaveAttribute('aria-expanded', 'false')
    await expect(
      forYou(canvasElement).queryByRole('list', { name: 'Findings to settle' }),
    ).toBeNull()
    await expect(
      within(canvasElement).getByRole('button', { name: 'Freeze' }),
    ).toHaveAccessibleDescription('5 findings to settle')
    await expect(
      card(canvasElement).getByRole('img', { name: 'Waiting for your answer' }),
    ).toBeVisible()
  },
}

/**
 * The findings unfolded: each one line — its severity, its first line, where it is. One unfolded
 * reads whole, with Dismiss; dismissed, it leaves the count.
 */
export const FindingsUnfolded: Story = {
  args: { moment: 'coldReadFindings' },
  play: async ({ canvasElement, args }) => {
    const waiting = forYou(canvasElement)
    await userEvent.click(waiting.getByRole('button', { name: /Cold read C1/ }))
    const list = await waiting.findByRole('list', { name: 'Findings to settle' })
    await expect(within(list).getAllByRole('button', { expanded: false })).toHaveLength(5)
    await userEvent.click(within(list).getByRole('button', { name: /^C1\.F4/ }))
    const dismiss = await within(list).findByRole('button', { name: 'Dismiss C1.F4' })
    await userEvent.click(dismiss)
    await expect(args.onDismissFinding).toHaveBeenCalledWith('C1.F4')
    await waitFor(() =>
      expect(waiting.getByRole('button', { name: /Cold read C1/ })).toHaveTextContent(
        '4 findings to settle',
      ),
    )
  },
}

/**
 * Two Probes run and wait on five permissions. Their chips are in the Planning card, the face
 * waits for a permission, and the five are one line in For you.
 */
export const ProbesWithPermissions: Story = {
  args: { moment: 'probesWithPermissions' },
  play: async ({ canvasElement }) => {
    const planning = card(canvasElement)
    await expect(planning.getByRole('img', { name: 'Waiting for your permission' })).toBeVisible()
    await expect(planning.getByRole('status')).toHaveTextContent(
      'Probe #1 and Probe #2 wait for your permission',
    )
    await expect(planning.getAllByRole('button', { name: /^Probe #/ })).toHaveLength(2)
    const line = forYou(canvasElement).getByRole('button', { name: /Permissions/ })
    await expect(line).toHaveTextContent('5 · Probe #1, Probe #2')
    await expect(line).toHaveAttribute('aria-expanded', 'false')
  },
}

/** The permissions unfolded: one line each; one opened is its card, answered there, and leaves. */
export const PermissionAnswered: Story = {
  args: { moment: 'probesWithPermissions' },
  play: async ({ canvasElement, args }) => {
    const waiting = forYou(canvasElement)
    await userEvent.click(waiting.getByRole('button', { name: /Permissions/ }))
    const list = await waiting.findByRole('list', { name: 'Permissions' })
    await expect(within(list).getAllByRole('listitem')).toHaveLength(5)
    await userEvent.click(within(list).getByRole('button', { name: /drop schema/ }))
    const allow = await within(list).findByRole('button', { name: 'Allow once' })
    await userEvent.click(allow)
    await expect(args.onPermission).toHaveBeenCalledWith('pr5', 'allow-once')
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4))
  },
}

/** Nothing left: the face is done, Freeze is enabled, For you says only Freeze is left. */
export const ReadyToFreeze: Story = {
  args: { moment: 'readyToFreeze' },
  play: async ({ canvasElement, args }) => {
    // The face comes first in the card; the steps' marks say Done too.
    await expect(card(canvasElement).getAllByRole('img')[0]).toHaveAccessibleName('Done')
    await expect(forYou(canvasElement).getByText('Only Freeze is left')).toBeVisible()
    const freeze = within(canvasElement).getByRole('button', { name: 'Freeze' })
    await expect(freeze).toBeEnabled()
    await userEvent.click(freeze)
    await expect(args.onFreeze).toHaveBeenCalled()
  },
}

/** The rest, folded: a press opens the vision, which the user may give at any time. */
export const VisionFolded: Story = {
  args: { moment: 'reading' },
  play: async ({ canvasElement }) => {
    const line = rest(canvasElement).getByRole('button', { name: /Your vision/ })
    await userEvent.click(line)
    await expect(line).toHaveAttribute('aria-expanded', 'true')
    await waitFor(
      () => expect(rest(canvasElement).getByRole('textbox', { name: 'Your vision' })).toBeVisible(),
      { timeout: 20_000 },
    )
  },
}
