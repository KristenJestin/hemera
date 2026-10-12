import type {
  AnswerVersion,
  ColdReadPass,
  Finding,
  PlanningData,
  Probe,
  Question,
  SpecSection,
  Wave,
} from '../../blocks/planning/planning-types.ts'
import type { Planner, PlanningFacts } from '../../blocks/planning/planning-progress.ts'
import {
  DEPENDENCIES,
  REQUIREMENTS,
  TASKS,
  WRITTEN,
} from '../../surfaces/planning/planning-fixtures.ts'

/**
 * ACME-12, "Export notes as Markdown", at a real size: eight questions, a cold read
 * of seven findings of a paragraph each, two Probes, five permission requests, and a Spec half
 * written. Each moment of the journey the page must make readable is one function.
 */

const NOW = Date.now()

const SECONDS = 1000

/** A permission an agent of the mission asks for: the command, who asks, and why. */
export interface PermissionAsk {
  id: string
  /** Who asks, as the page names it: `Probe #2`, `Planner`. */
  who: string
  command: string
  /** Why the agent wants it, in its words. */
  agentReason: string
  /** Why Hemera asks rather than allows. */
  hemeraReason: string
  when: string
}

/** One moment of the journey: what the page knows, and the permissions that wait. */
export interface AttentionMoment extends PlanningFacts {
  permissions: readonly PermissionAsk[]
}

const IDLE: Planner = { state: 'idle', doing: null, next: null, reason: null }

const working = (doing: string, next: string | null = null): Planner => ({
  state: 'working',
  doing,
  next,
  reason: null,
})

const answer = (
  optionId: string | null,
  inputState: AnswerVersion['inputState'],
  at: string,
  text: string | null = null,
): AnswerVersion => ({ version: 1, optionId, text, at, inputState })

/** A question with what every question has; what differs is given. */
function question(
  given: Pick<
    Question,
    'id' | 'wave' | 'text' | 'why' | 'options' | 'recommended' | 'recommendedReason' | 'section'
  > &
    Partial<Question>,
): Question {
  return {
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
  }
}

const Q1 = question({
  id: 'Q1',
  wave: 1,
  text: 'Should a note’s attachments leave with it?',
  why: 'A note can hold images and files; a Markdown file alone cannot carry them.',
  options: [
    { id: 'A', label: 'As links', detail: 'The file points where the attachment lives in Acme.' },
    { id: 'B', label: 'As files beside it', detail: 'An archive per note, even for one note.' },
  ],
  recommended: 'A',
  recommendedReason: 'Links keep one file per note, which is what acme/shop#41 asks for.',
  section: 'decisions',
})

const Q2 = question({
  id: 'Q2',
  wave: 1,
  text: 'Which Markdown?',
  why: 'Notes hold tables, which plain Markdown has no syntax for.',
  options: [
    { id: 'A', label: 'CommonMark', detail: 'Tables become HTML inside the file.' },
    { id: 'B', label: 'GitHub-flavoured Markdown', detail: 'Tables stay tables.' },
  ],
  recommended: 'B',
  recommendedReason: 'Every editor the ticket names reads GitHub-flavoured tables.',
  section: 'decisions',
})

const Q3 = question({
  id: 'Q3',
  wave: 1,
  text: 'Does the front matter hold every field of the note, or only its title?',
  why: 'A wiki reads the front matter; fields it does not know it keeps as they are.',
  options: [
    {
      id: 'A',
      label: 'Every field',
      detail: 'Title, author, dates and tags: the file says all Acme knows.',
    },
    { id: 'B', label: 'Only the title', detail: 'A shorter file; the rest is lost.' },
  ],
  recommended: 'A',
  recommendedReason: 'shared/src/notes/fields.ts lists them already; writing them costs nothing.',
  section: 'R1',
})

const Q4 = question({
  id: 'Q4',
  wave: 1,
  text: 'Who may export a shared note?',
  why: 'A shared note can be read by people outside its workspace; an export is a copy that leaves Acme.',
  options: [
    {
      id: 'A',
      label: 'Anyone who can read it',
      detail: 'The same rule as reading: a file is what they see.',
    },
    { id: 'B', label: 'Only its owner', detail: 'Safer, but readers will copy and paste instead.' },
    { id: 'C', label: 'Its owner and its editors', detail: 'Readers see Export greyed out.' },
  ],
  recommended: 'A',
  recommendedReason:
    'api/src/policies/notes.ts lets every reader fetch the whole body already: refusing the export protects nothing.',
  section: 'R1',
})

const Q5 = question({
  id: 'Q5',
  wave: 1,
  text: 'What is the file called when the note has no title?',
  why: 'A file needs a name; about one note in twenty has no title today.',
  options: [
    {
      id: 'A',
      label: '“Untitled note.md”',
      detail: 'Numbered when there are several in an archive.',
    },
    { id: 'B', label: 'The first line of the body', detail: 'Cut at 60 characters.' },
  ],
  recommended: 'A',
  recommendedReason: 'web already shows “Untitled note” for such a note (web/src/notes/title.tsx).',
  section: 'R2',
})

const Q6 = question({
  id: 'Q6',
  wave: 1,
  text: 'From how many notes does an export run in the background?',
  why: 'Below it, the file comes in the same request; above it, a job writes an archive and says when it is ready.',
  options: [
    { id: 'A', label: '1 000 notes', detail: 'Rarely more than two seconds.' },
    { id: 'B', label: '5 000 notes', detail: 'Up to ten seconds on the largest workspace.' },
  ],
  recommended: 'A',
  recommendedReason: 'The request timeout of api is ten seconds; 1 000 keeps a margin.',
  section: 'R3',
  state: 'waiting',
  waitingNote: 'The support team knows the largest workspaces.',
})

const Q7 = question({
  id: 'Q7',
  wave: 1,
  text: 'Are the dates written in the reader’s time zone or in UTC?',
  why: 'The front matter keeps created and updated dates; a wiki shows them as they are written.',
  options: [
    { id: 'A', label: 'UTC, with its offset', detail: 'The same file wherever it is opened.' },
    { id: 'B', label: 'The exporter’s time zone', detail: 'Reads naturally, differs per person.' },
  ],
  recommended: 'A',
  recommendedReason: 'api stores UTC already (api/src/notes/model.ts); nothing to convert.',
  section: 'R1',
})

const Q8 = question({
  id: 'Q8',
  wave: 1,
  text: 'Do tags go in the front matter, or as a line at the end of the body?',
  why: 'Some wikis read tags from the front matter, others from #words in the text.',
  options: [
    { id: 'A', label: 'In the front matter', detail: 'A list, as wikis read them.' },
    {
      id: 'B',
      label: 'As #tags at the end',
      detail: 'Visible in any editor, harder to read back.',
    },
  ],
  recommended: 'A',
  recommendedReason: 'The three wikis the ticket names read tags from the front matter.',
  section: 'R1',
})

const answered = (q: Question, given: AnswerVersion): Question => ({
  ...q,
  state: 'answered',
  waitingNote: null,
  answers: [given],
})

/**
 * The questions as the page sees them: one list that grows, in the order they were asked. The
 * data still carries waves until the build drops them; the page draws none.
 */
function asked(questions: readonly Question[]): Wave[] {
  return [{ number: 1, askedAt: '10:12', questions }]
}

/** Half of the Spec: Why, Goals and Impact written, Requirements being written, the rest empty. */
const HALF: readonly SpecSection[] = WRITTEN.map((section) =>
  ['why', 'goals', 'impact'].includes(section.name)
    ? section
    : { ...section, body: '', state: 'empty' },
)

const EMPTY: readonly SpecSection[] = WRITTEN.map((section) => ({
  ...section,
  body: '',
  state: 'empty',
}))

/** A finding of the cold read, open unless said. */
const finding = (
  id: string,
  severity: Finding['severity'],
  where: string,
  text: string,
  fate: Partial<Finding> = {},
): Finding => ({
  id,
  severity,
  where: [where],
  text,
  tasksOnly: false,
  fate: 'open',
  questionId: null,
  fixedWhat: null,
  ...fate,
})

/** Seven findings, a paragraph each, as a fresh reader writes them. */
const FINDINGS: readonly Finding[] = [
  finding(
    'C1.F1',
    'blocking',
    'R2',
    'R2 says the characters a file system refuses are dropped, but not which file system: a name valid on Linux can be refused on Windows, where a colon, a question mark and a trailing dot are forbidden. A developer reading R2 alone would drop only the slash, and the archive opened on Windows would fail on the notes Probe #1 seeded.',
  ),
  finding(
    'C1.F2',
    'blocking',
    'R3',
    'R3 sends a selection of more than 1 000 notes to a job, but says nothing of what the user sees while it runs, nor where the archive goes once it is written. Without it, the developer of web will invent a toast, a page or a mail, and the scenario R3.S1 cannot be checked.',
  ),
  finding(
    'C1.F3',
    'warning',
    'R1',
    'R1 names the front matter’s fields as “its fields”, while Decisions lists title, author, dates and tags. A reader of R1 alone cannot tell whether a field added to notes later is exported too; the Spec should say whether the list is closed.',
  ),
  finding(
    'C1.F4',
    'warning',
    'impact',
    'Impact names a new route in api and a job, but not the queue the job runs on. api has two today, one shared with the mail digests that runs every hour; a large export on it would wait behind them, which nothing in the Spec accounts for.',
  ),
  finding(
    'C1.F5',
    'warning',
    'R1.S1',
    'R1.S1 expects the body “byte for byte” against a fixture, but the front matter holds the export’s date, which changes every run. As written, the proof fails every time it runs after the day the fixture was made.',
  ),
  finding(
    'C1.F6',
    'suggestion',
    'why',
    'Why could say who asked for the export and what they do with the file today, so that a reader who doubts a decision knows whom to ask. The ticket names the support team; the Spec does not.',
    { fate: 'dismissed' },
  ),
  finding(
    'C1.F7',
    'blocking',
    'T4',
    'T4 changes web/src/notes/export-button.tsx, which does not exist at the base commit: the button is new, and the task should create it rather than change it.',
    { tasksOnly: true, fate: 'fixed', fixedWhat: 'T4 now creates it.' },
  ),
]

const PASS: ColdReadPass = {
  id: 'c1',
  label: 'C1',
  requestedBy: 'hemera',
  state: 'done',
  stuck: false,
  startedAt: NOW - 600 * SECONDS,
  endedAt: NOW - 420 * SECONDS,
  failure: null,
  findings: FINDINGS,
}

const PROBES: readonly Probe[] = [
  {
    id: 'p1',
    label: '#1',
    question: 'Does a title with a slash break the export today?',
    scenario: 'R2.S1',
    state: 'running',
    stuck: false,
    startedAt: NOW - 140 * SECONDS,
    endedAt: null,
    outcome: null,
    step: 'Runs the export test of api on a seeded note',
  },
  {
    id: 'p2',
    label: '#2',
    question: 'How long does api take to export 5 000 notes?',
    scenario: 'R3.S1',
    state: 'running',
    stuck: false,
    startedAt: NOW - 84 * SECONDS,
    endedAt: null,
    outcome: null,
    step: 'Seeding 5 000 notes in a copy of the workspace “Large”',
  },
]

const ENDED_PROBES: readonly Probe[] = PROBES.map((probe, index) => ({
  ...probe,
  state: 'done',
  endedAt: NOW - (300 - index * 60) * SECONDS,
  outcome: index === 0 ? 'reproduced' : 'answered',
}))

const OUTSIDE = 'It runs outside the mission’s Workspace.'

export const PERMISSIONS: readonly PermissionAsk[] = [
  {
    id: 'pr1',
    who: 'Probe #1',
    command: 'pnpm --filter api test notes-export',
    agentReason: 'To see whether a slash in a title breaks the export today.',
    hemeraReason: 'Tests of api write to a database: the setting asks first.',
    when: '2 min',
  },
  {
    id: 'pr2',
    who: 'Probe #1',
    command: 'docker compose -f api/compose.test.yml up -d postgres',
    agentReason: 'The export test needs its database running.',
    hemeraReason: OUTSIDE,
    when: '2 min',
  },
  {
    id: 'pr3',
    who: 'Probe #2',
    command: 'node api/scripts/seed-notes.ts --workspace large-copy --count 5000',
    agentReason: 'To time an export of 5 000 notes on a copy of the largest workspace.',
    hemeraReason: 'It writes 5 000 rows: the setting asks before a write of that size.',
    when: '1 min',
  },
  {
    id: 'pr4',
    who: 'Probe #2',
    command:
      'curl -s -o /dev/null -w "%{time_total}" localhost:4000/notes/export?workspace=large-copy',
    agentReason: 'To measure how long the export takes.',
    hemeraReason: 'It calls a server on this machine: the setting asks first.',
    when: '1 min',
  },
  {
    id: 'pr5',
    who: 'Probe #2',
    command: 'psql "$TEST_DATABASE_URL" -c "drop schema large_copy cascade"',
    agentReason: 'To remove the copy once it has its measure.',
    hemeraReason: 'It deletes data: Hemera always asks.',
    when: '40 s',
  },
]

/** The page with nothing written, asked or run: the base of every moment. */
function base(): PlanningData {
  return {
    frozen: false,
    sections: EMPTY,
    requirementsState: 'empty',
    requirements: [],
    tasks: [],
    waves: [],
    discussions: [],
    probes: [],
    passes: [],
    freshness: { current: true, changes: [] },
    dependencies: [],
    changes: [],
    visions: [],
    triage: null,
    ticket: null,
  }
}

const moment = (
  data: Partial<PlanningData>,
  planner: Planner = IDLE,
  more: Partial<AttentionMoment> = {},
): AttentionMoment => ({
  data: { ...base(), ...data },
  planner,
  declaredComplete: false,
  permissions: [],
  ...more,
})

/** The first minutes: the Planner reads what exists before it writes a line. */
export function reading(): AttentionMoment {
  return moment(
    {},
    working(
      'Reads the living spec, the docs and the code of api and web to understand how notes are stored',
      'Write Why and Goals, then ask what it cannot decide alone',
    ),
  )
}

const HALF_WRITTEN: Partial<PlanningData> = {
  sections: HALF,
  requirementsState: 'being_written',
  requirements: REQUIREMENTS.slice(0, 2),
}

/** Eight questions asked: two answered, one waits on someone, five wait for the user. */
export function questionsWaiting(): AttentionMoment {
  return moment({
    ...HALF_WRITTEN,
    requirementsState: 'written',
    waves: asked([
      answered(Q1, answer('A', 'integrated', '10:20')),
      answered(Q2, answer('B', 'integrated', '10:21')),
      Q3,
      Q4,
      Q5,
      Q6,
      Q7,
      Q8,
    ]),
  })
}

/** Every question answered; the Planner takes the last six into account and rewrites. */
export function takingAnswers(): AttentionMoment {
  return moment(
    {
      sections: WRITTEN,
      requirementsState: 'written',
      requirements: REQUIREMENTS,
      tasks: TASKS,
      waves: asked([
        answered(Q1, answer('A', 'integrated', '10:20')),
        answered(Q2, answer('B', 'integrated', '10:21')),
        answered(Q3, answer('A', 'integrated', '10:51')),
        answered(Q4, answer('A', 'delivered', '10:52')),
        answered(Q5, answer('A', 'delivered', '10:52')),
        answered(Q6, answer('A', 'delivered', '11:05')),
        answered(Q7, answer('A', 'received', '11:06')),
        answered(Q8, answer('B', 'received', '11:06')),
      ]),
      dependencies: DEPENDENCIES.filter((dependency) => dependency.state !== 'proposed'),
    },
    working('Takes your answers to Q4–Q8 into account in Requirements and Decisions'),
  )
}

const ALL_SETTLED = (): Wave[] =>
  asked(
    [Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8].map((q) =>
      answered(q, answer(q.recommended, 'integrated', '10:52')),
    ),
  )

/** Declared complete; the cold read reported seven findings, five of them to settle. */
export function coldReadFindings(): AttentionMoment {
  return moment(
    {
      sections: WRITTEN,
      requirementsState: 'written',
      requirements: REQUIREMENTS,
      tasks: TASKS,
      waves: ALL_SETTLED(),
      passes: [PASS],
      probes: ENDED_PROBES,
      dependencies: DEPENDENCIES.filter((dependency) => dependency.state !== 'proposed'),
      visions: [
        {
          id: 'v1',
          text: 'Keep it boring: one file per note, the way a wiki would store it.',
          at: '09:05',
          inputState: 'integrated',
        },
      ],
    },
    IDLE,
    { declaredComplete: true },
  )
}

/** Two Probes run on the half-written Spec and wait on five permissions; the first three questions are answered. */
export function probesWithPermissions(): AttentionMoment {
  return moment(
    {
      ...HALF_WRITTEN,
      waves: asked([
        answered(Q1, answer('A', 'integrated', '10:20')),
        answered(Q2, answer('B', 'integrated', '10:21')),
        answered(Q3, answer('A', 'integrated', '10:22')),
      ]),
      probes: PROBES,
    },
    IDLE,
    { permissions: PERMISSIONS },
  )
}

/** Nothing left: every finding settled, every answer in the Spec; Freeze is the user's. */
export function readyToFreeze(): AttentionMoment {
  const settled = FINDINGS.map((one): Finding =>
    one.fate === 'open'
      ? Object.assign({}, one, {
          fate: 'fixed' as const,
          fixedWhat: `${one.where.join(', ')} rewritten.`,
        })
      : one,
  )
  const before = coldReadFindings()
  return {
    ...before,
    data: { ...before.data, passes: [{ ...PASS, findings: settled }] },
  }
}

/** The moments a story can show, by name. */
export const MOMENTS = {
  reading,
  questionsWaiting,
  takingAnswers,
  coldReadFindings,
  probesWithPermissions,
  readyToFreeze,
} as const

export type MomentName = keyof typeof MOMENTS
