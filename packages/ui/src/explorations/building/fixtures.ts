import type { NeedRow } from '../../blocks/need/needs-you-list.tsx'
import type {
  BuildingMoment,
  Check,
  Helper,
  MissionThings,
  Phase,
  ReadyMoment,
  Requirement,
  Service,
  Task,
  TaskDetail,
} from './types.ts'

/**
 * ACME-12 at a real size, for the Ready and Building pages of #149: nine requirements, twenty-two
 * tasks in every state, three repositories, long outputs. Neutral data only: Acme, `api`, `web`,
 * `shared`.
 */

const MINUTE = 60_000

/** A moment ago, for what runs: fixed once per load so the chips' seconds tick from it. */
const since = (minutes: number): number => Date.now() - minutes * MINUTE

export const KEY = 'ACME-12'

export const TITLE = 'Export invoices as CSV from the billing page'

export const BRANCH = 'feat/acme-12-export-invoices'

export const LONG_TITLE =
  'Export invoices as CSV from the billing page, with the customer filters kept, the dates in the customer’s own time zone, and a progress for the long ones'

const task = (
  id: string,
  title: string,
  state: Task['state'],
  repositories: readonly string[],
  failures?: number,
): Task =>
  failures === undefined
    ? { id, title, state, repositories }
    : { id, title, state, repositories, failures }

/** Building at forty per cent: the first requirements proven, the middle at work, the rest to do. */
export const REQUIREMENTS: readonly Requirement[] = [
  {
    id: 'R1',
    title: 'Export the invoices of the current filters as CSV',
    tasks: [
      task('T1', 'Add the export endpoint', 'verified', ['api']),
      task('T2', 'Stream the rows instead of loading them', 'verified', ['api']),
      task('T3', 'The export button on the billing page', 'verified', ['web']),
    ],
    scenarios: [
      { id: 'S1', title: 'The file holds the filtered invoices', proof: 'green', redAt: '09:12' },
      { id: 'S2', title: 'No filter exports every invoice', proof: 'green', redAt: '09:12' },
    ],
  },
  {
    id: 'R2',
    title: 'Name the file after the filters',
    tasks: [task('T4', 'Build the file name from the filters', 'verified', ['shared'])],
    scenarios: [
      {
        id: 'S3',
        title: 'The name carries the customer and the range',
        proof: 'green',
        redAt: '09:13',
      },
    ],
  },
  {
    id: 'R3',
    title: 'Dates in the customer’s own time zone',
    tasks: [
      task('T5', 'Carry the customer’s zone to the export', 'verified', ['api']),
      task('T6', 'Format the dates in that zone', 'unverified', ['shared']),
    ],
    scenarios: [
      { id: 'S4', title: 'A Tokyo customer sees Tokyo dates', proof: 'green', redAt: '09:13' },
      { id: 'S5', title: 'A date at midnight stays on its day', proof: 'rerun', redAt: '09:13' },
    ],
  },
  {
    id: 'R4',
    title: 'Show a progress for long exports',
    tasks: [
      task('T7', 'Count the rows before streaming', 'verified', ['api']),
      task('T8', 'A progress on the export button', 'running', ['web'], 1),
      task('T9', 'Cancel an export on its way', 'todo', ['api', 'web']),
    ],
    scenarios: [
      {
        id: 'S6',
        title: 'Past 10 000 rows, the button shows a progress',
        proof: 'red',
        redAt: '09:14',
      },
      { id: 'S7', title: 'A cancelled export leaves no file', proof: 'red', redAt: '09:14' },
    ],
  },
  {
    id: 'R5',
    title: 'Amounts in the invoice’s own currency',
    tasks: [
      task('T10', 'Write the currency beside each amount', 'running', ['shared']),
      task('T11', 'Keep the amounts unrounded', 'waiting', ['api']),
    ],
    scenarios: [
      { id: 'S8', title: 'A yen invoice keeps no decimals', proof: 'red', redAt: '09:14' },
    ],
  },
  {
    id: 'R6',
    title: 'Only the invoices the user may read',
    tasks: [
      task('T12', 'Apply the read rules to the export query', 'blocked', ['api']),
      task('T13', 'Hide the button from read-only roles', 'todo', ['web']),
    ],
    scenarios: [
      { id: 'S9', title: 'A sales role exports only its customers', proof: 'red', redAt: '09:15' },
      { id: 'S10', title: 'A read-only role sees no button', proof: 'red', redAt: '09:15' },
    ],
  },
  {
    id: 'R7',
    title: 'Large exports do not block the page',
    tasks: [
      task('T14', 'Run the export in the background', 'todo', ['api']),
      task('T15', 'Tell the user when the file is ready', 'todo', ['web']),
      task('T16', 'Keep the file for a day', 'skipped', ['api']),
    ],
    scenarios: [
      { id: 'S11', title: 'The page answers during an export', proof: 'red', redAt: '09:15' },
    ],
  },
  {
    id: 'R8',
    title: 'The columns follow the customer’s settings',
    tasks: [
      task('T17', 'Read the column choice', 'todo', ['api']),
      task('T18', 'Order the columns as chosen', 'todo', ['shared']),
      task('T19', 'Show the columns in the export menu', 'todo', ['web']),
    ],
    scenarios: [
      { id: 'S12', title: 'Hidden columns are not exported', proof: 'none' },
      { id: 'S13', title: 'The order is the customer’s', proof: 'none' },
    ],
  },
  {
    id: 'R9',
    title: 'An export is logged for the audit',
    tasks: [
      task('T20', 'Write the audit line', 'todo', ['api']),
      task('T21', 'Show exports in the audit page', 'todo', ['web']),
      task('T22', 'Purge audit lines after a year', 'todo', ['api']),
    ],
    scenarios: [{ id: 'S14', title: 'Each export leaves one audit line', proof: 'none' }],
  },
]

/** The same requirements once every task is done and every scenario green. */
export const REQUIREMENTS_DONE: readonly Requirement[] = REQUIREMENTS.map((requirement) => ({
  ...requirement,
  tasks: requirement.tasks.map((one) =>
    one.state === 'skipped' ? one : { ...one, state: 'verified' },
  ),
  scenarios: requirement.scenarios.map((scenario) => ({
    ...scenario,
    proof: 'green',
    redAt: scenario.redAt ?? '11:02',
  })),
}))

const CHECKS: readonly Check[] = [
  { repository: 'api', name: 'test', state: 'done', final: false, after: 'after R3' },
  { repository: 'api', name: 'typecheck', state: 'done', final: false, after: 'after R3' },
  { repository: 'web', name: 'test', state: 'done', final: false, after: 'after R3' },
  { repository: 'web', name: 'lint', state: 'done', final: false, after: 'after R3' },
  { repository: 'shared', name: 'test', state: 'done', final: false, after: 'after R3' },
]

const CHECK_FAILED: readonly Check[] = CHECKS.map((check) =>
  check.repository === 'web' && check.name === 'test'
    ? {
        ...check,
        state: 'failed',
        after: 'after R4',
        tail: [
          ' FAIL  src/billing/export-button.test.tsx > shows a progress past 10 000 rows',
          'TestingLibraryElementError: Unable to find role="progressbar"',
          '    at waitForProgress (src/billing/export-button.test.tsx:48:19)',
          ' Test Files  1 failed | 41 passed (42)',
          '      Tests  1 failed | 318 passed (319)',
        ],
      }
    : { ...check, after: 'after R4' },
)

const FINAL_CHECKS: readonly Check[] = [
  { repository: 'api', name: 'test', state: 'done', final: true, after: 'final' },
  { repository: 'api', name: 'typecheck', state: 'done', final: true, after: 'final' },
  { repository: 'api', name: 'build', state: 'done', final: true, after: 'final' },
  { repository: 'web', name: 'test', state: 'done', final: true, after: 'final' },
  { repository: 'web', name: 'lint', state: 'running', final: true, after: 'final' },
  { repository: 'web', name: 'e2e', state: 'todo', final: true, after: 'final' },
  { repository: 'shared', name: 'test', state: 'done', final: true, after: 'final' },
]

const SERVICES: readonly Service[] = [
  {
    name: 'api',
    state: 'running',
    startedAt: since(42),
    endedAt: null,
    url: 'http://localhost:3012',
    line: 'pnpm --filter api dev',
  },
  {
    name: 'web',
    state: 'running',
    startedAt: since(41),
    endedAt: null,
    url: 'http://localhost:4212',
    line: 'pnpm --filter web dev',
  },
]

const IDLE = [
  { name: 'storybook', line: 'pnpm --filter web storybook' },
  { name: 'worker', line: 'pnpm --filter api worker' },
]

const CATALOGUE = [
  { name: 'mailpit', line: 'docker compose up mailpit' },
  { name: 'docs', line: 'pnpm --filter docs dev' },
]

const HELPERS: readonly Helper[] = [
  {
    name: 'Helper',
    kind: 'helper',
    state: 'running',
    step: 'Writes the labels of the export menu (T19)',
    startedAt: since(6),
    endedAt: null,
  },
]

const PHASES: readonly Phase[] = [
  { id: 'tasks', title: 'Tasks', state: 'running' },
  { id: 'documentation', title: 'Documentation', state: 'todo' },
  { id: 'final-checks', title: 'Final checks', state: 'todo' },
  { id: 'review', title: 'Automatic review', state: 'todo' },
  { id: 'special', title: 'Special tasks', state: 'todo' },
]

const JOURNAL = [
  { at: '10:58', text: 'R3 proven: S4 green; S5 to re-run after T6' },
  { at: '10:51', text: 'Checks green after R3 in api, web and shared' },
  { at: '10:44', text: 'T8 failed once: the progress never showed; trying again' },
  { at: '10:40', text: 'A helper started on the export menu’s labels (T19)' },
  { at: '10:31', text: 'R2 proven: S3 green' },
  { at: '10:12', text: 'R1 proven: S1 and S2 green' },
  { at: '09:15', text: 'Every scenario’s red recorded: 11 of 14, three wait for their code' },
  { at: '09:08', text: 'Workspace prepared: 3 worktrees, .env copied, dependencies installed' },
  { at: '09:02', text: 'You launched ACME-12 on Claude Code · Opus · High' },
]

export const MISSION_THINGS: MissionThings = {
  dependencies: [
    { key: 'ACME-9', title: 'Customer time zones in the api', stage: 'Done' },
    { key: 'ACME-10', title: 'Read rules for invoices', stage: 'Done' },
  ],
  grants: [
    {
      id: 'g1',
      action: 'Run the api’s database migrations on the test database',
      by: 'You',
      at: 'today at 09:31',
      uses: 4,
    },
    {
      id: 'g2',
      action: 'Install packages in web',
      by: 'You',
      at: 'yesterday at 16:40',
      uses: 1,
    },
    {
      id: 'g3',
      action: 'Read the shared fixtures folder outside the Workspace',
      by: 'You',
      at: 'yesterday at 15:02',
      uses: 12,
    },
  ],
  budget: { cap: '$40', spent: '$12.40', share: 0.31, estimated: false },
}

const permission = (
  id: string,
  command: string,
  agentReason: string,
  hemeraReason: string,
  when: string,
  role = 'Builder',
): NeedRow => ({
  id,
  project: 'Acme',
  agent: { id: role.toLowerCase(), name: role },
  need: {
    ask: {
      kind: 'permission',
      command,
      agentReason,
      hemeraReason,
      choices: ['allow-once', 'allow-for-mission', 'deny'],
    },
    title: `${role} asks to run a command`,
    when,
    role,
  },
})

/** Every need Building can raise, at once: what a crowded morning looks like. */
export const NEEDS: readonly NeedRow[] = [
  permission(
    'n1',
    'pnpm --filter api migration:run',
    'T11 needs the amounts column widened before its test can run.',
    'The catalogue marks migrations “ask before running”; they touch the shared test database.',
    '2 min',
  ),
  {
    id: 'n2',
    project: 'Acme',
    need: {
      ask: {
        kind: 'decision',
        options: [
          {
            label: 'Amend T11: keep four decimals, round on display',
            recommended: 'the ledger already stores four decimals',
          },
          { label: 'Keep T11 as frozen: store two decimals' },
        ],
      },
      title: 'T11 cannot keep the amounts unrounded as written',
      text: 'The ledger stores four decimals, the Spec says two. Writing two loses cents on yen-to-euro invoices.',
      when: '6 min',
      role: 'Builder',
    },
  },
  {
    id: 'n3',
    project: 'Acme',
    need: {
      ask: {
        kind: 'error',
        attempts: [
          {
            what: 'Applied the read rules in the export query',
            output: 'error TS2339: Property "scope" does not exist on type "Session".',
          },
          {
            what: 'Read the scope from the request instead',
            output: 'S9 failed: expected 12 invoices, received 40',
          },
          {
            what: 'Joined on the customer’s owner',
            output: 'S9 failed: expected 12 invoices, received 0',
          },
        ],
        proposed:
          'Wait for ACME-10, which adds the read rules to the session, and build R7 meanwhile.',
      },
      title: 'T12 failed three times',
      when: '9 min',
      role: 'Builder',
    },
  },
  {
    id: 'n4',
    project: 'Acme',
    need: {
      ask: { kind: 'environment', action: 'Retry', settings: 'Variables' },
      title: 'BILLING_EXPORT_BUCKET is not set in web',
      text: 'T15 needs it to write the finished file; the Project’s variables have no value for it.',
      when: '12 min',
      role: 'Builder',
    },
  },
  {
    id: 'n5',
    project: 'Acme',
    need: {
      ask: {
        kind: 'decision',
        options: [
          { label: 'Mark S7 as proven', recommended: 'the cancel already removes the file' },
          { label: 'Rewrite S7 so it fails first' },
          { label: 'Back to Planning on S7' },
        ],
      },
      title: 'S7 already passes before its code',
      text: 'Its test passed when its red was to be recorded: cancelling already leaves no file.',
      when: '14 min',
      role: 'Builder',
    },
  },
  {
    id: 'n6',
    project: 'Acme',
    need: {
      ask: {
        kind: 'decision',
        options: [
          { label: 'Keep the new failure as S8’s red', recommended: 'it is the behaviour asked' },
          { label: 'Back to Planning on S8' },
        ],
        evidence: [
          { what: 'In Planning', output: 'Expected column "Currency" in invoices.csv, found none' },
          { what: 'Now', output: 'Expected "¥1200" in column "Amount", received "1200.00"' },
        ],
      },
      title: 'S8 fails, but not the way it did in Planning',
      when: '15 min',
      role: 'Builder',
    },
  },
]

/** Refusals said as needs: the budget spent, an agent's limit reached. */
export const REFUSALS: readonly NeedRow[] = [
  {
    id: 'r1',
    project: 'Acme',
    need: {
      ask: { kind: 'environment', action: 'Raise the budget', settings: 'Budget' },
      title: 'The mission’s budget is spent: $40 of $40',
      text: 'Building paused after T10. Nothing is lost; it goes on from T11 once the budget allows it.',
      when: 'now',
    },
  },
  {
    id: 'r2',
    project: 'Acme',
    need: {
      ask: { kind: 'environment', action: 'Retry' },
      title: 'Claude Code’s usage limit is reached until 14:00',
      text: 'Building waits and goes on by itself at 14:00, or now with another model.',
      when: '3 min',
    },
  },
]

/** The moment Building is in: one per state the stories show. */
export type MomentName =
  | 'working'
  | 'starting'
  | 'needs'
  | 'refused'
  | 'checkFailed'
  | 'outside'
  | 'stuck'
  | 'endPhases'
  | 'round'
  | 'long'

const WORKING: BuildingMoment = {
  now: 'Builder writes the progress on the export button (T8), its second try.',
  next: 'Then the currency beside each amount (T10).',
  elapsed: '1 h 56 min',
  workspace: 'acme-12',
  branch: BRANCH,
  round: 0,
  requirements: REQUIREMENTS,
  special: [],
  phases: PHASES,
  checks: CHECKS,
  changes: [
    { repository: 'api', files: 14, added: 412, deleted: 38 },
    { repository: 'web', files: 6, added: 188, deleted: 21 },
    { repository: 'shared', files: 3, added: 64, deleted: 4 },
  ],
  services: SERVICES,
  idle: IDLE,
  catalogue: CATALOGUE,
  helpers: HELPERS,
  journal: JOURNAL,
  needs: [],
  mission: MISSION_THINGS,
}

export const MOMENTS: Record<MomentName, () => BuildingMoment> = {
  working: () => WORKING,
  starting: () => ({
    ...WORKING,
    now: 'Builder records each scenario’s red before writing its code: 6 of 14.',
    next: 'Then the export endpoint (T1).',
    elapsed: '4 min',
    requirements: REQUIREMENTS.map((requirement) => ({
      ...requirement,
      tasks: requirement.tasks.map((one) =>
        one.state === 'skipped' ? one : { ...one, state: 'todo' },
      ),
      scenarios: requirement.scenarios.map((scenario, at) =>
        Number(requirement.id.slice(1)) <= 3 && at === 0
          ? { ...scenario, proof: 'red', redAt: '09:12' }
          : { ...scenario, proof: 'none' },
      ),
    })),
    checks: [],
    changes: [],
    services: [],
    helpers: [],
    journal: JOURNAL.slice(-2),
  }),
  needs: () => ({ ...WORKING, needs: NEEDS }),
  refused: () => ({
    ...WORKING,
    now: 'Building is paused: the mission’s budget is spent.',
    next: undefined,
    needs: REFUSALS,
    helpers: [],
    mission: {
      ...MISSION_THINGS,
      budget: { cap: '$40', spent: '$40.00', share: 1, estimated: false },
    },
  }),
  checkFailed: () => ({
    ...WORKING,
    now: 'Builder reads why web’s tests failed after R4.',
    checks: CHECK_FAILED,
  }),
  outside: () => ({
    ...WORKING,
    outside: 'web',
    changes: WORKING.changes.map((change) =>
      change.repository === 'web' ? { ...change, outside: true } : change,
    ),
  }),
  stuck: () => ({
    ...WORKING,
    helpers: [
      { ...HELPERS[0]!, state: 'stuck', startedAt: since(19) },
      {
        name: 'Documenter',
        kind: 'documenter',
        state: 'running',
        step: 'Notes how the export streams its rows',
        startedAt: since(2),
        endedAt: null,
      },
    ],
  }),
  endPhases: () => ({
    ...WORKING,
    now: 'The final checks run in web: lint, then the end-to-end tests.',
    next: 'Then the automatic review.',
    elapsed: '4 h 12 min',
    requirements: REQUIREMENTS_DONE,
    special: [
      task('RV1', 'Name the export’s time zone in the file header', 'todo', ['shared']),
      task('RV2', 'Close the stream when the user leaves', 'todo', ['api']),
      task('RV3', 'Label the progress for screen readers', 'todo', ['web']),
    ],
    phases: [
      { id: 'tasks', title: 'Tasks', state: 'done' },
      { id: 'documentation', title: 'Documentation', state: 'done', detail: '4 notes' },
      { id: 'final-checks', title: 'Final checks', state: 'running', detail: '5 of 7' },
      { id: 'review', title: 'Automatic review', state: 'todo' },
      { id: 'special', title: 'Special tasks', state: 'todo', detail: '3' },
    ],
    checks: FINAL_CHECKS,
    helpers: [
      {
        name: 'Code reviewer',
        kind: 'reviewer',
        state: 'running',
        step: 'Reads the api’s changes',
        startedAt: since(4),
        endedAt: null,
      },
      {
        name: 'Spec reviewer',
        kind: 'reviewer',
        state: 'stuck',
        step: 'Holds the Spec against the tests',
        startedAt: since(12),
        endedAt: null,
      },
      {
        name: 'Documenter',
        kind: 'documenter',
        state: 'finished',
        step: 'Wrote 4 notes',
        startedAt: since(30),
        endedAt: since(18),
      },
    ],
  }),
  round: () => ({
    ...WORKING,
    now: 'Builder keeps the date range in the file name (P2).',
    next: 'Then two exports at once (P3).',
    elapsed: '38 min',
    round: 2,
    requirements: REQUIREMENTS_DONE,
    points: [
      {
        id: 'P1',
        title: 'The date column follows the browser, not the customer',
        tasks: [task('T23', 'Format the date column in the customer’s zone', 'verified', ['web'])],
      },
      {
        id: 'P2',
        title: 'The file name keeps the filters, but not the date range',
        tasks: [task('T24', 'Add the range to the file name', 'running', ['shared'])],
      },
      {
        id: 'P3',
        title: 'Two exports at once give the same file name',
        tasks: [
          task('T25', 'Add the time to the file name', 'todo', ['shared']),
          task('T26', 'Refuse a second export while one runs', 'todo', ['web']),
        ],
      },
      {
        id: 'P4',
        title: 'A long export shows no progress at all',
        tasks: [task('T27', 'Show the progress from the first row', 'todo', ['web'])],
      },
    ],
  }),
  long: () => ({
    ...WORKING,
    now: 'Builder writes the progress on the export button of the billing page, the one the customers with more than ten thousand invoices a month asked for, on its second try after the first never showed it (T8).',
    next: 'Then the currency beside each amount, in the invoice’s own currency and never the customer’s, with the symbol where the locale puts it (T10).',
    workspace: 'acme-12-export-invoices-with-filters-and-time-zones',
    branch: 'feat/acme-12-export-invoices-as-csv-with-filters-time-zones-and-progress',
    requirements: REQUIREMENTS.map((requirement) =>
      requirement.id === 'R4'
        ? {
            ...requirement,
            title:
              'Show a progress for long exports, counted in rows rather than in bytes, which the customers understand',
            tasks: requirement.tasks.map((one) =>
              one.id === 'T8'
                ? {
                    ...one,
                    title:
                      'A progress on the export button that says how many rows are written out of how many',
                    repositories: ['web', 'shared', 'ui-kit'],
                  }
                : one,
            ),
          }
        : requirement,
    ),
  }),
}

/** The task views a story can open, by task id. */
export const TASK_DETAILS = new Map<string, TaskDetail>([
  [
    'T8',
    {
      task: REQUIREMENTS[3]!.tasks[1]!,
      requirement: 'R4 · Show a progress for long exports',
      targets: [
        'web/src/billing/export-button.tsx',
        'web/src/billing/export-button.test.tsx',
        'shared/src/export/progress.ts',
      ],
      tries: [
        { n: 1, runner: 'Builder · Claude Code · Opus · High', state: 'failed', took: '11 min' },
        { n: 2, runner: 'Builder · Claude Code · Opus · High', state: 'running', took: '4 min' },
      ],
      files: [
        { path: 'web/src/billing/export-button.tsx', added: 48, deleted: 6, outside: false },
        { path: 'web/src/billing/export-button.test.tsx', added: 31, deleted: 0, outside: false },
        { path: 'shared/src/export/progress.ts', added: 22, deleted: 0, outside: false },
      ],
      verdicts: [
        {
          name: 'S6 · Past 10 000 rows, the button shows a progress',
          state: 'failed',
          tail: [
            ' FAIL  src/billing/export-button.test.tsx > shows a progress past 10 000 rows',
            'TestingLibraryElementError: Unable to find role="progressbar"',
            '    at waitForProgress (src/billing/export-button.test.tsx:48:19)',
            ' Test Files  1 failed | 41 passed (42)',
            '      Tests  1 failed | 318 passed (319)',
          ],
        },
        { name: 'web · typecheck', state: 'done' },
      ],
      conflicts: [],
    },
  ],
  [
    'T6',
    {
      task: REQUIREMENTS[2]!.tasks[1]!,
      requirement: 'R3 · Dates in the customer’s own time zone',
      targets: ['shared/src/dates/format.ts', 'shared/src/dates/format.test.ts'],
      tries: [
        { n: 1, runner: 'Helper · Claude Code · Sonnet · Medium', state: 'done', took: '7 min' },
      ],
      files: [
        { path: 'shared/src/dates/format.ts', added: 36, deleted: 12, outside: false },
        { path: 'shared/src/dates/format.test.ts', added: 54, deleted: 0, outside: false },
        { path: 'web/src/billing/invoice-row.tsx', added: 3, deleted: 3, outside: true },
      ],
      verdicts: [
        { name: 'S4 · A Tokyo customer sees Tokyo dates', state: 'done' },
        { name: 'S5 · A date at midnight stays on its day', state: 'todo' },
      ],
      conflicts: [
        {
          with: 'T5',
          path: 'shared/src/dates/format.ts',
          settled: 'Merged by the Builder: both changes kept',
        },
      ],
      amended: {
        by: 'Your decision at 10:20',
        what: 'Dates at midnight belong to the day that starts, in the customer’s zone.',
        at: '10:20',
      },
    },
  ],
  [
    'T12',
    {
      task: REQUIREMENTS[5]!.tasks[0]!,
      requirement: 'R6 · Only the invoices the user may read',
      targets: ['api/src/invoices/export.query.ts', 'api/tests/invoices-export-rules.test.ts'],
      tries: [
        { n: 1, runner: 'Builder · Claude Code · Opus · High', state: 'failed', took: '6 min' },
        { n: 2, runner: 'Builder · Claude Code · Opus · High', state: 'failed', took: '9 min' },
        { n: 3, runner: 'Builder · Claude Code · Opus · High', state: 'failed', took: '8 min' },
      ],
      files: [{ path: 'api/src/invoices/export.query.ts', added: 18, deleted: 4, outside: false }],
      verdicts: [
        {
          name: 'S9 · A sales role exports only its customers',
          state: 'failed',
          tail: [
            ' FAIL  tests/invoices-export-rules.test.ts > a sales role exports only its customers',
            'AssertionError: expected 0 to be 12',
            '    at tests/invoices-export-rules.test.ts:31:24',
          ],
        },
      ],
      conflicts: [],
    },
  ],
])

/** The frozen Spec in summary, on the Ready page. */
const READY: ReadyMoment = {
  goal: 'Customers ask for their invoices in a spreadsheet. The billing page exports the invoices of its current filters as a CSV file, named after those filters, with the dates in the customer’s own time zone and the amounts in each invoice’s currency. A long export shows its progress and never blocks the page; only the invoices the user may read are exported, and each export is logged for the audit.',
  requirements: REQUIREMENTS.map((requirement) => ({
    id: requirement.id,
    title: requirement.title,
    scenarios: requirement.scenarios.length,
  })),
  frozenAt: 'yesterday at 17:02',
  model: { agent: 'claude', model: 'opus', effort: 'high' },
  why: 'Nine requirements across three repositories, with read rules and time zones: a model that holds a long plan. A smaller one would do for R2 alone.',
  overridden: false,
  check: { state: 'idle' },
  preparation: null,
  needs: [],
  mission: {
    ...MISSION_THINGS,
    dependencies: MISSION_THINGS.dependencies.slice(0, 1),
    grants: MISSION_THINGS.grants.slice(2),
    budget: { cap: '$40', spent: '$3.10', share: 0.08, estimated: true },
  },
}

const MOVED_TARGETS = [
  {
    kind: 'target',
    what: 'api/src/invoices/invoices.query.ts',
    how: '+12 −3 in 2 commits',
    verdict: { holds: true, why: 'Only a column renamed; T2 reads the new name.' },
  },
  {
    kind: 'proof',
    what: 'web/e2e/billing.spec.ts',
    how: '+40 in 1 commit',
    verdict: { holds: true, why: 'New tests of the filters, none on the export.' },
  },
  { kind: 'dirty', what: 'shared/src/money.ts', how: 'Uncommitted at Freeze, committed since' },
] as const

const MOVED_BREAKING = [
  {
    kind: 'target',
    what: 'api/src/invoices/export.query.ts',
    how: '+88 −14 in 3 commits',
    verdict: {
      holds: false,
      why: 'Someone added a first export without filters: R1 and T1 would write it again.',
    },
  },
  ...MOVED_TARGETS,
  {
    kind: 'living',
    what: 'Billing · Invoices are read by the owner only',
    how: 'Changed today at 08:40',
  },
  { kind: 'ticket', what: 'acme/shop#41', how: 'Its description changed this morning' },
] as const

export type ReadyName =
  | 'frozen'
  | 'blocked'
  | 'checking'
  | 'clear'
  | 'moved'
  | 'outdated'
  | 'unfetched'
  | 'silent'
  | 'expired'
  | 'dependency'
  | 'preparing'
  | 'preparationFailed'
  | 'overridden'
  | 'long'

const MISSION_THINGS_DEPENDENCIES = {
  dependencies: [
    MISSION_THINGS.dependencies[0]!,
    { key: 'ACME-10', title: 'Read rules for invoices', stage: 'Building', percent: 80 },
  ],
} satisfies Pick<MissionThings, 'dependencies'>

const PREPARATION = [
  { name: 'Workspace', state: 'done', detail: 'acme-12' },
  { name: 'Worktree api', state: 'done', detail: BRANCH },
  { name: 'Worktree web', state: 'done', detail: BRANCH },
  { name: 'Worktree shared', state: 'done', detail: BRANCH },
  { name: 'Copy .env', state: 'done', detail: 'api, web' },
  { name: 'Install dependencies', state: 'running', detail: 'pnpm install' },
  { name: 'Build shared', state: 'todo' },
] as const

export const READY_MOMENTS: Record<ReadyName, () => ReadyMoment> = {
  frozen: () => READY,
  blocked: () => ({ ...READY, mission: { ...READY.mission, ...MISSION_THINGS_DEPENDENCIES } }),
  checking: () => ({
    ...READY,
    check: { state: 'checking', step: 'Fetches api, web and shared' },
  }),
  clear: () => ({ ...READY, check: { state: 'clear' }, preparation: PREPARATION }),
  moved: () => ({
    ...READY,
    check: { state: 'moved', moved: MOVED_TARGETS },
    preparation: PREPARATION,
  }),
  outdated: () => ({ ...READY, check: { state: 'outdated', moved: MOVED_BREAKING } }),
  unfetched: () => ({
    ...READY,
    check: { state: 'unfetched', since: 'Monday at 18:20', moved: MOVED_TARGETS.slice(2) },
  }),
  silent: () => ({ ...READY, check: { state: 'silent', moved: MOVED_TARGETS } }),
  expired: () => ({ ...READY, check: { state: 'expired' } }),
  dependency: () => ({
    ...READY,
    check: {
      state: 'dependency',
      dependency: { ...MISSION_THINGS.dependencies[0]!, stage: 'Review' },
    },
  }),
  preparing: () => ({ ...READY, check: { state: 'clear' }, preparation: PREPARATION }),
  preparationFailed: () => ({
    ...READY,
    check: { state: 'clear' },
    preparation: [
      ...PREPARATION.slice(0, 5),
      {
        name: 'Install dependencies',
        state: 'failed',
        detail: 'pnpm install: no access to the private registry',
      },
      PREPARATION[6],
    ],
    needs: [
      {
        id: 'p1',
        project: 'Acme',
        need: {
          ask: { kind: 'environment', action: 'Retry', settings: 'Variables' },
          title: 'Dependencies could not be installed in web',
          text: 'pnpm install was refused by the private registry: NPM_TOKEN is not set in the Workspace.',
          when: 'now',
        },
      },
    ],
  }),
  overridden: () => ({
    ...READY,
    model: { agent: 'claude', model: 'sonnet', effort: 'medium' },
    overridden: true,
  }),
  long: () => ({
    ...READY,
    goal: `${READY.goal} ${READY.goal}`,
    requirements: READY.requirements.map((one) =>
      one.id === 'R4'
        ? {
            ...one,
            title:
              'Show a progress for long exports, counted in rows rather than in bytes, which the customers understand better',
          }
        : one,
    ),
    why: `${READY.why} The api's export query is the risky part: it joins five tables and the read rules of ACME-10.`,
    check: {
      state: 'outdated',
      moved: [
        {
          kind: 'target',
          what: 'api/src/invoices/exports/streaming/csv/export-with-filters-and-time-zones.query.ts',
          how: '+88 −14 in 3 commits, two of them merges from the main branch of the repository',
          verdict: MOVED_BREAKING[0].verdict,
        },
        ...MOVED_BREAKING.slice(1),
      ],
    },
  }),
}
