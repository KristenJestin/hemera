import type { ReactNode } from 'react'

import { HemeraToolCall } from '../../activity/hemera-tool-call.tsx'
import { IconPaperclip } from '../../icons.ts'
import { AgentText } from '../../message/agent-text.tsx'
import { MessageGroup } from '../../message/message.tsx'
import type { ScrollerEntry } from '../../message/scroller/scroller.tsx'
import { MissionBrief } from '../../spec/mission-brief.tsx'
import type { SpecView, StoryView } from '../../spec/model.ts'
import { CREDIT_NOTES, MID_PLAN, STORIES } from '../../spec/spec-fixtures.ts'
import { SpecQuestion } from '../../spec/spec-question.tsx'
import type {
  AgentState,
  Attention,
  BuildProgressView,
  Restatement,
  StoryProgress,
} from './model.ts'
import { Restatements } from './restatements.tsx'

/**
 * The Sessions the exploration lays out, one per moment: a `free` one, a `define` one on `ATL-7`,
 * and the build of the same Spec — building, blocked, waiting for the user's review, and the
 * review restated. The same Spec and the same words as the lot-19 and lot-22 stories, so that what
 * changes from one variant to the next is the layout and nothing else.
 */

type Mission = 'free' | 'define' | 'build'

export interface SessionFixture {
  title: string
  meta: string
  mission: Mission
  thread: ScrollerEntry[]
  /** Whether the agent's turn runs. */
  running: boolean
  /** The Spec of a `define` Session. */
  spec?: SpecView | undefined
  /** The build of a `build` Session. */
  build?: BuildProgressView | undefined
  agent: AgentState
  /** What waits for the user in the chat, which the minimised chat previews. */
  attention?: Attention | undefined
  /** What the chat asks, answerable without opening it (V5). */
  asks?: 'blocker' | 'restatements' | undefined
  /** The Workspaces the composer offers, or the one the Session is bound to (V6). */
  workspaces: string[]
}

const AT = 'Today at'

function yours(id: string, at: string, body: ReactNode, mark: string): ScrollerEntry {
  return {
    id,
    mark,
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

function agents(id: string, text: string): ScrollerEntry {
  return { id, content: <AgentText text={text} /> }
}

function hemera(id: string, title: string, detail: string, brief?: string): ScrollerEntry {
  return { id, content: <MissionBrief title={title} detail={detail} brief={brief} /> }
}

const CLAUDE = { name: 'Claude Code', agentId: 'claude-code' }

// ---------------------------------------------------------------------------------------------
// free

const FREE: SessionFixture = {
  title: 'September totals',
  meta: 'FREE · Claude Code · Sonnet 5',
  mission: 'free',
  running: false,
  workspaces: ['main', 'login-form'],
  agent: { ...CLAUDE, tone: 'success', says: 'Answered' },
  thread: [
    yours(
      'ask',
      '09:02',
      'Why does the September total on the billing page differ from the ledger by 412 €?',
      'September total',
    ),
    agents(
      'answer',
      'Three credit notes of September were issued on 30 September but booked in the ledger on 1 October. The billing page counts them by issue date, the ledger by booking date: 412 € is their sum.\n\nIf the accountants need the two to agree, an export by issue date would settle it — that would be a Spec of its own.',
    ),
  ],
}

// ---------------------------------------------------------------------------------------------
// define

const ASK = yours(
  'ask',
  '10:31',
  'Accountants need a month of invoices as one CSV they can import into their ledger, from the billing page.',
  'CSV export',
)

const DEFINE: SessionFixture = {
  title: 'Spec CSV',
  meta: 'DEFINE · Claude Code · Sonnet 5 · ATL-7',
  mission: 'define',
  running: true,
  workspaces: ['main'],
  spec: MID_PLAN,
  agent: { ...CLAUDE, tone: 'running', says: 'Writing the plan of ATL-7' },
  attention: { title: 'A question', preview: CREDIT_NOTES.body },
  thread: [
    ASK,
    hemera(
      'brief',
      'What the agent was told · Plan',
      '10:44',
      '**Plan** · analyse the code and fix the technical approach of `ATL-7`, its risks and how it is verified.',
    ),
    agents(
      'answer',
      'Shape is finished: the problem, the outcome, the scope and two stories are in the Spec. I am writing the plan: the export can reuse the invoice query of `export.service.ts` and stream its rows.\n\nOne question blocks the plan:',
    ),
    {
      id: 'question',
      content: <SpecQuestion question={CREDIT_NOTES} onAnswer={() => undefined} />,
    },
  ],
}

// ---------------------------------------------------------------------------------------------
// build

/** A story of `ATL-7`, by its key. */
function specStory(key: string): StoryView {
  const found = STORIES.find((one) => one.key === key)
  if (found === undefined) throw new Error(`ATL-7 has no story ${key}`)
  return found
}

const S1 = specStory('S1')
const S2 = specStory('S2')

function story(
  of: StoryView,
  criteria: StoryProgress['criteria'][number]['progress'][],
  tasks: StoryProgress['tasks'],
): StoryProgress {
  return {
    id: of.id,
    key: of.key,
    title: of.title,
    narrative: of.narrative,
    criteria: of.criteria.map((text, index) => ({
      id: `${of.key}-${String(index + 1)}`,
      text,
      progress: criteria[index] ?? 'todo',
    })),
    tasks,
  }
}

const T1 = 'The invoice lines of the month, streamed'
const T2 = 'A CSV in the column order of the ledger'
const T3 = 'Credit notes as negative rows'
const T4 = 'The file imports into the ledger'

const BUILD_BASE = { specKey: 'ATL-7', specTitle: 'CSV invoice export' }

const PROGRESS_BUILDING: BuildProgressView = {
  ...BUILD_BASE,
  stage: 'building',
  stories: [
    story(
      S1,
      ['done', 'working', 'todo'],
      [
        { label: 'T1', title: T1, state: 'done' },
        { label: 'T2', title: T2, state: 'in_progress' },
        { label: 'T4', title: T4, state: 'waiting' },
      ],
    ),
    story(
      S2,
      ['working', 'todo'],
      [
        { label: 'T3', title: T3, state: 'checking' },
        { label: 'T4', title: T4, state: 'waiting' },
      ],
    ),
  ],
}

const BLOCKER_REASON =
  'The Spec says a credit note keeps the number of the invoice it cancels, but the ledger refuses two rows with the same number in one file. Either the number changes, or credit notes go in a file of their own.'

const PROGRESS_BLOCKED: BuildProgressView = {
  ...PROGRESS_BUILDING,
  stories: [
    PROGRESS_BUILDING.stories[0]!,
    story(
      S2,
      ['blocked', 'todo'],
      [
        { label: 'T3', title: T3, state: 'blocked' },
        { label: 'T4', title: T4, state: 'blocked' },
      ],
    ),
  ],
  blocker: {
    criterionId: 'S2-1',
    reason: BLOCKER_REASON,
    raised: '6 min ago',
    options: [
      { id: 'renumber', label: 'Give credit notes a number of their own', changesSpec: true },
      { id: 'own-file', label: 'Put credit notes in a file of their own', changesSpec: true },
    ],
  },
}

const PROGRESS_REVIEW: BuildProgressView = {
  ...BUILD_BASE,
  stage: 'review',
  stories: [
    story(
      S1,
      ['done', 'done', 'done'],
      [
        { label: 'T1', title: T1, state: 'done' },
        { label: 'T2', title: T2, state: 'done' },
        { label: 'T4', title: T4, state: 'done' },
      ],
    ),
    story(
      S2,
      ['done', 'done'],
      [
        { label: 'T3', title: T3, state: 'done' },
        { label: 'T4', title: T4, state: 'done' },
      ],
    ),
  ],
}

const BUILD_THREAD: ScrollerEntry[] = [
  hemera(
    'brief',
    'What the agent was told · Building',
    '10:28',
    '**Building** · work through the ready tasks of `ATL-7`.',
  ),
  {
    id: 'read',
    content: (
      <HemeraToolCall
        tool="build_read"
        label="Read build"
        mark="read-build"
        status="completed"
        summary="Reading the build of ATL-7"
      />
    ),
  },
  agents(
    'answer',
    'S1 · the column order was red: the ledger wants the number before the client. I am fixing the writer, then S2 from the same query.',
  ),
]

const BUILD_META = 'BUILD · Claude Code · Opus 5 · ATL-7'

const BUILDING: SessionFixture = {
  title: 'Build CSV export',
  meta: BUILD_META,
  mission: 'build',
  running: true,
  workspaces: ['atl-7-csv-export'],
  build: PROGRESS_BUILDING,
  agent: { ...CLAUDE, tone: 'running', says: 'Working on S1 · the column order' },
  thread: BUILD_THREAD,
}

const BLOCKED: SessionFixture = {
  ...BUILDING,
  running: false,
  build: PROGRESS_BLOCKED,
  agent: { ...CLAUDE, tone: 'pending', says: 'Waits for you' },
  attention: {
    title: 'Blocker on S2',
    preview:
      'A credit note keeps its invoice number, but the ledger refuses two rows with the same number.',
  },
  asks: 'blocker',
  thread: [
    ...BUILD_THREAD,
    agents(
      'blocker',
      `I stopped on **S2 · Credit notes in the same file**: ${BLOCKER_REASON}\n\nS1 goes on meanwhile. Tell me which, or that the Spec stands.`,
    ),
  ],
}

const DONE_THREAD: ScrollerEntry[] = [
  ...BUILD_THREAD,
  agents(
    'done',
    'Every story of ATL-7 is done and the final checks are green. Try it, and tell me what to change: bullets, screenshots, as you would say it.',
  ),
]

const REVIEW: SessionFixture = {
  ...BUILDING,
  running: false,
  build: PROGRESS_REVIEW,
  agent: { ...CLAUDE, tone: 'pending', says: 'Waits for your review' },
  attention: {
    title: 'Your review',
    preview: 'Every story is done and the final checks are green. Tell me what to change.',
  },
  thread: DONE_THREAD,
}

export const RESTATEMENTS: Restatement[] = [
  {
    id: 'r-1',
    point: 'Export is too far from the month',
    understood: 'Move Export right beside the month picker, on the same row.',
  },
  {
    id: 'r-2',
    point: 'the file should say which account it is',
    understood:
      'Name the file `invoices-<account>-2026-09.csv` rather than `invoices-2026-09.csv`. Behaviour names the file, so the Spec changes with it.',
    changesSpec: true,
  },
  {
    id: 'r-3',
    point: 'button looks disabled in dark (screenshot)',
    understood:
      'Export reads as disabled in the dark theme: give it the secondary style there too.',
  },
]

/** The user's review, as they wrote it: bullets and a pasted screenshot. */
const THE_REVIEW = (
  <span className="flex flex-col gap-2">
    <span>Tried it on September. Three things:</span>
    <ul className="list-disc pl-5">
      <li>Export is too far from the month</li>
      <li>the file should say which account it is</li>
      <li>button looks disabled in dark (screenshot)</li>
    </ul>
    <span className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
      <IconPaperclip size="sm" aria-hidden="true" />
      billing-export-dark.png
    </span>
  </span>
)

const RESTATED: SessionFixture = {
  ...REVIEW,
  agent: { ...CLAUDE, tone: 'pending', says: 'Waits for you' },
  attention: {
    title: '3 points to confirm',
    preview: 'I understood: move Export right beside the month picker, on the same row.',
  },
  asks: 'restatements',
  thread: [
    ...DONE_THREAD,
    yours('review', '11:52', THE_REVIEW, 'Review'),
    {
      id: 'restated',
      content: <Restatements restatements={RESTATEMENTS} onAnswer={() => undefined} />,
    },
  ],
}

// ---------------------------------------------------------------------------------------------
// V6: decisions in the panel, words in the chat

/** The blocker in V6: the agent says it in a line and points at the panel, where it is answered. */
const BLOCKED_V6: SessionFixture = {
  ...BLOCKED,
  attention: { title: 'Blocker on S2', preview: 'Answer it in the panel; S1 goes on meanwhile.' },
  thread: [
    ...BUILD_THREAD,
    agents(
      'blocker',
      'I stopped on **S2 · Credit notes in the same file**: the Spec and the ledger disagree on the number of a credit note. Answer it in the panel; S1 goes on meanwhile.',
    ),
  ],
}

/** The review in V6: written in the chat, restated in one line there, confirmed in the panel. */
const RESTATED_V6: SessionFixture = {
  ...REVIEW,
  build: { ...PROGRESS_REVIEW, review: RESTATEMENTS },
  agent: { ...CLAUDE, tone: 'pending', says: 'Waits for you' },
  attention: {
    title: '3 points to confirm',
    preview: 'I restated your 3 points, confirm them in the panel.',
  },
  thread: [
    ...DONE_THREAD,
    yours('review', '11:52', THE_REVIEW, 'Review'),
    agents('restated', 'I restated your 3 points, confirm them in the panel.'),
  ],
}

/** The six Sessions as V6 draws them: the same, but for what the chat says and the panel asks. */
export const SESSIONS_V6 = {
  free: FREE,
  define: DEFINE,
  building: BUILDING,
  blocked: BLOCKED_V6,
  review: REVIEW,
  restated: RESTATED_V6,
} as const

/** Every Session of the exploration, by the name its stories use. */
export const SESSIONS = {
  free: FREE,
  define: DEFINE,
  building: BUILDING,
  blocked: BLOCKED,
  review: REVIEW,
  restated: RESTATED,
} as const

export type SessionName = keyof typeof SESSIONS
