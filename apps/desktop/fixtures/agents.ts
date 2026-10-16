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
import { FAKE_PAYMENTS_KEY } from './larkspur.ts'

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

/** What runs a test file of `api`, its report in TAP whatever the terminal. */
const testLine = (path: string) => `node --test --test-reporter=tap ${path}`

/** R1.S1's proof: red until `src/export.js` writes one line per invoice. */
export const EXPORT_TEST_PATH = 'tests/export.test.js'
const EXPORT_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'

test('the invoices of a month export as one line each', async () => {
  const exported = await import('../src/export.js').catch(() => ({}))
  assert.equal(typeof exported.toCsv, 'function', 'src/export.js has no toCsv yet')
  assert.equal(exported.toCsv([{ number: 'A1', lines: [] }]).split('\\n').length, 2)
})
`

/** R1.S2's proof: red until `src/invoices.js` reads an amount back. */
export const CENTS_TEST_PATH = 'tests/cents.test.js'
const CENTS_TEST = `import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as invoices from '../src/invoices.js'

test('an amount printed as 21.00 reads back as 2100 cents', () => {
  assert.equal(typeof invoices.toCents, 'function', 'src/invoices.js has no toCents yet')
  assert.equal(invoices.toCents('21.00'), 2100)
})
`

/**
 * The Planner of Larkspur's CSV export: it writes the whole Spec through Hemera's tools (its
 * sections, one requirement with two scenarios, each with an automated proof red at the base, one
 * task per scenario, a model for Building) and declares it complete, as a real Planner does over its first turn.
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
          starting_data: 'One invoice in March.',
          expected: 'A header and one line.',
          test: {
            repository: 'api',
            path: EXPORT_TEST_PATH,
            code: EXPORT_TEST,
            insertion: 'new_file',
            command: testLine(EXPORT_TEST_PATH),
          },
          seen_today: false,
        },
        base_version: 0,
      }),
      uses('toolu_proof_2', 'proof_write', {
        scenario: 'R1.S2',
        proof: {
          mode: 'automated',
          actions: ['Read the amount "21.00" of an invoice line'],
          starting_data: 'None.',
          expected: 'It is 2100 cents.',
          test: {
            repository: 'api',
            path: CENTS_TEST_PATH,
            code: CENTS_TEST,
            insertion: 'new_file',
            command: testLine(CENTS_TEST_PATH),
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
            scenarios: ['R1.S1'],
            targets: [{ repository: 'api', path: 'src/export.js', intent: 'create' }],
            depends_on: [],
          },
          {
            title: 'Read the amounts back',
            result: 'toCents reads an amount as the export prints it.',
            requirements: ['R1'],
            scenarios: ['R1.S2'],
            targets: [{ repository: 'api', path: 'src/invoices.js', intent: 'change' }],
            depends_on: [],
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

/** What stays readable around the key in each place it is put: the tests find each one. */
export const MASKING_PLACES = [
  'Authorization: ',
  'https://payments.example.test/v1/charges?api_key=',
  'The configuration reads',
  'x-api-key',
]

const KEY = FAKE_PAYMENTS_KEY

/** A command line the agent runs, as its call's arguments name it, and what it printed. */
const runs = (id: string, title: string, line: string, printed: string): FakeStep[] => [
  {
    does: 'calls',
    call: { id, title, kind: 'execute', status: 'in_progress', rawInput: { line } },
  },
  {
    does: 'updates',
    call: {
      id,
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: printed } }],
    },
  },
]

/**
 * The agent of a Chat that tries the payments API: the fake key in a request's header and in a
 * URL on the command lines it runs, in JSON written in its own words, and in JSON inside a JSON
 * string, as an agent that read the configuration would put it.
 */
export const LEAKS_THE_KEY: FakeScript = {
  turns: [
    [
      says('I will try the payments API with the key from the configuration.'),
      ...runs(
        'call_headers',
        'Ask for the charges',
        `curl -i -H "Authorization: Bearer ${KEY}" https://payments.example.test/v1/charges`,
        `> Authorization: Bearer ${KEY}\n< HTTP/1.1 200 OK\n`,
      ),
      ...runs(
        'call_url',
        'Ask for the charges by URL',
        `curl -s "https://payments.example.test/v1/charges?api_key=${KEY}"`,
        '{"data": []}',
      ),
      says(`The configuration reads {"payments": {"apiKey": "${KEY}", "currency": "EUR"}}.\n\n`),
      says(
        `The last webhook logged ${JSON.stringify({
          event: 'charge.succeeded',
          request: JSON.stringify({ headers: { 'x-api-key': KEY } }),
        })}.`,
      ),
      says('The API answers; the key works.'),
    ],
  ],
  steps: [says('Noted.')],
}
