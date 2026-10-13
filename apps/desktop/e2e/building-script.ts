/**
 * The agents the Building suite scripts, as the fake agent of the headless run plays them: a
 * Planner that writes a whole Spec on the vision (one requirement, its scenario verified by hand,
 * one task changing `api/invoices.ts`, a model recommended) and asks one question, then declares
 * the Spec complete once it is answered; and a Builder that answers every prompt and does nothing
 * else, so the Building page is read as it starts.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

const uses = (id: string, tool: string, args: Record<string, Json>) =>
  ({ does: 'uses', id, tool, arguments: args }) as const

const SECTIONS = ['why', 'goals', 'impact', 'decisions', 'risks', 'migration', 'open_questions']

/** The Spec's why, which the Ready page shows in summary. */
export const WHY = 'Customers ask for their invoices in a spreadsheet.'

/** The Planner: the whole Spec and one question, then the Spec declared complete. */
export const PLANNER = {
  turns: [
    [
      ...SECTIONS.map((name) =>
        uses(`toolu_${name}`, 'spec_write_section', {
          section: name,
          content: name === 'why' ? WHY : `The ${name}.`,
          base_version: 0,
        }),
      ),
      uses('toolu_requirement', 'requirement_write', {
        domain: 'Invoices',
        delta: 'added',
        text: 'Invoices export as CSV.',
        scenarios: [{ when: 'the user exports the invoices', then: 'a CSV file is saved' }],
      }),
      uses('toolu_describe', 'mission_describe', { title: 'Invoices as CSV', type: 'feature' }),
      uses('toolu_proof', 'proof_write', {
        scenario: 'R1.S1',
        proof: {
          mode: 'by_hand',
          actions: ['Export the invoices'],
          starting_data: 'None.',
          expected: 'A CSV file is saved.',
          seen_today: false,
        },
        base_version: 0,
      }),
      uses('toolu_tasks', 'tasks_write', {
        tasks: [
          {
            title: 'Export as CSV',
            result: 'The invoices export as CSV.',
            requirements: ['R1'],
            scenarios: ['R1.S1'],
            targets: [{ repository: 'api', path: 'invoices.ts', intent: 'change' }],
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
      uses('toolu_integrated_I1', 'input_integrated', { id: 'I1', where: 'why' }),
      uses('toolu_wave', 'ask_wave', {
        questions: [
          {
            text: 'Which separator?',
            why: 'The Spec depends on it.',
            options: [
              { label: 'Comma', detail: 'Choosing Comma.' },
              { label: 'Semicolon', detail: 'Choosing Semicolon.' },
            ],
            recommended: 0,
            recommended_reason: 'It is what spreadsheets read.',
          },
        ],
      }),
    ],
    // The answer (I2): integrated, and the Spec declared complete, which starts the cold read.
    [
      uses('toolu_integrated_I2', 'input_integrated', { id: 'I2', where: 'decisions' }),
      uses('toolu_declare', 'declare_complete', { why: 'A Builder can build it.' }),
    ],
  ],
  steps: [{ does: 'says', text: 'Done.' }],
} as const

/** A Builder that answers every prompt and does nothing else. */
export const BUILDER = { steps: [{ does: 'says', text: 'Read.' }] } as const
