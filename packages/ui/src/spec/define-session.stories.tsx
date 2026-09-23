import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Composer } from '../composer/composer.tsx'
import { TooltipProvider } from '../components/tooltip/tooltip.tsx'
import { AgentText } from '../message/agent-text.tsx'
import { MessageGroup } from '../message/message.tsx'
import { MessageScroller, type ScrollerEntry } from '../message/scroller/scroller.tsx'
import { SessionHeader } from '../session/session.tsx'
import { MissionBrief } from './mission-brief.tsx'
import type { ReaderView, SpecView, StageItem } from './model.ts'
import { NoSpecYet } from './no-spec-yet.tsx'
import {
  BUG,
  CONFLICT,
  DRAFTS,
  GATE_FULL,
  MID_PLAN,
  READER,
  READY,
  SCOPE_MINE,
  STALE,
} from './spec-fixtures.ts'
import { LiveSpecPanel } from './spec-harness.tsx'

/**
 * A `define` Session: the chat on the left, the Spec panel beside it (lot 19, the eight screens
 * of the brief).
 *
 * The chat is the thread and the composer of the Session page, as they are; what `define` adds
 * to it is the thin Hemera line that says what the agent was handed this turn. The panel takes
 * the side column's place — there is no side column while it is there — and has its own scroll.
 * Every screen is the same Spec, `ATL-7`, taken through its states, and each is consistent with
 * the product rules: no task before `decompose`, a full gate only once every phase is finished.
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

/** What each screen of the brief has in its thread, and what the Session is called. */
interface Screen {
  title: string
  thread: ScrollerEntry[]
  spec?: SpecView | undefined
  reader?: ReaderView | undefined
  item?: StageItem | undefined
}

const SCREENS = {
  midPlan: {
    title: 'Spec CSV',
    spec: MID_PLAN,
    item: 'questions',
    thread: [
      ASK,
      hemera('brief', 'Mission brief · plan', '10:44', PLAN_BRIEF),
      agents(
        'answer',
        'Shape is finished: the problem, the outcome, the scope and two stories are in the Spec. I am writing the plan: the export can reuse the invoice query of `export.service.ts` and stream its rows.\n\nOne question blocks the plan. **Credit notes**: negative rows in the same file, or left out? I recommend negative rows, so the file total matches the ledger.',
      ),
    ],
  },
  bug: {
    title: 'Rounding bug',
    spec: BUG,
    item: 'reproduction',
    thread: [
      yours(
        'ask',
        '09:12',
        'Multi-currency invoices are off by a cent. Accounting saw it on the September close.',
      ),
      hemera('brief', 'Mission brief · shape', '09:12', '**Shape** · frame the need of `ATL-12`.'),
      agents(
        'answer',
        'I reproduced it on the demo data and wrote the steps under Reproduction. You changed the amounts of step 1; I keep yours.\n\nOne question before the plan: is the total the sum of the lines as printed, or one rounding of the raw amounts? I recommend the sum of the lines: it is what the PDF prints today.',
      ),
    ],
  },
  empty: {
    title: 'Untitled',
    thread: [
      hemera('mission', 'Mission · define', '11:02'),
      yours('ask', '11:02', 'Let us write down the cent-rounding bug accounting found.'),
      agents(
        'answer',
        'This Session has no Spec yet. Create one from what you said, or join a draft: **ATL-12**, written in « Rounding bug », looks like the same one.',
      ),
    ],
  },
  gateFull: {
    title: 'Spec CSV',
    spec: GATE_FULL,
    item: 'tasks',
    thread: [
      ASK,
      hemera('brief', 'Mission brief · decompose', '11:20', '**Decompose** · slice `ATL-7`.'),
      agents(
        'answer',
        'Decompose is finished: four tasks, each one a slice that can be verified alone, the last one yours: checking the file imports into the ledger.\n\nI attest the contract is complete and a build can run it without inventing a decision. Marking it ready is yours.',
      ),
    ],
  },
  ready: {
    title: 'Spec CSV',
    spec: READY,
    item: 'expected_outcome',
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
    reader: { writer: 'Spec CSV' },
    item: 'stories',
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
    item: 'scope',
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
    item: 'plan',
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

type ScreenName = keyof typeof SCREENS

/**
 * The Session, held together as the renderer will hold it: the composer's words are the
 * story's own, and the panel stands in for the engine with `LiveSpecPanel`.
 */
function DefineSession({
  screen,
  reworkOpen = false,
}: {
  screen: ScreenName
  reworkOpen?: boolean
}): ReactNode {
  const shown: Screen = SCREENS[screen]
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  return (
    <TooltipProvider>
      <div className="flex h-screen min-h-0 bg-background text-foreground">
        <div className="flex min-h-0 min-w-0 basis-11/20 flex-col">
          <div className="flex w-full flex-col px-6 pt-6 pb-4">
            <SessionHeader
              title={shown.title}
              projectName="Atlas"
              meta="DEFINE · Claude Code · Sonnet 5"
              onRename={fn()}
              onStartEditing={fn()}
              onArchive={fn()}
            />
          </div>
          <MessageScroller
            className="flex-1"
            label="The thread of this Session"
            entries={shown.thread}
          />
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
        <div className="min-h-0 min-w-0 basis-9/20 border-l border-border">
          {shown.spec === undefined ? (
            <div className="h-full bg-surface-content">
              <NoSpecYet projectName="Atlas" drafts={DRAFTS} onCreate={fn()} onJoin={fn()} />
            </div>
          ) : (
            <LiveSpecPanel
              spec={shown.spec}
              reader={shown.reader}
              defaultItem={shown.item}
              defaultReworkOpen={reworkOpen}
              onSaveSection={fn()}
              onApplyMine={fn()}
              onDiscardMine={fn()}
              onSaveStory={fn()}
              onAnswer={fn()}
              onMarkReady={fn()}
              onRework={fn()}
              onPickRevision={fn()}
              onTakeOver={fn()}
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

const meta = {
  title: 'Surfaces/Session/Define',
  component: DefineSession,
  tags: ['autodocs', 'new'],
  parameters: { layout: 'fullscreen' },
  args: { screen: 'midPlan' },
  argTypes: {
    screen: {
      control: 'select',
      options: Object.keys(SCREENS),
      description: 'Which of the eight screens of the brief.',
    },
    reworkOpen: { control: 'boolean', description: 'Whether the rework dialog starts open.' },
  },
} satisfies Meta<typeof DefineSession>

export default meta

type Story = StoryObj<typeof meta>

/*
 * The eight screens first, each named after the state it shows and each left as it opens: its
 * play asserts and changes nothing, so the screen the gate looks at is the screen as drawn. The
 * paths through them — the outline walked, a Spec marked ready, reworked, taken over, a conflict
 * applied — are stories of their own, named after what they do.
 */

/**
 * Screen 1 · a feature being planned: shape finished, plan open with the pulse in the outline,
 * one blocking question on the stage, three checks of seven — no task exists before Decompose.
 * The thread says what the agent was handed in one folded Hemera line.
 */
export const MidPlan: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /Mission brief · plan/ })).toBeVisible()
    await expect(canvas.getByRole('group', { name: 'Readiness, 3 of 7 checks pass' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Plan, being written' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Tasks, 0, not written' })).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Questions' })).toBeVisible()
    await expect(canvas.getByText('Plan · the agent is writing the plan')).toBeVisible()
  },
}

/** Outline navigation: the keyboard walks the outline and opens the tasks, not written yet. */
export const MidPlanOutlineWalked: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const tasks = canvas.getByRole('button', { name: 'Tasks, 0, not written' })
    const questions = canvas.getByRole('button', { name: /^Questions, 1/ })
    questions.focus()
    await userEvent.keyboard('{ArrowUp}')
    await expect(tasks).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('heading', { name: 'Tasks' })).toBeVisible()
    await expect(canvas.getByText(/Tasks are written in Decompose/)).toBeVisible()
  },
}

/** Screen 2 · a bug: its contract has Reproduction, and Behaviour is never drawn. */
export const Bug: Story = {
  args: { screen: 'bug' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const outline = canvas.getByRole('navigation', { name: 'Outline of ATL-12' })
    await expect(within(outline).getByRole('button', { name: /^Reproduction/ })).toBeVisible()
    await expect(within(outline).queryByRole('button', { name: /^Behaviour/ })).toBeNull()
    await expect(canvas.getByText('sent to the agent next turn')).toBeVisible()
    await expect(canvas.getByText(/and 2 more/)).toBeVisible()
  },
}

/** Screen 3 · a `define` Session with no Spec: create one, or join a draft of Atlas. */
export const Empty: Story = {
  args: { screen: 'empty' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'This Session defines a Spec.' }),
    ).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Create a Spec' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Drafts in Atlas' })).toBeVisible()
  },
}

/** Screen 4 · every check passes: `Ready to freeze`, and `Mark ready` offered. */
export const GateFull: Story = {
  args: { screen: 'gateFull' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Ready to freeze')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Mark ready' })).toBeEnabled()
    await expect(canvas.getByText('4 tasks, 1 for you')).toBeVisible()
  },
}

/** Mark ready pressed: the Spec is frozen, the stage read only, and Rework appears. */
export const GateFullMarkedReady: Story = {
  args: { screen: 'gateFull' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Mark ready' }))
    await expect(canvas.getByRole('button', { name: 'Rework' })).toBeVisible()
    await expect(canvas.getByText(/Frozen on today/)).toBeVisible()
    // It leaves the way it came, and is gone once it has.
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'Mark ready' })).toBeNull())
  },
}

/**
 * Screen 5 · ready and frozen at revision 2: no editing look, the picker of the revisions, and
 * Rework at the end of the head.
 */
export const ReadyFrozen: Story = {
  args: { screen: 'ready' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const stage = canvas.getByRole('heading', { name: 'Expected outcome' }).parentElement!
    await expect(within(stage).getByText('frozen')).toBeVisible()
    await expect(canvas.queryByRole('textbox', { name: 'Expected outcome' })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'rev 2' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Rework' })).toBeVisible()
  },
}

/** Screen 5, with the rework dialog open over the frozen Spec, as the brief draws it. */
export const ReworkAsked: Story = {
  args: { screen: 'ready', reworkOpen: true },
  play: async () => {
    const page = within(document.body)
    await expect(await page.findByRole('dialog', { name: 'Rework ATL-7' })).toBeVisible()
  },
}

/**
 * Rework: the reason asked for, then the whole contract copied into revision 3, a draft again
 * whose plan and tasks are stale.
 */
export const ReadyReworked: Story = {
  args: { screen: 'ready' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Rework' }))
    const page = within(document.body)
    // The dialog rises into place; what is asked is where it ends.
    const says = await page.findByText(
      'A complete copy becomes revision 3; revision 2 stays as it is.',
    )
    await waitFor(() => expect(says).toBeVisible())
    await userEvent.type(
      page.getByRole('textbox', { name: 'Reason' }),
      'Credit notes must keep the number of their invoice{Enter}',
    )
    await waitFor(() => expect(canvas.getByRole('button', { name: 'rev 3' })).toBeVisible())
    await expect(canvas.getByText('Rework · the agent re-declares each phase')).toBeVisible()
  },
}

/**
 * Screen 6 · the draft read from a second Session: the quiet bar with `Take over`; the agent of
 * this Session does not write, and you still edit in place.
 */
export const Reader: Story = {
  args: { screen: 'reader' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('« Spec CSV »')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Take over' })).toBeVisible()
    await expect(canvas.getByText('you can edit; the agent of the writer is told')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Tasks, 3, being written' })).toBeVisible()
  },
}

/** A reader edits a story in place, saved on blur, then takes the write right over. */
export const ReaderEditsThenTakesOver: Story = {
  args: { screen: 'reader' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
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
 * editor, whole.
 */
export const Conflict: Story = {
  args: { screen: 'conflict' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByText('Your text was written on v3; the section is at v5.'),
    ).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Scope, your text' })).toHaveValue(SCOPE_MINE)
    await expect(
      canvas.getByRole('button', { name: 'Scope, in conflict with your text' }),
    ).toBeVisible()
    await expect(canvas.getByRole('group', { name: 'Readiness, 3 of 7 checks pass' })).toBeVisible()
  },
}

/** Conflict actions: the agent's version on Compare, then yours applied on top of it. */
export const ConflictApplied: Story = {
  args: { screen: 'conflict' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Compare' }))
    await expect(canvas.getByText('v5 · agent')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Apply mine on v5' }))
    await expect(canvas.queryByRole('group', { name: 'Conflict' })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Scope, edited by you' })).toBeVisible()
    await expect(canvas.getByText('v6')).toBeVisible()
  },
}

/**
 * Screen 8 · after a rework: plan and decompose stale on the rail, their rows amber, the plan
 * copied from revision 2, and the one sentence saying the agent declares them again.
 */
export const StaleAfterRework: Story = {
  args: { screen: 'stale' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Rework · the agent re-declares each phase')).toBeVisible()
    await expect(canvas.getAllByText('rework')).toHaveLength(2)
    await expect(canvas.getByRole('button', { name: 'Plan, stale after the rework' })).toBeVisible()
    await expect(
      canvas.getByRole('button', { name: 'Tasks, 4, stale after the rework' }),
    ).toBeVisible()
    await expect(canvas.getByText('copied from rev 2')).toBeVisible()
    await expect(canvas.getByText(/2 things before ready/)).toBeVisible()
  },
}
