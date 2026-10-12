import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../../components/button/button.tsx'
import { settled } from '../../blocks/planning/planning-play.ts'
import { type MomentName, PlanningScreen } from './planning-screen-fixture.tsx'

/**
 * The Planning page of a mission, the base of its frame while the Spec is written with the user,
 * from the mission's first second to Freeze. It tells at a glance what waits for the user, what
 * happens, and where the Spec stands. The Spec keeps the middle, its sections the left; the head
 * draws the ball without the face and no Now line. The rail reads top to bottom: the stage card
 * (Hemera's face in the expression of what happens, one line, where Planning stands, the chips of
 * what runs), For you (what waits — the mission's needs, the questions, the findings to settle —
 * one line per kind, the questions one list that grows, one open at a time), and the rest folded
 * one quiet line each. Freeze stands in the head from the declaration on, disabled with what is
 * left until nothing is.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Planning',
  component: PlanningScreen,
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'questionsWaiting',
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
    onSay: fn(() => Promise.resolve()),
    onAccept: fn(() => Promise.resolve()),
    onClose: fn(() => Promise.resolve()),
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
const card = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: 'Planning' }))
const forYou = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: 'For you' }))
const rest = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: 'Everything else' }))
/** The ids of the questions a list holds, in its order: its own items, not their options'. */
const questionIds = (list: HTMLElement): string[] =>
  [...list.querySelectorAll(':scope > li')].map((item) => item.textContent?.slice(0, 2) ?? '')
/** Whether an element shows in the window, at least its top. */
const inView = (element: Element): boolean => {
  const box = element.getBoundingClientRect()
  return box.top >= 0 && box.top < window.innerHeight
}

/** The first read is on its way: skeletons where the sections and the Spec will be. */
export const Loading: Story = {
  args: { moment: 'loading' },
  play: async ({ canvasElement }) => {
    await expect(page(canvasElement).getByRole('region', { name: 'Spec' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
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

/**
 * The page was drawn, then stopped hearing the engine: what it shows may be behind. It says so
 * above the columns, with the cause and Try again, and keeps what it had read.
 */
export const StoppedFollowing: Story = {
  args: { moment: 'asked', failure: 'The engine did not answer in time.' },
  play: async ({ canvasElement, args }) => {
    const canvas = page(canvasElement)
    const alert = canvas.getByRole('alert')
    await expect(alert).toHaveTextContent('may be behind')
    await expect(alert).toHaveTextContent('did not answer in time')
    await expect(canvas.getByRole('region', { name: 'Why' })).toBeVisible()
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await expect(args.onRetry).toHaveBeenCalled()
  },
}

/**
 * The first minutes: the Planner reads before it writes. The face reads, the card's line is the
 * Planner's own and says no section is written yet; nothing waits for the user, and nothing in
 * the card or the head looks like it leads anywhere.
 */
export const ReadingAtTheStart: Story = {
  args: { moment: 'reading' },
  play: async ({ canvasElement }) => {
    const planning = card(canvasElement)
    await expect(planning.getByRole('img', { name: 'Reading' })).toBeVisible()
    await expect(planning.getByRole('status')).toHaveTextContent(/^Reads the living spec/)
    await expect(planning.getByText('0 of 8 sections written')).toBeVisible()
    await expect(forYou(canvasElement).getByText('Nothing waits for you')).toBeVisible()
    await expect(
      page(canvasElement).queryByRole('button', { name: /Reads the living spec/ }),
    ).toBeNull()
  },
}

/** The Planner writes the first draft: its line, the face writing, a section being written. */
export const PlannerWriting: Story = {
  args: { moment: 'writing' },
  play: async ({ canvasElement }) => {
    const planning = card(canvasElement)
    await expect(planning.getByRole('img', { name: 'Writing' })).toBeVisible()
    await expect(planning.getByRole('status')).toHaveTextContent(/^Writes Impact/)
    const nav = within(page(canvasElement).getByRole('navigation', { name: 'Spec sections' }))
    await expect(nav.getByRole('img', { name: 'Being written' })).toBeVisible()
    await expect(page(canvasElement).queryByRole('button', { name: 'Freeze' })).toBeNull()
  },
}

/**
 * Eight questions asked, one list: two answered, one waiting on someone, five to answer. The
 * card says so and where the Spec stands; the first to answer stands whole, the others one line
 * each; the answered ones are one line under the rest.
 */
export const QuestionsWaiting: Story = {
  play: async ({ canvasElement }) => {
    const planning = card(canvasElement)
    await expect(planning.getByRole('img', { name: 'Waiting for your answer' })).toBeVisible()
    await expect(planning.getByRole('status')).toHaveTextContent('5 questions wait for your answer')
    await expect(planning.getByText('The Spec')).toBeVisible()
    await expect(planning.getByText('4 of 8 sections written')).toBeVisible()
    const waiting = forYou(canvasElement)
    await expect(waiting.getByRole('button', { name: /Questions/ })).toHaveTextContent(
      '5 to answer · 1 waits on someone',
    )
    await expect(waiting.getByRole('article', { name: /^Q3/ })).toBeVisible()
    for (const id of ['Q4', 'Q5', 'Q7', 'Q8']) {
      // oxlint-disable-next-line no-await-in-loop -- one line after the other, in the list's order
      await expect(waiting.getByRole('button', { name: new RegExp(`^${id}`) })).toHaveAttribute(
        'aria-expanded',
        'false',
      )
    }
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

/** A click on a section in the page's list brings the Spec to it, and its heading takes the focus. */
export const SectionClickedInTheList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    const nav = within(canvas.getByRole('navigation', { name: 'Spec sections' }))
    const migration = canvas.getByRole('region', { name: 'Migration plan' })
    await userEvent.click(nav.getByRole('button', { name: /Migration plan/ }))
    await expect(within(migration).getByRole('heading', { name: /Migration plan/ })).toHaveFocus()
    await expect(inView(migration)).toBe(true)
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
 * Eight questions asked at two moments are one list, in the order they were asked: no wave label,
 * grouping or count by wave anywhere on the page.
 */
export const NoWaveAnywhere: Story = {
  play: async ({ canvasElement }) => {
    const list = forYou(canvasElement).getByRole('list', { name: 'Questions to answer' })
    await expect(questionIds(list)).toEqual(['Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8'])
    await expect(canvasElement.textContent).not.toMatch(/wave/i)
  },
}

/** A story that asks Q9 on a press, while the page is open: the questions as they arrive. */
const ARRIVING: Pick<Story, 'args' | 'render'> = {
  args: { moment: 'asked' },
  render: function Arriving(args) {
    const [moment, setMoment] = useState<MomentName>(args.moment)
    return (
      <>
        <div className="flex px-8 py-2">
          <Button variant="secondary" size="sm" onClick={() => setMoment('threeToAnswer')}>
            Ask Q9
          </Button>
        </div>
        <PlanningScreen {...args} moment={moment} />
      </>
    )
  },
}

/** The questions the Planner asks while the page is open join the list, at its end. */
export const QuestionsArriving: Story = {
  ...ARRIVING,
  play: async ({ canvasElement }) => {
    const waiting = forYou(canvasElement)
    await expect(waiting.getByRole('article', { name: /^Q5/ })).toBeVisible()
    await expect(waiting.queryByRole('button', { name: /^Q9/ })).toBeNull()
    await userEvent.click(page(canvasElement).getByRole('button', { name: 'Ask Q9' }))
    const list = waiting.getByRole('list', { name: 'Questions to answer' })
    await waitFor(() => expect(questionIds(list)).toEqual(['Q5', 'Q6', 'Q9']))
    await expect(waiting.getByRole('article', { name: /^Q5/ })).toBeVisible()
  },
}

/**
 * A question put on hold, waiting on someone, stays open where it stands: the Planner drafts its
 * message there.
 */
export const PuttingOnHold: Story = {
  args: { moment: 'asked' },
  play: async ({ canvasElement, args }) => {
    const waiting = forYou(canvasElement)
    const q5 = within(waiting.getByRole('article', { name: /^Q5/ }))
    await userEvent.click(q5.getByRole('button', { name: /waiting on someone/ }))
    await userEvent.type(q5.getByRole('textbox', { name: 'Who, or what, it waits on' }), 'Sam')
    await userEvent.click(q5.getByRole('button', { name: 'Wait' }))
    await expect(args.onWaitOnSomeone).toHaveBeenCalledWith('Q5', 'Sam')
    await waitFor(() =>
      expect(waiting.getByRole('button', { name: /Questions/ })).toHaveTextContent(
        '2 wait on someone',
      ),
    )
    await expect(waiting.getByRole('article', { name: /^Q5/ })).toBeVisible()
  },
}

/**
 * Questions asked after the last one was answered: the first to answer opens, and stays open
 * where it stands once put on hold.
 */
export const ArrivedQuestionPutOnHold: Story = {
  ...ARRIVING,
  play: async ({ canvasElement }) => {
    const waiting = forYou(canvasElement)
    const q5 = within(waiting.getByRole('article', { name: /^Q5/ }))
    await userEvent.click(q5.getByRole('button', { name: /Anyone who can read it/ }))
    await userEvent.click(page(canvasElement).getByRole('button', { name: 'Ask Q9' }))
    const q6 = within(await waiting.findByRole('article', { name: /^Q6/ }))
    await userEvent.click(q6.getByRole('button', { name: /waiting on someone/ }))
    await userEvent.click(q6.getByRole('button', { name: 'Wait' }))
    await waitFor(() =>
      expect(waiting.getByRole('button', { name: /Questions/ })).toHaveTextContent(
        '1 to answer · 1 waits on someone',
      ),
    )
    await expect(waiting.getByRole('article', { name: /^Q6/ })).toBeVisible()
    await expect(waiting.getByRole('button', { name: /^Q9/ })).toHaveAttribute(
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

/** Answering from the keyboard: Tab to an option, Enter, its ring visible. */
export const AnsweringByKeyboard: Story = {
  args: { moment: 'asked' },
  play: async ({ canvasElement, args }) => {
    const q5 = forYou(canvasElement).getByRole('article', { name: /^Q5/ })
    const option = within(q5).getByRole('button', { name: /Anyone who can read it/ })
    option.focus()
    await expect(option.matches(':focus-visible')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith('Q5', { optionId: 'A' })
  },
}

/** Discuss pressed: the view opens, Escape closes it and the focus returns to Discuss. */
export const Discussing: Story = {
  args: { moment: 'asked' },
  play: async ({ canvasElement, args }) => {
    const discuss = within(forYou(canvasElement).getByRole('article', { name: /^Q5/ })).getByRole(
      'button',
      { name: 'Discuss' },
    )
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

/** A question made moot by a discussion: under the rest, it opens its discussion again. */
export const DiscussionReadAgain: Story = {
  args: { moment: 'mootByDiscussion' },
  play: async ({ canvasElement, args }) => {
    const others = rest(canvasElement)
    await userEvent.click(others.getByRole('button', { name: /Answered/ }))
    const q7 = within(await others.findByRole('article', { name: /^Q7/ }))
    await userEvent.click(q7.getByRole('button', { name: 'Open the discussion' }))
    await expect(args.onDiscuss).toHaveBeenCalledWith({ kind: 'question', id: 'Q7' })
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

/** The ticket answered a question that waits on someone: opened, the Planner proposes it. */
export const ProposedAnswer: Story = {
  args: { moment: 'proposedAnswer' },
  play: async ({ canvasElement, args }) => {
    const waiting = forYou(canvasElement)
    await userEvent.click(waiting.getByRole('button', { name: /^Q6/ }))
    const proposal = await waiting.findByRole('group', { name: 'Proposed from the ticket' })
    const pressed = within(proposal).getByRole('button', { name: 'Accept' })
    await userEvent.click(pressed)
    await expect(args.onAcceptProposed).toHaveBeenCalledWith('pa1', null)
    await settled(pressed)
  },
}

/**
 * The cold read reported seven findings, a paragraph each: five to settle are one line in For
 * you, the two settled one line under the rest. Freeze stands disabled with what is left.
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
      page(canvasElement).getByRole('button', { name: 'Freeze' }),
    ).toHaveAccessibleDescription('5 findings to settle')
    await expect(
      card(canvasElement).getByRole('img', { name: 'Waiting for your answer' }),
    ).toBeVisible()
    await expect(
      rest(canvasElement).getByRole('button', { name: /Cold read C1/ }),
    ).toHaveTextContent('2 settled')
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
 * Declared complete: the cold read reads, its chip in the card; Freeze stands disabled, the
 * reason under it.
 */
export const ColdReadRunning: Story = {
  args: { moment: 'coldReadRunning' },
  play: async ({ canvasElement }) => {
    const planning = card(canvasElement)
    await expect(planning.getByRole('status')).toHaveTextContent(
      'The cold read is reading the Spec',
    )
    await expect(planning.getByRole('button', { name: /Cold read C1/ })).toBeVisible()
    const freeze = page(canvasElement).getByRole('button', { name: 'Freeze' })
    await expect(freeze).toBeDisabled()
    await expect(freeze).toHaveAccessibleDescription('The cold read is reading the Spec')
  },
}

/** The cold read failed: the face says so; its line under the rest says why, and runs another. */
export const ColdReadFailed: Story = {
  args: { moment: 'coldReadFailed' },
  play: async ({ canvasElement, args }) => {
    const planning = card(canvasElement)
    await expect(planning.getByRole('img', { name: 'Error' })).toBeVisible()
    await expect(planning.getByRole('status')).toHaveTextContent(
      'The cold read stopped before its report',
    )
    const others = rest(canvasElement)
    await userEvent.click(others.getByRole('button', { name: /Cold read C1/ }))
    await expect(await others.findByText(/The cold read failed/)).toBeVisible()
    const again = others.getByRole('button', { name: 'Run another cold read' })
    await userEvent.click(again)
    await expect(args.onRunColdRead).toHaveBeenCalled()
    await settled(again)
  },
}

/**
 * Two Probes run and wait on five permissions. Their chips are in the stage card, the face
 * waits for a permission, and the five are one line in For you; the mission's needs are not
 * drawn above the Spec.
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
    await expect(page(canvasElement).queryByRole('list', { name: 'Needs you' })).toBeNull()
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

/** A Probe running beside two that ended: its chip in the card, the ended ones under the rest. */
export const ProbeRunning: Story = {
  args: { moment: 'probing' },
  play: async ({ canvasElement }) => {
    await expect(card(canvasElement).getAllByRole('button', { name: /^Probe #/ })).toHaveLength(1)
    await expect(rest(canvasElement).getByRole('button', { name: /Probes/ })).toHaveTextContent(
      '2 ended',
    )
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

/** A dependency on ACME-20 proposed by the Planner: its line under the rest, Accept in it. */
export const DependencyProposed: Story = {
  args: { moment: 'dependencyProposed' },
  play: async ({ canvasElement, args }) => {
    const others = rest(canvasElement)
    const line = others.getByRole('button', { name: /Dependencies/ })
    await expect(line).toHaveTextContent('2 · 1 proposed')
    await userEvent.click(line)
    const accept = await others.findByRole('button', { name: 'Accept the dependency on ACME-20' })
    await userEvent.click(accept)
    await expect(args.onDecideDependency).toHaveBeenCalledWith('dep1', true)
    await settled(accept)
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
    const pressed = spec.getByRole('button', { name: 'Mark as read' })
    await userEvent.click(pressed)
    await expect(args.onMarkRead).toHaveBeenCalled()
    await settled(pressed)
  },
}

/** The rest, folded: a press opens the vision, which the user may give at any time. */
export const VisionFolded: Story = {
  args: { moment: 'reading' },
  play: async ({ canvasElement }) => {
    const line = rest(canvasElement).getByRole('button', { name: /Your vision/ })
    await userEvent.click(line)
    await expect(line).toHaveAttribute('aria-expanded', 'true')
    // The field's editor arrives on its own, the first time its module is fetched: until then there
    // is nothing to show. A cold Windows runner takes seconds for it.
    await waitFor(
      () => expect(rest(canvasElement).getByRole('textbox', { name: 'Your vision' })).toBeVisible(),
      { timeout: 20_000 },
    )
  },
}

/** The vision given twice: its line counts them, and unfolds to what was given and the field. */
export const Vision: Story = {
  args: { moment: 'vision' },
  play: async ({ canvasElement }) => {
    const others = rest(canvasElement)
    const line = others.getByRole('button', { name: /Your vision/ })
    await expect(line).toHaveTextContent('2 given')
    await userEvent.click(line)
    await expect(await others.findByRole('list', { name: 'Your vision so far' })).toBeVisible()
  },
}

/** Nothing left: the face is done, Freeze is enabled, For you says only Freeze is left. */
export const ReadyToFreeze: Story = {
  args: { moment: 'readyToFreeze' },
  play: async ({ canvasElement, args }) => {
    await expect(card(canvasElement).getByRole('img', { name: 'Done' })).toBeVisible()
    await expect(forYou(canvasElement).getByText('Only Freeze is left')).toBeVisible()
    const freeze = page(canvasElement).getByRole('button', { name: 'Freeze' })
    await expect(freeze).toBeEnabled()
    await userEvent.click(freeze)
    await expect(args.onFreeze).toHaveBeenCalled()
  },
}

/** Freeze pressed as the Planner changed the Spec: refused, and why, under Freeze. */
export const FreezeRefused: Story = {
  args: { moment: 'freezeRefused' },
  play: async ({ canvasElement }) => {
    await expect(
      page(canvasElement).getByRole('button', { name: 'Freeze' }),
    ).toHaveAccessibleDescription(
      'Not frozen: The Spec changed after you read it: R2 and Decisions',
    )
  },
}

/** Frozen: the lock is in the track, the card says so; nothing waits, no vision to give. */
export const Frozen: Story = {
  args: { moment: 'frozen' },
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    const planning = card(canvasElement)
    await expect(planning.getByRole('status')).toHaveTextContent('The Spec is frozen')
    await expect(planning.getByRole('img', { name: 'Done' })).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'For you' })).toBeNull()
    await expect(canvas.queryByRole('textbox', { name: 'Your vision' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'Freeze' })).toBeNull()
  },
}

/** The Planner stopped: the face and the card say why. */
export const PlannerStopped: Story = {
  args: { moment: 'plannerFailed' },
  play: async ({ canvasElement }) => {
    const planning = card(canvasElement)
    await expect(planning.getByRole('img', { name: 'Error' })).toBeVisible()
    await expect(planning.getByRole('status')).toHaveTextContent(
      'The Planner stopped: its provider refused the request',
    )
  },
}

/** The Planner's last turn ended without a word: said, rather than an old line believed. */
export const PlannerSilent: Story = {
  args: { moment: 'plannerSilent' },
  play: async ({ canvasElement }) => {
    await expect(card(canvasElement).getByRole('status')).toHaveTextContent(
      'The Planner’s last turn ended without a word',
    )
  },
}

/** Hemera started again in the middle: the Planner says it, every answer where it was. */
export const Restarted: Story = {
  args: { moment: 'restarted' },
  play: async ({ canvasElement }) => {
    await expect(card(canvasElement).getByRole('status')).toHaveTextContent(/^Started again/)
    await expect(forYou(canvasElement).getByRole('article', { name: /^Q5/ })).toBeVisible()
  },
}

/** The ticket changed while the Spec is written: its difference waits for the user. */
export const Outdated: Story = {
  args: { moment: 'outdated' },
  play: async ({ canvasElement }) => {
    await expect(
      forYou(canvasElement).getByRole('region', { name: 'acme/shop#41 changed' }),
    ).toBeVisible()
  },
}

/** The Planner read the request as belonging elsewhere: its answer waits for the user. */
export const Triage: Story = {
  args: { moment: 'triaged' },
  play: async ({ canvasElement, args }) => {
    await expect(card(canvasElement).getByRole('status')).toHaveTextContent(
      'The Planner asks whether this is new work',
    )
    const keep = forYou(canvasElement).getByRole('button', { name: 'Keep planning' })
    await userEvent.click(keep)
    await expect(args.onKeepPlanning).toHaveBeenCalled()
    await settled(keep)
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

/**
 * The last answer is being taken into account: Freeze stands disabled, saying so; `--set
 * moment=settled` plays it turning enabled, for the image sequence.
 */
export const FreezeAppearing: Story = {
  args: { moment: 'almostReady' },
  play: async ({ canvasElement }) => {
    const freeze = page(canvasElement).getByRole('button', { name: 'Freeze' })
    await expect(freeze).toBeDisabled()
    await expect(freeze).toHaveAccessibleDescription('Your answers are being taken into account')
  },
}
