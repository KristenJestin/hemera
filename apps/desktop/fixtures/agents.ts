/**
 * The agents a fixture is built with: the fake agent of #32, a real ACP peer replaying a script,
 * never a real provider. Each agent the engine starts plays the script its group gives for its
 * place in the start order, and answers every prompt and does nothing else once past the list.
 * Claude Code is the one agent installed, as under the end-to-end suite.
 */

import { SPEC_SECTIONS } from '@hemera/core/domain'
import { Effect, Layer } from 'effect'
import type { Schema } from 'effect'

import { type FakeScript, type FakeStep, fakeAgent } from '../src/engine/agents/fake.ts'
import { AgentStarter } from '../src/engine/agents/runtime.ts'
import type { SuiteAgent } from '../src/engine/agents/suite-agent.ts'

export const uses = (id: string, tool: string, args: Schema.JsonObject): FakeStep => ({
  does: 'uses',
  id,
  tool,
  arguments: args,
})

export const says = (text: string): FakeStep => ({ does: 'says', text })

/** An agent that answers every prompt and does nothing else. */
export const QUIET: FakeScript = { steps: [says('Done.')] }

/** A cold read that reads the Spec and finds nothing. */
export const READS_COLD: FakeScript = {
  turns: [
    [
      uses('toolu_read', 'spec_read', {}),
      uses('toolu_report', 'cold_read_report', { findings: [] }),
    ],
  ],
  steps: [says('Read.')],
}

/** The fake agents, the one listed as the suite's, each playing its script in the start order. */
export function scriptedAgents(
  fakes: SuiteAgent,
  scriptOf: (index: number) => FakeScript,
): SuiteAgent['sessions'] {
  let started = 0
  return {
    discovery: fakes.sessions.discovery,
    starter: Layer.succeed(AgentStarter, {
      start: () =>
        Effect.sync(() => {
          const script = scriptOf(started)
          started += 1
          return fakeAgent(script).process
        }),
    }),
  }
}

const SECTIONS: Readonly<Record<(typeof SPEC_SECTIONS)[number], string>> = {
  why: 'Accountants copy each invoice by hand into their spreadsheet at the end of the month.',
  goals: 'Export every invoice of a month as one CSV file, its number and its total per line.',
  impact: 'The api gains an export; the web page gains a button that downloads it.',
  decisions: 'Amounts are written with two decimals and a dot, whatever the language of the page.',
  risks: 'A month with thousands of invoices: the export streams its lines.',
  migration: 'None: nothing stored changes.',
  open_questions: 'None left.',
}

/**
 * The Planner of Larkspur's CSV export: it writes the whole Spec through Hemera's tools (its
 * sections, one requirement with two scenarios and their automated proofs, two tasks, a model for
 * Building) and declares it complete, as a real Planner does over its first turn.
 */
export const PLANS_THE_EXPORT: FakeScript = {
  turns: [
    [
      ...SPEC_SECTIONS.map((section) =>
        uses(`toolu_section_${section}`, 'spec_write_section', {
          section,
          content: SECTIONS[section],
          base_version: 0,
        }),
      ),
      uses('toolu_requirement', 'requirement_write', {
        domain: 'invoices',
        text: 'The invoices of a month export as one CSV file.',
        scenarios: [
          {
            when: 'the user exports March',
            then: 'a CSV file holds one line per invoice of March',
          },
          { when: 'an invoice totals 21 euros', then: 'its line says 21.00' },
        ],
        delta: 'added',
      }),
      uses('toolu_describe', 'mission_describe', {
        title: 'Export the invoices as CSV',
        type: 'feature',
      }),
      uses('toolu_proof_1', 'proof_write', {
        scenario: 'R1.S1',
        proof: {
          mode: 'automated',
          actions: ['Export the invoices of March', 'Count the lines of the file'],
          starting_data: 'Two invoices in March, one in April.',
          expected: 'A header and two lines.',
          test: {
            repository: 'api',
            path: 'tests/export.test.js',
            code: "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n\nimport { toCsv } from '../src/export.js'\n\ntest('one line per invoice', () => {\n  assert.equal(toCsv([{ number: 'A1', lines: [] }]).split('\\n').length, 2)\n})\n",
            insertion: 'new_file',
            command: 'node --test tests/export.test.js',
          },
          seen_today: false,
        },
        base_version: 0,
      }),
      uses('toolu_proof_2', 'proof_write', {
        scenario: 'R1.S2',
        proof: {
          mode: 'automated',
          actions: ['Export an invoice of 21 euros'],
          starting_data: 'One invoice of two lines, 21 euros in all.',
          expected: 'Its line ends with 21.00.',
          test: {
            repository: 'api',
            path: 'tests/export-amounts.test.js',
            code: "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n\nimport { toCsv } from '../src/export.js'\n\ntest('two decimals', () => {\n  assert.match(toCsv([{ number: 'A1', lines: [{ quantity: 1, unitCents: 2100 }] }]), /21\\.00$/)\n})\n",
            insertion: 'new_file',
            command: 'node --test tests/export-amounts.test.js',
          },
          seen_today: false,
        },
        base_version: 0,
      }),
      uses('toolu_tasks', 'tasks_write', {
        tasks: [
          {
            title: 'Write the export',
            result: 'toCsv writes one line per invoice with its total.',
            requirements: ['R1'],
            scenarios: ['R1.S1', 'R1.S2'],
            targets: [{ repository: 'api', path: 'src/export.js', intent: 'create' }],
            depends_on: [],
          },
          {
            title: 'Document the export',
            result: 'The README says how to export a month.',
            requirements: ['R1'],
            scenarios: ['R1.S1'],
            targets: [{ repository: 'api', path: 'README.md', intent: 'change' }],
            depends_on: ['Write the export'],
          },
        ],
        base_version: 0,
      }),
      uses('toolu_model', 'model_recommend', {
        agent: 'claude',
        model: 'default',
        reason: 'One new file and its two tests: a small change.',
      }),
      uses('toolu_complete', 'declare_complete', { why: 'A Builder can build it as written.' }),
      says('The Spec is written whole; it is yours to read and judge.'),
    ],
  ],
  steps: [says('Noted.')],
}
