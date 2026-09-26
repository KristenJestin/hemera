import type {
  GateCheck,
  GateCheckView,
  PhaseState,
  PhaseView,
  ReadinessItem,
  ReadinessView,
  SectionView,
  SpecQuestionView,
  SpecView,
  StoryView,
  TaskView,
} from './model.ts'
import { GATE_CHECKS } from './model.ts'

/**
 * The Spec the stories are drawn with: the CSV invoice export of the Project Atlas, `ATL-7`,
 * and the rounding bug beside it, `ATL-12` (lot 19, the prototype's example).
 *
 * One Spec, taken through the eight screens of the brief, so that what changes from one story
 * to the next is the state and never the words: shaped and being planned, ready, reworked, read
 * from a second Session. Consistent with the product rules on purpose: no task
 * exists before `decompose` opens, and a gate is only full when every phase has finished.
 */

/** The four phases, from the states of the three that can be worked; `prototype` is never on. */
export function phases(shape: PhaseState, plan: PhaseState, decompose: PhaseState): PhaseView[] {
  return [
    { name: 'shape', state: shape },
    { name: 'plan', state: plan },
    { name: 'decompose', state: decompose },
    { name: 'prototype', state: 'unavailable' },
  ]
}

/**
 * The seven checks, every one met but those named with what fails and those `unmet`: passing on
 * nothing — no task, so no broken link and no cycle — which leaves their segment empty (#130).
 */
export function gate(
  failing: Partial<Record<GateCheck, string>>,
  todo: ReadinessItem[],
  unmet: readonly GateCheck[] = [],
): ReadinessView {
  const checks: GateCheckView[] = GATE_CHECKS.map((check) => {
    const detail = failing[check]
    return detail === undefined
      ? { check, passed: !unmet.includes(check) }
      : { check, passed: false, detail }
  })
  return { checks, todo }
}

/** Every check passing, nothing left to do. */
export const FULL_GATE: ReadinessView = gate({}, [])

const PROBLEM: SectionView = {
  name: 'problem',
  body: 'Accountants rebuild each month of invoices by hand in their ledger: the billing page shows a month, but it cannot hand it over. The September close took two days of retyping.',
  author: 'agent',
  mark: 'agent',
}

const OUTCOME: SectionView = {
  name: 'expected_outcome',
  body: 'An accountant picks a month on the billing page and downloads one CSV file holding every invoice and credit note issued that month, one row per line, in the columns their ledger imports.\n\nThe total of the file equals the total the billing page shows for the same month.',
  author: 'agent',
  mark: 'agent',
}

const SCOPE_TEXT =
  'In: invoices and credit notes issued in the chosen month, in every currency, from the Export button of the billing page.\n\nOut: scheduled exports, PDF, filtering by client.'

const SCOPE: SectionView = {
  name: 'scope',
  body: SCOPE_TEXT,
  author: 'human',
  mark: 'human',
}

const VERIFICATION: SectionView = {
  name: 'verification',
  body: 'Export September on the demo account and import the file into the ledger: no row is refused, and the file total equals the billing page total for the month. An empty month downloads the header row only.',
  author: 'agent',
  mark: 'agent',
}

const BEHAVIOUR: SectionView = {
  name: 'behaviour',
  body: 'The billing page gains an **Export** button beside the month picker. It downloads `invoices-2026-09.csv`: one row per invoice line, in the column order of the ledger, credit notes as negative rows.',
  author: 'agent',
  mark: 'agent',
}

const PLAN_TEXT =
  'Reuse the invoice query of `export.service.ts`, grouped by issue date, and stream its rows through the CSV writer of `shared/csv`. The endpoint lives beside the PDF export and takes the month as `YYYY-MM`.\n\nCredit notes come from the same query with their sign kept. Risk: the ledger rejects a file above 10 000 rows; one month of the largest account is 6 400.\n\nVerification: an integration test per story, and T4 by hand on the September data.'

const PLAN: SectionView = {
  name: 'plan',
  body: PLAN_TEXT,
  author: 'agent',
  mark: 'agent',
}

/** The plan while the agent is still writing it: its first paragraph, and the pulse. */
const PLAN_WRITING: SectionView = {
  name: 'plan',
  body: 'Reuse the invoice query of `export.service.ts`, grouped by issue date, and stream its rows through the CSV writer of `shared/csv`.',
  author: 'agent',
  mark: 'writing',
}

export const STORIES: StoryView[] = [
  {
    id: 'story-export-a-month',
    key: 'S1',
    title: 'Export a month',
    narrative:
      'As an accountant closing a month, I download every invoice of that month as one CSV, so that I import it into the ledger without retyping.',
    criteria: [
      'One row per invoice line issued in the month, by issue date.',
      'Columns in the order of the ledger: date, number, client, net, VAT, gross, currency.',
      'An empty month downloads the header row only.',
    ],
  },
  {
    id: 'story-credit-notes',
    key: 'S2',
    title: 'Credit notes in the same file',
    narrative:
      'As an accountant, I find credit notes in the same export as negative rows, so that the file total matches the ledger.',
    criteria: [
      'A credit note is a row of type credit with negative amounts.',
      'The file total equals the billing page total for the month.',
    ],
  },
]

export const TASKS: TaskView[] = [
  {
    key: 'T1',
    title: 'The invoice lines of the month, streamed',
    result: 'The export endpoint returns every line issued in the month, in issue-date order.',
    after: [],
    covers: ['S1'],
    executor: 'agent',
  },
  {
    key: 'T2',
    title: 'A CSV in the column order of the ledger',
    result:
      'The Export button of the billing page downloads the file; an empty month gives the header only.',
    after: ['T1'],
    covers: ['S1'],
    executor: 'agent',
  },
  {
    key: 'T3',
    title: 'Credit notes as negative rows',
    result:
      'A credit note is a row of type `credit` with negative amounts; the total still matches.',
    after: ['T1'],
    covers: ['S2'],
    executor: 'agent',
  },
  {
    key: 'T4',
    title: 'The file imports into the ledger',
    result: 'The September file imports without an error and its total equals the billing page.',
    after: ['T2', 'T3'],
    covers: ['S1', 'S2'],
    executor: 'human',
  },
]

export const CREDIT_NOTES: SpecQuestionView = {
  id: 'q-credit-notes',
  body: 'Credit notes: negative rows in the same file, or left out of the export?',
  blocking: true,
  phase: 'plan',
  stories: ['S2'],
  options: [
    { id: 'negative', label: 'Negative rows in the same file', recommended: true },
    { id: 'separate', label: 'A second file for credit notes' },
    { id: 'omitted', label: 'Left out of the export' },
  ],
  answer: null,
}

const WHICH_DATE: SpecQuestionView = {
  id: 'q-which-date',
  body: 'Which date decides the month: the issue date or the payment date?',
  blocking: true,
  phase: 'shape',
  options: [
    { id: 'issue', label: 'The issue date', recommended: true },
    { id: 'payment', label: 'The payment date' },
  ],
  answer: { optionId: 'issue' },
}

export const QUESTIONS: SpecQuestionView[] = [CREDIT_NOTES, WHICH_DATE]

/** The rounding question of the bug, open. */
export const ROUNDING: SpecQuestionView = {
  id: 'q-rounding',
  body: 'Is the total the sum of the lines as printed, or one rounding of the raw amounts?',
  blocking: true,
  phase: 'shape',
  options: [
    { id: 'lines', label: 'The sum of the lines as printed', recommended: true },
    { id: 'raw', label: 'One rounding of the raw amounts' },
  ],
  answer: null,
}

/** The revisions of ATL-7 once it has been frozen at 2. */
const FROZEN_REVISIONS = [
  { number: 2, detail: 'Latest · ready' },
  { number: 1, detail: 'Marked ready 22 Sep · read only' },
]

/** The same three facts every mid-plan gate says: no task yet, a question, plan still open. */
const MID_PLAN_GATE = gate(
  {
    coverage: 'coverage · no task yet',
    questions: 'questions · 1 blocking',
    phases: 'phases · plan open',
    attestation: 'attestation · not given',
  },
  [
    { label: 'the tasks', target: 'tasks' },
    { label: 'the credit-note question', target: 'questions' },
    { label: 'plan and decompose', target: 'plan' },
    { label: "the agent's final check" },
  ],
  ['references', 'cycle'],
)

/**
 * Screen 1 · a `feature`, shaped and being planned: the plan is being written, a question is
 * open, and no task exists yet because `decompose` has not opened. One check of seven is met: the
 * contract; the links and the cycles pass on no task at all, which meets nothing.
 */
export const MID_PLAN: SpecView = {
  key: 'ATL-7',
  title: 'CSV invoice export',
  type: 'feature',
  status: 'draft',
  revision: 1,
  revisions: [{ number: 1, detail: 'Latest · draft' }],
  phases: phases('finished', 'open', 'pending'),
  focus: 'plan',
  sections: [PROBLEM, OUTCOME, SCOPE, VERIFICATION, BEHAVIOUR, PLAN_WRITING],
  stories: STORIES,
  storiesMark: 'agent',
  tasks: [],
  tasksMark: 'empty',
  questions: QUESTIONS,
  questionsMark: 'agent',
  readiness: MID_PLAN_GATE,
}

/**
 * Screen 2 · a `bug`, being shaped: its contract has `Reproduction` and never `Behaviour`, the
 * steps were edited by you, and scope and verification are still to be written.
 */
export const BUG: SpecView = {
  key: 'ATL-12',
  title: 'Totals off by a cent on multi-currency invoices',
  type: 'bug',
  status: 'draft',
  revision: 1,
  revisions: [{ number: 1, detail: 'Latest · draft' }],
  phases: phases('open', 'pending', 'pending'),
  focus: 'reproduction',
  sections: [
    {
      name: 'problem',
      body: 'Invoices in a currency other than the account one show a total one cent above the sum of their lines. Accounting found it on the September close.',
      author: 'agent',
      mark: 'agent',
    },
    {
      name: 'expected_outcome',
      body: 'The total of an invoice is the sum of its lines as printed, in every currency.',
      author: 'agent',
      mark: 'agent',
    },
    { name: 'scope', body: '', author: null, mark: 'empty' },
    { name: 'verification', body: '', author: null, mark: 'empty' },
    {
      name: 'reproduction',
      body: '1. Create an invoice in EUR with three lines at 19.99, 0.35 and 7.10, VAT 20 %.\n2. Switch the account currency to USD and open the invoice.\n3. Compare the total with the sum of the lines.\n\nObserved: the total is 33.93 USD, one cent above the lines.\nExpected: 33.92 USD, the sum of the lines as printed.',
      author: 'human',
      mark: 'human',
      note: 'Replayed after the build, by an agent or by you, to see the wrong total is gone.',
    },
    { name: 'plan', body: '', author: null, mark: 'empty' },
  ],
  stories: [],
  storiesMark: 'empty',
  tasks: [],
  tasksMark: 'empty',
  questions: [ROUNDING],
  questionsMark: 'agent',
  readiness: gate(
    {
      contract: 'contract · scope, verification',
      coverage: 'coverage · no task yet',
      questions: 'questions · 1 blocking',
      phases: 'phases · shape open',
      attestation: 'attestation · not given',
    },
    [
      { label: 'the scope', target: 'scope' },
      { label: 'the verification', target: 'verification' },
      { label: 'the rounding question', target: 'questions' },
      { label: 'the tasks', target: 'tasks' },
      { label: "the agent's final check" },
    ],
    ['references', 'cycle'],
  ),
}

/** Screen 4 · every phase finished and attested, every check passing: ready to freeze. */
export const GATE_FULL: SpecView = {
  ...MID_PLAN,
  phases: phases('finished', 'finished', 'finished'),
  focus: 'tasks',
  sections: [PROBLEM, OUTCOME, SCOPE, VERIFICATION, BEHAVIOUR, PLAN],
  tasks: TASKS,
  tasksMark: 'agent',
  questions: [{ ...CREDIT_NOTES, answer: { optionId: 'negative' } }, WHICH_DATE],
  readiness: FULL_GATE,
}

/** Screen 5 · ready at revision 2: read only, a picker for the older one, and Rework. */
export const READY: SpecView = {
  ...GATE_FULL,
  status: 'ready',
  revision: 2,
  revisions: FROZEN_REVISIONS,
  focus: undefined,
}

/**
 * The same Spec, its older revision 1 picked: read as it was marked ready, with no editor and no
 * Rework, since only the current revision can be reworked (D7-05).
 */
export const OLDER_REVISION: SpecView = {
  ...READY,
  revision: 1,
  replacedBy: 2,
}

/**
 * Screen 6 · the same draft read from a second Session while the writer's agent splits the
 * tasks: three are written, and S2 has none yet.
 */
export const READER: SpecView = {
  ...MID_PLAN,
  phases: phases('finished', 'finished', 'open'),
  focus: 'tasks',
  sections: [PROBLEM, OUTCOME, SCOPE, VERIFICATION, BEHAVIOUR, PLAN],
  tasks: TASKS.slice(0, 2).concat(TASKS[3]!),
  tasksMark: 'writing',
  questions: GATE_FULL.questions,
  readiness: gate(
    {
      coverage: 'coverage · S2 has no task',
      phases: 'phases · decompose open',
      attestation: 'attestation · not given',
    },
    [
      { label: 'a task for S2', target: 'tasks' },
      { label: 'decompose', target: 'tasks' },
      { label: "the agent's final check" },
    ],
  ),
}

/**
 * Screen 8 · reworked into revision 3: a complete copy, whose plan and tasks are stale until
 * the agent declares them again; shape still holds.
 */
export const STALE: SpecView = {
  ...GATE_FULL,
  revision: 3,
  revisions: [
    { number: 3, detail: 'Latest · draft' },
    { number: 2, detail: 'Marked ready 23 Sep · read only' },
    { number: 1, detail: 'Marked ready 22 Sep · read only' },
  ],
  phases: phases('finished', 'stale', 'stale'),
  focus: 'plan',
  sections: [
    PROBLEM,
    OUTCOME,
    SCOPE,
    VERIFICATION,
    BEHAVIOUR,
    { ...PLAN, mark: 'stale', copiedFrom: 2 },
  ],
  tasksMark: 'stale',
  readiness: gate(
    {
      phases: 'phases · plan and decompose stale',
      attestation: 'attestation · not given',
    },
    [{ label: 'plan and decompose', target: 'plan' }, { label: "the agent's final check" }],
  ),
}

/** A `maintenance` Spec, shaped: its own section is the invariants it must keep. */
export const MAINTENANCE: SpecView = {
  key: 'ATL-15',
  title: 'Move the invoice PDFs to the object store',
  type: 'maintenance',
  status: 'draft',
  revision: 1,
  revisions: [{ number: 1, detail: 'Latest · draft' }],
  phases: phases('finished', 'open', 'pending'),
  focus: 'invariants',
  sections: [
    {
      name: 'problem',
      body: 'The invoice PDFs fill the disk of the application server: 180 GB, growing by 6 GB a month.',
      author: 'agent',
      mark: 'agent',
    },
    {
      name: 'expected_outcome',
      body: 'Every PDF lives in the object store, and the server keeps none.',
      author: 'agent',
      mark: 'agent',
    },
    {
      name: 'scope',
      body: 'In: the PDFs of invoices and credit notes, old and new.\n\nOut: the exports, which are streamed and never stored.',
      author: 'agent',
      mark: 'agent',
    },
    {
      name: 'verification',
      body: 'Every invoice of the demo account opens its PDF after the migration, and the disk holds none.',
      author: 'agent',
      mark: 'agent',
    },
    {
      name: 'invariants',
      body: '- The URL of a PDF sent to a client keeps working.\n- A PDF, once issued, is never regenerated.\n- Nobody but the account can read it.',
      author: 'human',
      mark: 'human',
    },
    { name: 'plan', body: '', author: null, mark: 'writing' },
  ],
  stories: [],
  storiesMark: 'empty',
  tasks: [],
  tasksMark: 'empty',
  questions: [],
  questionsMark: 'empty',
  readiness: gate(
    {
      coverage: 'coverage · no task yet',
      phases: 'phases · plan open',
      attestation: 'attestation · not given',
    },
    [
      { label: 'the tasks', target: 'tasks' },
      { label: 'plan and decompose', target: 'plan' },
      { label: "the agent's final check" },
    ],
  ),
}

/**
 * The feature one answer away from ready: every phase finished and attested, the tasks written,
 * and the credit-note question still open. Answering it is what lets it be marked ready.
 */
export const ONE_QUESTION_LEFT: SpecView = {
  ...GATE_FULL,
  focus: 'questions',
  questions: QUESTIONS,
  readiness: gate({ questions: 'questions · 1 blocking' }, [
    { label: 'the credit-note question', target: 'questions' },
  ]),
}

/**
 * The Spec a `free` Session has just created from its conversation: `shape` open, the agent
 * writing the problem, nothing else written yet.
 */
export const JUST_CREATED: SpecView = {
  key: 'ATL-7',
  title: 'CSV invoice export',
  type: 'feature',
  status: 'draft',
  revision: 1,
  revisions: [{ number: 1, detail: 'Latest · draft' }],
  phases: phases('open', 'pending', 'pending'),
  focus: 'problem',
  sections: [
    {
      name: 'problem',
      body: 'Accountants rebuild each month of invoices by hand in their ledger.',
      author: 'agent',
      mark: 'writing',
    },
  ],
  stories: [],
  storiesMark: 'empty',
  tasks: [],
  tasksMark: 'empty',
  questions: [],
  questionsMark: 'empty',
  readiness: gate(
    {
      contract: 'contract · outcome, scope, verification, behaviour',
      coverage: 'coverage · no task yet',
      phases: 'phases · shape open',
      attestation: 'attestation · not given',
    },
    [
      { label: 'the expected outcome', target: 'expected_outcome' },
      { label: 'the scope', target: 'scope' },
      { label: 'the verification', target: 'verification' },
      { label: 'the tasks', target: 'tasks' },
      { label: "the agent's final check" },
    ],
  ),
}
