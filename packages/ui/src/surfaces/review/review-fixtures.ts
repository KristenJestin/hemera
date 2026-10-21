import type { NeedRow } from '../../blocks/need/needs-you-list.tsx'
import type { Question } from '../../blocks/planning/planning-types.ts'
import type {
  Check,
  Finding,
  Proof,
  PullRequest,
  Remark,
  ReviewMoment,
  Round,
  RoundPoint,
  Service,
  ShipPreview,
  TeamComment,
} from './review-types.ts'

/**
 * ACME-12 in Review at a real size, for #254: five repositories, fourteen scenarios of which two are
 * verified by hand, seven final checks, a round already back and the next one being written, team
 * comments from several people, a pull request per repository. Neutral data only: Acme, `api`,
 * `web`, `shared`, `ui-kit`, `billing`; the forge is GitHub, `acme/shop`.
 */

export const KEY = 'ACME-12'

export const TITLE = 'Export invoices as CSV from the billing page'

export const BRANCH = 'feat/acme-12-export-invoices'

export const LONG_TITLE =
  'Export invoices as CSV from the billing page, with the customer filters kept, the dates in the customer’s own time zone, and a progress for the long ones'

export const REPOSITORIES = ['api', 'web', 'shared', 'ui-kit', 'billing'] as const

/** A remark of 2,000 characters: what a long live test writes in one go. */
export const LONG_REMARK = [
  'The export button works on the first page of invoices, but as soon as I change the customer filter and come back to the list, the button keeps the old filter in its tooltip and the file it gives me holds the invoices of the previous customer.',
  'I tried it three times with Northwind and then Globex: each time the second export carried the first customer’s rows, and the file name said Globex while the rows said Northwind, which is the worst of both.',
  'Reloading the page fixes it, so it looks like the filters are read once when the page mounts and never again.',
  'While I was there: the progress on the button jumps from 0 to 100 on exports under a thousand rows, which reads as a glitch rather than as a progress — I would rather not show it at all below a second.',
  'The date column is right for Tokyo now, but the header still says “Date (UTC)” even when the dates are in the customer’s zone; it should name the zone it uses, or say nothing.',
  'Last, on a narrow window the button’s label wraps under its icon and pushes the table down by a line; the other buttons of the toolbar shrink to their icon instead, and this one should do the same.',
  'None of this blocks the merge for me except the first point, which exports the wrong customer’s invoices: please treat it first, and add a scenario that changes the filter twice before exporting.',
  'I attached the two files I got so you can compare them, and a capture of the wrapped button at 1024 pixels wide.',
  'If the filter is meant to be read from the URL rather than from the page’s state, say so in your answer and I will check the links we send customers.',
]
  .join(' ')
  .padEnd(2000, ' Again, the first point matters most.')
  .slice(0, 2000)

export const LONG_PATH =
  'web/src/features/billing/invoices/export/components/export-button/export-progress-indicator.tsx:142'

export const LONG_REVIEWERS = [
  'ana.lopez',
  'bram.de-vries',
  'chen.wei',
  'dmitri.ivanov',
  'eleni.papadopoulou',
  'farah.haddad',
  'giulia.romano',
  'hiroshi.tanaka',
  'ingrid.johansson',
  'jonas.meier',
  'kemal.yilmaz',
  'lea.dubois',
]

/** A copy of a value with some of its fields changed. */
function patched<T extends object>(one: T, change: Partial<T>): T {
  return { ...one, ...change }
}

/** The list with the items that match changed, the others as they were. */
export function edit<T extends object>(
  list: readonly T[],
  matches: (one: T) => boolean,
  change: (one: T) => NoInfer<Partial<T>>,
): T[] {
  return list.map((one) => (matches(one) ? patched(one, change(one)) : one))
}

const all = (): boolean => true

// --- Remarks and rounds ---------------------------------------------------------------------

const remark = (given: Pick<Remark, 'id' | 'text' | 'state' | 'at'> & Partial<Remark>): Remark => ({
  kind: 'remark',
  ...given,
})

/** Round 1, back: what the agent did with each remark, waiting for the user to resolve them. */
const ROUND_ONE: readonly Remark[] = [
  remark({
    id: 'F1',
    text: 'The export button stays enabled while an export runs: two presses give two files.',
    state: 'addressed',
    round: 1,
    at: 'yesterday 16:10',
    answer:
      'The button is disabled from the press until the file is saved; a second press does nothing. Proven by S15.',
  }),
  remark({
    id: 'F2',
    text: 'The file name has spaces in it, which breaks the import script on the finance side.',
    state: 'addressed',
    round: 1,
    at: 'yesterday 16:12',
    answer: 'Spaces become dashes: `acme-northwind-2026-09.csv`. Decision D4 records it.',
  }),
  remark({
    id: 'F3',
    kind: 'question',
    text: 'Why does the export stream rather than build the file in memory?',
    state: 'addressed',
    round: 1,
    at: 'yesterday 16:14',
    answer:
      'A customer with 400 000 invoices would hold 180 MB in the API’s memory; streaming keeps it under 5 MB. Nothing was changed.',
  }),
  remark({
    id: 'F4',
    text: 'Use the amount formatter from ui-kit instead of a new one.',
    state: 'resolved',
    round: 1,
    at: 'yesterday 16:20',
    anchor: 'web/src/billing/export-row.tsx:31',
    answer: 'Replaced by `formatAmount` from ui-kit; the local helper is gone.',
  }),
  remark({
    id: 'F5',
    text: 'Rename the column “Amt” to “Amount”.',
    state: 'withdrawn',
    round: 1,
    at: 'yesterday 16:22',
  }),
]

/** What the user wrote since round 1 came back, not sent yet. */
const WAITING: readonly Remark[] = [
  remark({
    id: 'F6',
    text: 'Changing the customer filter, then exporting, gives the previous customer’s invoices.',
    state: 'waiting',
    at: '09:41',
    images: [
      { name: 'export-northwind.png', size: '412 KB' },
      { name: 'export-globex.png', size: '398 KB' },
    ],
  }),
  remark({
    id: 'F7',
    text: 'The progress jumps from 0 to 100 on small exports: do not show it under a second.',
    state: 'waiting',
    at: '09:44',
  }),
  remark({
    id: 'F8',
    text: 'This query reads every column; select only the ones the CSV writes.',
    state: 'waiting',
    at: '09:47',
    anchor: 'api/src/billing/export.query.ts:57',
  }),
  remark({
    id: 'F9',
    kind: 'question',
    text: 'Is the filter read from the URL or from the page’s state?',
    state: 'waiting',
    at: '09:49',
  }),
]

const point = (
  given: Pick<RoundPoint, 'id' | 'title' | 'kind' | 'sources' | 'state' | 'detail'> &
    Partial<RoundPoint>,
): RoundPoint => given

const ROUND_ONE_POINTS: readonly RoundPoint[] = [
  point({
    id: 'P1',
    title: 'Disable the export button while an export runs',
    kind: 'fix',
    sources: ['F1'],
    state: 'done',
    detail: 'From the press until the file is saved, the button is disabled and says so.',
    scenario: 'S15 · A second press during an export gives no second file',
  }),
  point({
    id: 'P2',
    title: 'Dashes instead of spaces in the file name',
    kind: 'behaviour',
    sources: ['F2'],
    state: 'done',
    detail: 'R2 named the file after the filters; the name now uses dashes between its parts.',
    decision: 'D4 · The file name has no spaces: its parts are joined by dashes.',
    scenario: 'S16 · The name of a Northwind export of September has no space',
  }),
  point({
    id: 'P3',
    title: 'Use ui-kit’s amount formatter',
    kind: 'fix',
    sources: ['F4', 'RV2'],
    state: 'done',
    detail: 'The export row formats its amounts with `formatAmount` from ui-kit.',
  }),
]

export const ROUND_ONE_CLOSED: Round = {
  n: 1,
  state: 'closed',
  waves: [],
  points: ROUND_ONE_POINTS,
  sentAt: 'yesterday 16:30',
  backAt: 'yesterday 18:05',
}

/** Round 1 as it came back: its remarks addressed, waiting for the user. */
const ROUND_ONE_BACK: Round = { ...ROUND_ONE_CLOSED, state: 'back' }

const NOW_MS = Date.now()

const question = (
  given: Pick<
    Question,
    'id' | 'text' | 'why' | 'options' | 'recommended' | 'recommendedReason' | 'section'
  > &
    Partial<Question>,
): Question => ({
  fromFinding: null,
  replaces: null,
  replacedBy: null,
  state: 'open',
  waitingNote: null,
  retiredReason: null,
  mootDecision: null,
  answers: [],
  drafts: [],
  proposals: [],
  ...given,
})

/** The grilling of round 2: a first wave answered, a second one open. */
export const GRILLING_WAVES: Round['waves'] = [
  {
    n: 1,
    questions: [
      question({
        id: 'Q1',
        text: 'F6 and F9 speak of the same filter. Treat them as one point?',
        why: 'F9 asks where the filter is read; the answer is the cause of F6.',
        options: [
          { id: 'A', label: 'One point', detail: 'F9 is answered inside the fix of F6.' },
          { id: 'B', label: 'Two points', detail: 'F9 gets its own answer, F6 its own fix.' },
        ],
        recommended: 'A',
        recommendedReason: 'the answer to F9 is the cause of F6',
        section: 'R1',
        state: 'answered',
        answers: [
          {
            version: 1,
            optionId: 'A',
            text: null,
            at: String(NOW_MS - 120_000),
            inputState: 'integrated',
          },
        ],
      }),
    ],
  },
  {
    n: 2,
    questions: [
      question({
        id: 'Q2',
        text: 'Should the progress stay hidden under one second, or under a thousand rows?',
        why: 'F7 says “small exports”; time and rows give different results on a slow network.',
        options: [
          {
            id: 'A',
            label: 'Under one second',
            detail: 'Whatever the size, a fast export shows nothing.',
          },
          { id: 'B', label: 'Under 1 000 rows', detail: 'The size decides, whatever the network.' },
        ],
        recommended: 'A',
        recommendedReason: 'it is what you see, whatever the size',
        section: 'R4',
      }),
      question({
        id: 'Q3',
        text: 'F8 selects fewer columns. May the CSV lose the internal `ledger_ref` column?',
        why: 'Nobody reads it in the file, but the finance script might.',
        options: [
          { id: 'A', label: 'Drop it', detail: 'The CSV writes only the columns R1 lists.' },
          { id: 'B', label: 'Keep it', detail: 'Select it too, until finance says otherwise.' },
        ],
        recommended: 'B',
        recommendedReason: 'R1 does not say finance does not need it',
        section: 'R1',
      }),
    ],
  },
]

const ROUND_TWO_POINTS: readonly RoundPoint[] = [
  point({
    id: 'P4',
    title: 'Read the customer filter at each export, not at mount',
    kind: 'fix',
    sources: ['F6', 'F9'],
    state: 'running',
    detail:
      'The export reads the filters from the URL at the moment of the press, so a changed filter is always the one exported.',
    scenario: 'S17 · Change the filter twice, export: the file holds the last customer’s invoices',
  }),
  point({
    id: 'P5',
    title: 'No progress under one second',
    kind: 'behaviour',
    sources: ['F7'],
    state: 'todo',
    detail: 'R4 showed a progress past 10 000 rows; it now shows one only after a second.',
    decision: 'D5 · The progress appears after one second, whatever the size.',
    conflict: {
      with: 'R4',
      why: 'R4 says “past 10 000 rows, the button shows a progress”: a 12 000-row export under a second would show none.',
    },
  }),
  point({
    id: 'P6',
    title: 'Select only the columns the CSV writes',
    kind: 'fix',
    sources: ['F8'],
    state: 'todo',
    detail: 'The export query selects the columns R1 lists, plus `ledger_ref`.',
  }),
  point({
    id: 'P7',
    title: 'Export the credit notes too',
    kind: 'behaviour',
    sources: ['C2'],
    state: 'todo',
    detail: 'The team asks for credit notes in the same file. The Spec never mentions them.',
    newMission: 'Export credit notes with the invoices',
  }),
]

export const ROUND_TWO_GRILLING: Round = {
  n: 2,
  state: 'grilling',
  waves: GRILLING_WAVES,
  points: [],
  sentAt: '09:52',
}

export const ROUND_TWO_BUILDING: Round = {
  n: 2,
  state: 'building',
  waves: edit(GRILLING_WAVES, all, (wave) => ({
    questions: edit(wave.questions, all, (one) => ({
      state: 'answered',
      answers: [
        {
          version: 1,
          optionId: one.recommended,
          text: null,
          at: String(NOW_MS - 60_000),
          inputState: 'integrated',
        },
      ],
    })),
  })),
  points: ROUND_TWO_POINTS,
  sentAt: '09:52',
  building: '1 of 4 points done',
}

// --- Team comments --------------------------------------------------------------------------

export const TEAM: readonly TeamComment[] = [
  {
    id: 'C1',
    author: 'ana.lopez',
    anchor: 'api/src/billing/export.controller.ts:88',
    text: 'This endpoint is not rate-limited. An export of everything, pressed in a loop, would hold a connection each.',
    reading:
      'Asks for a limit on concurrent exports per user. The Spec says nothing on it; a fix, not a behaviour change.',
    draft:
      'Good catch: I will cap it at one running export per user and answer 429 to the next one until it ends.',
    state: 'new',
    url: 'https://github.com/acme/shop/pull/412#discussion_r1',
    at: '08:58',
  },
  {
    id: 'C2',
    author: 'bram.de-vries',
    anchor: 'api #412',
    text: 'Could the same export include the credit notes? Finance asks every month.',
    reading: 'Asks for a new kind of document in the file: an addition the Spec never asked for.',
    draft: 'Not in this change: it gets its own mission so it can be specified with finance.',
    state: 'new',
    url: 'https://github.com/acme/shop/pull/412#issuecomment-2',
    at: '09:03',
  },
  {
    id: 'C3',
    author: 'chen.wei',
    anchor: 'web/src/billing/export-button.tsx:12',
    text: 'Nit: the icon should come from ui-kit.',
    reading: 'Already done in round 1 (P3).',
    draft: 'Done in the last push: it is ui-kit’s download icon now.',
    state: 'resolved',
    url: 'https://github.com/acme/shop/pull/413#discussion_r3',
    at: 'yesterday 17:40',
  },
]

// --- Delivery -------------------------------------------------------------------------------

const opened = (
  repository: string,
  number: number,
  ci: PullRequest['ci'],
  given: number,
  reviewers: readonly string[] = ['ana.lopez', 'bram.de-vries'],
): PullRequest => ({
  repository,
  state: 'open',
  number,
  url: `https://github.com/acme/${repository}/pull/${String(number)}`,
  ci,
  approvals: { given, needed: 1 },
  reviewers,
  images: { published: true, names: ['export-northwind.png', 'export-globex.png'] },
})

/** Every state a pull request goes through, one per repository. */
export const PULLS_EVERY_STATE: readonly PullRequest[] = [
  opened('api', 412, 'done', 1),
  opened('web', 413, 'running', 0),
  { repository: 'shared', state: 'running', step: 'pushing the branch' },
  {
    repository: 'ui-kit',
    state: 'failed',
    message:
      "! [remote rejected] feat/acme-12-export-invoices -> feat/acme-12-export-invoices (protected branch hook declined)\nerror: failed to push some refs to 'github.com:acme/ui-kit.git'",
  },
  { repository: 'billing', state: 'click' },
]

export const PULLS_OPEN: readonly PullRequest[] = [
  opened('api', 412, 'done', 1),
  opened('web', 413, 'done', 1),
  opened('shared', 88, 'done', 1),
  opened('ui-kit', 140, 'done', 2),
  opened('billing', 57, 'done', 1),
]

// --- Services, proofs, checks ---------------------------------------------------------------

export const SERVICES: readonly Service[] = [
  { name: 'api', state: 'running', url: 'http://localhost:3012', line: 'pnpm --filter api dev' },
  { name: 'web', state: 'running', url: 'http://localhost:4212', line: 'pnpm --filter web dev' },
  { name: 'worker', state: 'stopped', line: 'pnpm --filter billing worker' },
  {
    name: 'mailpit',
    state: 'failed',
    line: 'mailpit --smtp 1025',
    error: 'Port 1025 is already in use by another process.',
  },
]

const proof = (
  id: string,
  requirement: string,
  title: string,
  state: Proof['state'] = 'green',
  given: Partial<Proof> = {},
): Proof => ({
  id,
  requirement,
  title,
  how: 'test',
  state,
  redAt: '09:12',
  greenAt: '11:40',
  ...given,
})

export const PROOFS: readonly Proof[] = [
  proof('S1', 'R1', 'The file holds the filtered invoices'),
  proof('S2', 'R1', 'No filter exports every invoice'),
  proof('S3', 'R2', 'The name carries the customer and the range'),
  proof('S4', 'R3', 'A Tokyo customer sees Tokyo dates'),
  proof('S5', 'R3', 'A date at midnight stays on its day'),
  proof('S6', 'R4', 'Past 10 000 rows, the button shows a progress'),
  proof('S7', 'R4', 'A cancelled export leaves no file'),
  proof('S8', 'R5', 'A yen invoice keeps no decimals'),
  proof('S9', 'R6', 'A reader sees only the invoices they may read'),
  proof('S10', 'R6', 'A read-only role sees no export button'),
  proof('S11', 'R7', 'An export of 400 000 rows stays under 5 MB of memory'),
  {
    id: 'S12',
    requirement: 'R8',
    title: 'The CSV opens in the spreadsheet with its accents intact',
    how: 'hand',
    state: 'toVerify',
    steps:
      'Export the Northwind invoices of September, open the file in your spreadsheet, check that “Société Générale” reads as written.',
  },
  {
    id: 'S13',
    requirement: 'R9',
    title: 'The export button reads well on a narrow window',
    how: 'hand',
    state: 'toVerify',
    steps: 'Narrow the window to 1024 pixels, look at the billing toolbar.',
  },
  proof('S14', 'R9', 'The button has an accessible name while it exports'),
]

export const CHECKS: readonly Check[] = [
  { repository: 'api', name: 'typecheck', state: 'done', after: '41 s' },
  { repository: 'api', name: 'unit tests', state: 'done', after: '2 min 10 s' },
  { repository: 'web', name: 'typecheck', state: 'done', after: '55 s' },
  { repository: 'web', name: 'unit tests', state: 'done', after: '1 min 32 s' },
  { repository: 'web', name: 'end-to-end', state: 'done', after: '6 min 04 s' },
  { repository: 'shared', name: 'unit tests', state: 'done', after: '18 s' },
  { repository: 'ui-kit', name: 'lint', state: 'done', after: '12 s' },
]

export const FINDINGS: readonly Finding[] = [
  {
    id: 'A1',
    severity: 'blocking',
    by: 'Code reviewer',
    text: 'The export query ignores the read rules when the filter names no customer.',
    fate: 'fixed by RV1',
  },
  {
    id: 'A2',
    severity: 'warning',
    by: 'Code reviewer',
    text: 'A second amount formatter duplicates ui-kit’s.',
    fate: 'fixed by RV2',
  },
  {
    id: 'A3',
    severity: 'suggestion',
    by: 'Spec reviewer',
    text: 'S6 checks the progress appears, never that it ends.',
    fate: 'dismissed: S7 ends every export it starts',
  },
]

const SAW = 'the tasks done at 11:20 · 5 repositories, 38 files · every proof and check green'

const AFTER = [
  {
    id: 'RV1',
    text: 'Read rules applied when no customer is filtered',
    files: ['api/src/billing/export.query.ts'],
  },
  {
    id: 'RV2',
    text: 'The local amount formatter replaced by ui-kit’s',
    files: ['web/src/billing/export-row.tsx', 'web/src/billing/format.ts'],
  },
]

const CHANGES: ReviewMoment['changes'] = [
  { repository: 'api', files: 9, added: 412, deleted: 38 },
  { repository: 'web', files: 14, added: 538, deleted: 61 },
  { repository: 'shared', files: 6, added: 120, deleted: 12 },
  { repository: 'ui-kit', files: 4, added: 48, deleted: 9 },
  { repository: 'billing', files: 5, added: 77, deleted: 20 },
]

export const PREVIEW: ShipPreview = {
  leaving: CHANGES.map((change) => ({
    repository: change.repository,
    branch: BRANCH,
    summary: `${String(change.files)} files · +${String(change.added)} −${String(change.deleted)}`,
  })),
  outside: [],
  redo: [],
  unvalidated: [],
  rules: [],
  ci: [
    { repository: 'api', number: 412, state: 'done', words: 'green' },
    { repository: 'web', number: 413, state: 'done', words: 'green' },
    { repository: 'shared', number: 88, state: 'done', words: 'green' },
    { repository: 'ui-kit', number: 140, state: 'done', words: 'green' },
    { repository: 'billing', number: 57, state: 'done', words: 'green' },
  ],
}

// --- Needs ----------------------------------------------------------------------------------

export const CLICK_NEED: NeedRow = {
  id: 'n-push',
  project: 'Acme',
  need: {
    ask: {
      kind: 'decision',
      options: [
        {
          label: 'Push and open the pull request',
          recommended: 'the delivery rules ask for it here',
        },
        { label: 'Not yet' },
      ],
    },
    title: 'billing waits for your click to push and open its pull request',
    text: 'The Project’s delivery rules push billing on a click: its changes touch the ledger.',
    when: '3 min',
  },
}

export const SIGNED_OUT_NEED: NeedRow = {
  id: 'n-gh',
  project: 'Acme',
  need: {
    ask: { kind: 'environment', action: 'Check again' },
    title: 'GitHub’s CLI is signed out',
    text: 'Run `gh auth login` in a terminal, then Check again. The pushes go on; opening the pull requests waits.',
    when: '1 min',
  },
}

export const RED_RERUN_NEED: NeedRow = {
  id: 'n-red',
  project: 'Acme',
  need: {
    ask: {
      kind: 'error',
      attempts: [
        {
          what: 'Re-ran web · unit tests, touched by the change made outside Hemera',
          output:
            "FAIL src/billing/export-row.test.tsx\n  ● formats a yen amount\n    expected '¥1,200' received '¥1,200.00'",
        },
      ],
    },
    title: 'Ship stopped: web · unit tests are red after the re-run',
    when: 'now',
  },
}

// --- Moments --------------------------------------------------------------------------------

/** Review entered: everything proven, the round history empty, two proofs to verify by hand. */
function entering(): ReviewMoment {
  return {
    face: 'question',
    now: 'Review is yours: every test proof is green and the final checks passed.',
    progress: { step: 'Review', detail: '12 of 14 proofs green · 2 to verify by hand' },
    round: 0,
    ball: { ball: 'you' },
    needs: [],
    remarks: [],
    fixable: false,
    rounds: [],
    team: [],
    pulls: [],
    forge: 'GitHub',
    services: SERVICES,
    proofs: PROOFS,
    checks: CHECKS,
    findings: FINDINGS,
    saw: SAW,
    after: AFTER,
    noDocChange:
      'No user documentation mentions the billing page’s toolbar; the API reference is generated from the code.',
    changes: CHANGES,
    refusals: ['S12 and S13 wait for you to verify them'],
    preview: { ...PREVIEW, unvalidated: [] },
  }
}

/** S12 validated by the user, S13 refused with its reason. */
const verified = (proofs: readonly Proof[]): readonly Proof[] =>
  edit(
    edit(
      proofs,
      (one) => one.id === 'S12',
      () => ({ state: 'validated' }),
    ),
    (one) => one.id === 'S13',
    () => ({ state: 'refused', reason: 'The label still wraps under its icon at 1024 pixels.' }),
  )

/** Round 1 back, the next round being written: the moment the feedback is designed for. */
function feedback(): ReviewMoment {
  return {
    ...entering(),
    face: 'question',
    now: 'Round 1 is back: 3 remarks addressed wait for you to resolve them.',
    progress: { step: 'Review · round 1', detail: '4 remarks wait to be sent' },
    round: 1,
    remarks: [...ROUND_ONE, ...WAITING],
    fixable: true,
    rounds: [ROUND_ONE_BACK],
    proofs: verified(PROOFS),
    pulls: PULLS_OPEN,
    refusals: ['4 remarks are not sent', '3 addressed remarks wait for you'],
  }
}

/** Fix pressed: the agent grills the remarks before round 2 starts. */
function grilling(): ReviewMoment {
  const moment = feedback()
  return {
    ...moment,
    face: 'question',
    now: 'Before round 2, the agent asks 2 questions about your remarks.',
    progress: { step: 'Round 2', detail: 'questions · wave 2 of 2' },
    round: 2,
    remarks: edit(
      moment.remarks,
      (one) => one.state === 'waiting',
      () => ({ state: 'inRound', round: 2 }),
    ),
    fixable: false,
    rounds: [ROUND_TWO_GRILLING, ROUND_ONE_BACK],
    refusals: ['round 2 is open', 'Q2 and Q3 wait for your answer'],
  }
}

/** Round 2 came back: the agent answered each remark; the user resolves or follows up. */
function back(): ReviewMoment {
  const moment = feedback()
  const answers = new Map([
    [
      'F6',
      'The export now reads the filters from the URL when pressed. S17 changes the filter twice before exporting, and is green.',
    ],
    ['F7', 'The progress appears after one second only (decision D5).'],
    ['F8', 'The query selects the eleven columns R1 lists, plus `ledger_ref` (your answer to Q3).'],
    ['F9', 'From the URL, at the press: see F6.'],
  ])
  return {
    ...moment,
    face: 'question',
    now: 'Round 2 is back: 4 remarks addressed wait for you to resolve them.',
    progress: { step: 'Review · round 2', detail: '4 addressed · 2 resolved' },
    round: 2,
    remarks: [
      ...edit(
        moment.remarks,
        (one) => one.state === 'addressed',
        () => ({ state: 'resolved' as const }),
      ).filter((one) => one.state !== 'waiting'),
      ...edit(
        moment.remarks.filter((one) => one.state === 'waiting'),
        all,
        (one) => ({ state: 'addressed' as const, round: 2, answer: answers.get(one.id) }),
      ),
    ],
    rounds: [
      {
        ...ROUND_TWO_BUILDING,
        state: 'back',
        backAt: '11:02',
        building: undefined,
        points: edit(ROUND_TWO_POINTS, all, (one) => ({
          state: 'done',
          conflict:
            one.conflict === undefined
              ? undefined
              : {
                  ...one.conflict,
                  outcome: 'clarified',
                  note: 'D5 replaces the row threshold of R4.',
                },
        })),
      },
      ROUND_ONE_CLOSED,
    ],
    refusals: ['4 addressed remarks wait for you'],
  }
}

/** Everything settled, the pull requests open and green: Ship can be pressed. */
function ready(): ReviewMoment {
  const moment = back()
  return {
    ...moment,
    face: 'done',
    now: 'Nothing waits: Ship when you are satisfied.',
    progress: { step: 'Review · round 2', detail: 'every remark resolved · 5 pull requests green' },
    ball: { ball: 'you' },
    remarks: edit(
      moment.remarks,
      (one) => one.state === 'addressed',
      () => ({ state: 'resolved' }),
    ),
    rounds: edit(moment.rounds, all, () => ({ state: 'closed' })),
    proofs: edit(
      PROOFS,
      (one) => one.how === 'hand',
      () => ({ state: 'validated' }),
    ),
    team: edit(TEAM, all, () => ({ state: 'resolved' })),
    refusals: [],
  }
}

export const MOMENTS = {
  entering,
  /** Proofs verified by hand: one validated, one refused with its reason. */
  verified: (): ReviewMoment => ({
    ...entering(),
    proofs: verified(PROOFS),
    now: 'S13 was refused: write a remark for it, or Fix sends it as is.',
    refusals: [],
  }),
  services: (): ReviewMoment => ({
    ...entering(),
    now: 'Test it live: api and web run, mailpit could not start.',
  }),
  writing: (): ReviewMoment => ({
    ...feedback(),
    remarks: ROUND_ONE,
    fixable: false,
    progress: { step: 'Review · round 1', detail: '3 addressed wait for you' },
    refusals: ['3 addressed remarks wait for you'],
  }),
  feedback,
  grilling,
  /** Round 2 answered: the mission is in Building · round 2. */
  building: (): ReviewMoment => {
    const moment = grilling()
    return {
      ...moment,
      stage: 'Building',
      face: 'writing',
      now: 'Builder reads the filters from the URL at each export (P4).',
      progress: { step: 'Round 2', detail: '1 of 4 points done' },
      ball: { ball: 'agent' },
      rounds: [ROUND_TWO_BUILDING, ROUND_ONE_BACK],
      refusals: [],
    }
  },
  back,
  /** Round 2 back, one remark answered with a mission of its own: it is started from there. */
  toAMission: (): ReviewMoment => {
    const moment = back()
    return {
      ...moment,
      remarks: edit(
        moment.remarks,
        (one) => one.id === 'F9',
        () => ({
          answer:
            'This asks for something the Spec never wanted: a mission of its own, started from this remark.',
          toMission: true,
        }),
      ),
    }
  },
  team: (): ReviewMoment => ({
    ...feedback(),
    now: '2 comments of the team wait for your take.',
    team: TEAM,
  }),
  pulls: (): ReviewMoment => ({
    ...feedback(),
    now: 'billing waits for your click to push and open its pull request.',
    needs: [CLICK_NEED, SIGNED_OUT_NEED],
    pulls: PULLS_EVERY_STATE,
    refusals: ['billing’s pull request is not open', 'web’s CI runs'],
  }),
  /** Every pull request open; only the team's approval and a CI hold Ship. */
  waitingOnTeam: (): ReviewMoment => {
    const moment = ready()
    return {
      ...moment,
      face: 'asleep',
      now: 'Waiting on the team: api #412 needs an approval, web #413’s CI runs.',
      ball: {
        ball: 'someone',
        words: 'Waiting on ana.lopez’s approval of api #412 and web #413’s CI',
      },
      pulls: edit(
        edit(
          PULLS_OPEN,
          (one) => one.repository === 'api',
          () => ({
            approvals: { given: 0, needed: 1 },
          }),
        ),
        (one) => one.repository === 'web',
        () => ({ ci: 'running' }),
      ),
      refusals: ['api #412 needs 1 approval', 'web #413’s CI runs'],
    }
  },
  outside: (): ReviewMoment => {
    const moment = ready()
    return {
      ...moment,
      now: 'web was changed outside Hemera: Ship re-runs what it touches.',
      changes: edit(
        CHANGES,
        (one) => one.repository === 'web',
        () => ({ outside: ['web/src/billing/export-row.tsx', 'web/src/billing/format.ts'] }),
      ),
      proofs: edit(
        moment.proofs,
        (one) => one.id === 'S8',
        () => ({ redo: true }),
      ),
      checks: edit(
        CHECKS,
        (one) => one.repository === 'web' && one.name !== 'end-to-end',
        () => ({ redo: true }),
      ),
    }
  },
  ready,
  /** Ship pressed with changes made outside Hemera: the re-runs before the push. */
  shipping: (): ReviewMoment => ({
    ...ready(),
    face: 'checking',
    now: 'Re-running what the changes made outside Hemera touch, before pushing.',
    progress: { step: 'Ship', detail: '1 of 3 re-run' },
    ball: { ball: 'agent' },
    shipping: {
      reruns: [
        { id: 'S8', what: 'S8 · A yen invoice keeps no decimals', state: 'done' },
        { id: 'web-typecheck', what: 'web · typecheck', state: 'running' },
        { id: 'web-unit', what: 'web · unit tests', state: 'todo' },
      ],
    },
    refusals: [],
  }),
  stopped: (): ReviewMoment => ({
    ...ready(),
    face: 'error',
    now: 'Ship stopped: web · unit tests are red after the re-run. Nothing was pushed.',
    progress: { step: 'Ship', detail: 'stopped at 3 of 3' },
    needs: [RED_RERUN_NEED],
    shipping: {
      reruns: [
        { id: 'S8', what: 'S8 · A yen invoice keeps no decimals', state: 'done' },
        { id: 'web-typecheck', what: 'web · typecheck', state: 'done' },
        {
          id: 'web-unit',
          what: 'web · unit tests',
          state: 'failed',
          tail: [
            'FAIL src/billing/export-row.test.tsx',
            '  ● formats a yen amount',
            "    expected '¥1,200' received '¥1,200.00'",
          ],
        },
      ],
      stopped: 'web · unit tests are red after the re-run',
    },
    refusals: ['web · unit tests are red after the re-run'],
  }),
  /** A Project with the Local preset: no forge, Ship is "Mark as delivered". */
  local: (): ReviewMoment => ({
    ...ready(),
    pulls: [],
    forge: null,
    team: [],
  }),
} as const satisfies Record<string, () => ReviewMoment>

export type MomentName = keyof typeof MOMENTS

/** What the confirmation lists when the Ship goes out with everything there is to say. */
export const FULL_PREVIEW: ShipPreview = {
  ...PREVIEW,
  outside: [
    { repository: 'web', path: 'web/src/billing/export-row.tsx' },
    { repository: 'web', path: 'web/src/billing/format.ts' },
  ],
  redo: ['S8 · A yen invoice keeps no decimals', 'web · typecheck', 'web · unit tests'],
  unvalidated: [{ id: 'S13', title: 'The export button reads well on a narrow window' }],
  rules: [
    {
      what: 'web’s merge',
      before: 'squash',
      now: 'rebase',
    },
  ],
  ci: edit(
    PREVIEW.ci,
    (one) => one.repository === 'web',
    () => ({ state: 'running', words: 'running' }),
  ),
}

export const LOCAL_PREVIEW: ShipPreview = {
  ...PREVIEW,
  ci: [],
  local: { merges: REPOSITORIES.map((repository) => ({ repository, into: 'develop' })) },
}
