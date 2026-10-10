import type {
  ColdReadPass,
  Dependency,
  Discussion,
  PlanningData,
  ProbeDetail,
  Question,
  Requirement,
  SpecChange,
  SpecSection,
  Task,
  Wave,
} from '../../blocks/planning/planning-types.ts'

/**
 * The neutral case the Planning page is drawn on: the Project "Acme" with `api`, `web` and
 * `shared`, the mission `ACME-12` "Export notes as Markdown" from the ticket `acme/shop#41`, and
 * its neighbours `ACME-16` and `ACME-20`. Each moment of the journey is one function below.
 */

/** A copy of a value with some of its fields changed. */
function changing<T extends object>(value: T, change: Partial<T>): T {
  return Object.assign({}, value, change)
}

/** When the page is looked at: chips count their seconds from here. */
const NOW = Date.now()

const SECONDS = 1000

const WRITTEN: readonly SpecSection[] = [
  {
    name: 'why',
    title: 'Why',
    body: 'People keep their notes in Acme and want them elsewhere too: in a wiki, in a repository, in a mail. Today a note leaves Acme only by copy and paste, which loses its headings, its lists and its tables.\n\nThe ticket acme/shop#41 asks for a file per note, in Markdown, that any editor opens as it is.',
    state: 'written',
  },
  {
    name: 'goals',
    title: 'Goals / Non-goals',
    body: '- Export one note as a Markdown file from its page in web.\n- Export a selection of notes as one archive, in the background when it is large.\n- Not an import: bringing Markdown back into Acme is another mission.\n- Not a sync: the file is a copy, it does not follow the note.',
    state: 'written',
  },
  {
    name: 'impact',
    title: 'Impact',
    body: 'api gains one route that renders a note as Markdown and one job for large selections. shared gains the serializer both use. web gains the Export button on a note and on a selection.',
    state: 'written',
  },
  {
    name: 'decisions',
    title: 'Decisions',
    body: '- D1 · Attachments are exported as links, never as files (Q1).\n- D2 · A front matter holds every field of a note: title, author, dates, tags (Q7, made moot).\n- D3 · GitHub-flavoured Markdown, for the tables notes hold (Q2).',
    state: 'written',
  },
  {
    name: 'risks',
    title: 'Risks & trade-offs',
    body: 'A selection of every note of a large workspace can take minutes: it runs as a job and says when the archive is ready, rather than holding a request open.',
    state: 'written',
  },
  {
    name: 'migration',
    title: 'Migration plan',
    body: 'None: nothing stored changes.',
    state: 'written',
  },
  {
    name: 'open_questions',
    title: 'Open questions',
    body: '- Who may export a shared note (Q5).\n- How large a selection runs in the background (Q6, waiting on the support team).',
    state: 'written',
  },
]

const R2_OBSERVED = `$ pnpm --filter api test notes-export
 FAIL  src/routes/notes-export.test.ts > a title with a slash
Error: ENOENT: no such file or directory, open '/tmp/export/Q3 / plans: draft?.md'
    at writeFile (src/routes/notes-export.ts:41:9)
 Tests  1 failed | 6 passed`

export const REQUIREMENTS: readonly Requirement[] = [
  {
    id: 'R1',
    domain: 'Notes',
    delta: 'added',
    text: 'A note is exported as one Markdown file named after its title, its body in GitHub-flavoured Markdown under a front matter of its fields.',
    scenarios: [
      {
        id: 'R1.S1',
        when: 'the user presses Export on a note titled “Weekly review”',
        then: 'the browser downloads “Weekly review.md”, its front matter first, then the body with its headings, lists and tables.',
        proof: {
          mode: 'automated',
          actions: [
            'Seed the note “Weekly review” with a heading, a list and a table',
            'GET /notes/n-1/export.md',
          ],
          startingData: 'api/test/fixtures/notes/weekly-review.json',
          expected: 'The body equals api/test/fixtures/notes/weekly-review.md, byte for byte.',
          test: 'api · src/routes/notes-export.test.ts',
          seenToday: false,
        },
      },
    ],
  },
  {
    id: 'R2',
    domain: 'Notes',
    delta: 'modified',
    text: 'A note’s title used as a file name drops the characters a file system refuses, and an empty title becomes “Untitled note”.',
    living: {
      ref: 'Notes.R4',
      text: 'A note’s title is at most 120 characters.',
      proposed: false,
    },
    scenarios: [
      {
        id: 'R2.S1',
        when: 'the user exports the note “Q3 / plans: draft?”',
        then: 'the file is “Q3 plans draft.md”.',
        proof: {
          mode: 'automated',
          actions: ['Seed the note “Q3 / plans: draft?”', 'GET /notes/n-2/export.md'],
          startingData: 'None.',
          expected: 'The Content-Disposition names “Q3 plans draft.md”.',
          test: 'api · src/routes/notes-export.test.ts',
          seenToday: true,
          observed: R2_OBSERVED,
          keyLine:
            "Error: ENOENT: no such file or directory, open '/tmp/export/Q3 / plans: draft?.md'",
          fromProbe: '#1',
        },
      },
    ],
  },
  {
    id: 'R3',
    domain: 'Exports',
    delta: 'added',
    text: 'A selection of more than 5 000 notes is exported in the background, and the user is told when its archive is ready.',
    scenarios: [
      {
        id: 'R3.S1',
        when: 'the user exports a selection of 6 000 notes',
        then: 'a notice says the export runs, and a second one offers the archive once it is ready.',
        proof: {
          mode: 'by_hand',
          actions: ['Open the workspace “Large” of the seed', 'Select every note and press Export'],
          startingData: 'The seed’s workspace “Large”, 6 000 notes.',
          expected: 'The two notices appear in that order, the second with Download.',
          seenToday: false,
        },
      },
    ],
  },
  {
    id: 'R4',
    domain: 'Exports',
    delta: 'removed',
    text: 'Notes are exported as plain text only.',
    living: { ref: 'Exports.R1', text: 'Notes are exported as plain text only.', proposed: true },
    scenarios: [],
  },
]

export const TASKS: readonly Task[] = [
  {
    id: 'T1',
    title: 'The Markdown serializer',
    result: 'shared renders a note, its front matter and body, as GitHub-flavoured Markdown.',
    scenarios: ['R1.S1'],
    targets: [{ repository: 'shared', path: 'src/markdown/serialize.ts', intent: 'create' }],
    dependsOn: [],
  },
  {
    id: 'T2',
    title: 'The file name of a note',
    result: 'A title becomes a safe file name, an empty one “Untitled note”.',
    scenarios: ['R2.S1'],
    targets: [{ repository: 'shared', path: 'src/markdown/file-name.ts', intent: 'create' }],
    dependsOn: [],
  },
  {
    id: 'T3',
    title: 'The export route and its job',
    result: 'api answers a note as a file, and a large selection as a job.',
    scenarios: ['R1.S1', 'R2.S1', 'R3.S1'],
    targets: [
      { repository: 'api', path: 'src/routes/notes-export.ts', intent: 'create' },
      { repository: 'api', path: 'src/jobs/export-archive.ts', intent: 'create' },
    ],
    dependsOn: ['T1', 'T2'],
  },
  {
    id: 'T4',
    title: 'Export in web',
    result: 'The Export button on a note and on a selection, and its two notices.',
    scenarios: ['R1.S1', 'R3.S1'],
    targets: [
      { repository: 'web', path: 'src/notes/export-button.tsx', intent: 'create' },
      { repository: 'web', path: 'src/notes/note-page.tsx', intent: 'change' },
    ],
    dependsOn: ['T3'],
  },
]

const ATTACHMENTS: Question = {
  id: 'Q1',
  wave: 1,
  text: 'Should a note’s attachments leave with it?',
  why: 'Notes hold images and files, kept in object storage by api; the export must say what becomes of them.',
  options: [
    {
      id: 'A',
      label: 'As links',
      detail: 'The file stays small; the links work while the note exists.',
    },
    {
      id: 'B',
      label: 'As files, in a zip',
      detail: 'Complete offline, but an archive instead of one file.',
    },
    {
      id: 'C',
      label: 'Not at all',
      detail: 'Only the text; the attachments are named, not linked.',
    },
  ],
  recommended: 'A',
  recommendedReason:
    'api/src/storage/attachments.ts already signs links that last; a zip would double the export’s work for a case the ticket does not name.',
  section: 'decisions',
  fromFinding: null,
  replaces: null,
  replacedBy: null,
  state: 'answered',
  waitingNote: null,
  retiredReason: null,
  mootDecision: null,
  answers: [{ version: 1, optionId: 'A', text: null, at: '09:20', inputState: 'integrated' }],
  drafts: [],
  proposals: [],
}

const FLAVOUR: Question = {
  id: 'Q2',
  wave: 1,
  text: 'Which Markdown?',
  why: 'The editors people open the file in read CommonMark; the notes’ tables do not exist in it.',
  options: [
    { id: 'A', label: 'CommonMark', detail: 'Read everywhere; tables become HTML.' },
    { id: 'B', label: 'GitHub-flavoured', detail: 'Tables and task lists as they are.' },
  ],
  recommended: 'B',
  recommendedReason:
    'One note in three of the seed holds a table (web/src/notes/editor/table.tsx).',
  section: 'decisions',
  fromFinding: null,
  replaces: null,
  replacedBy: null,
  state: 'answered',
  waitingNote: null,
  retiredReason: null,
  mootDecision: null,
  answers: [
    { version: 1, optionId: 'A', text: null, at: '09:21', inputState: 'superseded' },
    { version: 2, optionId: 'B', text: null, at: '10:02', inputState: 'delivered' },
  ],
  drafts: [],
  proposals: [],
}

const COMMENTS: Question = {
  id: 'Q3',
  wave: 1,
  text: 'Do the comments of a note leave with it?',
  why: 'Notes have comments in web.',
  options: [
    { id: 'A', label: 'Yes, at the end', detail: '' },
    { id: 'B', label: 'No', detail: '' },
  ],
  recommended: 'B',
  recommendedReason: '',
  section: null,
  fromFinding: null,
  replaces: null,
  replacedBy: null,
  state: 'withdrawn',
  waitingNote: null,
  retiredReason: 'comments are not part of a note in api: there is nothing to export.',
  mootDecision: null,
  answers: [],
  drafts: [],
  proposals: [],
}

const SIZE_OLD: Question = {
  ...COMMENTS,
  id: 'Q4',
  text: 'Should large exports be refused?',
  state: 'replaced',
  retiredReason: null,
  replacedBy: 'Q6',
}

const WHO: Question = {
  id: 'Q5',
  wave: 2,
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
}

const SIZE: Question = {
  id: 'Q6',
  wave: 2,
  text: 'From how many notes does an export run in the background?',
  why: 'Below it, the file comes in the same request; above it, a job writes an archive and says when it is ready.',
  options: [
    { id: 'A', label: '1 000 notes', detail: 'Rarely more than two seconds.' },
    {
      id: 'B',
      label: '5 000 notes',
      detail: 'About eight seconds on the seed; most workspaces never reach it.',
    },
    {
      id: 'C',
      label: 'Always in the background',
      detail: 'One way only, but a notice even for one note.',
    },
  ],
  recommended: 'B',
  recommendedReason: 'Probe #2 measures it now; 5 000 notes took 7.8 s on the seed.',
  section: 'R3',
  fromFinding: null,
  replaces: 'Q4',
  replacedBy: null,
  state: 'waiting',
  waitingNote: 'Asked the support team how many notes the largest workspaces hold.',
  retiredReason: null,
  mootDecision: null,
  answers: [],
  drafts: [
    {
      text: 'Hello, we are adding a Markdown export of notes. How many notes does the largest workspace hold today, and how many do the ten largest hold on average?',
      at: '10:44',
    },
  ],
  proposals: [],
}

const DATES: Question = {
  id: 'Q7',
  wave: 2,
  text: 'Should the file keep the note’s creation date?',
  why: '',
  options: [
    { id: 'A', label: 'Yes', detail: '' },
    { id: 'B', label: 'No', detail: '' },
  ],
  recommended: 'A',
  recommendedReason: '',
  section: null,
  fromFinding: null,
  replaces: null,
  replacedBy: null,
  state: 'moot',
  waitingNote: null,
  retiredReason: null,
  mootDecision: 'D2, a front matter holds every field of a note.',
  answers: [],
  drafts: [],
  proposals: [],
}

const EMPTY_TITLE: Question = {
  id: 'Q8',
  wave: 3,
  text: 'What is the file called when the note has no title?',
  why: 'From the cold read: R1 names the file after the title and says nothing of an empty one.',
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
  fromFinding: 'C1.F1',
  replaces: null,
  replacedBy: null,
  state: 'open',
  waitingNote: null,
  retiredReason: null,
  mootDecision: null,
  answers: [],
  drafts: [],
  proposals: [],
}

export const WAVES: readonly Wave[] = [
  { number: 1, askedAt: '09:12', questions: [ATTACHMENTS, FLAVOUR, COMMENTS, SIZE_OLD] },
  { number: 2, askedAt: '10:40', questions: [WHO, SIZE, DATES] },
]

export const DISCUSSION: Discussion = {
  id: 'd1',
  label: '#1',
  item: { kind: 'question', id: 'Q5' },
  state: 'open',
  outcome: null,
  decision: null,
  proposal: {
    text: 'Anyone who can read a note may export it, the guests of a share link included.',
    at: '10:58',
  },
  waitsOn: 'user',
  plannerFailed: null,
  messages: [
    {
      author: 'user',
      text: 'What about the guests of a share link? They are not in the workspace.',
      proposal: false,
      at: '10:52',
    },
    {
      author: 'agent',
      text: 'They read through api/src/policies/share-links.ts, which hands them the same body as a member. Refusing them the export would only make them copy the page.',
      proposal: false,
      at: '10:55',
    },
    {
      author: 'agent',
      text: 'Anyone who can read a note may export it, the guests of a share link included.',
      proposal: true,
      at: '10:58',
    },
  ],
}

const SLASH_PROBE: ProbeDetail = {
  id: 'p1',
  label: '#1',
  question: 'Does a title with a slash break the export today?',
  scenario: 'R2.S1',
  state: 'done',
  stuck: false,
  startedAt: NOW - 840 * SECONDS,
  endedAt: NOW - 720 * SECONDS,
  outcome: 'reproduced',
  report: {
    answer: 'Yes: api writes the file under the title as it is, and a slash makes a folder of it.',
    actions: ['Seed the note “Q3 / plans: draft?”', 'Run pnpm --filter api test notes-export'],
    command: 'pnpm --filter api test notes-export',
    observed: R2_OBSERVED,
    keyLine: "Error: ENOENT: no such file or directory, open '/tmp/export/Q3 / plans: draft?.md'",
    evidence: ['slash-title.log'],
  },
  failure: null,
}

export const SIZE_PROBE: ProbeDetail = {
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
  report: null,
  failure: null,
}

export const EMOJI_PROBE: ProbeDetail = {
  id: 'p3',
  label: '#3',
  question: 'Do emoji in a title break the file name?',
  scenario: 'R2.S1',
  state: 'done',
  stuck: false,
  startedAt: NOW - 300 * SECONDS,
  endedAt: NOW - 250 * SECONDS,
  outcome: 'not_reproduced',
  report: {
    answer:
      'No: a title of emoji gives a file of the same name on Linux, macOS and Windows; nothing to change for them.',
    actions: [
      'Seed the note “🚀 Launch”',
      'GET /notes/n-3/export.md',
      'Open the file on the three systems',
    ],
    command: 'pnpm --filter api test notes-export -t emoji',
    observed: ' ✓ src/routes/notes-export.test.ts > emoji in a title\n Tests  1 passed',
    evidence: ['emoji-title.log'],
  },
  failure: null,
}

export const CHANGES: readonly SpecChange[] = [
  {
    item: 'R2',
    before: 'A note’s title used as a file name drops the characters a file system refuses.',
    after:
      'A note’s title used as a file name drops the characters a file system refuses, and an empty title becomes “Untitled note”.',
    at: '11:14',
  },
  {
    item: 'decisions',
    before: null,
    after: 'D3 · GitHub-flavoured Markdown, for the tables notes hold (Q2).',
    at: '11:02',
  },
  {
    item: 'T3',
    before: 'T3 changes web/src/notes/export-button.tsx.',
    after: 'T3 creates web/src/notes/export-button.tsx.',
    at: '11:20',
  },
]

const FINDINGS_PASS: ColdReadPass = {
  id: 'c1',
  label: 'C1',
  requestedBy: 'hemera',
  state: 'done',
  stuck: false,
  startedAt: NOW - 600 * SECONDS,
  endedAt: NOW - 420 * SECONDS,
  failure: null,
  findings: [
    {
      id: 'C1.F1',
      severity: 'blocking',
      where: ['R1'],
      text: 'R1 names the file after the title and says nothing of a note without one.',
      tasksOnly: false,
      fate: 'asked',
      questionId: 'Q8',
      fixedWhat: null,
    },
    {
      id: 'C1.F2',
      severity: 'blocking',
      where: ['T4'],
      text: 'T4 changes web/src/notes/export-button.tsx, which does not exist at the base commit.',
      tasksOnly: true,
      fate: 'fixed',
      questionId: null,
      fixedWhat: 'T4 now creates it.',
    },
    {
      id: 'C1.F3',
      severity: 'warning',
      where: ['R3'],
      text: '5 000 notes is not tied to a measure: a developer would not know whether 4 000 must be fast.',
      tasksOnly: false,
      fate: 'open',
      questionId: null,
      fixedWhat: null,
    },
    {
      id: 'C1.F4',
      severity: 'suggestion',
      where: ['why'],
      text: 'Why could say who asked for the export, so a reader knows whom to ask.',
      tasksOnly: false,
      fate: 'open',
      questionId: null,
      fixedWhat: null,
    },
  ],
}

export const DEPENDENCIES: readonly Dependency[] = [
  {
    id: 'dep1',
    dependsOnKey: 'ACME-20',
    dependsOnTitle: 'Notes keep their attachments in one place',
    dependsOnStage: 'Building',
    reason: 'The links D1 exports point where ACME-20 moves the attachments.',
    state: 'proposed',
  },
  {
    id: 'dep2',
    dependsOnKey: 'ACME-16',
    dependsOnTitle: 'Labels in French and English',
    dependsOnStage: 'Ready',
    reason: 'The front matter’s field names come from the labels ACME-16 translates.',
    state: 'accepted',
  },
]
/** The probes as their chips show them, without their reports. */
const chip = ({ report: _report, failure: _failure, ...probe }: ProbeDetail) => probe

/** Every Probe whole, the first launched first: what a report opened over the page reads. */
export const PROBES: readonly ProbeDetail[] = [SLASH_PROBE, SIZE_PROBE, EMOJI_PROBE]

/** One Probe whole, by its id. */
export const probeById = (id: string): ProbeDetail | null =>
  PROBES.find((probe) => probe.id === id) ?? null

/** What the mission's head says at a moment of the journey, beside the page. */
export interface PlanningHead {
  /** What the Planner does now, in words; null while nothing runs. */
  now: string | null
  /** A turn that ended without a word, said in words. */
  silent?: string | undefined
  /** Whether Freeze is offered. */
  ready: boolean
  frozen: boolean
  /** Freeze pressed and refused: every reason, each naming what blocks it. */
  refused?: readonly string[] | undefined
  outdated?: boolean | undefined
}

/** One moment of the journey: the page, and the head beside it. */
export interface PlanningMoment {
  data: PlanningData
  head: PlanningHead
}

const VISION = {
  id: 'v1',
  text: 'Keep it boring: one file per note, the way a wiki would store it.',
  at: '09:05',
  inputState: 'integrated' as const,
}

/** The Planning page with everything written and two waves asked: the base of every moment. */
function base(): PlanningData {
  return {
    frozen: false,
    sections: WRITTEN,
    requirementsState: 'written',
    requirements: REQUIREMENTS,
    tasks: TASKS,
    waves: WAVES,
    discussions: [],
    probes: [chip(SLASH_PROBE)],
    passes: [],
    freshness: { current: true, changes: [] },
    dependencies: DEPENDENCIES,
    changes: [],
    visions: [VISION],
    triage: null,
    ticket: null,
  }
}

const YOUR_TURN: PlanningHead = { now: null, ready: false, frozen: false }

/** How far the first draft has gone, section by section. */
const DRAFT_STATES: readonly SpecSection['state'][] = ['written', 'written', 'being_written']

/** The first draft, being written: two sections done, Impact under way, no question yet. */
export function writing(): PlanningMoment {
  return {
    data: {
      ...base(),
      sections: WRITTEN.map((section, index) =>
        changing(section, {
          state: DRAFT_STATES[index] ?? 'empty',
          body: index < 2 ? section.body : '',
        }),
      ),
      requirementsState: 'empty',
      requirements: [],
      tasks: [],
      waves: [],
      probes: [],
      dependencies: [],
      visions: [],
    },
    head: { ...YOUR_TURN, now: 'Writes Impact, after reading api/src/routes/notes.ts' },
  }
}

/** Two waves: one question open, one waiting on someone with its drafted message, others retired. */
export function wave(): PlanningMoment {
  return { data: base(), head: YOUR_TURN }
}

/** Only the first wave, before the second arrives. */
export function firstWave(): PlanningMoment {
  return { data: { ...base(), waves: WAVES.slice(0, 1) }, head: YOUR_TURN }
}

/** A discussion open on Q5, the agent's decision proposed. */
export function discussing(): PlanningMoment {
  return { data: { ...base(), discussions: [DISCUSSION] }, head: YOUR_TURN }
}

/** A Probe running while the Planner goes on with the user; one reported, one that did not reproduce. */
export function probing(): PlanningMoment {
  return {
    data: { ...base(), probes: [chip(SLASH_PROBE), chip(SIZE_PROBE), chip(EMOJI_PROBE)] },
    head: { ...YOUR_TURN, now: 'Waits for Probe #2 before writing R3' },
  }
}

/** Every wave answered and integrated: what a settled Planning holds. */
function answered(): Wave[] {
  return WAVES.map((one) =>
    changing(one, {
      questions: one.questions.map((question): Question => {
        if (question.state !== 'open' && question.state !== 'waiting' && question.id !== 'Q2') {
          return question
        }
        const versions =
          question.id === 'Q2'
            ? question.answers.map((answer) =>
                changing(answer, {
                  inputState: answer.version === 2 ? 'integrated' : answer.inputState,
                }),
              )
            : [
                {
                  version: 1,
                  optionId: question.recommended,
                  text: null,
                  at: '11:08',
                  inputState: 'integrated' as const,
                },
              ]
        return changing(question, { state: 'answered', waitingNote: null, answers: versions })
      }),
    }),
  )
}

/** The first completeness declaration: Hemera launched the cold read; it runs. */
export function coldReadRunning(): PlanningMoment {
  return {
    data: {
      ...base(),
      waves: answered(),
      passes: [
        {
          ...FINDINGS_PASS,
          state: 'running',
          startedAt: NOW - 42 * SECONDS,
          endedAt: null,
          findings: [],
        },
      ],
      dependencies: [DEPENDENCIES[1]!],
    },
    head: { ...YOUR_TURN, now: 'Declared the Spec complete' },
  }
}

/** The cold read reported: a blocker asked as Q8, one fixed on the tasks, a warning and a suggestion. */
export function findings(): PlanningMoment {
  return {
    data: {
      ...base(),
      waves: [...answered(), { number: 3, askedAt: '11:30', questions: [EMPTY_TITLE] }],
      passes: [FINDINGS_PASS],
      freshness: { current: false, changes: CHANGES },
      dependencies: [DEPENDENCIES[1]!],
    },
    head: YOUR_TURN,
  }
}

/** The cold read failed: said in words, and another pass is the user's to run. */
export function coldReadFailed(): PlanningMoment {
  const running = coldReadRunning()
  return {
    data: {
      ...running.data,
      passes: [
        {
          ...FINDINGS_PASS,
          state: 'failed',
          startedAt: NOW - 400 * SECONDS,
          endedAt: NOW - 100 * SECONDS,
          failure: 'its session gave no sign for five minutes and was ended. Nothing was read.',
          findings: [],
        },
      ],
    },
    head: { ...YOUR_TURN, silent: 'The cold read stopped without a report' },
  }
}

/** A dependency on another mission proposed by the Planner, waiting for the user. */
export function dependencyProposed(): PlanningMoment {
  return { data: { ...base(), waves: answered() }, head: YOUR_TURN }
}

/** Back after a while: what changed since the last read, marked in the text. */
export function changed(): PlanningMoment {
  const found = findings()
  return { data: { ...found.data, changes: CHANGES }, head: YOUR_TURN }
}

/** The vision given twice: the first integrated, the second just received. */
export function vision(): PlanningMoment {
  return {
    data: {
      ...base(),
      visions: [
        VISION,
        {
          id: 'v2',
          text: 'A notebook export can wait: one note, and a selection, is what people ask for.',
          at: '11:40',
          inputState: 'received',
        },
      ],
    },
    head: YOUR_TURN,
  }
}

/** Everything settled for the agent: Freeze appears in the head. */
export function readyToFreeze(): PlanningMoment {
  return {
    data: {
      ...base(),
      waves: [
        ...answered(),
        {
          number: 3,
          askedAt: '11:30',
          questions: [
            {
              ...EMPTY_TITLE,
              state: 'answered',
              answers: [
                { version: 1, optionId: 'A', text: null, at: '11:34', inputState: 'integrated' },
              ],
            },
          ],
        },
      ],
      passes: [
        {
          ...FINDINGS_PASS,
          findings: FINDINGS_PASS.findings.map((finding) =>
            finding.fate === 'open' ? changing(finding, { fate: 'dismissed' }) : finding,
          ),
        },
      ],
      freshness: { current: true, changes: [] },
      discussions: [
        {
          ...DISCUSSION,
          state: 'closed',
          outcome: 'decision',
          decision: DISCUSSION.proposal?.text ?? null,
          proposal: null,
          waitsOn: null,
        },
      ],
      dependencies: [{ ...DEPENDENCIES[0]!, state: 'accepted' }, DEPENDENCIES[1]!],
    },
    head: { ...YOUR_TURN, ready: true },
  }
}

/** Freeze pressed as the Planner changed the Spec: refused, each reason named. */
export function freezeRefused(): PlanningMoment {
  const ready = readyToFreeze()
  return {
    data: { ...ready.data, changes: CHANGES.slice(0, 2) },
    head: {
      ...YOUR_TURN,
      refused: [
        'The Spec changed after you read it: R2 and Decisions',
        'Your answer to Q8 is delivered, not integrated yet',
      ],
    },
  }
}

/** Frozen: the Spec read-only, nothing left to answer. */
export function frozen(): PlanningMoment {
  const ready = readyToFreeze()
  return {
    data: { ...ready.data, frozen: true, probes: [] },
    head: { now: null, ready: false, frozen: true },
  }
}

/** The ticket changed while the Spec is written: its difference, as the Planner receives it. */
export function outdated(): PlanningMoment {
  return {
    data: {
      ...base(),
      ticket: {
        key: 'acme/shop#41',
        changes: [
          {
            id: 'e1',
            what: 'The ticket’s description changed',
            difference:
              '- Export a note as a Markdown file.\n+ Export a note as a Markdown file, and a whole notebook as one archive with a table of contents.',
            at: '08:12',
            inputState: 'delivered',
          },
        ],
      },
    },
    head: { ...YOUR_TURN, now: 'Reads the ticket’s new description', outdated: true },
  }
}

/** The Planner read the request as something else: its triage answer, Keep planning. */
export function triaged(): PlanningMoment {
  const draft = writing()
  return {
    data: {
      ...draft.data,
      sections: WRITTEN.map((section) => changing(section, { state: 'empty', body: '' })),
      triage: {
        kind: 'existing_mission',
        ref: 'ACME-20',
        text: 'ACME-20 already moves the attachments and adds a download of each note: a Markdown export belongs there, as one more format of that download.',
        basedOnProposed: false,
      },
    },
    head: YOUR_TURN,
  }
}

/** Q6 waits on the support team; a comment on the ticket answers it, and the Planner proposes it. */
export function proposedAnswer(): PlanningMoment {
  return {
    data: {
      ...base(),
      waves: WAVES.map((one) =>
        changing(one, {
          questions: one.questions.map((question) =>
            question.id === 'Q6'
              ? changing(question, {
                  proposals: [
                    {
                      id: 'pa1',
                      author: 'support-team',
                      comment:
                        'The largest workspace holds 41 000 notes; the ten largest hold about 9 000 each.',
                      text: 'B, 5 000 notes: the largest workspaces are well above it, most never reach it.',
                    },
                  ],
                })
              : question,
          ),
        }),
      ),
    },
    head: YOUR_TURN,
  }
}

/**
 * Hemera started again in the middle of the waves: every answer is where it was, and the Planner
 * is told what it had not integrated yet.
 */
export function restarted(): PlanningMoment {
  return {
    data: base(),
    head: { ...YOUR_TURN, now: 'Started again: reads what it had not integrated yet' },
  }
}

/** Everything settled but the last answer's integration: Freeze is not there yet. */
export function almostReady(): PlanningMoment {
  const ready = readyToFreeze()
  return { data: ready.data, head: { ...ready.head, ready: false } }
}

/** Q5 answered with B, at a given state of its input. */
function answeredQ5(inputState: 'received' | 'delivered' | 'integrated'): PlanningMoment {
  return {
    data: {
      ...base(),
      waves: WAVES.map((one) =>
        changing(one, {
          questions: one.questions.map((question) =>
            question.id === 'Q5'
              ? changing(question, {
                  state: 'answered',
                  answers: [{ version: 1, optionId: 'B', text: null, at: '11:02', inputState }],
                })
              : question,
          ),
        }),
      ),
    },
    head: YOUR_TURN,
  }
}

/** Q5 just answered: received. */
export function answerReceived(): PlanningMoment {
  return answeredQ5('received')
}

/** Q5's answer delivered to the Planner. */
export function answerDelivered(): PlanningMoment {
  return answeredQ5('delivered')
}

/** Q5's answer integrated in the Spec. */
export function answerIntegrated(): PlanningMoment {
  return answeredQ5('integrated')
}

const LONG =
  'When the user exports a note whose title is a whole sentence written by someone who pasted the first paragraph of a meeting into the title field, and the note holds tables, task lists, images and links to other notes of another workspace, '

/** Long text in every field: a question, its options, an answer, a requirement. */
export function long(): PlanningMoment {
  const discussed = discussing()
  return {
    data: {
      ...discussed.data,
      requirements: REQUIREMENTS.map((requirement) =>
        changing(requirement, { text: `${LONG}${requirement.text}` }),
      ),
      waves: discussed.data.waves.map((one) =>
        changing(one, {
          questions: one.questions.map((question) =>
            changing(question, {
              text: `${LONG}${question.text}`,
              options: question.options.map((option) =>
                changing(option, { label: `${option.label}, ${LONG}` }),
              ),
              answers:
                question.id === 'Q1'
                  ? [
                      {
                        version: 1,
                        optionId: null,
                        text: `${LONG}links, please.`,
                        at: '09:20',
                        inputState: 'integrated' as const,
                      },
                    ]
                  : question.answers,
            }),
          ),
        }),
      ),
      visions: [{ ...VISION, text: `${LONG}one file per note.` }],
    },
    head: { ...YOUR_TURN, now: `Writes R3, ${LONG}` },
  }
}

export { FINDINGS_PASS, WRITTEN }
