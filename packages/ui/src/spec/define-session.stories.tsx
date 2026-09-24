import type { Meta, StoryObj } from '@storybook/react-vite'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Composer } from '../composer/composer.tsx'
import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { AgentText } from '../message/agent-text.tsx'
import { MessageGroup } from '../message/message.tsx'
import { MessageScroller, type ScrollerEntry } from '../message/scroller/scroller.tsx'
import { crossfade, useTransition } from '../motion.ts'
import { SessionHeader } from '../session/session.tsx'
import { CreateSpecProposal, type ProposalState } from './create-spec-proposal.tsx'
import { MissionBrief } from './mission-brief.tsx'
import type { ReaderView, SpecType, SpecView } from './model.ts'
import {
  BUG,
  CONFLICT,
  GATE_FULL,
  JUST_CREATED,
  MID_PLAN,
  ONE_QUESTION_LEFT,
  READER,
  READY,
  SCOPE_MINE,
  STALE,
} from './spec-fixtures.ts'
import { useLiveSpec } from './spec-harness.tsx'
import { SpecPanel } from './spec-panel.tsx'
import { SpecQuestion } from './spec-question.tsx'

/**
 * A `define` Session: the chat on the left, the Spec panel beside it (lot 19, the screens of the
 * brief, revision 2).
 *
 * The chat is the thread and the composer of the Session page, as they are; what `define` adds
 * to it is the thin Hemera line that says what the agent was handed this turn, and the questions
 * of the Spec, asked there and answered there. The panel takes the side column's place — there
 * is no side column while it is there. It opens folded to a band of glyphs, so the chat has the
 * width (brief revision 4): a screen that shows the panel's state opens it unfolded, and a path
 * unfolds it first, the way a hand does.
 * A `define` Session never exists without its Spec: it starts from a Spec, or from a `free`
 * Session whose agent proposes one. Every screen is the same Spec, `ATL-7`, taken through its
 * states, consistent with the product rules: no task before `decompose`, a full gate only once
 * every phase is finished.
 */

const AT = 'Today at'

/** A message of yours, as the thread draws one. */
function yours(id: string, at: string, body: string): ScrollerEntry {
  return {
    id,
    mark: body,
    content: (
      <MessageGroup
        author="user"
        name="You"
        at={at}
        atLabel={`${AT} ${at}`}
        state="saved"
        lines={[{ id: `${id}-1`, body }]}
      />
    ),
  }
}

/** What the agent said, as the thread draws it. */
function agents(id: string, text: string): ScrollerEntry {
  return { id, content: <AgentText text={text} /> }
}

/** A Hemera line of the thread. */
function hemera(id: string, title: string, detail: string, brief?: string): ScrollerEntry {
  return { id, content: <MissionBrief title={title} detail={detail} brief={brief} /> }
}

const ASK = yours(
  'ask',
  '10:31',
  'Accountants need a month of invoices as one CSV they can import into their ledger, from the billing page.',
)

const PLAN_BRIEF =
  '**Plan** · analyse the code and fix the technical approach of `ATL-7`, its risks and how it is verified. Shape is finished; one blocking question is open.\n\nSince the last turn you edited **Scope** (v4).'

/** What each screen has in its thread, the questions asked there, and its Spec. */
interface Screen {
  title: string
  thread: ScrollerEntry[]
  /** The questions of the Spec asked at the end of the thread, by id. */
  asks?: string[] | undefined
  spec: SpecView
  reader?: ReaderView | undefined
}

const SCREENS = {
  midPlan: {
    title: 'Spec CSV',
    spec: MID_PLAN,
    asks: ['q-credit-notes'],
    thread: [
      ASK,
      hemera('brief', 'Mission brief · plan', '10:44', PLAN_BRIEF),
      agents(
        'answer',
        'Shape is finished: the problem, the outcome, the scope and two stories are in the Spec. I am writing the plan: the export can reuse the invoice query of `export.service.ts` and stream its rows.\n\nOne question blocks the plan:',
      ),
    ],
  },
  bug: {
    title: 'Rounding bug',
    spec: BUG,
    asks: ['q-rounding'],
    thread: [
      yours(
        'ask',
        '09:12',
        'Multi-currency invoices are off by a cent. Accounting saw it on the September close.',
      ),
      hemera('brief', 'Mission brief · shape', '09:12', '**Shape** · frame the need of `ATL-12`.'),
      agents(
        'answer',
        'I reproduced it on the demo data and wrote the steps under Reproduction. You changed the amounts of step 1; I keep yours.\n\nOne question before the plan:',
      ),
    ],
  },
  gateFull: {
    title: 'Spec CSV',
    spec: GATE_FULL,
    thread: [
      ASK,
      hemera('brief', 'Mission brief · decompose', '11:20', '**Decompose** · slice `ATL-7`.'),
      agents(
        'answer',
        'Decompose is finished: four tasks, each one a slice that can be verified alone, the last one yours: checking the file imports into the ledger.\n\nI attest the contract is complete and a build can run it without inventing a decision. Marking it ready is yours.',
      ),
    ],
  },
  lastQuestion: {
    title: 'Spec CSV',
    spec: ONE_QUESTION_LEFT,
    asks: ['q-credit-notes'],
    thread: [
      ASK,
      hemera('brief', 'Mission brief · decompose', '11:20', '**Decompose** · slice `ATL-7`.'),
      agents(
        'answer',
        'Decompose is finished and I attest the contract. One question is still yours before it can be marked ready:',
      ),
    ],
  },
  ready: {
    title: 'Spec CSV',
    spec: READY,
    thread: [
      ASK,
      hemera('ready', 'ATL-7 marked ready · rev 2', '11:34'),
      agents(
        'answer',
        'The Spec is frozen at revision 2. A build Session can start from it. I can no longer change it unless you rework it.',
      ),
    ],
  },
  reader: {
    title: 'Billing review',
    spec: READER,
    reader: { writer: 'Spec CSV', takeOverRefused: null },
    thread: [
      yours('ask', '14:05', 'What does ATL-7 say about credit notes?'),
      agents(
        'answer',
        'Story S2 covers them: negative rows in the same file, marked by a `type` column. Its second criterion says the file total must still equal the billing page total for the month.\n\nI only read it: « Spec CSV » writes it.',
      ),
    ],
  },
  conflict: {
    title: 'Spec CSV',
    spec: CONFLICT,
    thread: [
      ASK,
      hemera('brief', 'Mission brief · plan', '10:44', PLAN_BRIEF),
      agents(
        'answer',
        'I rewrote Scope (v5): payments stay out, and the currency column moved to Verification.',
      ),
    ],
  },
  stale: {
    title: 'Spec CSV',
    spec: STALE,
    thread: [
      ASK,
      hemera('rework', 'ATL-7 reworked · rev 3', '« credit notes keep their invoice number »'),
      agents(
        'answer',
        'Revision 3 is a full copy of 2. The reason touches the plan and the tasks, so I am declaring both again; shape still holds.',
      ),
    ],
  },
} satisfies Record<string, Screen>

type ScreenName = keyof typeof SCREENS | 'fromFree'

/** Where the thread of a question is: the id its block is found by. */
function askId(id: string): string {
  return `ask-${id}`
}

/** Takes the thread to where a question is asked, and the keyboard to its first answer. */
function goToQuestion(id: string): void {
  const block = document.getElementById(askId(id))
  block?.scrollIntoView({ block: 'center' })
  block?.querySelector('button')?.focus()
}

/** The chat of a Session: its head, its thread and its composer. */
function Chat({
  title,
  mission,
  thread,
}: {
  title: string
  mission: 'FREE' | 'DEFINE'
  thread: ScrollerEntry[]
}): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex w-full flex-col px-6 pt-6 pb-4">
        <SessionHeader
          title={title}
          projectName="Atlas"
          meta={`${mission} · Claude Code · Sonnet 5`}
          onRename={fn()}
          onStartEditing={fn()}
          onArchive={fn()}
        />
      </div>
      <MessageScroller className="flex-1" label="The thread of this Session" entries={thread} />
      <div className="flex w-full flex-col px-6 pb-4">
        <Composer
          value={value}
          onValueChange={setValue}
          files={files}
          onFilesChange={setFiles}
          onSearchFiles={() => Promise.resolve([])}
          variant="inline"
          action="Send"
          placeholder="Answer, or ask the agent…"
          onSend={() => Promise.resolve(null)}
        />
      </div>
    </div>
  )
}

/** The actions a story reports, for the paths that assert on them. */
const ON = {
  onSaveSection: fn(),
  onApplyMine: fn(),
  onDiscardMine: fn(),
  onSaveStory: fn(),
  onAnswer: fn(),
  onGoToQuestion: goToQuestion,
  onMarkReady: fn(),
  onRework: fn(),
  onPickRevision: fn(),
  onTakeOver: fn(),
}

/**
 * A `define` Session held together as the renderer will hold it: the Spec is held once, and both
 * the panel and the questions of the thread read it and write it.
 */
function DefineSession({
  shown,
  reworkOpen,
  folded,
}: {
  shown: Screen
  reworkOpen: boolean
  folded: boolean
}): ReactNode {
  const { spec, reader, actions } = useLiveSpec(shown.spec, shown.reader, ON)
  const asked: ScrollerEntry[] = (shown.asks ?? []).flatMap((id) => {
    const question = spec.questions.find((one) => one.id === id)
    if (question === undefined) return []
    return [
      {
        id: askId(id),
        content: (
          <div id={askId(id)}>
            <SpecQuestion question={question} onAnswer={(answer) => actions.onAnswer(id, answer)} />
          </div>
        ),
      },
    ]
  })
  return (
    // The row is the container the unfolded panel's width is a share of.
    <div className="@container flex h-screen min-h-0 bg-background text-foreground">
      <Chat title={shown.title} mission="DEFINE" thread={[...shown.thread, ...asked]} />
      <SpecPanel
        spec={spec}
        reader={reader}
        defaultReworkOpen={reworkOpen}
        defaultFolded={folded}
        onSaveSection={actions.onSaveSection}
        onApplyMine={actions.onApplyMine}
        onDiscardMine={actions.onDiscardMine}
        onSaveStory={actions.onSaveStory}
        onGoToQuestion={actions.onGoToQuestion}
        onMarkReady={actions.onMarkReady}
        onRework={actions.onRework}
        onPickRevision={actions.onPickRevision}
        onTakeOver={actions.onTakeOver}
      />
    </div>
  )
}

/**
 * A `free` Session whose agent proposes a Spec: on `Create` the Session becomes `define`, the
 * Spec exists, and the panel arrives beside the thread — a cross-fade, nothing travelling — while
 * the thread stays exactly as it was.
 */
function FreeThenDefine(): ReactNode {
  const transition = useTransition(crossfade)
  const [state, setState] = useState<ProposalState>('proposed')
  const [created, setCreated] = useState<SpecView | null>(null)
  const thread: ScrollerEntry[] = [
    ASK,
    agents(
      'answer',
      'That is a feature of its own: an export from the billing page, one file per month, in the order the ledger imports. Shall I write it down as a Spec?',
    ),
    {
      id: 'proposal',
      content: (
        <CreateSpecProposal
          title="CSV invoice export"
          type="feature"
          state={state}
          createdKey="ATL-7"
          onCreate={(title: string, type: SpecType) => {
            setState('created')
            setCreated({ ...JUST_CREATED, title, type })
          }}
          onDecline={() => setState('declined')}
        />
      ),
    },
  ]
  return (
    <div className="@container flex h-screen min-h-0 bg-background text-foreground">
      <Chat
        title="Invoices for the accountants"
        mission={created === null ? 'FREE' : 'DEFINE'}
        thread={thread}
      />
      <AnimatePresence initial={false}>
        {created !== null && (
          <motion.div
            key="panel"
            className="flex shrink-0"
            initial={{ filter: 'opacity(0)' }}
            animate={{ filter: 'opacity(1)' }}
            transition={transition}
          >
            <SpecPanel
              spec={created}
              onSaveSection={fn()}
              onApplyMine={fn()}
              onDiscardMine={fn()}
              onSaveStory={fn()}
              onGoToQuestion={fn()}
              onMarkReady={fn()}
              onRework={fn()}
              onPickRevision={fn()}
              onTakeOver={fn()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** One screen of the brief, by name. */
function Screens({
  screen,
  reworkOpen = false,
  folded = true,
}: {
  screen: ScreenName
  reworkOpen?: boolean
  /** Whether the panel opens folded to its band, as a Session opens it. */
  folded?: boolean
}): ReactNode {
  return (
    <TooltipProvider>
      {screen === 'fromFree' ? (
        <FreeThenDefine />
      ) : (
        <DefineSession shown={SCREENS[screen]} reworkOpen={reworkOpen} folded={folded} />
      )}
    </TooltipProvider>
  )
}

const meta = {
  title: 'Surfaces/Session/Define',
  component: Screens,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'fullscreen' },
  args: { screen: 'midPlan' },
  argTypes: {
    screen: {
      control: 'select',
      options: [...Object.keys(SCREENS), 'fromFree'],
      description: 'Which screen of the brief.',
    },
    reworkOpen: { control: 'boolean', description: 'Whether the rework dialog starts open.' },
    folded: { control: 'boolean', description: 'Whether the panel opens folded to its band.' },
  },
} satisfies Meta<typeof Screens>

export default meta

type Story = StoryObj<typeof meta>

/*
 * The screens first, each named after the state it shows and each left as it opens: its play
 * asserts and changes nothing, so the screen the gate looks at is the screen as drawn. A Session
 * opens its panel folded; a screen that shows the panel's own state opens it unfolded. The paths
 * through them — a link followed, a Spec marked ready, reworked, taken over, a conflict applied,
 * a question answered in the chat — are stories of their own, named after what they do, and
 * start from the folded panel a Session opens on: the hand unfolds it first.
 */

/** The hand unfolding the panel from its band, and the sheet once it is open. */
async function unfold(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: 'Unfold the Spec' }))
  await canvas.findByRole('region', { name: 'Stage of ATL-7' })
}

/**
 * Screen 1 · a feature being planned, as the Session opens it: the chat has the width, the panel
 * a band beside it — the glyph of each part with its dot, the plan the agent writes breathing,
 * `Plan` open and three checks of seven. The thread says what the agent was handed in one folded
 * Hemera line, and asks the blocking question as a block.
 */
export const MidPlan: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /Mission brief · plan/ })).toBeVisible()
    const band = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(
      within(band).getByRole('img', { name: 'Readiness, 3 of 7 checks pass' }),
    ).toHaveTextContent('3/7')
    await expect(within(band).getByRole('button', { name: 'Plan phase, open' })).toBeVisible()
    await expect(within(band).getByRole('button', { name: 'Plan, being written' })).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(within(band).getByRole('button', { name: 'Tasks, 0, not written' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Unfold the Spec' })).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'Stage of ATL-7' })).toBeNull()
    await expect(canvas.getByRole('group', { name: /^Question: Credit notes/ })).toBeVisible()
  },
}

/**
 * Unfolded, then a thing left before ready followed from the rail's foot: the tasks, not written
 * yet, on the stage.
 */
export const MidPlanLinkFollowed: Story = {
  play: async ({ canvasElement }) => {
    await unfold(canvasElement)
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Plan · the agent is writing the plan')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: '4 things before ready' }))
    await userEvent.click(await within(document.body).findByRole('button', { name: 'the tasks' }))
    await expect(canvas.getByRole('button', { name: /^Tasks/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    const stage = canvas.getByRole('region', { name: 'Stage of ATL-7' })
    await expect(within(stage).getByRole('heading', { name: /^Tasks · 0/ })).toBeVisible()
    await expect(canvas.getByText(/Tasks are written in Decompose/)).toBeVisible()
  },
}

/** A question answered in the chat: the register records it, and the gate stops naming it. */
export const MidPlanQuestionAnswered: Story = {
  play: async ({ canvasElement }) => {
    await unfold(canvasElement)
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Questions/ }))
    await userEvent.click(canvas.getByRole('button', { name: /^Answer in the chat: Credit/ }))
    const recommended = canvas.getByRole('button', { name: /recommended/ })
    await expect(recommended).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.queryByRole('button', { name: /^Answer in the chat/ })).toBeNull()
    await expect(canvas.getByRole('heading', { name: /^Questions · 0 open/ })).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'Readiness, 4 of 7 checks pass' })).toBeVisible()
  },
}

/** Screen 2 · a bug: its Shape has Reproduction, and Behaviour is never drawn. */
export const Bug: Story = {
  args: { screen: 'bug', folded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('heading', { name: /^Reproduction/ })).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: /^Behaviour/ })).toBeNull()
    await expect(canvas.getByText('sent to the agent next turn')).toBeVisible()
    await expect(canvas.getByRole('group', { name: /^Question: Is the total/ })).toBeVisible()
  },
}

/**
 * Screen 3 · from a free Session: the agent proposes the Spec in the thread, `Create` makes the
 * Session `define`, and the panel arrives beside the thread, folded to its band, while the thread
 * stays.
 */
export const FromAFreeSession: Story = {
  args: { screen: 'fromFree' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/FREE · Claude Code/)).toBeVisible()
    await expect(canvas.queryByRole('region', { name: 'Spec ATL-7' })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Create' }))
    await expect(await canvas.findByRole('region', { name: 'Spec ATL-7' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Unfold the Spec' })).toBeVisible()
    await expect(canvas.getByText(/DEFINE · Claude Code/)).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent('Created ATL-7')
    await expect(canvas.getByText(/Shall I write it down as a Spec/)).toBeVisible()
  },
}

/** Screen 4 · every check passes: `Ready to freeze`, and `Mark ready` offered. */
export const GateFull: Story = {
  args: { screen: 'gateFull', folded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Ready to freeze')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Mark ready' })).toBeEnabled()
    await expect(canvas.getByRole('heading', { name: /^Tasks · 4/ })).toBeVisible()
  },
}

/** Mark ready pressed: the Spec is frozen, the document read only, and Rework appears. */
export const GateFullMarkedReady: Story = {
  args: { screen: 'gateFull' },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement)
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Mark ready' }))
    await expect(canvas.getByRole('button', { name: 'Rework' })).toBeVisible()
    await expect(canvas.getByText(/Frozen on today/)).toBeVisible()
    await expect(canvas.queryByRole('textbox', { name: 'Problem' })).toBeNull()
    // It leaves the way it came, and is gone once it has.
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull())
  },
}

/**
 * Mark ready appearing: the last blocking question answered in the chat, the bar fills, the
 * foot reads `Ready to freeze` and `Mark ready` is offered — and pressed.
 */
export const LastQuestionAnswered: Story = {
  args: { screen: 'lastQuestion' },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement)
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull()
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Something else' }),
      'Negative rows, marked by a type column.{Enter}',
    )
    await expect(canvas.getByRole('img', { name: 'Readiness, 7 of 7 checks pass' })).toBeVisible()
    await expect(canvas.getByText('Ready to freeze')).toBeVisible()
    await expect(
      canvas.getByText('Negative rows, marked by a type column.', { selector: 'p' }),
    ).toBeVisible()
    const mark = await canvas.findByRole('button', { name: 'Mark ready' })
    mark.focus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('button', { name: 'Rework' })).toBeVisible()
  },
}

/**
 * Screen 5 · ready and frozen at revision 2: no editing look, the picker of the revisions, and
 * Rework at the end of the head.
 */
export const ReadyFrozen: Story = {
  args: { screen: 'ready', folded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByText('frozen').length).toBeGreaterThan(0)
    await expect(canvas.queryByRole('textbox', { name: 'Expected outcome' })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'rev 2' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Rework' })).toBeVisible()
  },
}

/** Screen 5, with the rework dialog open over the frozen Spec, as the brief draws it. */
export const ReworkAsked: Story = {
  args: { screen: 'ready', reworkOpen: true, folded: false },
  play: async () => {
    const page = within(document.body)
    await expect(await page.findByRole('dialog', { name: 'Rework ATL-7' })).toBeVisible()
  },
}

/**
 * Rework, with no reason given: the whole contract copied into revision 3, a draft again whose
 * plan and tasks are stale.
 */
export const ReadyReworked: Story = {
  args: { screen: 'ready' },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement)
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Rework' }))
    const page = within(document.body)
    // The dialog rises into place; what is asked is where it ends.
    const says = await page.findByText(
      'A complete copy becomes revision 3; revision 2 stays as it is.',
    )
    await waitFor(() => expect(says).toBeVisible())
    await userEvent.click(page.getByRole('button', { name: 'Rework' }))
    await waitFor(() => expect(canvas.getByRole('button', { name: 'rev 3' })).toBeVisible())
    await expect(canvas.getByText('Rework · the agent re-declares each phase')).toBeVisible()
  },
}

/**
 * Screen 6 · the draft read from a second Session: the quiet bar with `Take over` under the head;
 * the agent of this Session does not write, and you still edit in place.
 */
export const Reader: Story = {
  args: { screen: 'reader', folded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('« Spec CSV »')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Take over' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Tasks, 3, being written' })).toHaveAttribute(
      'aria-current',
      'true',
    )
  },
}

/** A reader opens the stories, edits one in place, saved on blur, then takes the right over. */
export const ReaderEditsThenTakesOver: Story = {
  args: { screen: 'reader' },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement)
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /^Stories/ }))
    await expect(canvas.getByText('you can edit; the agent of the writer is told')).toBeVisible()
    const narrative = canvas.getByRole('textbox', { name: 'Narrative of S2' })
    await userEvent.click(narrative)
    await userEvent.keyboard('{Control>}{End}{/Control} Each keeps its invoice number.')
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Stories, 2, edited by you' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Take over' }))
    await expect(canvas.queryByText('« Spec CSV »')).toBeNull()
  },
}

/**
 * Screen 7 · a conflict keeps the human's text: the banner inside Scope and your text in the
 * editor, whole; Scope is the part in focus.
 */
export const Conflict: Story = {
  args: { screen: 'conflict', folded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Your text was written on v3; the section is at v5.'),
    ).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: /^Scope ?, your text/ })).toHaveValue(
      SCOPE_MINE,
    )
    await expect(
      canvas.getByRole('heading', { name: /^Scope ?, in conflict with your text/ }),
    ).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'Readiness, 3 of 7 checks pass' })).toBeVisible()
  },
}

/** Conflict actions: the agent's version on Compare, then yours applied on top of it. */
export const ConflictApplied: Story = {
  args: { screen: 'conflict' },
  play: async ({ canvasElement }) => {
    await unfold(canvasElement)
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Compare' }))
    await expect(canvas.getByText('v5 · agent')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Apply mine on v5' }))
    await expect(canvas.queryByRole('group', { name: 'Conflict' })).toBeNull()
    await expect(canvas.getByRole('heading', { name: /^Scope ?, edited by you/ })).toBeVisible()
    await expect(canvas.getByText('v6')).toBeVisible()
  },
}

/**
 * Screen 8 · after a rework: the Plan and Decompose groups of the rail in amber, their rows
 * stale, the plan copied from revision 2 on the stage, and the one sentence saying the agent
 * declares them again.
 */
export const StaleAfterRework: Story = {
  args: { screen: 'stale', folded: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Rework · the agent re-declares each phase')).toBeVisible()
    const rail = canvas.getByRole('navigation', { name: 'Parts of ATL-7' })
    await expect(within(rail).getByRole('group', { name: 'Plan' })).toHaveTextContent('stale')
    await expect(within(rail).getByRole('group', { name: 'Decompose' })).toHaveTextContent('stale')
    await expect(
      canvas.getByRole('button', { name: 'Tasks, 4, stale after the rework' }),
    ).toBeVisible()
    await expect(canvas.getByText('copied from rev 2')).toBeVisible()
    await expect(canvas.getByRole('button', { name: '2 things before ready' })).toBeVisible()
  },
}
