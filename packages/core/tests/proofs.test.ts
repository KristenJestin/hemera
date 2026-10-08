/**
 * The proofs and the tasks of a Spec (#90): which proof is refused at write, each refusal naming
 * its field; the task graph's problems, a cycle named as a closed path by title; and what
 * completeness adds to #85's checks.
 *
 * Rewritten from `hemera-legacy` (`packages/core/tests/spec.test.ts`, "A cyclic dependency is
 * refused") against tasks that cover requirements and scenarios instead of stories.
 */

import * as fc from 'fast-check'
import { describe, expect, test } from 'vite-plus/test'

import {
  Proof,
  ProofTest,
  SPEC_SECTIONS,
  SupportFile,
  type SpecTaskText,
  TaskAsked,
  TaskTarget,
  type SpecText,
  completeness,
  cycleSaid,
  graphProblemSaid,
  insertedFiles,
  proofRefusals,
  proofSeen,
  proofText,
  renderSpecMarkdown,
  taskGraph,
} from '../src/domain/index.ts'
import { Result, Schema } from 'effect'

const AUTOMATED: Proof = {
  mode: 'automated',
  actions: ['Import tests/fixtures/names.csv', 'Read the imported name'],
  starting_data: 'tests/fixtures/names.csv holds the name "Éloïse".',
  expected: 'The imported name reads "Éloïse".',
  test: {
    repository: 'api',
    path: 'tests/import-accents.test.ts',
    code: 'test("keeps accents", () => expect(importName("Éloïse")).toBe("Éloïse"))\n',
    insertion: 'new_file',
    command: 'node --test tests/import-accents.test.ts',
  },
  support_files: [
    {
      repository: 'api',
      path: 'tests/fixtures/names.csv',
      insertion: 'new_file',
      content: 'name\nÉloïse\n',
    },
  ],
  seen_today: false,
}

const AUTOMATED_TEST = {
  repository: 'api',
  path: 'tests/import-accents.test.ts',
  code: 'x',
  insertion: 'new_file',
  command: 'node --test tests/import-accents.test.ts',
} as const

const BY_HAND_PROOF = {
  mode: 'by_hand',
  actions: ['Open the list'],
  starting_data: 'None.',
  expected: 'The name reads "Éloïse".',
  seen_today: false,
}

const SEEN: Proof = {
  ...AUTOMATED,
  seen_today: true,
  observed: 'not ok 1 - keeps accents\n  Expected "Éloïse", received "Eloise"',
  key_line: 'Expected "Éloïse", received "Eloise"',
  base_commit: [{ repository: 'api', commit: 'abc1234' }],
}

describe('A proof is refused at write, naming the field', () => {
  test('a complete automated proof, and one seen today, are kept', () => {
    expect(proofRefusals(AUTOMATED)).toEqual([])
    expect(proofRefusals(SEEN)).toEqual([])
  })

  test('seen today without observed, key line or base commit', () => {
    const { observed: _o, key_line: _k, base_commit: _b, ...bare } = SEEN
    expect(proofRefusals(bare)).toEqual([
      '`observed` is required when `seen_today` is true: quote what a real run printed today, verbatim.',
      '`key_line` is required when `seen_today` is true: copy the line of `observed` that shows the behaviour.',
      '`base_commit` is required when `seen_today` is true: the commit of each repository it was seen on.',
    ])
    expect(proofRefusals({ ...SEEN, base_commit: [] })).toEqual([
      '`base_commit` is required when `seen_today` is true: the commit of each repository it was seen on.',
    ])
  })

  test('a key line that is not found verbatim in observed', () => {
    expect(proofRefusals({ ...SEEN, key_line: 'Expected Éloïse, received Eloise' })).toEqual([
      '`key_line` is not in a line of `observed`: copy one line exactly from there.',
    ])
  })

  test('a key line that is blank, or that spans lines of observed, is refused', () => {
    expect(proofRefusals({ ...SEEN, key_line: '   ' })).toEqual([
      '`key_line` is blank: copy the line of `observed` that shows the behaviour.',
    ])
    expect(
      proofRefusals({ ...SEEN, key_line: 'keeps accents\n  Expected "Éloïse", received "Eloise"' }),
    ).toEqual(['`key_line` is not in a line of `observed`: copy one line exactly from there.'])
  })

  test('a key line found once trimmed in a line of observed is kept', () => {
    expect(
      proofRefusals({ ...SEEN, key_line: '  Expected "Éloïse", received "Eloise"  ' }),
    ).toEqual([])
  })

  test('a support file given twice, or at the test’s own path, is refused', () => {
    const [fixture] = AUTOMATED.support_files ?? []
    if (fixture === undefined) throw new Error('no fixture')
    expect(
      proofRefusals({
        ...AUTOMATED,
        support_files: [fixture, fixture, { ...fixture, path: 'tests/import-accents.test.ts' }],
      }),
    ).toEqual([
      '`support_files[1]`: api/tests/fixtures/names.csv is given twice: a proof gives each file once.',
      '`support_files[2]`: api/tests/import-accents.test.ts is the path of the test: a proof gives each file once.',
    ])
  })

  test('a by-hand proof holds actions, starting data and expected only', () => {
    expect(proofRefusals({ ...AUTOMATED, mode: 'by_hand' })).toEqual([
      '`test` is for an automated proof: a proof verified by hand has actions, starting data and expected only.',
      '`support_files` is for an automated proof: a proof verified by hand has actions, starting data and expected only.',
    ])
    const { test: _t, support_files: _s, ...byHand } = AUTOMATED
    expect(proofRefusals({ ...byHand, mode: 'by_hand' })).toEqual([])
  })

  test('an addition needs its patch and its commit; a new support file its content', () => {
    const { test: kept } = AUTOMATED
    if (kept === undefined) throw new Error('no test')
    expect(
      proofRefusals({
        ...AUTOMATED,
        test: { ...kept, insertion: 'addition' },
        support_files: [{ repository: 'api', path: 'tests/helpers.ts', insertion: 'new_file' }],
      }),
    ).toEqual([
      '`test.patch` is required for an addition: the unified patch against the file at the base commit.',
      '`test.against` is required for an addition: the commit the patch was written against.',
      '`support_files[0].content` is required for a new file: its whole content.',
    ])
  })

  test('a command line holds no shell syntax; a test and a command are one or the other', () => {
    const { test: kept } = AUTOMATED
    if (kept === undefined) throw new Error('no test')
    expect(
      proofRefusals({
        ...AUTOMATED,
        test: { ...kept, command: 'pnpm test | tee out.txt' },
        command: 'pnpm test',
      }),
    ).toEqual([
      '`test.command` holds shell syntax (“|”): name a catalogue command, or one command line.',
      '`command` is for a proof without a test file: the test is run by `test.command`.',
    ])
  })

  test('the files a proof inserts are its test, then its support files, each with its field', () => {
    expect(insertedFiles(AUTOMATED)).toEqual([
      {
        field: 'test',
        repository: 'api',
        path: 'tests/import-accents.test.ts',
        insertion: 'new_file',
        patch: null,
      },
      {
        field: 'support_files[0]',
        repository: 'api',
        path: 'tests/fixtures/names.csv',
        insertion: 'new_file',
        patch: null,
      },
    ])
  })

  test('the page reads support files by reference, never their content', () => {
    expect(proofSeen(AUTOMATED).support_files).toEqual([
      { repository: 'api', path: 'tests/fixtures/names.csv', insertion: 'new_file' },
    ])
  })
})

const task = (id: string, title: string, dependsOn: ReadonlyArray<string> = []) => ({
  id,
  title,
  requirements: ['R1'],
  scenarios: ['R1.S1'],
  dependsOn,
})

const LIVE = { requirements: new Set(['R1']), scenarios: new Set(['R1.S1']) }

describe('A cyclic dependency is refused', () => {
  test('the graph returns the cycle as a closed path by title', () => {
    const graph = [task('T1', 'A', ['T2']), task('T2', 'B', ['T3']), task('T3', 'C', ['T1'])]
    expect(taskGraph(graph, LIVE)).toEqual([{ kind: 'cycle', path: ['A', 'B', 'C', 'A'] }])
  })

  test('the refusal names the cycle A → B → C → A', () => {
    expect(cycleSaid(['A', 'B', 'C', 'A'])).toBe('A → B → C → A')
    expect(graphProblemSaid({ kind: 'cycle', path: ['A', 'B', 'C', 'A'] })).toBe(
      'The tasks depend on each other in a cycle: A → B → C → A.',
    )
  })

  test('an acyclic graph with valid references has no problem', () => {
    expect(taskGraph([task('T1', 'A', ['T2']), task('T2', 'B')], LIVE)).toEqual([])
  })

  test('a dependency, a requirement or a scenario that names nothing is a reference problem', () => {
    const problems = taskGraph(
      [{ ...task('T1', 'A', ['T9']), requirements: ['R7'], scenarios: ['R1.S1', 'R1.S9'] }],
      LIVE,
    )
    expect(problems).toEqual([
      { kind: 'unknown_task', task: 'T1', target: 'T9' },
      { kind: 'unknown_requirement', task: 'T1', target: 'R7' },
      { kind: 'unknown_scenario', task: 'T1', target: 'R1.S9' },
    ])
    expect(problems.map(graphProblemSaid)).toEqual([
      'T1 depends on T9, which is no task of the graph.',
      'T1 covers R7, which is no requirement of the Spec.',
      'T1 covers R1.S9, which is no scenario of the Spec.',
    ])
  })
})

describe('One id is one task', () => {
  test('an id given to two tasks is a problem, said once', () => {
    const problems = taskGraph(
      [task('T1', 'A'), task('T1', 'B'), task('T1', 'C'), task('T2', 'D')],
      LIVE,
    )
    expect(problems).toEqual([{ kind: 'duplicate_task', task: 'T1' }])
    expect(problems.map(graphProblemSaid)).toEqual([
      'T1 is the id of more than one task: each task has its own.',
    ])
  })
})

/** Whether a graph has a cycle, by Kahn's algorithm: what the property checks `taskGraph` against. */
const cyclic = (size: number, edges: ReadonlyArray<readonly [number, number]>): boolean => {
  const incoming = Array.from({ length: size }, () => 0)
  for (const [, to] of edges) incoming[to] = (incoming[to] ?? 0) + 1
  const ready = incoming.flatMap((count, at) => (count === 0 ? [at] : []))
  let ordered = 0
  while (ready.length > 0) {
    const node = ready.pop() ?? 0
    ordered += 1
    for (const [from, to] of edges) {
      if (from !== node) continue
      incoming[to] = (incoming[to] ?? 0) - 1
      if (incoming[to] === 0) ready.push(to)
    }
  }
  return ordered < size
}

describe('taskGraph finds a cycle exactly when one exists', () => {
  test('on random graphs', () => {
    const graphs = fc.integer({ min: 1, max: 9 }).chain((size) =>
      fc.record({
        size: fc.constant(size),
        edges: fc.uniqueArray(fc.tuple(fc.nat({ max: size - 1 }), fc.nat({ max: size - 1 })), {
          maxLength: size * 3,
          selector: ([from, to]) => `${String(from)}>${String(to)}`,
        }),
      }),
    )
    fc.assert(
      fc.property(graphs, ({ size, edges }) => {
        const tasks = Array.from({ length: size }, (_, at) =>
          task(
            `T${String(at + 1)}`,
            `Task ${String(at + 1)}`,
            edges.filter(([from]) => from === at).map(([, to]) => `T${String(to + 1)}`),
          ),
        )
        const cycles = taskGraph(tasks, LIVE).filter((problem) => problem.kind === 'cycle')
        expect(cycles.length > 0).toBe(cyclic(size, edges))
        for (const problem of cycles) {
          if (problem.kind !== 'cycle') continue
          // A closed path: it ends where it starts.
          expect(problem.path.at(0)).toBe(problem.path.at(-1))
        }
      }),
    )
  })
})

const TASK: SpecTaskText = {
  id: 'T1',
  title: 'Keep accents on import',
  result: 'Imported names keep their accents.',
  requirements: ['R1'],
  scenarios: ['R1.S1'],
  targets: [{ repository: 'api', path: 'importer.ts', intent: 'change' }],
  dependsOn: [],
}

const scenario = (id: string, proof: Proof | null = AUTOMATED) => ({
  id,
  when: 'the user imports names.csv',
  then: 'the name keeps its accents',
  version: 1,
  proof: proof === null ? null : proofSeen(proof),
  proofVersion: proof === null ? 0 : 1,
})

const planned = (): SpecText => ({
  key: 'ACME-12',
  title: 'Import names as written',
  type: 'bug',
  language: 'en',
  version: 12,
  sections: SPEC_SECTIONS.map((name) => ({ name, body: `The ${name}.`, version: 1 })),
  requirements: [
    {
      id: 'R1',
      domain: 'imports',
      delta: 'modified',
      livingRef: null,
      livingVersion: null,
      text: 'Names import as written.',
      version: 1,
      removed: false,
      scenarios: [scenario('R1.S1', SEEN)],
    },
  ],
  tasks: [TASK],
  tasksVersion: 1,
  recommendation: { agent: 'claude', model: 'large', effort: 'high', reason: 'A small change.' },
})

const ready = {
  described: true,
  triagePending: false,
  pendingInputs: [],
  openQuestions: [],
  livingChanged: [],
  atBase: [],
  openDiscussions: [],
} as const

describe('Completeness adds the proofs, the tasks and the model', () => {
  test('a complete Spec passes', () => {
    expect(completeness(planned(), ready)).toEqual([])
  })

  test('a scenario without a proof, one no task covers, a task covering nothing, no model', () => {
    const spec = planned()
    const failures = completeness(
      {
        ...spec,
        requirements: [
          {
            ...spec.requirements[0]!,
            scenarios: [scenario('R1.S1', SEEN), scenario('R1.S2', null)],
          },
        ],
        tasks: [TASK, { ...TASK, id: 'T2', title: 'Tidy up', scenarios: [] }],
        recommendation: null,
      },
      ready,
    )
    expect(failures).toEqual([
      { target: 'R1.S2', sentence: 'R1.S2 has no proof: write it with proof_write.' },
      { target: 'R1.S2', sentence: 'R1.S2 is covered by no task.' },
      { target: 'T2', sentence: 'T2 (Tidy up) covers no scenario.' },
      {
        target: 'model',
        sentence: 'No model is recommended for Building: give one with model_recommend.',
      },
    ])
  })

  test('an automated proof without a test nor a command, a by-hand one without starting data', () => {
    const { test: _t, support_files: _s, ...bare } = AUTOMATED
    const spec = planned()
    const failures = completeness(
      {
        ...spec,
        requirements: [
          {
            ...spec.requirements[0]!,
            scenarios: [
              scenario('R1.S1', { ...bare, actions: [] }),
              scenario('R1.S2', { ...bare, mode: 'by_hand', starting_data: ' ' }),
            ],
          },
        ],
        tasks: [{ ...TASK, scenarios: ['R1.S1', 'R1.S2'] }],
      },
      ready,
    )
    expect(failures).toEqual([
      { target: 'R1.S1', sentence: 'R1.S1’s proof has no action.' },
      { target: 'R1.S1', sentence: 'R1.S1’s proof has neither a test nor a command.' },
      {
        target: 'R1.S2',
        sentence: 'R1.S2’s proof has no starting data: write "None." when it starts from nothing.',
      },
    ])
  })

  test('what is seen today without its output; a cycle; what Git found at the base', () => {
    const { observed: _o, ...withoutOutput } = SEEN
    const spec = planned()
    const failures = completeness(
      {
        ...spec,
        requirements: [{ ...spec.requirements[0]!, scenarios: [scenario('R1.S1', withoutOutput)] }],
        tasks: [
          { ...TASK, dependsOn: ['T2'] },
          { ...TASK, id: 'T2', title: 'Second', dependsOn: ['T1'] },
        ],
      },
      {
        ...ready,
        atBase: [
          {
            target: 'T1',
            sentence: 'T1 changes api/importer.ts, which does not exist at the base commit.',
          },
        ],
      },
    )
    expect(failures).toEqual([
      {
        target: 'R1.S1',
        sentence:
          'R1.S1’s proof: `observed` is required when `seen_today` is true: quote what a real run printed today, verbatim.',
      },
      {
        target: 'tasks',
        sentence:
          'The tasks depend on each other in a cycle: Keep accents on import → Second → Keep accents on import.',
      },
      {
        target: 'T1',
        sentence: 'T1 changes api/importer.ts, which does not exist at the base commit.',
      },
    ])
  })
})

describe('The readable file carries the proofs, the tasks and the model', () => {
  test('each proof under its scenario, then the tasks, then the model', () => {
    const text = renderSpecMarkdown(planned())
    expect(text).toContain('  - Proof: automated, seen today')
    expect(text).toContain('    - Key line: Expected "Éloïse", received "Eloise"')
    expect(text).toContain(
      '    - Test: api/tests/import-accents.test.ts (new file), run by `node --test tests/import-accents.test.ts`',
    )
    expect(text).toContain('    - Support files: api/tests/fixtures/names.csv (new file)')
    expect(text).not.toContain('name\nÉloïse')
    const headings = text.split('\n').filter((line) => line.startsWith('## '))
    expect(headings.slice(-2)).toEqual(['## Tasks', '## Model for Building'])
    expect(text).toContain(
      '- T1 · Keep accents on import: Imported names keep their accents. Covers R1, R1.S1. Targets: change api/importer.ts.',
    )
    expect(text).toContain('claude · large · effort high: A small change.')
  })
})

describe('A path in a repository is one Git can name, inside it', () => {
  const BAD = [
    '/etc/passwd',
    '../escape.ts',
    'tests/../../escape.ts',
    'C:/acme/api.ts',
    'tests\\a.ts',
    '.git/config',
    'api/.git',
    'tests//a.ts',
    './a.ts',
    '',
  ]
  /** Whether each of a target, a support file and a test reads with the path. */
  const decoders: ReadonlyArray<(path: string) => boolean> = [
    (path) =>
      Result.isSuccess(
        Schema.decodeUnknownResult(TaskTarget)({ repository: 'api', path, intent: 'create' }),
      ),
    (path) =>
      Result.isSuccess(
        Schema.decodeUnknownResult(SupportFile)({
          repository: 'api',
          path,
          insertion: 'new_file',
          content: '',
        }),
      ),
    (path) =>
      Result.isSuccess(
        Schema.decodeUnknownResult(ProofTest)({
          repository: 'api',
          path,
          code: 'x',
          insertion: 'new_file',
          command: 'node a.ts',
        }),
      ),
  ]

  test.each(BAD)('%j is refused by a target, a support file and a test', (path) => {
    for (const decode of decoders) expect(decode(path)).toBe(false)
  })

  test('a relative path inside the repository is kept', () => {
    for (const decode of decoders) {
      expect(decode('tests/fixtures/names.csv')).toBe(true)
      expect(decode('.github/workflows/ci.yml')).toBe(true)
    }
  })
})

describe('The Spec file keeps its Markdown whole', () => {
  test('a fence is longer than any run of ~ in what it holds', () => {
    const text = proofText(
      proofSeen({
        ...SEEN,
        test: { ...AUTOMATED_TEST, code: 'const doc = `\n~~~\nnot the end\n~~~~\n`\n' },
        observed: 'before\n~~~~~\nafter',
        key_line: 'after',
      }),
    )
    expect(text).toContain('      ~~~~~\n      const doc = `')
    expect(text).toContain('      ~~~~~~\n      before')
    // Each block opens and closes on its own fence; what it holds stays inside.
    const lines = text.split('\n').map((line) => line.trim())
    expect(lines.filter((line) => line === '~~~~~')).toHaveLength(3)
    expect(lines.filter((line) => line === '~~~~~~')).toHaveLength(2)
  })

  test('a field written on one line refuses a newline', () => {
    const refused = (decoded: Result.Result<unknown, unknown>) => Result.isFailure(decoded)
    expect(
      refused(Schema.decodeUnknownResult(Proof)({ ...BY_HAND_PROOF, starting_data: 'one\ntwo' })),
    ).toBe(true)
    expect(
      refused(Schema.decodeUnknownResult(Proof)({ ...BY_HAND_PROOF, actions: ['one\n- two'] })),
    ).toBe(true)
    expect(
      refused(Schema.decodeUnknownResult(Proof)({ ...BY_HAND_PROOF, expected: 'one\r\ntwo' })),
    ).toBe(true)
    expect(
      refused(
        Schema.decodeUnknownResult(TaskAsked)({
          title: 'Parse\n## Injected',
          result: 'Done.',
          requirements: [],
          scenarios: [],
          targets: [],
          depends_on: [],
        }),
      ),
    ).toBe(true)
    expect(refused(Schema.decodeUnknownResult(Proof)(BY_HAND_PROOF))).toBe(false)
  })
})
