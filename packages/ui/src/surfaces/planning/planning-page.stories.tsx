import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { PlanningScreen } from './planning-screen-fixture.tsx'
import { settled } from '../../blocks/planning/planning-play.ts'

/**
 * The Planning page of a mission, the base of its frame while the Spec is written with the user,
 * from the mission's first second to Freeze. The user always knows what happens and what to do:
 * the head's Now line says it, and a press on it brings them to the card it names; the top of the
 * rail says where Planning stands, step by step, with what the Planner does next. The Spec leads,
 * in the middle at its measure, its sections down the left — the green check only once settled.
 * The rail, in an order that never changes: where Planning stands, the triage and the ticket when
 * they wait, the questions (a wave whose every question is settled folds to one line, below the
 * waves still open), the cold read, the Probes, the dependencies and the vision. Freeze stands in
 * the head from the declaration on, disabled with what is left until nothing is.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Surfaces/Planning',
  component: PlanningScreen,
  parameters: { layout: 'fullscreen' },
  args: {
    moment: 'wave',
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
    onSeenTicketChange: fn(() => Promise.resolve()),
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
const rail = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('complementary', { name: 'What calls for you' }))
const steps = (canvasElement: HTMLElement) =>
  within(within(canvasElement).getByRole('region', { name: 'Where Planning stands' }))
/** The head's Now line, a button that brings the user to what it names. */
const nowLine = (canvasElement: HTMLElement, name: string | RegExp) =>
  within(canvasElement).getByRole('button', { name })
/** Whether an element shows in the window, at least its top. */
const inView = (element: Element): boolean => {
  const box = element.getBoundingClientRect()
  return box.top >= 0 && box.top < window.innerHeight
}

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

/**
 * The page was drawn, then stopped hearing the engine: what it shows may be behind. It says so
 * above the columns, with the cause and Try again, and keeps what it had read.
 */
export const StoppedFollowing: Story = {
  args: { moment: 'wave', failure: 'The engine did not answer in time.' },
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
 * The first second of a mission: the Planner reads what exists before it writes. The head says
 * so, the top of the rail says where Planning stands — the Spec under way, then the questions,
 * the cold read and Freeze — with what the Planner does next, and the vision is there to give
 * meanwhile. A press on the Now line brings the user to the section the Planner writes.
 */
export const Starting: Story = {
  args: { moment: 'starting' },
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    const where = steps(canvasElement)
    await expect(where.getAllByRole('listitem')).toHaveLength(4)
    const spec = where.getByRole('listitem', { name: /The Spec/ })
    await expect(within(spec).getByRole('img', { name: 'Running' })).toBeVisible()
    await expect(spec).toHaveTextContent('0 of 8 sections written')
    await expect(spec).toHaveTextContent(
      'Next: write Why and Goals, then ask what it cannot decide alone',
    )
    await expect(where.getByRole('listitem', { name: /Your answers/ })).toHaveTextContent(
      'Asked once the Planner meets what it cannot decide alone',
    )
    await expect(canvas.queryByRole('button', { name: 'Freeze' })).toBeNull()
    // The field's editor arrives on its own, the first time its module is fetched: until then there
    // is nothing to focus. A cold Windows runner takes seconds for it.
    const vision = await canvas.findByRole('textbox', { name: 'Your vision' }, { timeout: 20_000 })
    await userEvent.click(within(spec).getByRole('button', { name: 'Give your vision' }))
    await waitFor(() => expect(vision).toHaveFocus())
    await userEvent.click(nowLine(canvasElement, /Reads the living spec and the prototype code/))
    await waitFor(() => expect(canvas.getByRole('region', { name: 'Why' })).toHaveFocus())
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

/**
 * A wave waits: the Now line names the question and a press brings the user to it; the step of
 * the answers says how many wait, and the sections they will change are not settled.
 */
export const WaveWaitsForYou: Story = {
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    await expect(
      steps(canvasElement).getByRole('listitem', { name: /Your answers/ }),
    ).toHaveTextContent('1 to answer · 1 waits on someone · 1 being taken into account')
    const nav = within(canvas.getByRole('navigation', { name: 'Spec sections' }))
    await expect(nav.getByRole('img', { name: 'Written · 2 questions open' })).toBeVisible()
    await userEvent.click(nowLine(canvasElement, /Q5 waits for your answer/))
    await waitFor(() =>
      expect(rail(canvasElement).getByRole('article', { name: /^Q5/ })).toHaveFocus(),
    )
  },
}

/**
 * A wave of three questions: the header says how many are left. Answering Q5 folds it at once to
 * its line and brings Q6 into view with the focus; answering the last says, in place, that every
 * question is answered and the Planner takes them into account.
 */
export const AnsweringBringsTheNext: Story = {
  args: { moment: 'waveToAnswer' },
  play: async ({ canvasElement }) => {
    const canvas = rail(canvasElement)
    const questions = within(canvas.getByRole('region', { name: 'Questions' }))
    await expect(questions.getByText('3 to answer')).toBeVisible()
    await expect(
      steps(canvasElement).getByRole('listitem', { name: /Your answers/ }),
    ).toHaveTextContent('3 to answer')
    await userEvent.click(canvas.getByRole('button', { name: /Only its owner/ }))
    const q6 = canvas.getByRole('article', { name: /^Q6/ })
    await waitFor(() => expect(q6).toHaveFocus())
    await expect(inView(q6)).toBe(true)
    await waitFor(() => expect(questions.getByText('2 to answer')).toBeVisible())
    const q5 = within(canvas.getByRole('article', { name: /^Q5/ }))
    await expect(q5.getByText('B · Only its owner')).toBeVisible()
    await expect(q5.getByRole('status')).toHaveTextContent('Sent')
    await userEvent.click(within(q6).getByRole('button', { name: /5 000 notes/ }))
    const q9 = canvas.getByRole('article', { name: /^Q9/ })
    await waitFor(() => expect(q9).toHaveFocus())
    await userEvent.click(within(q9).getByRole('button', { name: /Yes, as a list/ }))
    const done = await questions.findByText(
      'All questions answered — the Planner takes them into account',
    )
    await waitFor(() => expect(done).toHaveFocus())
    await expect(questions.queryByText(/to answer$/)).toBeNull()
  },
}

/** Q5 answered and sent: folded at once to its line, "Sent" beside its dot. */
export const AnswerSent: Story = {
  args: { moment: 'answerReceived' },
  play: async ({ canvasElement }) => {
    const card = within(rail(canvasElement).getByRole('article', { name: /^Q5/ }))
    await expect(card.getByText('B · Only its owner')).toBeVisible()
    await expect(card.getByRole('status')).toHaveTextContent('Sent')
  },
}

/** With the Planner: the line's dot turns blue; the step says it is being taken into account. */
export const AnswerWithThePlanner: Story = {
  args: { moment: 'answerDelivered' },
  play: async ({ canvasElement }) => {
    const card = within(rail(canvasElement).getByRole('article', { name: /^Q5/ }))
    await expect(card.getByRole('status')).toHaveTextContent('With the Planner')
    await expect(
      steps(canvasElement).getByRole('listitem', { name: /Your answers/ }),
    ).toHaveTextContent('2 being taken into account')
  },
}

/** Taken into account: the same line, its dot green and its word, Change. */
export const AnswerTakenIntoAccount: Story = {
  args: { moment: 'answerIntegrated' },
  play: async ({ canvasElement }) => {
    const card = within(rail(canvasElement).getByRole('article', { name: /^Q5/ }))
    await expect(card.getByText('B · Only its owner')).toBeVisible()
    await expect(card.getByRole('status')).toHaveTextContent('Taken into account')
    await expect(card.getByRole('button', { name: 'Change the answer to Q5' })).toBeVisible()
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
    await expect(nowLine(canvasElement, /Waits for Probe #2/)).toBeVisible()
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

/**
 * Declared complete, many questions answered: the Now line says the cold read reads the Spec,
 * with its chip, and leads to it; Freeze stands in the head, disabled, the reason under it; the
 * waves whose questions are all settled are one line each, and the cold read is in view.
 */
export const ColdReadRunning: Story = {
  args: { moment: 'coldReadRunning' },
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    await expect(nowLine(canvasElement, /The cold read is reading the Spec/)).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: /Cold read C1/ })).toHaveLength(2)
    const freeze = canvas.getByRole('button', { name: 'Freeze' })
    await expect(freeze).toBeDisabled()
    await expect(freeze).toHaveAccessibleDescription('The cold read is reading the Spec')
    const waves = rail(canvasElement)
    await expect(waves.getByRole('button', { name: /Wave 2 · 3 settled/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(waves.getByRole('button', { name: /Wave 1 · 4 settled/ })).toBeVisible()
    const coldRead = waves.getByRole('region', { name: 'Cold read' })
    await expect(inView(coldRead)).toBe(true)
    await userEvent.click(nowLine(canvasElement, /The cold read is reading the Spec/))
    await waitFor(() => expect(coldRead).toHaveFocus())
  },
}

/** A settled wave opens again on a press: its questions, each one line with Change. */
export const SettledWaveOpened: Story = {
  args: { moment: 'coldReadRunning' },
  play: async ({ canvasElement }) => {
    const canvas = rail(canvasElement)
    const wave = canvas.getByRole('button', { name: /Wave 1 · 4 settled/ })
    await userEvent.click(wave)
    await expect(wave).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: 'Change the answer to Q1' })).toBeVisible(),
    )
  },
}

/**
 * The cold read reported on an earlier text, with findings to settle and Q8 asked from one:
 * Freeze names what is left, the Now line leads to Q8.
 */
export const ColdReadFindings: Story = {
  args: { moment: 'findings' },
  play: async ({ canvasElement }) => {
    const canvas = rail(canvasElement)
    await expect(
      canvas.getByRole('button', { name: /The cold read read an earlier text/ }),
    ).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Wave 3' })).toBeVisible()
    await expect(
      page(canvasElement).getByRole('button', { name: 'Freeze' }),
    ).toHaveAccessibleDescription('1 question to answer · 2 findings to settle')
    await expect(nowLine(canvasElement, /Q8 waits for your answer/)).toBeVisible()
  },
}

/** The cold read failed: why, and another pass to run; the head and the steps say it stopped. */
export const ColdReadFailed: Story = {
  args: { moment: 'coldReadFailed' },
  play: async ({ canvasElement, args }) => {
    const canvas = rail(canvasElement)
    await expect(canvas.getByText(/The cold read failed/)).toBeVisible()
    await expect(nowLine(canvasElement, /The cold read stopped before its report/)).toBeVisible()
    const again = canvas.getByRole('button', { name: 'Run another cold read' })
    await userEvent.click(again)
    await expect(args.onRunColdRead).toHaveBeenCalled()
    await settled(again)
  },
}

/** A dependency on ACME-20 proposed by the Planner: Accept or Reject, in the rail. */
export const DependencyProposed: Story = {
  args: { moment: 'dependencyProposed' },
  play: async ({ canvasElement, args }) => {
    const canvas = rail(canvasElement)
    const accept = canvas.getByRole('button', { name: 'Accept the dependency on ACME-20' })
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

/** The vision, given twice: always a field in the rail. */
export const Vision: Story = {
  args: { moment: 'vision' },
  play: async ({ canvasElement }) => {
    const canvas = rail(canvasElement)
    await expect(canvas.getByRole('list', { name: 'Your vision so far' })).toBeVisible()
    await waitFor(() => expect(canvas.getByRole('textbox', { name: 'Your vision' })).toBeVisible())
  },
}

/**
 * Nothing left: Freeze is enabled, the Now line says so and leads to it, the last step waits for
 * the user.
 */
export const ReadyToFreeze: Story = {
  args: { moment: 'readyToFreeze' },
  play: async ({ canvasElement, args }) => {
    const canvas = page(canvasElement)
    const freeze = canvas.getByRole('button', { name: 'Freeze' })
    await expect(freeze).toBeEnabled()
    await expect(steps(canvasElement).getByRole('listitem', { name: /Freeze/ })).toHaveTextContent(
      'Ready: yours to press',
    )
    await userEvent.click(nowLine(canvasElement, /Ready to freeze/))
    await waitFor(() => expect(freeze).toHaveFocus())
    await userEvent.click(freeze)
    await expect(args.onFreeze).toHaveBeenCalled()
  },
}

/** Freeze pressed as the Planner changed the Spec: refused, and why, under Freeze. */
export const FreezeRefused: Story = {
  args: { moment: 'freezeRefused' },
  play: async ({ canvasElement }) => {
    const canvas = page(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Freeze' })).toHaveAccessibleDescription(
      'Not frozen: The Spec changed after you read it: R2 and Decisions',
    )
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
    await expect(
      steps(canvasElement)
        .getAllByRole('img')
        .map((mark) => mark.getAttribute('aria-label')),
    ).toEqual(['Done', 'Done', 'Done', 'Done'])
  },
}

/** The Planner stopped: the head says why, the step of the Spec failed, the Now line leads there. */
export const PlannerStopped: Story = {
  args: { moment: 'plannerFailed' },
  play: async ({ canvasElement }) => {
    const line = nowLine(canvasElement, /The Planner stopped: its provider refused the request/)
    const spec = steps(canvasElement).getByRole('listitem', { name: /The Spec/ })
    await expect(within(spec).getByRole('img', { name: 'Failed' })).toBeVisible()
    await userEvent.click(line)
    await waitFor(() =>
      expect(
        page(canvasElement).getByRole('region', { name: 'Where Planning stands' }),
      ).toHaveFocus(),
    )
  },
}

/** The Planner's last turn ended without a word: said, rather than an old line believed. */
export const PlannerSilent: Story = {
  args: { moment: 'plannerSilent' },
  play: async ({ canvasElement }) => {
    await expect(
      nowLine(canvasElement, /The Planner’s last turn ended without a word/),
    ).toBeVisible()
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
    const keep = canvas.getByRole('button', { name: 'Keep planning' })
    await userEvent.click(keep)
    await expect(args.onKeepPlanning).toHaveBeenCalled()
    await settled(keep)
  },
}

/** The ticket answered a question that waits: the Planner proposes it; Accept, Edit, Dismiss. */
export const ProposedAnswer: Story = {
  args: { moment: 'proposedAnswer' },
  play: async ({ canvasElement, args }) => {
    const canvas = rail(canvasElement)
    const proposal = canvas.getByRole('group', { name: 'Proposed from the ticket' })
    const pressed = within(proposal).getByRole('button', { name: 'Accept' })
    await userEvent.click(pressed)
    await expect(args.onAcceptProposed).toHaveBeenCalledWith('pa1', null)
    await settled(pressed)
  },
}

/** Hemera started again in the middle: every answer and its state are where they were. */
export const Restarted: Story = {
  args: { moment: 'restarted' },
  play: async ({ canvasElement }) => {
    await expect(nowLine(canvasElement, /Started again/)).toBeVisible()
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
    await expect(within(card).getByRole('img', { name: /^Sent/ })).toBeVisible()
  },
}

/**
 * The last answer is being taken into account: Freeze stands disabled, saying so; `--set
 * moment=readyToFreeze` plays it turning enabled, for the image sequence.
 */
export const FreezeAppearing: Story = {
  args: { moment: 'almostReady' },
  play: async ({ canvasElement }) => {
    const freeze = page(canvasElement).getByRole('button', { name: 'Freeze' })
    await expect(freeze).toBeDisabled()
    await expect(freeze).toHaveAccessibleDescription('Your answers are being taken into account')
  },
}
