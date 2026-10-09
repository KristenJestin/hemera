import type { ExploredMission } from '../coming-back/parts.tsx'
import type {
  ColdReadPass,
  Dependency,
  Discussion,
  PlanningState,
  Probe,
  Question,
  Requirement,
  SpecChange,
  SpecSection,
  Task,
  Wave,
} from './model.ts'

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

export const MISSION: ExploredMission = {
  key: 'ACME-12',
  title: 'Export notes as Markdown',
  type: 'feature',
  stage: 'Planning',
  frozen: false,
  ball: 'you',
  marks: [{ kind: 'needsYou' }],
  event: { text: 'Wave 2: three questions', when: '10:40' },
  ticket: 'acme/shop#41',
}

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

const SLASH_PROBE: Probe = {
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
}

export const SIZE_PROBE: Probe = {
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
}

export const EMOJI_PROBE: Probe = {
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

const UNSETTLED = [
  'Q5 waits for your answer',
  'Q6 waits on someone: the support team',
  'Discussion #1 on Q5 is open',
  'Your answer to Q2 is not integrated yet',
  'The dependency on ACME-20 waits for your decision',
]

/** The Planning page with everything written and two waves asked: the base of every moment. */
function base(): PlanningState {
  return {
    mission: MISSION,
    now: null,
    sections: WRITTEN,
    requirementsState: 'written',
    requirements: REQUIREMENTS,
    tasks: TASKS,
    waves: WAVES,
    discussions: [],
    probes: [SLASH_PROBE],
    passes: [],
    freshness: { current: true, changes: [] },
    dependencies: DEPENDENCIES,
    readiness: { ready: false, unsettled: UNSETTLED },
    changes: [],
    visions: [
      {
        text: 'Keep it boring: one file per note, the way a wiki would store it.',
        at: '09:05',
        inputState: 'integrated',
      },
    ],
  }
}

/** How far the first draft has gone, section by section. */
const DRAFT_STATES: readonly SpecSection['state'][] = ['written', 'written', 'being_written']

/** The first draft, being written: three sections done, Impact under way, no question yet. */
export function writing(): PlanningState {
  return {
    ...base(),
    mission: { ...MISSION, ball: 'agent', marks: [] },
    now: 'Writes Impact, after reading api/src/routes/notes.ts',
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
    readiness: { ready: false, unsettled: ['The Planner is writing the first draft'] },
    visions: [],
  }
}

/** Two waves: one question open, one waiting on someone with its drafted message, others retired. */
export function wave(): PlanningState {
  return base()
}

/** A discussion open on Q5, the agent's decision proposed. */
export function discussing(): PlanningState {
  return { ...base(), discussions: [DISCUSSION] }
}

/** A Probe running while the Planner goes on with the user; one reported, one that did not reproduce. */
export function probing(): PlanningState {
  return {
    ...base(),
    mission: { ...MISSION, ball: 'agent' },
    now: 'Waits for Probe #2 before writing R3',
    probes: [SLASH_PROBE, SIZE_PROBE, EMOJI_PROBE],
  }
}

/** The first completeness declaration: Hemera launched the cold read; it runs. */
export function coldReadRunning(): PlanningState {
  return {
    ...base(),
    mission: { ...MISSION, ball: 'agent', marks: [] },
    now: 'Declared the Spec complete',
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
    readiness: { ready: false, unsettled: ['The cold read runs'] },
  }
}

/** The cold read reported: a blocker asked as Q8, one fixed on the tasks, a warning and a suggestion. */
export function findings(): PlanningState {
  return {
    ...base(),
    waves: [...answered(), { number: 3, askedAt: '11:30', questions: [EMPTY_TITLE] }],
    passes: [FINDINGS_PASS],
    freshness: { current: false, changes: CHANGES },
    dependencies: [DEPENDENCIES[1]!],
    readiness: {
      ready: false,
      unsettled: ['Q8 waits for your answer', 'C1.F3 and C1.F4 wait to be settled'],
    },
  }
}

/** The cold read failed: said in words, and another pass is the user's to run. */
export function coldReadFailed(): PlanningState {
  return {
    ...coldReadRunning(),
    mission: { ...MISSION, ball: 'you', marks: [{ kind: 'needsYou' }] },
    now: null,
    silent: 'The cold read stopped without a report',
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
    readiness: { ready: false, unsettled: ['The cold read failed: run another'] },
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

/** Everything settled for the agent: Freeze appears in the head. */
export function readyToFreeze(): PlanningState {
  const done = findings()
  return {
    ...base(),
    mission: { ...MISSION, ball: 'you', marks: [] },
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
    freshness: done.freshness,
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
    readiness: { ready: true, unsettled: [] },
  }
}

/** Freeze pressed as the Planner changed the Spec: refused, each reason named. */
export function freezeRefused(): PlanningState {
  return {
    ...readyToFreeze(),
    readiness: { ready: false, unsettled: [] },
    refused: [
      'The Spec changed after you read it: R2 and Decisions',
      'Your answer to Q8 is delivered, not integrated yet',
    ],
    changes: CHANGES.slice(0, 2),
  }
}

/** Frozen: Ready, the Spec read-only, Return to Planning in the head. */
export function frozen(): PlanningState {
  const ready = readyToFreeze()
  return {
    ...ready,
    mission: { ...MISSION, stage: 'Ready', frozen: true, ball: 'idle', marks: [] },
    readiness: { ready: false, unsettled: [] },
    probes: [],
  }
}

/** Ready, then the ticket changed: outdated, with its difference. */
export function outdated(): PlanningState {
  const ready = frozen()
  return {
    ...ready,
    mission: { ...ready.mission, marks: [{ kind: 'outdated' }] },
    outdated: {
      ticket: 'acme/shop#41',
      when: 'Changed this morning at 08:12, after the freeze',
      before: 'Export a note as a Markdown file.',
      after:
        'Export a note as a Markdown file, and a whole notebook as one archive with a table of contents.',
    },
  }
}

/** Back after a while: what changed since the last read. */
export function changed(): PlanningState {
  return { ...findings(), changes: CHANGES }
}

const LONG =
  'When the user exports a note whose title is a whole sentence written by someone who pasted the first paragraph of a meeting into the title field, and the note holds tables, task lists, images and links to other notes of another workspace, '

/** Long text in every field: a question, its options, an answer, a requirement. */
export function long(): PlanningState {
  const state = discussing()
  return {
    ...state,
    requirements: REQUIREMENTS.map((requirement) =>
      changing(requirement, { text: `${LONG}${requirement.text}` }),
    ),
    waves: state.waves.map((one) =>
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
  }
}
