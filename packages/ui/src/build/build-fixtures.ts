import type {
  BuildAttemptView,
  BuildBlockerView,
  BuildCheckView,
  BuildStoryView,
  BuildTaskView,
  BuildViewData,
} from './model.ts'

/**
 * One build, taken through its states, for the stories (lot 22, phase 0).
 *
 * The Spec is the one the define Session wrote, `ATL-7`, frozen with its four tasks: the invoice
 * lines of the month, the CSV, the credit notes, and the import into the ledger, which is the
 * user's. Every screen is that build at one moment, consistent with the product rules: a task
 * waits for its dependencies, a human task comes back to the user, three red tries come back to
 * the user, a blocker suspends its task and its dependants and nothing else.
 */

/** The moment every story is seen from. */
export const NOW = '2026-09-25T10:40:00.000Z'

/** A time, that many minutes before `NOW`. */
function before(minutes: number): string {
  return new Date(Date.parse(NOW) - minutes * 60_000).toISOString()
}

const API = 'sources/api'
const FRONT = 'sources/front'

function check(
  id: string,
  name: string,
  verdict: BuildCheckView['verdict'],
  more: Partial<BuildCheckView> = {},
): BuildCheckView {
  return {
    id,
    name,
    place: API,
    line: `pnpm ${name}`,
    verdict,
    exitCode: verdict === 'red' ? 1 : 0,
    value: null,
    detail: verdict === 'red' ? 'exited with 1' : null,
    outputTail: '',
    runId: `run-${id}`,
    ranAt: before(30),
    ...more,
  }
}

const TYPES_GREEN = check('c-types-1', 'typecheck', 'green', {
  line: 'pnpm tsc --noEmit',
  outputTail: 'Found 0 errors.',
})

const LINT_GREEN = check('c-lint-1', 'lint', 'green', {
  line: 'pnpm oxlint src/billing',
  outputTail: 'Found 0 warnings and 0 errors.\nFinished in 212ms on 14 files.',
})

const TESTS_GREEN = check('c-tests-1', 'unit tests', 'green', {
  line: 'pnpm vitest run src/billing/export.query.test.ts',
  outputTail:
    ' ✓ src/billing/export.query.test.ts (6 tests) 48ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)',
})

/** A test the agent wrote that does not pass yet: the ledger's column order is wrong. */
const TESTS_RED = check('c-tests-2', 'unit tests', 'red', {
  place: FRONT,
  line: 'pnpm vitest run src/billing/export-csv.test.ts',
  outputTail: [
    ' FAIL  src/billing/export-csv.test.ts > the header follows the ledger',
    'AssertionError: expected "date,client,number" to be "date,number,client"',
    ' ❯ src/billing/export-csv.test.ts:18:32',
    '',
    ' Test Files  1 failed (1)',
    '      Tests  1 failed | 4 passed (5)',
  ].join('\n'),
})

/** A coverage under its minimum: the check exits 0, and the number it printed is too low (L4). */
const COVERAGE_RED = check('c-coverage-2', 'coverage', 'red', {
  place: FRONT,
  line: 'pnpm vitest run --coverage',
  exitCode: 0,
  value: 64.2,
  detail: '64.2 < 70',
  outputTail: 'All files          |   64.2 |    58.1 |   70.4 |   64.2 |',
})

/** A files filter that matched nothing the try changed: the check did not run. */
const E2E_SKIPPED = check('c-e2e-1', 'e2e written', 'skipped', {
  line: 'pnpm playwright test {files}',
  exitCode: null,
  detail: 'no changed file matched e2e/**/*.e2e.ts',
})

const T1_FILES = [
  { repository: API, path: 'src/billing/export.query.ts', status: 'A', added: 48, removed: 0 },
  { repository: API, path: 'src/billing/export.controller.ts', status: 'M', added: 12, removed: 3 },
  { repository: API, path: 'src/billing/export.query.test.ts', status: 'A', added: 61, removed: 0 },
]

const T2_FILES = [
  { repository: FRONT, path: 'src/billing/ExportButton.tsx', status: 'A', added: 34, removed: 0 },
  { repository: FRONT, path: 'src/billing/BillingPage.tsx', status: 'M', added: 4, removed: 1 },
  { repository: FRONT, path: 'src/billing/export-csv.test.ts', status: 'A', added: 52, removed: 0 },
  { repository: API, path: 'src/shared/csv.ts', status: 'M', added: 9, removed: 2 },
  { repository: API, path: 'fixtures/ledger-sample.xlsx', status: 'A', added: null, removed: null },
]

const T1_TRY: BuildAttemptView = {
  id: 'a-t1-1',
  scope: 'task',
  number: 1,
  startedAt: before(38),
  endedAt: before(29),
  result: 'green',
  checks: [TYPES_GREEN, LINT_GREEN, TESTS_GREEN, E2E_SKIPPED],
  files: T1_FILES,
}

/** A red try of T2, the `number`-th. */
function t2Red(number: number, startedAt: number, endedAt: number): BuildAttemptView {
  return {
    id: `a-t2-${String(number)}`,
    scope: 'task',
    number,
    startedAt: before(startedAt),
    endedAt: before(endedAt),
    result: 'red',
    checks: [
      { ...TYPES_GREEN, id: `c-t2-types-${String(number)}`, place: FRONT },
      number === 2
        ? { ...COVERAGE_RED, id: 'c-t2-cov-2' }
        : { ...TESTS_RED, id: `c-t2-${String(number)}` },
    ],
    files: T2_FILES,
  }
}

const T2_RUNNING: BuildAttemptView = {
  id: 'a-t2-2',
  scope: 'task',
  number: 2,
  startedAt: before(12),
  endedAt: null,
  result: null,
  checks: [],
  files: [],
}

const T3_CHECKING: BuildAttemptView = {
  id: 'a-t3-1',
  scope: 'task',
  number: 1,
  startedAt: before(27),
  endedAt: before(1),
  result: null,
  checks: [{ ...TYPES_GREEN, id: 'c-t3-types', ranAt: before(0.5) }],
  files: [
    { repository: API, path: 'src/billing/export.query.ts', status: 'M', added: 14, removed: 2 },
    {
      repository: API,
      path: 'src/billing/credit-notes.test.ts',
      status: 'A',
      added: 40,
      removed: 0,
    },
  ],
}

const T3_GREEN: BuildAttemptView = {
  ...T3_CHECKING,
  endedAt: before(20),
  result: 'green',
  checks: [
    { ...TYPES_GREEN, id: 'c-t3-types' },
    { ...TESTS_GREEN, id: 'c-t3-tests', line: 'pnpm vitest run src/billing/credit-notes.test.ts' },
  ],
}

/** The four tasks of `ATL-7` as the Spec defines them, before the build touches them. */
const T1: BuildTaskView = {
  id: 'bt-1',
  taskId: 'task-1',
  label: 'T1',
  title: 'The invoice lines of the month, streamed',
  result: 'The export endpoint returns every line issued in the month, in issue-date order.',
  criteria: 'A month of 10 000 lines streams in under two seconds; an empty month returns no line.',
  type: 'code',
  executor: 'agent',
  state: 'ready',
  dependsOn: [],
  storyIds: ['story-export-a-month'],
  handedAt: null,
  startedAt: null,
  finishedAt: null,
  endedAt: null,
  updatedAt: before(40),
  skipReason: null,
  attempts: [],
}

const T2: BuildTaskView = {
  ...T1,
  id: 'bt-2',
  taskId: 'task-2',
  label: 'T2',
  title: 'A CSV in the column order of the ledger',
  result:
    'The Export button of the billing page downloads the file; an empty month gives the header only.',
  criteria: 'The header reads date, number, client, net, VAT, gross, currency, in that order.',
  state: 'waiting',
  dependsOn: ['T1'],
}

const T3: BuildTaskView = {
  ...T1,
  id: 'bt-3',
  taskId: 'task-3',
  label: 'T3',
  title: 'Credit notes as negative rows',
  result: 'A credit note is a row of type `credit` with negative amounts; the total still matches.',
  criteria: 'The file total equals the billing page total for September.',
  state: 'waiting',
  dependsOn: ['T1'],
  storyIds: ['story-credit-notes'],
}

export const T4: BuildTaskView = {
  ...T1,
  id: 'bt-4',
  taskId: 'task-4',
  label: 'T4',
  title: 'The file imports into the ledger',
  result: 'The September file imports without an error and its total equals the billing page.',
  criteria: 'Import the September file into the ledger of the test company, and compare totals.',
  type: 'verification',
  executor: 'human',
  state: 'waiting',
  dependsOn: ['T2', 'T3'],
  storyIds: ['story-export-a-month', 'story-credit-notes'],
}

/** T1 done on its first try, every check green. */
export const T1_DONE: BuildTaskView = {
  ...T1,
  state: 'done',
  handedAt: before(39),
  startedAt: before(38),
  finishedAt: before(30),
  endedAt: before(29),
  updatedAt: before(29),
  attempts: [T1_TRY],
}

/** T2 on its second try, after a red one. */
export const T2_WORKING: BuildTaskView = {
  ...T2,
  state: 'in_progress',
  handedAt: before(29),
  startedAt: before(28),
  finishedAt: before(14),
  updatedAt: before(12),
  attempts: [t2Red(1, 28, 13), T2_RUNNING],
}

/** T3 finished by the agent a minute ago, its checks running. */
export const T3_CHECKING_TASK: BuildTaskView = {
  ...T3,
  state: 'checking',
  handedAt: before(29),
  startedAt: before(27),
  finishedAt: before(1),
  updatedAt: before(1),
  attempts: [T3_CHECKING],
}

const T2_DONE: BuildTaskView = {
  ...T2,
  state: 'done',
  handedAt: before(29),
  startedAt: before(28),
  finishedAt: before(9),
  endedAt: before(8),
  updatedAt: before(8),
  attempts: [
    t2Red(1, 28, 13),
    {
      id: 'a-t2-2',
      scope: 'task',
      number: 2,
      startedAt: before(12),
      endedAt: before(8),
      result: 'green',
      checks: [
        { ...TYPES_GREEN, id: 'c-t2-types-2', place: FRONT },
        {
          ...TESTS_GREEN,
          id: 'c-t2-tests-2',
          place: FRONT,
          line: 'pnpm vitest run src/billing/export-csv.test.ts',
        },
      ],
      files: T2_FILES,
    },
  ],
}

const T3_DONE: BuildTaskView = {
  ...T3,
  state: 'done',
  handedAt: before(29),
  startedAt: before(27),
  finishedAt: before(21),
  endedAt: before(20),
  updatedAt: before(20),
  attempts: [T3_GREEN],
}

/** The human task, ready and so the user's. */
export const T4_YOURS: BuildTaskView = {
  ...T4,
  state: 'yours',
  handedAt: before(8),
  endedAt: before(8),
  updatedAt: before(8),
}

/** T2 after its third red try: back to the user, with the three failures. */
export const T2_THREE_RED: BuildTaskView = {
  ...T2,
  state: 'yours',
  handedAt: before(29),
  startedAt: before(28),
  finishedAt: before(3),
  endedAt: before(2),
  updatedAt: before(2),
  attempts: [t2Red(1, 28, 20), t2Red(2, 19, 11), t2Red(3, 10, 2)],
}

/** T3, which the agent says contradicts the Spec. */
export const T3_BLOCKED: BuildTaskView = {
  ...T3,
  state: 'blocked',
  handedAt: before(29),
  startedAt: before(27),
  updatedAt: before(6),
  attempts: [{ ...T3_CHECKING, endedAt: null, checks: [], files: [] }],
}

export const BLOCKER: BuildBlockerView = {
  id: 'blocker-1',
  taskId: 'bt-3',
  label: 'T3',
  reason:
    'The Spec says a credit note keeps the number of the invoice it cancels, but the ledger refuses two rows with the same number in one file. Either the number changes, or credit notes go in a file of their own.',
  raisedAt: before(6),
  dismissedAt: null,
}

/** The human task, done by the user. */
const T4_DONE: BuildTaskView = {
  ...T4,
  state: 'done',
  handedAt: before(8),
  endedAt: before(5),
  updatedAt: before(5),
}

/** T1 done, but no check was configured: nothing judged it. */
export const T1_NOT_VERIFIED: BuildTaskView = {
  ...T1_DONE,
  attempts: [{ ...T1_TRY, result: 'unverified', checks: [] }],
}

/** T3 skipped by the user, its dependants let go on. */
export const T3_SKIPPED: BuildTaskView = {
  ...T3,
  state: 'skipped',
  endedAt: before(4),
  updatedAt: before(4),
  skipReason: 'Credit notes wait for the new numbering; they ship in the next Spec.',
  skipUnblocks: true,
}

const STORIES_OPEN: BuildStoryView[] = [
  {
    id: 'story-export-a-month',
    key: 'S1',
    title: 'Export a month',
    labels: ['T1', 'T2', 'T4'],
    state: 'open',
    attempts: [],
  },
  {
    id: 'story-credit-notes',
    key: 'S2',
    title: 'Credit notes in the same file',
    labels: ['T3', 'T4'],
    state: 'open',
    attempts: [],
  },
]

const STORIES_GREEN: BuildStoryView[] = STORIES_OPEN.map((story) => ({ ...story, state: 'green' }))

const APPROACH = [
  '**T1** · the invoice query of `export.service.ts`, grouped by issue date and streamed; I check first that an empty month returns no line. Risk: the query loads every line at once today.',
  '',
  '**T2** · a new `ExportButton` on the billing page and the CSV writer of `shared/csv`; I check the header order against the ledger sample first.',
  '',
  '**T3** · credit notes from the same query, as negative rows of type `credit`. Risk: the ledger may refuse a credit note that repeats its invoice number.',
  '',
  '**T4** · yours: importing the September file into the ledger.',
].join('\n')

const BASE: BuildViewData = {
  sessionId: 'session-build-1',
  specId: 'spec-atl-7',
  specKey: 'ATL-7',
  specTitle: 'CSV invoice export',
  phase: 'execute',
  pausedAt: null,
  detail: null,
  note: APPROACH,
  tasks: [T1_DONE, T2_WORKING, T3_CHECKING_TASK, T4],
  blockers: [],
  stories: STORIES_OPEN,
  endAttempts: [],
  canAccept: false,
}

/** `prepare`: the rows are there, T1 is ready, and the agent has not written its approach. */
export const GETTING_READY: BuildViewData = {
  ...BASE,
  phase: 'prepare',
  note: null,
  tasks: [T1, T2, T3, T4],
}

/** `execute`: T1 done, T2 on its second try, T3 being checked, T4 waiting on both. */
export const BUILDING: BuildViewData = BASE

/** The human task is ready: it is the user's, and the build waits on nothing else. */
export const YOURS: BuildViewData = {
  ...BASE,
  tasks: [T1_DONE, T2_DONE, T3_DONE, T4_YOURS],
}

/** T2 red three times: it came back to the user; T3 is done and T4 waits. */
export const THREE_RED: BuildViewData = {
  ...BASE,
  tasks: [T1_DONE, T2_THREE_RED, T3_DONE, T4],
}

/** The agent says T3 contradicts the Spec: T3 and T4 are blocked, T2 goes on. */
export const BLOCKED: BuildViewData = {
  ...BASE,
  tasks: [T1_DONE, T2_WORKING, T3_BLOCKED, { ...T4, state: 'blocked', updatedAt: before(6) }],
  blockers: [BLOCKER],
}

/** Paused by the user in the middle of T2. */
export const PAUSED: BuildViewData = { ...BASE, pausedAt: before(3) }

const END_GREEN: BuildAttemptView = {
  id: 'a-end-1',
  scope: 'build',
  number: 1,
  startedAt: before(4),
  endedAt: before(2),
  result: 'green',
  checks: [
    check('c-build-1', 'build', 'green', {
      place: '',
      line: 'pnpm build',
      outputTail: '✓ built in 14.2s',
      ranAt: before(3),
    }),
    check('c-e2e-end-1', 'e2e', 'green', {
      place: '',
      line: 'pnpm e2e',
      outputTail: '  12 passed (41.3s)',
      ranAt: before(2),
    }),
  ],
  files: [],
}

const END_RED: BuildAttemptView = {
  ...END_GREEN,
  endedAt: before(3),
  result: 'red',
  checks: [
    { ...END_GREEN.checks[0]! },
    check('c-e2e-end-1', 'e2e', 'red', {
      place: '',
      line: 'pnpm e2e',
      outputTail: [
        '  1) billing › exports September',
        '     Error: expected the total 12 480.00 to equal 12 490.00',
        '',
        '  11 passed, 1 failed (40.8s)',
      ].join('\n'),
      ranAt: before(3),
    }),
  ],
}

const DONE_TASKS = [T1_DONE, T2_DONE, T3_DONE, T4_DONE]

/** `verify`: every task done, the final checks running. */
export const FINAL_CHECKS: BuildViewData = {
  ...BASE,
  phase: 'verify',
  tasks: DONE_TASKS,
  stories: STORIES_GREEN,
  endAttempts: [{ ...END_GREEN, endedAt: null, result: null, checks: [END_GREEN.checks[0]!] }],
}

/** `verify`: the first final try red, the agent on the second. */
export const FINAL_CHECKS_RED: BuildViewData = {
  ...FINAL_CHECKS,
  endAttempts: [
    END_RED,
    {
      ...END_GREEN,
      id: 'a-end-2',
      number: 2,
      startedAt: before(2),
      endedAt: null,
      result: null,
      checks: [],
    },
  ],
}

/** `verify` green, nothing waiting for the user: Accept is offered. */
export const READY_TO_ACCEPT: BuildViewData = {
  ...FINAL_CHECKS,
  endAttempts: [END_GREEN],
  canAccept: true,
}

/** Accepted: over, readable, nothing runs. */
export const ACCEPTED: BuildViewData = {
  ...READY_TO_ACCEPT,
  phase: 'accepted',
  canAccept: false,
}

/** Stopped by the user mid-build: over, readable, nothing runs. */
export const STOPPED: BuildViewData = {
  ...BASE,
  phase: 'stopped',
  detail: 'You stopped the build.',
  tasks: [T1_DONE, { ...T2_WORKING, attempts: [t2Red(1, 28, 13)] }, T3_SKIPPED, T4],
}
