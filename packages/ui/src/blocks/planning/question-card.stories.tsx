import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ComponentProps, type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '../../components/button/button.tsx'

import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import { WAVES } from '../../surfaces/planning/planning-fixtures.ts'
import type { Question } from './planning-types.ts'
import { QuestionCard } from './question-card.tsx'
import { EDITOR_LOADED, settled, writeAndSend } from './planning-play.ts'

/**
 * A question of the Planner, as the rail of the Planning page holds it: its options, the
 * recommended one starred and why (a star and a line, never a frame: the frame and the fill are the
 * user's choice alone), answered by a press that shows at once (there is no Send), or in the user's
 * own words; "I'm waiting on someone" with a note, and the Planner's drafted message with Copy,
 * never Send. Its dot and a word say where the answer stands — sent, with the Planner, taken into
 * account — and it folds to a line once taken into account. What it shows is drawn from the
 * question alone: the same live as after a restart.
 */

const byId = (id: string): Question => {
  const found = WAVES.flatMap((wave) => wave.questions).find((question) => question.id === id)
  if (found === undefined) throw new Error(`No question ${id} in the fixtures`)
  return found
}

const OPEN = byId('Q5')

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/QuestionCard',
  component: QuestionCard,
  args: {
    question: OPEN,
    discussed: false,
    mentionables: MENTIONABLES,
    onAnswer: fn(() => Promise.resolve()),
    onWaitOnSomeone: fn(() => Promise.resolve()),
    onCopyDraft: fn(),
    onAcceptProposed: fn(() => Promise.resolve()),
    onDismissProposed: fn(() => Promise.resolve()),
    onDiscuss: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-view-narrow">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QuestionCard>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Open, with a recommendation and no answer: the recommended option wears the star and nothing
 * else — no frame, no fill — so nothing reads as chosen; the dot says it is not answered yet.
 */
export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const card = canvas.getByRole('article', { name: /Q5/ })
    await expect(within(card).getAllByRole('button', { pressed: false })).toHaveLength(3)
    const recommended = within(card).getByRole('button', {
      name: /Anyone who can read it, recommended/,
    })
    const other = within(card).getByRole('button', { name: /Only its owner/ })
    await expect(getComputedStyle(recommended).borderColor).toBe(
      getComputedStyle(other).borderColor,
    )
    await expect(getComputedStyle(recommended).backgroundColor).toBe(
      getComputedStyle(other).backgroundColor,
    )
    await expect(card).toHaveTextContent('Recommended A')
    await expect(within(card).getByRole('img', { name: 'Not answered yet' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Send' })).toBeNull()
  },
}

/** The card once folded: its one line, and nothing of the options left. */
const foldedTo = async (canvasElement: HTMLElement, answer: string): Promise<void> => {
  const canvas = within(canvasElement)
  await waitFor(() => {
    expect(canvas.getByText(answer)).toBeVisible()
    expect(canvas.queryByRole('list', { name: /^Options of/ })).toBeNull()
  })
}

/**
 * Chosen: the card folds at once to its line — the answer, "Sending" beside its dot, Change —
 * before the engine has answered.
 */
export const Chosen: Story = {
  args: { onAnswer: fn(() => new Promise<void>(() => undefined)) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Only its owner/ }))
    await expect(args.onAnswer).toHaveBeenCalledWith('Q5', { optionId: 'B' })
    await foldedTo(canvasElement, 'B · Only its owner')
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Sending'))
    await expect(canvas.getByRole('button', { name: 'Change the answer to Q5' })).toBeVisible()
  },
}

/** Sent: the engine took it; the line says "Sent". */
export const Sent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Only its owner/ }))
    await foldedTo(canvasElement, 'B · Only its owner')
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Sent'))
  },
}

/** The engine refused the answer: the card opens again, says why, and nothing is chosen. */
export const ChosenRefused: Story = {
  args: { onAnswer: fn(() => Promise.reject(new Error('Q5 is no longer open.'))) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Only its owner/ }))
    await waitFor(() =>
      expect(canvas.getByRole('alert')).toHaveTextContent('Not sent: Q5 is no longer open.'),
    )
    await expect(canvas.getAllByRole('button', { pressed: false })).toHaveLength(3)
  },
}

const answeredQ5 = (
  inputState: 'received' | 'delivered' | 'integrated',
  optionId = 'B',
): Question => ({
  ...OPEN,
  state: 'answered',
  answers: [{ version: 1, optionId, text: null, at: '11:02', inputState }],
})

/** Sent, as the engine says it: the same line a press leaves, drawn from the question alone. */
export const SentAsRead: Story = {
  args: { question: answeredQ5('received') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('B · Only its owner')).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent('Sent')
    await expect(canvas.getByRole('img', { name: /^Sent/ })).toBeVisible()
  },
}

/** With the Planner: delivered, not yet in the Spec; the line's dot turns blue. */
export const WithThePlanner: Story = {
  args: { question: answeredQ5('delivered') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('With the Planner')
    await expect(canvas.getByRole('img', { name: /^With the Planner/ })).toBeVisible()
  },
}

/** Taken into account: the green dot and its word on the line; Change opens the card again. */
export const TakenIntoAccount: Story = {
  args: { question: answeredQ5('integrated') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('B · Only its owner')).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent('Taken into account')
    await expect(canvas.getByRole('img', { name: 'Taken into account in the Spec' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /Anyone who can read it/ })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Change the answer to Q5' }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /Only its owner/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
  },
}

/**
 * Answered with another option than the recommended one, opened with Change: the choice is
 * filled, the recommended one keeps its star only and is dimmed with the others.
 */
export const AnsweredAgainstTheRecommendation: Story = {
  args: { question: answeredQ5('delivered', 'C') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('C · Its owner and its editors')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Change the answer to Q5' }))
    await waitFor(() =>
      expect(canvas.getByRole('button', { name: /Its owner and its editors/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    )
    const recommended = canvas.getByRole('button', { name: /Anyone who can read it, recommended/ })
    await expect(recommended).toHaveAttribute('aria-pressed', 'false')
    await expect(recommended).toHaveAttribute('data-dimmed', '')
  },
}

/** The four steps of one answer, the live card beside one drawn fresh from the same question. */
function LiveAndRestarted(props: ComponentProps<typeof QuestionCard>): ReactNode {
  const steps: readonly Question[] = [
    OPEN,
    answeredQ5('received'),
    answeredQ5('delivered'),
    answeredQ5('integrated'),
  ]
  const [step, setStep] = useState(0)
  const question = steps[step] ?? OPEN
  return (
    <div className="flex flex-col gap-4">
      <Button variant="secondary" size="sm" onClick={() => setStep((step + 1) % steps.length)}>
        Next step
      </Button>
      <section aria-label="Live" className="rounded-md border border-border">
        <QuestionCard {...props} question={question} />
      </section>
      <section aria-label="After a restart" className="rounded-md border border-border">
        <QuestionCard key={step} {...props} question={question} />
      </section>
    </div>
  )
}

/** What differs between two equal cards: generated ids, and the inline style an animation leaves. */
const GENERATED = new Set(['id', 'aria-controls', 'aria-describedby', 'aria-labelledby', 'style'])

/** The markup of a card, attributes in order, what is generated aside. */
const shape = (node: Node): string => {
  if (!(node instanceof Element)) return node.textContent ?? ''
  const attributes = [...node.attributes]
    .filter((attribute) => !GENERATED.has(attribute.name))
    .map((attribute) => `${attribute.name}="${attribute.value}"`)
    .toSorted()
    .join(' ')
  return `<${node.tagName} ${attributes}>${[...node.childNodes].map(shape).join('')}</>`
}

/**
 * One display for a question, live or after a restart: at every step, the card that lived through
 * the answer and a card drawn fresh from the same question are the same.
 */
export const SameAfterARestart: Story = {
  render: (args) => <LiveAndRestarted {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const live = canvas.getByRole('region', { name: 'Live' })
    const restarted = canvas.getByRole('region', { name: 'After a restart' })
    const next = canvas.getByRole('button', { name: 'Next step' })
    const steps = ['Not answered yet', 'Sent', 'With the Planner', 'Taken into account']
    // One step after the other: each is checked, then the next is played.
    await steps.reduce<Promise<void>>(
      (before, step) =>
        before.then(async () => {
          await waitFor(() =>
            expect(within(live).getByRole('img', { name: new RegExp(`^${step}`) })).toBeVisible(),
          )
          await waitFor(() =>
            expect([...live.childNodes].map(shape)).toEqual([...restarted.childNodes].map(shape)),
          )
          await userEvent.click(next)
        }),
      Promise.resolve(),
    )
  },
}

/**
 * The folded line, step after step: the question keeps the whole width, nothing beside it; the
 * answer and its state sit under it, and Change stays where it was from Sent to Taken into account.
 */
export const ChangeStaysPut: Story = {
  render: (args) => <LiveAndRestarted {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const live = within(canvas.getByRole('region', { name: 'Live' }))
    const next = canvas.getByRole('button', { name: 'Next step' })
    await userEvent.click(next)
    const steps = ['Sent', 'With the Planner', 'Taken into account']
    const places = await steps.reduce<Promise<string[]>>(
      (before, step, index) =>
        before.then(async (seen) => {
          if (index > 0) await userEvent.click(next)
          await waitFor(() => expect(live.getByRole('status')).toHaveTextContent(step))
          const question = live.getByText(OPEN.text).getBoundingClientRect()
          const status = live.getByRole('status').getBoundingClientRect()
          const change = live
            .getByRole('button', { name: 'Change the answer to Q5' })
            .getBoundingClientRect()
          await expect(status.top).toBeGreaterThanOrEqual(question.bottom)
          await expect(change.top).toBeGreaterThanOrEqual(question.bottom)
          return [...seen, `${change.left},${change.top},${change.width}`]
        }),
      Promise.resolve([]),
    )
    await expect(new Set(places).size).toBe(1)
  },
}

/** An option pressed twice before the engine has it: sent once, the card folded at the first. */
export const AnsweringTwice: Story = {
  args: { onAnswer: fn(() => new Promise<void>(() => undefined)) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const option = canvas.getByRole('button', { name: /Only its owner/ })
    await userEvent.click(option)
    await userEvent.keyboard('{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledTimes(1)
    await foldedTo(canvasElement, 'B · Only its owner')
  },
}

/** The keyboard path: Tab reaches the options in order, Enter answers, the ring shows. */
export const AnsweringByKeyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const first = canvas.getByRole('button', { name: /Anyone who can read it/ })
    first.focus()
    await userEvent.tab()
    const second = canvas.getByRole('button', { name: /Only its owner/ })
    await expect(second).toHaveFocus()
    await expect(second.matches(':focus-visible')).toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith('Q5', { optionId: 'B' })
  },
}

/** In the user's own words, through the mention field that unfolds under the options. */
export const OwnWords: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const own = canvas.getByRole('button', { name: 'In my own words' })
    await userEvent.click(own)
    await expect(own).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Your answer to Q5' })).toBeVisible(),
    )
  },
}

/** An answer in the user's own words the engine refuses: the words stay, and why is said. */
export const OwnWordsRefused: Story = {
  loaders: EDITOR_LOADED,
  args: { onAnswer: fn(() => Promise.reject(new Error('Q5 is no longer open.'))) },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'In my own words' }))
    const field = await canvas.findByRole('textbox', { name: 'Your answer to Q5' })
    await writeAndSend(field, 'Only the team')
    await expect(args.onAnswer).toHaveBeenCalledWith('Q5', { text: 'Only the team' })
    const why = await canvas.findByRole('alert')
    await expect(why).toHaveTextContent('Not sent: Q5 is no longer open.')
    await expect(field).toHaveTextContent('Only the team')
  },
}

/** "I'm waiting on someone": a note, optional, and the question waits. */
export const MarkingWaiting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'I’m waiting on someone' }))
    const note = await canvas.findByLabelText('Who, or what, it waits on')
    await userEvent.type(note, 'The legal team')
    await userEvent.click(canvas.getByRole('button', { name: 'Wait' }))
    await expect(args.onWaitOnSomeone).toHaveBeenCalledWith('Q5', 'The legal team')
    // Taken: the note folds away.
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Wait' })).toBeNull())
  },
}

/**
 * Open, the question has its row to itself, as on the folded line: the dot with its word and the
 * waiting clock sit under it, aligned with its text, never beside it.
 */
export const QuestionOnItsRow: Story = {
  args: { question: byId('Q6') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const heading = canvas.getByRole('heading', { name: byId('Q6').text })
    const below = heading.getBoundingClientRect().bottom
    const left = heading.getBoundingClientRect().left
    const glyphs = [
      canvas.getByRole('img', { name: 'Not answered yet' }),
      canvas.getByRole('img', { name: 'Waiting on someone' }),
    ].map((glyph) => glyph.getBoundingClientRect())
    await expect(glyphs.map((glyph) => glyph.top >= below && glyph.left >= left)).toEqual([
      true,
      true,
    ])
    await expect(canvas.getByRole('status')).toHaveTextContent('Not answered yet')
  },
}

/** Waiting on someone: the glyph, the note, the drafted message with Copy and no Send. */
export const WaitingOnSomeone: Story = {
  args: { question: byId('Q6') },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Waiting on someone' })).toBeVisible()
    await expect(canvas.getByText(/Asked the support team/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Copy' }))
    await expect(args.onCopyDraft).toHaveBeenCalledWith(expect.stringMatching(/^Hello/))
    await expect(canvas.queryByRole('button', { name: 'Send' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: 'I’m waiting on someone' })).toBeNull()
  },
}

/** A changed answer, said as the change it is; the new one with the Planner. */
export const ChangedAnswer: Story = {
  args: { question: byId('Q2') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Now B, before A')).toBeVisible()
    await expect(canvas.getByRole('img', { name: /^With the Planner/ })).toBeVisible()
  },
}

/** Withdrawn by the Planner: kept, with its reason. */
export const Withdrawn: Story = {
  args: { question: byId('Q3') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Withdrawn: comments are not part of a note/)).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** Replaced by a later question: kept, with the link. */
export const Replaced: Story = {
  args: { question: byId('Q4') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Replaced by Q6')).toBeVisible()
  },
}

/** Made moot by a decision: kept, with the decision. */
export const Moot: Story = {
  args: { question: byId('Q7') },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Moot: D2/)).toBeVisible()
  },
}

/** Made moot by the decision of its discussion: the discussion is read again from it. */
export const MootAfterDiscussion: Story = {
  args: { question: byId('Q7'), discussed: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/Moot: D2/)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Open the discussion' }))
    await expect(args.onDiscuss).toHaveBeenCalledWith({ kind: 'question', id: 'Q7' })
  },
}

const PROPOSED: Question = {
  ...byId('Q6'),
  proposals: [
    {
      id: 'pa1',
      author: 'support-team',
      comment: 'The largest workspace holds 41 000 notes; the ten largest hold about 9 000 each.',
      text: 'B, 5 000 notes: the largest workspaces are well above it, most never reach it.',
    },
  ],
}

/** The ticket answered it: the Planner proposes the answer; Accept, Edit or Dismiss. */
export const ProposedFromTicket: Story = {
  args: { question: PROPOSED },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const proposal = canvas.getByRole('group', { name: 'Proposed from the ticket' })
    await expect(proposal).toHaveTextContent('support-team')
    await expect(proposal).toHaveTextContent('41 000 notes')
    const accept = within(proposal).getByRole('button', { name: 'Accept' })
    await userEvent.click(accept)
    await expect(args.onAcceptProposed).toHaveBeenCalledWith('pa1', null)
    const dismiss = within(proposal).getByRole('button', { name: 'Dismiss' })
    await userEvent.click(dismiss)
    await expect(args.onDismissProposed).toHaveBeenCalledWith('pa1')
    await settled(accept)
    await settled(dismiss)
  },
}

/** Edit: the proposed answer in the field, to change before it is accepted. */
export const ProposedEdited: Story = {
  args: { question: PROPOSED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const proposal = canvas.getByRole('group', { name: 'Proposed from the ticket' })
    await userEvent.click(within(proposal).getByRole('button', { name: 'Edit' }))
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Your answer to Q6' })).toHaveTextContent(
        /5 000 notes/,
      ),
    )
  },
}

/** A discussion is open on it: Discuss opens it again. */
export const Discussed: Story = {
  args: { discussed: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Open the discussion' }))
    await expect(args.onDiscuss).toHaveBeenCalledWith({ kind: 'question', id: 'Q5' })
  },
}

const LONG =
  'When the user exports a note whose title is a whole sentence written by someone who pasted the first paragraph of a meeting into the title field, '

/** Long text in every field: it wraps, nothing overflows the rail. */
export const LongText: Story = {
  args: {
    question: {
      ...OPEN,
      text: `${LONG}${OPEN.text}`,
      recommendedReason: `${LONG}${OPEN.recommendedReason}`,
      options: OPEN.options.map((option) =>
        Object.assign({}, option, { label: `${option.label}, ${LONG}` }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement).getByRole('article', { name: /Q5/ })
    await expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth)
  },
}
