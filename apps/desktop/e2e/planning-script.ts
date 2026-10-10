/**
 * The Planner the Planning suites script, as the fake agent of the headless run plays it: one
 * list of steps per prompt it is given, each a call of one of Hemera's tools. Every turn leaves a
 * mark the page shows, which the suite waits for before its next gesture: two gestures made while
 * a turn runs would reach the Planner as one prompt, and the turns would no longer line up.
 *
 * The inputs are numbered by the engine in the order received (`I1` the vision, `I2` and `I3` the
 * answers of the first wave, `I4` the question put on hold, `I5` the decision the Planner
 * proposes in the discussion, `I6` the same decision once accepted, `I7` the answer to the question
 * put on hold), the questions across waves (`Q1` to `Q4`).
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

const uses = (id: string, tool: string, args: Record<string, Json>) =>
  ({ does: 'uses', id, tool, arguments: args }) as const

const section = (name: string, content: string, base: number) =>
  uses(`toolu_${name}_${String(base)}`, 'spec_write_section', {
    section: name,
    content,
    base_version: base,
  })

const integrated = (input: string, where: Json) =>
  uses(`toolu_integrated_${input}`, 'input_integrated', { id: input, where })

const question = (text: string, first: string, second: string) => ({
  text,
  why: 'The Spec depends on it.',
  options: [
    { label: first, detail: `Choosing ${first}.` },
    { label: second, detail: `Choosing ${second}.` },
  ],
  recommended: 0,
  recommended_reason: 'It is what the notes do today.',
})

export const DRAFT_MARK = 'The notes leave the app as files.'
export const DECISION = 'A note is exported with its images.'
export const NOT_PROBED = 'No Probe could run on a Project without a repository.'
export const DRAFTED = 'Could you tell me which notes the archive team keeps?'

/** The Planner: from the vision to the Spec declared complete, one list of steps per prompt. */
export const PLANNER = {
  turns: [
    // The brief and the vision (I1): the draft, then the first wave.
    [
      section('why', DRAFT_MARK, 0),
      section('goals', 'Export one note as Markdown. Not an import.', 0),
      section('impact', 'The notes page gains an export.', 0),
      section('decisions', 'None yet.', 0),
      section('risks', 'None.', 0),
      section('migration', 'None.', 0),
      section('open_questions', 'None.', 0),
      uses('toolu_requirement', 'requirement_write', {
        domain: 'Notes',
        delta: 'added',
        text: 'A note is exported as one Markdown file.',
        scenarios: [{ when: 'the user exports a note', then: 'one Markdown file is saved' }],
      }),
      uses('toolu_describe', 'mission_describe', {
        title: 'Export notes as Markdown',
        type: 'feature',
      }),
      integrated('I1', 'why'),
      uses('toolu_wave_1', 'ask_wave', {
        questions: [
          question('Who may export a note?', 'Anyone who can read it', 'Only its owner'),
          question('Which flavour of Markdown?', 'CommonMark', 'GitHub'),
        ],
      }),
    ],
    // The answer to Q1 (I2).
    [integrated('I2', 'goals')],
    // The answer to Q2 (I3), then the second wave.
    [
      integrated('I3', 'decisions'),
      uses('toolu_wave_2', 'ask_wave', {
        questions: [
          question('Which notes are archived?', 'Every note', 'The old ones'),
          question('Are the images exported?', 'With the note', 'Not at all'),
        ],
      }),
    ],
    // Q3 put on hold (I4): a message drafted for whoever it waits on.
    [
      integrated('I4', { no_change: 'It waits on the archive team.' }),
      uses('toolu_draft', 'question_draft_message', { question: 'Q3', text: DRAFTED }),
    ],
    // The first message of the discussion on Q4: a decision proposed.
    [
      uses('toolu_propose', 'discussion_propose_decision', {
        discussion: '#1',
        decision: DECISION,
      }),
    ],
    // The decision accepted (I6, which supersedes the proposal, I5): written, Q4 made moot, and a Probe launched.
    [
      section('decisions', `${DECISION} (discussion #1)`, 1),
      integrated('I6', 'decisions'),
      uses('toolu_retire', 'question_retire', {
        question: 'Q4',
        how: 'moot',
        reason: 'Decided in discussion #1.',
        decision: DECISION,
      }),
      uses('toolu_probe', 'probe_launch', {
        question: 'Does a long note export whole?',
        brief: 'Export a note of a thousand lines.',
      }),
    ],
    // What became of the Probe: said in the risks.
    [section('risks', NOT_PROBED, 1)],
    // The answer to Q3 (I7) settles the last input: the proof, the tasks and the model go in, and
    // the Spec is declared complete, which starts the cold read.
    [
      integrated('I7', 'goals'),
      uses('toolu_proof', 'proof_write', {
        scenario: 'R1.S1',
        proof: {
          mode: 'by_hand',
          actions: ['Export a note'],
          starting_data: 'None.',
          expected: 'One Markdown file is saved.',
          seen_today: false,
        },
        base_version: 0,
      }),
      uses('toolu_tasks', 'tasks_write', {
        tasks: [
          {
            title: 'Export a note',
            result: 'A note is exported as Markdown.',
            requirements: ['R1'],
            scenarios: ['R1.S1'],
            targets: [],
            depends_on: [],
          },
        ],
        base_version: 0,
      }),
      uses('toolu_model', 'model_recommend', {
        agent: 'claude',
        model: 'opus',
        reason: 'A small change.',
      }),
      uses('toolu_declare', 'declare_complete', { why: 'A Builder can build it.' }),
    ],
  ],
  steps: [{ does: 'says', text: 'Done.' }],
} as const

/** The cold read, scripted before the Planner declares the Spec complete: it finds nothing. */
export const COLD_READER = {
  turns: [[uses('toolu_cold_read', 'cold_read_report', { findings: [] })]],
  steps: [{ does: 'says', text: 'Done.' }],
} as const
