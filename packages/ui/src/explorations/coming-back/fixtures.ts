import type { Ball } from '../../blocks/ball/ball-mark.tsx'
import type { ExploredMission, NightEvent, StartResult } from './parts.tsx'

/**
 * The neutral case these screens are drawn on: a Project "Acme" with the repositories `api`,
 * `web` and `shared`, its missions `ACME-5` to `ACME-21`, a ticket `acme/shop#41`, and Hemera
 * itself as a second Project.
 */
export const REPOSITORIES = [{ name: 'api' }, { name: 'web' }, { name: 'shared' }]

export const LONG_TITLE =
  'Export invoices as CSV from the billing page, with the customer filters kept and a progress for the long ones'

/** One mission per stage, and every mark at least once. */
export const MISSIONS: readonly ExploredMission[] = [
  {
    key: 'ACME-18',
    title: 'Release the invoices export to every customer',
    type: 'feature',
    stage: 'Shipping',
    frozen: true,
    ball: 'someone',
    marks: [{ kind: 'waiting', on: 'CI on acme/shop#52' }],
    event: { text: 'Pull request opened in api and web', when: '08:31' },
    ticket: 'acme/shop#44',
  },
  {
    key: 'ACME-12',
    title: 'Export invoices as CSV from the billing page',
    type: 'feature',
    stage: 'Review',
    round: 1,
    frozen: true,
    ball: 'you',
    marks: [{ kind: 'needsYou' }, { kind: 'outside', repository: 'web' }, { kind: 'fixing' }],
    event: { text: 'Round 1 addressed: 4 points, checks green', when: '08:58' },
    ticket: 'acme/shop#41',
    branch: 'feat/acme-12-export-invoices',
  },
  {
    key: 'ACME-15',
    title: 'Retry a failed webhook from its row',
    type: 'fix',
    stage: 'Building',
    frozen: true,
    ball: 'agent',
    marks: [],
    event: { text: 'T3 done in api, T4 started in web', when: '09:02' },
    percent: 60,
    branch: 'fix/acme-15-webhook-retry',
  },
  {
    key: 'ACME-17',
    title: 'Move the invoice numbers to the shared sequence',
    type: 'chore',
    stage: 'Building',
    frozen: true,
    ball: 'blocked',
    marks: [{ kind: 'blocked', cause: 'shared database · ACME-15' }],
    event: { text: 'Waiting for the shared database', when: '07:44' },
    percent: 20,
  },
  {
    key: 'ACME-14',
    title: 'An audit log of who read what',
    type: 'feature',
    stage: 'Planning',
    frozen: false,
    ball: 'you',
    marks: [{ kind: 'needsYou' }],
    event: { text: 'Two questions wait for you', when: 'yesterday' },
    ticket: 'acme/shop#47',
  },
  {
    key: 'ACME-16',
    title: 'Labels in French and English',
    type: 'feature',
    stage: 'Ready',
    frozen: true,
    ball: 'blocked',
    marks: [{ kind: 'blocked', cause: 'ACME-9' }],
    event: { text: 'Frozen, waits for ACME-9 to ship', when: 'yesterday' },
  },
  {
    key: 'ACME-19',
    title: 'Paginate the customer list',
    type: 'feature',
    stage: 'Ready',
    frozen: true,
    ball: 'idle',
    marks: [{ kind: 'outdated' }],
    event: { text: 'The ticket changed after the freeze', when: 'Monday' },
    ticket: 'acme/shop#38',
  },
]

export const DONE: readonly ExploredMission[] = [
  ['ACME-9', 'Export the movements', 'yesterday'],
  ['ACME-8', 'Sort invoices by due date', 'Monday'],
  ['ACME-7', 'A filter on the customer', 'Monday'],
  ['ACME-5', 'Rename the billing tab', 'last week'],
].map(([key = '', title = '', when = '']) => ({
  key,
  title,
  type: 'feature' as const,
  stage: 'Done' as const,
  frozen: true,
  ball: 'idle' as const,
  marks: [],
  event: { text: 'Shipped', when },
}))

const BALLS: readonly Ball[] = ['agent', 'you', 'someone', 'blocked', 'idle']

/** A Project lived in for months: many missions in every stage, every title long. */
export function manyMissions(): ExploredMission[] {
  const stages = ['Shipping', 'Review', 'Building', 'Planning', 'Ready'] as const
  return Array.from({ length: 30 }, (_, index) => {
    const ball = BALLS[index % BALLS.length] ?? 'idle'
    return {
      key: `ACME-${String(100 + index)}`,
      title: `${LONG_TITLE} (${String(index + 1)})`,
      type: 'feature',
      stage: stages[index % stages.length] ?? 'Ready',
      frozen: index % 2 === 0,
      ball,
      marks:
        ball === 'blocked'
          ? [{ kind: 'blocked', cause: `shared database · ACME-${String(99 + index)}` }]
          : index % 7 === 0
            ? [{ kind: 'outdated' }, { kind: 'outside', repository: 'web' }]
            : [],
      event: {
        text: 'The agent wrote the tests of the export of every invoice of every customer at once',
        when: `${String(8 + (index % 10))}:${String(10 + index).padStart(2, '0')}`,
      },
    }
  })
}

/** Everything the start field can find for "export". */
export const RESULTS: readonly StartResult[] = [
  { kind: 'mission', key: 'ACME-12', title: 'Export invoices as CSV from the billing page' },
  { kind: 'mission', key: 'ACME-9', title: 'Export the movements', done: true },
  { kind: 'ticket', key: 'acme/shop#41', title: 'Export invoices as CSV', linked: 'ACME-12' },
  { kind: 'ticket', key: 'acme/shop#56', title: 'Export the audit log as JSON' },
]

export const CHATS = [
  { id: 'invoices', title: 'Invoices export', when: '08:20' },
  { id: 'release', title: 'Release notes for 2.4', when: 'yesterday' },
]

/**
 * A night away, the newest first: two missions failed, two finished, a ticket answered, a
 * dependency lifted.
 */
export const NIGHT: readonly NightEvent[] = [
  {
    project: 'Acme',
    key: 'ACME-12',
    title: 'Export invoices as CSV from the billing page',
    ball: 'you',
    events: [
      { tone: 'done', text: 'Round 1 addressed: 4 points', when: '23:51' },
      { tone: 'ticket', text: 'acme/shop#41: a teammate answered on the ticket', when: '07:12' },
    ],
  },
  {
    project: 'Acme',
    key: 'ACME-15',
    title: 'Retry a failed webhook from its row',
    ball: 'agent',
    events: [
      { tone: 'failed', text: 'T3 failed: the retry test times out in api', when: '02:14' },
      { tone: 'done', text: 'T3 fixed and green on the second try', when: '02:40' },
    ],
  },
  {
    project: 'Hemera',
    key: 'HEM-58',
    title: 'Probe worktrees survive a restart',
    ball: 'blocked',
    events: [{ tone: 'failed', text: 'Checks failed after the merge: 2 tests', when: '01:03' }],
  },
  {
    project: 'Acme',
    key: 'ACME-16',
    title: 'Labels in French and English',
    ball: 'idle',
    events: [{ tone: 'lifted', text: 'No longer blocked: ACME-9 shipped', when: '00:22' }],
  },
  {
    project: 'Acme',
    key: 'ACME-9',
    title: 'Export the movements',
    ball: 'idle',
    events: [{ tone: 'done', text: 'Shipped: api and web merged', when: '23:10' }],
  },
]

export const NEEDS = [
  {
    project: 'Acme',
    key: 'ACME-12',
    title: 'Run the migration on the shared database?',
    when: '08:56',
  },
  {
    project: 'Hemera',
    key: 'HEM-58',
    title: 'Checks failed after the merge: retry or look?',
    when: '01:03',
  },
]

export const QUESTIONS = [
  { project: 'Acme', key: 'ACME-14', title: 'Who may read the audit log?', when: 'yesterday' },
  { project: 'Acme', key: 'ACME-14', title: 'How long is the log kept?', when: 'yesterday' },
]

export const RECENT: readonly ExploredMission[] = [MISSIONS[1]!, MISSIONS[2]!, MISSIONS[4]!]
