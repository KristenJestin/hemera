/**
 * Red first, then green (#144): how Hemera classifies a proof run (CT-35) from the report the
 * Project's test runner prints (JUnit XML, TAP) or from its exit code and its words, what makes a
 * red valid, and how a key line observed in Planning is found again once colours, paths,
 * durations, addresses and numbers are masked.
 */

import { readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'

import { Predicate } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type GoModule,
  KEYS_CAP,
  NAME_CAP,
  REPORT_CAP,
  type ReportFound,
  type ScenarioProofState,
  type TestReporting,
  classifyProofRun,
  addedTestNames,
  addedTests,
  foundReport,
  goModulePath,
  keyLineFound,
  normalisedOutput,
  redPassed,
  reportedTests,
  runnerChange,
  runnerReads,
  shellSyntaxIn,
  validRed,
  withReporting,
  wordsOf,
} from '../src/domain/index.ts'

const TAP_ASSERTION = `TAP version 13
# Subtest: exports as CSV
not ok 1 - exports as CSV
  ---
  duration_ms: 2.03473
  type: 'test'
  location: '/work/acme/api/tests/export.test.mjs:3:1'
  failureType: 'testCodeFailure'
  error: |-
    the CSV uses commas

    'a,b' !== 'a;b'

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: 'a;b'
  actual: 'a,b'
  operator: 'strictEqual'
  ...
1..1
# tests 1
# pass 0
# fail 1
`

const TAP_IMPORT = `TAP version 13
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/work/acme/api/export.mjs' imported from /work/acme/api/tests/export.test.mjs
# Subtest: tests/export.test.mjs
not ok 1 - tests/export.test.mjs
  ---
  duration_ms: 28.437904
  type: 'test'
  location: '/work/acme/api/tests/export.test.mjs:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# pass 0
# fail 1
`

const TAP_REFUSED = `TAP version 13
# Subtest: reaches the service
not ok 1 - reaches the service
  ---
  duration_ms: 9.336448
  type: 'test'
  location: '/work/acme/api/tests/export.test.mjs:4:1'
  failureType: 'testCodeFailure'
  error: 'connect ECONNREFUSED 127.0.0.1:9'
  code: 'ECONNREFUSED'
  ...
1..1
# tests 1
# pass 0
# fail 1
`

const TAP_PASSED = `TAP version 13
# Subtest: exports
ok 1 - exports
  ---
  duration_ms: 1.082548
  type: 'test'
  ...
1..1
# tests 1
# pass 1
# fail 0
`

const JUNIT_ASSERTION = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<testcase name="exports as CSV" time="0.001945" classname="test" file="/work/acme/api/tests/export.test.mjs" failure="the CSV uses commas&#10;&#10;'a,b' !== 'a;b'&#10;">
		<failure type="testCodeFailure" message="the CSV uses commas&#10;&#10;'a,b' !== 'a;b'">
[Error [ERR_TEST_FAILURE]: the CSV uses commas] {
  cause: AssertionError [ERR_ASSERTION]: the CSV uses commas
}
		</failure>
	</testcase>
	<!-- tests 1 -->
	<!-- pass 0 -->
	<!-- fail 1 -->
</testsuites>
`

const JUNIT_EMPTY = `<?xml version="1.0" encoding="utf-8"?>
<testsuites>
	<!-- tests 0 -->
	<!-- pass 0 -->
	<!-- fail 0 -->
</testsuites>
`

/** Two tests in one file: one that was there fails, the scenario's passes. */
const TAP_OTHER_FAILS = `TAP version 13
# Subtest: one is one
not ok 1 - one is one
  ---
  duration_ms: 1.2
  type: 'test'
  location: '/work/acme/api/tests/export.test.mjs:5:1'
  failureType: 'testCodeFailure'
  error: 'it was broken already'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  ...
# Subtest: the invoices export as Markdown
ok 2 - the invoices export as Markdown
  ---
  duration_ms: 0.4
  type: 'test'
  ...
1..2
# tests 2
# pass 1
# fail 1
`

/** The same file, the scenario's test failing too. */
const TAP_BOTH_FAIL = TAP_OTHER_FAILS.replace(
  `ok 2 - the invoices export as Markdown
  ---
  duration_ms: 0.4
  type: 'test'
  ...`,
  `not ok 2 - the invoices export as Markdown
  ---
  duration_ms: 0.4
  type: 'test'
  location: '/work/acme/api/tests/export.test.mjs:9:1'
  failureType: 'testCodeFailure'
  error: 'export.ts exports nothing yet'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  ...`,
)

/** The runner stopped a test that ran past its timeout. */
const TAP_TIMEOUT = `TAP version 13
# Subtest: exports as CSV
not ok 1 - exports as CSV
  ---
  duration_ms: 30000.2
  type: 'test'
  location: '/work/acme/api/tests/export.test.mjs:3:1'
  failureType: 'testTimeoutFailure'
  error: 'test timed out after 30000ms'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# pass 0
# fail 1
`

const run = (
  output: string,
  exitCode: number | null,
  testPath: string | null = 'tests/export.test.mjs',
) => classifyProofRun({ output, exitCode, testPath })

/** Module `example.com/acme`, its `go.mod` at the repository's root: the Go outputs' module. */
const ACME: GoModule = { path: 'example.com/acme', folder: '' }

/** Whether a run is a valid red of a test of module `example.com/acme`. */
const goRed = (
  ran: Parameters<typeof validRed>[0],
  testPath: string | null,
  testNames: Parameters<typeof validRed>[2] = [],
  keyLineMatched: boolean | null = null,
) => validRed(ran, testPath, testNames, keyLineMatched, ACME)

/**
 * How many times longer `read` takes on the input `make` builds at eight times the size: about 8
 * when the reading is linear, 64 when it is quadratic, whatever the machine's speed. Each side is
 * read once to warm up, then as many times as make the small side last 5 ms or more, the two sides
 * one after the other, three times over: the smallest of the three ratios is kept, since a busy
 * machine can slow a side down but never make a superlinear reading look linear three times.
 */
const growth = (make: (size: number) => string, size: number, read: (output: string) => void) => {
  const small = make(size)
  const large = make(size * 8)
  read(small)
  read(large)
  const started = performance.now()
  read(small)
  const times = Math.ceil(5 / Math.max(performance.now() - started, 0.001))
  const timed = (output: string) => {
    const begun = performance.now()
    for (let count = 0; count < times; count += 1) read(output)
    return performance.now() - begun
  }
  return Math.min(...[0, 1, 2].map(() => timed(large) / timed(small)))
}

describe('A proof run is classified (CT-35)', () => {
  test('a TAP report whose test failed on an assertion is assertion_failed, with the test and the assertion', () => {
    expect(run(TAP_ASSERTION, 1)).toMatchObject({
      classification: 'assertion_failed',
      failingTest: 'exports as CSV',
      assertion: 'the CSV uses commas',
      failingFile: '/work/acme/api/tests/export.test.mjs',
    })
  })

  test('a JUnit report whose test failed on an assertion is assertion_failed', () => {
    expect(run(JUNIT_ASSERTION, 1)).toMatchObject({
      classification: 'assertion_failed',
      failingTest: 'exports as CSV',
      assertion: 'the CSV uses commas',
      failingFile: '/work/acme/api/tests/export.test.mjs',
    })
  })

  test('a test file that does not load (a module not found) is error_before_test', () => {
    expect(run(TAP_IMPORT, 1).classification).toBe('error_before_test')
  })

  test('a syntax error before any test, printed in words, is error_before_test', () => {
    expect(
      run('SyntaxError: Unexpected token )\n    at compileSourceTextModule', 1).classification,
    ).toBe('error_before_test')
    expect(run('src/export.ts(3,1): error TS2304: Cannot find name x', 2).classification).toBe(
      'error_before_test',
    )
  })

  test('a service that cannot be reached is environment', () => {
    expect(run(TAP_REFUSED, 1).classification).toBe('environment')
    expect(run('Error: listen EADDRINUSE: address already in use :::3000', 1).classification).toBe(
      'environment',
    )
  })

  test('a run that never exited on its own (killed, timed out, not started) is environment', () => {
    expect(run('', null).classification).toBe('environment')
  })

  test('a test file the runner cannot find, or a report with no test, is test_not_found', () => {
    expect(run("Could not find 'tests/export.test.mjs'", 1).classification).toBe('test_not_found')
    expect(run(JUNIT_EMPTY, 0).classification).toBe('test_not_found')
  })

  test('a run that exits 0 with its tests passing is passed', () => {
    expect(run(TAP_PASSED, 0).classification).toBe('passed')
    expect(run('All good.', 0).classification).toBe('passed')
  })

  test('a failing command with no test file and no other sign is assertion_failed: its exit code is its expected result', () => {
    expect(run('api runs on framework 10', 1, null).classification).toBe('assertion_failed')
  })

  test('an assertion whose message says something timed out is assertion_failed, not environment', () => {
    const timedOut = TAP_ASSERTION.replace('the CSV uses commas', 'the export timed out')
    expect(run(timedOut, 1).classification).toBe('assertion_failed')
    expect(run('AssertionError: the export timed out', 1).classification).toBe('assertion_failed')
  })

  test('the runner’s own timeout is environment', () => {
    expect(run(TAP_TIMEOUT, 1).classification).toBe('environment')
  })

  test('a pytest assertion, with no report, is assertion_failed', () => {
    const output = [
      '    def test_exports_markdown():',
      '>       assert to_markdown([]) == "| total |"',
      "E       AssertionError: assert '' == '| total |'",
      'FAILED tests/test_export.py::test_exports_markdown - AssertionError',
    ].join('\n')
    expect(run(output, 1, 'tests/test_export.py').classification).toBe('assertion_failed')
    const plain = 'E       assert 1 == 2\nFAILED tests/test_export.py::test_one - assert 1 == 2'
    expect(run(plain, 1, 'tests/test_export.py').classification).toBe('assertion_failed')
  })

  test('a Go test that failed is assertion_failed', () => {
    const output =
      '--- FAIL: TestExportMarkdown (0.00s)\n    export_test.go:12: got "", want "| total |"\nFAIL'
    expect(run(output, 1, 'export_test.go').classification).toBe('assertion_failed')
  })

  test('a Rust assertion that failed is assertion_failed', () => {
    const output = [
      "thread 'tests::exports_markdown' panicked at src/export.rs:20:9:",
      'assertion `left == right` failed',
      '  left: ""',
      ' right: "| total |"',
      'test tests::exports_markdown ... FAILED',
    ].join('\n')
    expect(run(output, 101, 'src/export.rs').classification).toBe('assertion_failed')
  })

  test('a failing test run whose words name no assertion is error_before_test', () => {
    expect(run('something went wrong', 1).classification).toBe('error_before_test')
  })
})

describe('A valid red', () => {
  test('a valid red is an assertion that failed in the scenario’s test; one in another file is not', () => {
    expect(validRed(run(TAP_ASSERTION, 1), 'tests/export.test.mjs', [], true)).toBe(true)
    expect(validRed(run(TAP_ASSERTION, 1), 'tests/import.test.mjs')).toBe(false)
    expect(validRed(run(TAP_IMPORT, 1), 'tests/export.test.mjs')).toBe(false)
    expect(validRed(run('exit 1', 1, null), null)).toBe(true)
  })

  test('an existing failing test in the same file is not taken as the scenario’s red', () => {
    const scenario = ['the invoices export as Markdown']
    expect(validRed(run(TAP_OTHER_FAILS, 1), 'tests/export.test.mjs', scenario)).toBe(false)
    expect(validRed(run(TAP_BOTH_FAIL, 1), 'tests/export.test.mjs', scenario, true)).toBe(true)
  })

  test('a TAP report written on Windows, its location’s backslashes escaped, names the scenario’s test file', () => {
    const windows = TAP_ASSERTION.replace(
      /location: '[^']*'/,
      "location: 'D:\\\\a\\\\_temp\\\\api\\\\tests\\\\export.test.mjs:5:1'",
    )
    expect(windows).toContain('D:\\\\a')
    expect(validRed(run(windows, 1), 'tests/export.test.mjs', [], true)).toBe(true)
  })

  test('a red from plain vitest output, with no report, is valid when the scenario’s test is named among its failures', () => {
    const output = [
      ' FAIL  tests/export.test.ts > exports > the invoices export as Markdown',
      'AssertionError: expected false to be true // Object.is equality',
      ' Test Files  1 failed (1)',
    ].join('\n')
    const names = ['the invoices export as Markdown']
    expect(
      validRed(run(output, 1, 'tests/export.test.ts'), 'tests/export.test.ts', names, true),
    ).toBe(true)
    const other = output.replace('the invoices export as Markdown', 'one is one')
    expect(validRed(run(other, 1, 'tests/export.test.ts'), 'tests/export.test.ts', names)).toBe(
      false,
    )
  })

  test('a JUnit report that names the file only in its classname is a valid red by the test’s name', () => {
    const output = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="1">
  <testsuite name="tests/export.test.ts" tests="1" failures="1">
    <testcase classname="tests/export.test.ts" name="exports &gt; the invoices export as Markdown">
      <failure message="expected false to be true" type="AssertionError">AssertionError: expected false to be true</failure>
    </testcase>
  </testsuite>
</testsuites>
`
    expect(
      validRed(run(output, 1), 'tests/export.test.ts', ['the invoices export as Markdown'], true),
    ).toBe(true)
  })

  test('a test named through describe.each or a template is found again among the failures', () => {
    const code = [
      "describe.each(['csv', 'md'])('exports %s', (kind) => {",
      '  it(`writes ${kind}`, () => {})',
      '})',
    ].join('\n')
    const names = addedTests({ insertion: 'new_file', code, patch: null })
    expect(names).toEqual([
      {
        title: { template: 'writes ${kind}' },
        scope: [{ template: 'exports %s' }],
        twin: false,
        clash: false,
      },
    ])
    const output =
      ' FAIL  tests/export.test.ts > exports md > writes md\nAssertionError: expected 1 to be 2'
    expect(validRed(run(output, 1), 'tests/export.test.ts', names, true)).toBe(true)
  })

  test('a passing test printed beside a failing one is not the red', () => {
    const output = [
      ' ✓ tests/export.test.ts > the invoices export as Markdown 2ms',
      ' × tests/export.test.ts > one is one 3ms',
      'AssertionError: it was broken already',
    ].join('\n')
    expect(
      validRed(run(output, 1), 'tests/export.test.ts', ['the invoices export as Markdown']),
    ).toBe(false)
  })

  test('a name is matched whole: "exports" is not the failing "exports as CSV"', () => {
    const output = ' × exports as CSV 3ms\nAssertionError: the CSV uses commas'
    expect(validRed(run(output, 1), 'tests/export.test.ts', ['exports'])).toBe(false)
    expect(validRed(run(output, 1), 'tests/export.test.ts', ['exports as CSV'], true)).toBe(true)
  })

  test('a name made of a placeholder alone matches nothing', () => {
    const output = ' × md 3ms\nAssertionError: expected 1 to be 2'
    expect(validRed(run(output, 1), 'tests/export.test.ts', [{ template: '${kind}' }])).toBe(false)
  })

  test('the scenario’s failing test above a long stack is found in the whole output', () => {
    const output = [
      ' × tests/export.test.ts > the invoices export as Markdown 3ms',
      'AssertionError: expected false to be true',
      ...Array.from(
        { length: 300 },
        (_, at) => `    at frame${String(at)} (/work/acme/node_modules/x.js:1:1)`,
      ),
    ].join('\n')
    expect(
      validRed(run(output, 1), 'tests/export.test.ts', ['the invoices export as Markdown'], true),
    ).toBe(true)
  })

  test('with no file named and no test name among the failures, the key line decides; the exit code alone does not', () => {
    const output = 'AssertionError: the CSV uses commas'
    const path = 'tests/export.test.mjs'
    expect(validRed(run(output, 1), path, ['exports as CSV'], true)).toBe(true)
    expect(validRed(run(output, 1), path, ['exports as CSV'], null)).toBe(false)
    expect(validRed(run(output, 1), path, ['exports as CSV'], false)).toBe(false)
  })

  test('the tests a proof adds are named from its new file, or from the lines its patch adds', () => {
    expect(
      addedTestNames({
        insertion: 'new_file',
        code: 'test(\'exports as CSV\', () => {})\nit("reads it back", () => {})\n',
        patch: null,
      }),
    ).toEqual(['exports as CSV', 'reads it back'])
    expect(
      addedTestNames({
        insertion: 'addition',
        code: "test('one is one', () => {})\ntest('the invoices export as Markdown', () => {})\n",
        patch:
          "@@ -1 +1,2 @@\n test('one is one', () => {})\n+test('the invoices export as Markdown', () => {})\n",
      }),
    ).toEqual(['the invoices export as Markdown'])
  })

  test('test.each and it.each name their tests too', () => {
    expect(
      addedTestNames({
        insertion: 'new_file',
        code: "test.each([['csv', 1], ['md', 2]])('exports %s', (kind) => {})\nit.each`\n  a\n`('reads $a', () => {})\n",
        patch: null,
      }),
    ).toEqual(['exports %s', 'reads $a'])
  })

  test('a scenario got past its red once recorded, set aside as not reproducible, or green since', () => {
    const passed: ReadonlyArray<ScenarioProofState> = [
      'red_recorded',
      'not_reproducible',
      'green',
      'to_rerun',
    ]
    const waiting: ReadonlyArray<ScenarioProofState> = ['waiting_red', 'held', 'to_verify']
    expect(passed.every((state) => redPassed(state))).toBe(true)
    expect(waiting.some((state) => redPassed(state))).toBe(false)
  })
})

/** Mocha 10.8, its own words: the scenario's test failed, numbered `1)`. */
const MOCHA_SCENARIO_FAILS = `

  exports
    ✔ one is one
    1) the invoices export as Markdown


  1 passing (5ms)
  1 failing

  1) exports
       the invoices export as Markdown:

      AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

'' !== '| total |'

      + expected - actual

      +| total |
      
      at Context.<anonymous> (tests/export.test.cjs:4:56)
      at process.processImmediate (node:internal/timers:504:21)
`

/** Mocha, the other way round: a test that was there fails, the scenario's passes. */
const MOCHA_OTHER_FAILS = MOCHA_SCENARIO_FAILS.replace(
  '    ✔ one is one\n    1) the invoices export as Markdown',
  '    1) one is one\n    ✔ the invoices export as Markdown',
).replace(
  '  1) exports\n       the invoices export as Markdown:',
  '  1) exports\n       one is one:',
)

/** pytest 9.1, its own words: a test that was there fails, the one the proof adds passes. */
const PYTEST_OTHER_FAILS = `============================= test session starts ==============================
platform linux -- Python 3.13.16, pytest-9.1.1, pluggy-1.6.0
rootdir: /work/acme/api
collected 2 items

tests/test_export.py F.                                                  [100%]

=================================== FAILURES ===================================
_______________________________ test_one_is_one ________________________________

    def test_one_is_one():
>       assert 1 == 2
E       assert 1 == 2

tests/test_export.py:6: AssertionError
=========================== short test summary info ============================
FAILED tests/test_export.py::test_one_is_one - assert 1 == 2
========================= 1 failed, 1 passed in 0.02s ==========================
`

/** The same file, the test the proof adds failing too. */
const PYTEST_BOTH_FAIL = `============================= test session starts ==============================
platform linux -- Python 3.13.16, pytest-9.1.1, pluggy-1.6.0
rootdir: /work/acme/api
collected 2 items

tests/test_export.py FF                                                  [100%]

=================================== FAILURES ===================================
_______________________________ test_one_is_one ________________________________

    def test_one_is_one():
>       assert 1 == 2
E       assert 1 == 2

tests/test_export.py:6: AssertionError
____________________________ test_exports_markdown _____________________________

    def test_exports_markdown():
>       assert to_markdown([]) == "| total |"
E       AssertionError: assert '' == '| total |'
E         
E         - | total |

tests/test_export.py:10: AssertionError
=========================== short test summary info ============================
FAILED tests/test_export.py::test_one_is_one - assert 1 == 2
FAILED tests/test_export.py::test_exports_markdown - AssertionError: assert '...
============================== 2 failed in 0.01s ===============================
`

/** go test, Go 1.23, its own words: the scenario's test failed. */
const GO_SCENARIO_FAILS = `--- FAIL: TestExportMarkdown (0.00s)
    export_test.go:13: got "", want "| total |"
FAIL
FAIL	example.com/acme	0.001s
FAIL
`

/** cargo test, its own words: the scenario's test failed. */
const CARGO_SCENARIO_FAILS = `   Compiling acme v0.1.0 (/work/acme/api)
    Finished \`test\` profile [unoptimized + debuginfo] target(s) in 0.21s
     Running unittests src/lib.rs (target/debug/deps/acme-d5b7551ab0e24432)

running 2 tests
test tests::one_is_one ... ok
test tests::exports_markdown ... FAILED

failures:

---- tests::exports_markdown stdout ----

thread 'tests::exports_markdown' (1292006) panicked at src/lib.rs:12:9:
assertion \`left == right\` failed
  left: ""
 right: "| total |"
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace


failures:
    tests::exports_markdown

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass \`--lib\`
`

/** jest 30.2, its own words: the scenario's test failed. */
const JEST_SCENARIO_FAILS = `FAIL ./tests/export.test.js
  exports
    ✓ one is one (2 ms)
    ✕ the invoices export as Markdown (3 ms)

  ● exports › the invoices export as Markdown

    expect(received).toBe(expected) // Object.is equality

    Expected: "| total |"
    Received: ""

      at Object.toBe (tests/export.test.js:4:60)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 passed, 2 total
`

/** node --test, its spec reporter: the scenario's test failed. */
const NODE_SPEC_SCENARIO_FAILS = `▶ exports
  ✔ one is one (0.547321ms)
  ✖ the invoices export as Markdown (0.9739ms)
✖ exports (2.334899ms)
ℹ tests 2
ℹ pass 1
ℹ fail 1

✖ failing tests:

test at tests/export.test.mjs:5:3
✖ the invoices export as Markdown (0.9739ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  '' !== '| total |'
`

const SCENARIO = ['the invoices export as Markdown']

describe('A red read from the words of each runner', () => {
  test('a passing test whose name contains FAIL, beside an unrelated failure, is not a red', () => {
    const output = [
      ' ✓ tests/export.test.ts > shows FAIL when the export breaks 2ms',
      ' × tests/export.test.ts > one is one 3ms',
      'AssertionError: it was broken already',
    ].join('\n')
    const names = ['shows FAIL when the export breaks']
    expect(validRed(run(output, 1), 'tests/export.test.ts', names)).toBe(false)
  })

  test('a FAILED to load log line ending with the scenario’s name is not a red', () => {
    for (const log of [
      'FAILED to load: the invoices export as Markdown',
      '[fixtures] FAILED to load: the invoices export as Markdown',
    ]) {
      const output = [log, ' × tests/export.test.ts > one is one 3ms', 'AssertionError: no'].join(
        '\n',
      )
      expect(validRed(run(output, 1), 'tests/export.test.ts', SCENARIO)).toBe(false)
    }
  })

  test('a log line holding a runner’s mark in its middle is not a failing line', () => {
    const output = [
      'stdout | the export ● the invoices export as Markdown',
      'note: × the invoices export as Markdown',
      'see 1) the invoices export as Markdown',
      'log: test the invoices export as Markdown ... FAILED',
      ' × tests/export.test.ts > one is one 3ms',
      'AssertionError: no',
    ].join('\n')
    expect(run(output, 1).failingLines).toEqual([' × tests/export.test.ts > one is one 3ms'])
  })

  test('mocha’s numbered failure is a red, by name', () => {
    const path = 'tests/export.test.cjs'
    expect(validRed(run(MOCHA_SCENARIO_FAILS, 1, path), path, SCENARIO, true)).toBe(true)
  })

  test('mocha’s numbered failure of another test is not the scenario’s red', () => {
    const path = 'tests/export.test.cjs'
    expect(validRed(run(MOCHA_OTHER_FAILS, 1, path), path, SCENARIO)).toBe(false)
  })

  test('a pytest addition into a file whose older test already fails, the new test passing, is not a red', () => {
    const path = 'tests/test_export.py'
    const names = addedTestNames({
      insertion: 'addition',
      code: 'def test_one_is_one():\n    assert 1 == 2\n\n\ndef test_exports_markdown():\n    assert to_markdown([]) == "| total |"\n',
      patch:
        '@@ -5,0 +7,4 @@\n+\n+\n+def test_exports_markdown():\n+    assert to_markdown([]) == "| total |"\n',
    })
    expect(names).toEqual(['test_exports_markdown'])
    expect(validRed(run(PYTEST_OTHER_FAILS, 1, path), path, names)).toBe(false)
    expect(validRed(run(PYTEST_BOTH_FAIL, 1, path), path, names, true)).toBe(true)
  })

  test('a Go func TestX failing is a red, by name', () => {
    const path = 'export_test.go'
    const names = addedTestNames({
      insertion: 'new_file',
      code: 'package acme\n\nimport "testing"\n\nfunc TestExportMarkdown(t *testing.T) {\n\tif got := ToMarkdown(); got != "| total |" {\n\t\tt.Errorf("got %q", got)\n\t}\n}\n',
      patch: null,
    })
    expect(names).toEqual(['TestExportMarkdown'])
    expect(goRed(run(GO_SCENARIO_FAILS, 1, path), path, names)).toBe(true)
    expect(goRed(run(GO_SCENARIO_FAILS, 1, path), path, ['TestImportCsv'])).toBe(false)
  })

  test('a Rust #[test] fn x failing is a red, by name', () => {
    const path = 'src/lib.rs'
    // The proof adds the test to the file's `mod tests`: its patch places in the file's code.
    const code = [
      'pub fn to_markdown() -> String { String::new() }',
      '',
      '#[cfg(test)]',
      'mod tests {',
      '    use super::*;',
      '',
      '    #[test]',
      '    fn exports_markdown() {',
      '        assert_eq!(to_markdown(), "| total |");',
      '    }',
      '}',
      '',
    ].join('\n')
    const added = {
      insertion: 'addition',
      code,
      patch:
        '@@ -6,0 +7,4 @@\n+    #[test]\n+    fn exports_markdown() {\n+        assert_eq!(to_markdown(), "| total |");\n+    }\n',
    } as const
    expect(addedTestNames(added)).toEqual(['exports_markdown'])
    const names = addedTests(added)
    expect(validRed(run(CARGO_SCENARIO_FAILS, 101, path), path, names)).toBe(true)
    expect(validRed(run(CARGO_SCENARIO_FAILS, 101, path), path, inTests('one_is_one'))).toBe(false)
  })

  test('jest’s and node:test’s marks are read, by name', () => {
    const jest = 'tests/export.test.js'
    expect(validRed(run(JEST_SCENARIO_FAILS, 1, jest), jest, SCENARIO, true)).toBe(true)
    expect(validRed(run(JEST_SCENARIO_FAILS, 1, jest), jest, ['one is one'])).toBe(false)
    const node = 'tests/export.test.mjs'
    expect(validRed(run(NODE_SPEC_SCENARIO_FAILS, 1, node), node, SCENARIO, true)).toBe(true)
    expect(validRed(run(NODE_SPEC_SCENARIO_FAILS, 1, node), node, ['one is one'])).toBe(false)
  })

  test('a mark coloured by the runner is read once its colours are removed', () => {
    const output =
      '\u001b[31m FAIL \u001b[39m tests/export.test.ts > the invoices export as Markdown\nAssertionError: no'
    expect(validRed(run(output, 1), 'tests/export.test.ts', SCENARIO, true)).toBe(true)
  })

  test('Python, Go and Rust tests are named in their usual shapes, and only tests', () => {
    const code = [
      'class TestExport:',
      '    def test_writes_csv(self):',
      '        pass',
      'async def test_reads_back():',
      '    pass',
      'def helper():',
      '    pass',
      'func TestMain(m *testing.M) {}',
      'func TestImportCsv(t *testing.T) {}',
      '#[tokio::test]',
      '#[should_panic]',
      'async fn exports_async() {}',
      'fn not_a_test() {}',
    ].join('\n')
    expect(addedTestNames({ insertion: 'new_file', code, patch: null })).toEqual([
      'test_writes_csv',
      'test_reads_back',
      'TestImportCsv',
      'exports_async',
    ])
  })

  test('a proof that adds named Python, Go or Rust tests is never a red on its exit code alone', () => {
    const output = 'AssertionError: something else broke'
    for (const [path, code] of [
      ['tests/test_export.py', 'def test_exports_markdown():\n    assert False\n'],
      ['export_test.go', 'func TestExportMarkdown(t *testing.T) {\n\tt.Fatal("no")\n}\n'],
      ['src/lib.rs', '#[test]\nfn exports_markdown() {\n    assert!(false);\n}\n'],
    ] as const) {
      const names = addedTestNames({ insertion: 'new_file', code, patch: null })
      expect(names.length).toBe(1)
      expect(goRed(run(output, 1, path), path, names)).toBe(false)
    }
  })
})

/** pytest 9.1, its own words: three cases of the parametrised test fail, ids with spaces, brackets and unicode among them; one passes, one is skipped. */
const PYTEST_PARAMETRISED_FAILS = `============================= test session starts ==============================
platform linux -- Python 3.11.2, pytest-9.1.1, pluggy-1.6.0
rootdir: /work/acme/api
configfile: pyproject.toml
collected 6 items

tests/test_export.py ..FFFs                                              [100%]

=================================== FAILURES ===================================
_______________________________ test_exports[md] _______________________________

kind = 'md'

    @pytest.mark.parametrize(
        "kind",
        [
            "csv",
            "md",
            pytest.param("md", id="with header [md]"),
            pytest.param("résumé", id="résumé"),
            pytest.param("txt", marks=pytest.mark.skip(reason="not yet")),
        ],
    )
    def test_exports(kind):
>       assert export(kind) == "total"
E       AssertionError: assert '' == 'total'
E         
E         - total

tests/test_export.py:21: AssertionError
________________________ test_exports[with header [md]] ________________________

kind = 'md'

    @pytest.mark.parametrize(
        "kind",
        [
            "csv",
            "md",
            pytest.param("md", id="with header [md]"),
            pytest.param("résumé", id="résumé"),
            pytest.param("txt", marks=pytest.mark.skip(reason="not yet")),
        ],
    )
    def test_exports(kind):
>       assert export(kind) == "total"
E       AssertionError: assert '' == 'total'
E         
E         - total

tests/test_export.py:21: AssertionError
__________________________ test_exports[r\\xe9sum\\xe9] __________________________

kind = 'résumé'

    @pytest.mark.parametrize(
        "kind",
        [
            "csv",
            "md",
            pytest.param("md", id="with header [md]"),
            pytest.param("résumé", id="résumé"),
            pytest.param("txt", marks=pytest.mark.skip(reason="not yet")),
        ],
    )
    def test_exports(kind):
>       assert export(kind) == "total"
E       AssertionError: assert '' == 'total'
E         
E         - total

tests/test_export.py:21: AssertionError
=========================== short test summary info ============================
FAILED tests/test_export.py::test_exports[md] - AssertionError: assert '' == ...
FAILED tests/test_export.py::test_exports[with header [md]] - AssertionError:...
FAILED tests/test_export.py::test_exports[r\\xe9sum\\xe9] - AssertionError: ass...
==================== 3 failed, 2 passed, 1 skipped in 0.01s ====================
`

/** pytest 9.1 with `-v -rA`: an older test fails; the parametrised test's cases pass or are skipped. */
const PYTEST_PARAMETRISED_OTHER_FAILS = `============================= test session starts ==============================
platform linux -- Python 3.11.2, pytest-9.1.1, pluggy-1.6.0 -- /work/acme/api/.venv/bin/python3
rootdir: /work/acme/api
configfile: pyproject.toml
collecting ... collected 4 items

tests/test_export.py::test_one_is_one FAILED                             [ 25%]
tests/test_export.py::test_exports[csv] PASSED                           [ 50%]
tests/test_export.py::test_exports[with header [txt]] PASSED             [ 75%]
tests/test_export.py::test_exports[md] SKIPPED (not yet)                 [100%]

=================================== FAILURES ===================================
_______________________________ test_one_is_one ________________________________

    def test_one_is_one():
>       assert 1 == 2
E       assert 1 == 2

tests/test_export.py:7: AssertionError
==================================== PASSES ====================================
=========================== short test summary info ============================
PASSED tests/test_export.py::test_exports[csv]
PASSED tests/test_export.py::test_exports[with header [txt]]
SKIPPED [1] tests/test_export.py:10: not yet
FAILED tests/test_export.py::test_one_is_one - assert 1 == 2
==================== 1 failed, 2 passed, 1 skipped in 0.01s ====================
`

/** go test -v, Go 1.27: a subtest nested two deep fails, its parents with it; one passes, one is skipped. */
const GO_SUBTEST_FAILS = `=== RUN   TestExport
=== RUN   TestExport/csv
=== RUN   TestExport/as_markdown
=== RUN   TestExport/as_markdown/with_header
    export_test.go:14: got "", want "| total |"
=== RUN   TestExport/as_markdown/empty
=== RUN   TestExport/txt
    export_test.go:24: not yet
--- FAIL: TestExport (0.00s)
    --- PASS: TestExport/csv (0.00s)
    --- FAIL: TestExport/as_markdown (0.00s)
        --- FAIL: TestExport/as_markdown/with_header (0.00s)
        --- PASS: TestExport/as_markdown/empty (0.00s)
    --- SKIP: TestExport/txt (0.00s)
FAIL
FAIL	example.com/acme	0.001s
FAIL
`

/** go test -v, Go 1.27: an older subtest fails; the others pass or are skipped. */
const GO_OTHER_SUBTEST_FAILS = `=== RUN   TestExport
=== RUN   TestExport/csv
    export_test.go:8: got "total", want "rows"
=== RUN   TestExport/as_markdown
=== RUN   TestExport/txt
    export_test.go:17: not yet
--- FAIL: TestExport (0.00s)
    --- FAIL: TestExport/csv (0.00s)
    --- PASS: TestExport/as_markdown (0.00s)
    --- SKIP: TestExport/txt (0.00s)
FAIL
FAIL	example.com/acme	0.001s
FAIL
`

/** A parametrised pytest test, as a patch adds it under an older test. */
const PYTEST_PARAMETRISED_PATCH = [
  '@@ -7,0 +8,14 @@',
  '+',
  '+',
  '+@pytest.mark.parametrize(',
  '+    "kind",',
  '+    [',
  '+        "csv",',
  '+        "md",',
  '+        pytest.param("md", id="with header [md]"),',
  '+    ],',
  '+)',
  '+def test_exports(kind):',
  '+    assert export(kind) == "total"',
].join('\n')

/** go test, Go 1.27: an older TestImport fails on its subtest \`empty\`. */
const GO_OTHER_PARENT_FAILS = `--- FAIL: TestImport (0.00s)
    --- FAIL: TestImport/empty (0.00s)
        export_test.go:7: got 1 rows, want 0
FAIL
FAIL	example.com/acme	0.004s
FAIL
`

/** Go subtests, as a patch adds them into an older TestExport. */
const GO_SUBTESTS_PATCH = [
  '@@ -10,0 +11,8 @@ func TestExport(t *testing.T) {',
  '+\tt.Run("as markdown", func(t *testing.T) {',
  '+\t\tif got := Export("md", false); got != "" {',
  '+\t\t\tt.Errorf("got %q, want %q", got, "")',
  '+\t\t}',
  '+\t})',
  '+\tt.Run("txt", func(t *testing.T) {',
  '+\t\tt.Skip("not yet")',
  '+\t})',
].join('\n')

describe('A red read from pytest parametrised tests and Go subtests', () => {
  test('a pytest parametrised test failing on some of its cases is a red, by its declared name', () => {
    const path = 'tests/test_export.py'
    const names = addedTestNames({
      insertion: 'addition',
      code: '',
      patch: PYTEST_PARAMETRISED_PATCH,
    })
    expect(names).toEqual(['test_exports'])
    expect(validRed(run(PYTEST_PARAMETRISED_FAILS, 1, path), path, names, true)).toBe(true)
    expect(validRed(run(PYTEST_PARAMETRISED_FAILS, 1, path), path, ['test_one_is_one'])).toBe(false)
  })

  test('a pytest case id with spaces, brackets or unicode is read as its declared test', () => {
    const path = 'tests/test_export.py'
    const lines = run(PYTEST_PARAMETRISED_FAILS, 1, path).failingLines
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(validRed(run(line, 1, path), path, ['test_exports'], true)).toBe(true)
      expect(validRed(run(line, 1, path), path, ['test_export'])).toBe(false)
    }
  })

  test('a pytest parametrised test whose cases pass or are skipped, beside an older failing test, is not a red', () => {
    const path = 'tests/test_export.py'
    const names = addedTestNames({
      insertion: 'addition',
      code: '',
      patch: PYTEST_PARAMETRISED_PATCH,
    })
    expect(validRed(run(PYTEST_PARAMETRISED_OTHER_FAILS, 1, path), path, names)).toBe(false)
    expect(
      validRed(run(PYTEST_PARAMETRISED_OTHER_FAILS, 1, path), path, ['test_one_is_one'], true),
    ).toBe(true)
  })

  test('a Go test whose nested subtest fails is a red, by its top function', () => {
    const path = 'export_test.go'
    const code = [
      'func TestExport(t *testing.T) {',
      '\tt.Run("csv", func(t *testing.T) {})',
      '\tt.Run("as markdown", func(t *testing.T) {',
      '\t\tt.Run(`with header`, func(t *testing.T) {})',
      '\t})',
      '\tfor _, tc := range cases {',
      '\t\tt.Run(tc.name, func(t *testing.T) {})',
      '\t}',
      '}',
    ].join('\n')
    expect(addedTests({ insertion: 'new_file', code, patch: null })).toEqual([
      'TestExport',
      { parent: 'TestExport', subtest: 'csv', nesting: [], whole: true },
      { parent: 'TestExport', subtest: 'as markdown', nesting: [], whole: true },
      { parent: 'TestExport', subtest: 'with header', nesting: ['as markdown'], whole: true },
    ])
    expect(addedTestNames({ insertion: 'new_file', code, patch: null })).toEqual([
      'TestExport',
      'csv',
      'as markdown',
      'with header',
    ])
    expect(goRed(run(GO_SUBTEST_FAILS, 1, path), path, ['TestExport'])).toBe(true)
    expect(goRed(run(GO_SUBTEST_FAILS, 1, path), path, ['TestImport'])).toBe(false)
  })

  test('a Go subtest the proof adds is read under the name Go prints, at any depth', () => {
    const path = 'export_test.go'
    const red = (subtest: string) =>
      goRed(run(GO_SUBTEST_FAILS, 1, path), path, [
        { parent: 'TestExport', subtest, nesting: [], whole: false },
      ])
    expect(red('with header')).toBe(true)
    expect(red('as markdown')).toBe(true)
    expect(red('empty')).toBe(false)
    expect(red('txt')).toBe(false)
  })

  test('Go subtests the proof adds, passing or skipped under a parent failing on an older one, are not a red', () => {
    const path = 'export_test.go'
    const names = addedTests({ insertion: 'addition', code: '', patch: GO_SUBTESTS_PATCH })
    expect(names).toEqual([
      { parent: 'TestExport', subtest: 'as markdown', nesting: [], whole: false },
      { parent: 'TestExport', subtest: 'txt', nesting: [], whole: false },
    ])
    expect(goRed(run(GO_OTHER_SUBTEST_FAILS, 1, path), path, names)).toBe(false)
    const csv = [{ parent: 'TestExport', subtest: 'csv', nesting: [], whole: false }]
    expect(goRed(run(GO_OTHER_SUBTEST_FAILS, 1, path), path, csv)).toBe(true)
  })

  test('a subtest of the same name under another parent is not the red', () => {
    const path = 'export_test.go'
    const code = [
      'func TestExport(t *testing.T) {',
      '\tt.Run("empty", func(t *testing.T) {})',
      '}',
    ].join('\n')
    const names = addedTests({ insertion: 'new_file', code, patch: null })
    expect(names).toEqual([
      'TestExport',
      { parent: 'TestExport', subtest: 'empty', nesting: [], whole: true },
    ])
    expect(goRed(run(GO_OTHER_PARENT_FAILS, 1, path), path, names)).toBe(false)
    const imported = [{ parent: 'TestImport', subtest: 'empty', nesting: [], whole: false }]
    expect(goRed(run(GO_OTHER_PARENT_FAILS, 1, path), path, imported)).toBe(true)
  })

  test('a slash in another runner’s line is not a separator: GET /users is not users, exports/markdown is not markdown', () => {
    const path = 'tests/export.test.ts'
    const vitest = ['  × GET /users 5ms', 'AssertionError: expected 404 to be 200'].join('\n')
    expect(validRed(run(vitest, 1, path), path, ['users'])).toBe(false)
    const tap = [
      'TAP version 13',
      'not ok 3 - GET /users',
      '  ---',
      "  error: 'AssertionError: expected 404 to be 200'",
      '  ...',
      '# tests 3',
    ].join('\n')
    expect(validRed(run(tap, 1, path), path, ['users'])).toBe(false)
    const mocha = [
      '  1) exports/markdown',
      'AssertionError: expected "" to equal "| total |"',
    ].join('\n')
    expect(validRed(run(mocha, 1, path), path, ['markdown'])).toBe(false)
  })

  test('a bracket or an underscore is pytest’s and Go’s only: items[0] is not items, as_markdown is not as markdown', () => {
    const path = 'tests/export.test.ts'
    const output = (line: string) => [line, 'AssertionError: no'].join('\n')
    expect(validRed(run(output('  × items[0] is defined'), 1, path), path, ['items'])).toBe(false)
    expect(validRed(run(output('  × as_markdown'), 1, path), path, ['as markdown'])).toBe(false)
  })
})

describe('The key line observed in Planning', () => {
  test('colours, paths, durations, addresses and numbers are masked', () => {
    expect(
      normalisedOutput(
        '\u001b[31m✖ export (12.5ms)\u001b[39m at /home/someone/acme/api/export.ts:14:3 0x7ffd2a',
      ),
    ).toBe('✖ export (<duration>) at <path>:<n>:<n> <address>')
    expect(normalisedOutput('at C:\\work\\acme\\export.ts:14 took 2 s')).toBe(
      'at <path>:<n> took <duration>',
    )
  })

  test('a key line found again after normalising colours, paths and durations matches; a different one does not', () => {
    const today = 'Error: the total is 41 in /tmp/acme-1/api/totals.ts (3ms)'
    const now = '\u001b[31mError: the total is 41 in /work/wt-7/api/totals.ts (12ms)\u001b[0m'
    expect(keyLineFound(now, today)).toBe(true)
    expect(keyLineFound('Error: the totals file is missing', today)).toBe(false)
  })
})

/** A runner's output captured as it printed it, colours included, under `fixtures/proof-runs`. */
const captured = (name: string): string =>
  readFileSync(new URL(`fixtures/proof-runs/${name}.txt`, import.meta.url), 'utf8')

/**
 * The tests of a Rust file under each declaration: `#[test]`, a `#[should_panic]` test,
 * `#[tokio::test(…)]`, `#[rstest]` with and without cases, `#[test_case(…)]`. The cargo test 1.97
 * and cargo-nextest 0.9.148 fixtures are this file's runs.
 */
const RUST_DECLARATIONS = `pub fn to_markdown(rows: &[&str]) -> String {
    rows.join("\\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;
    use test_case::test_case;

    #[test]
    fn one_is_one() {
        assert_eq!(1, 1);
    }

    #[test]
    #[should_panic]
    fn rejects_empty() {
        to_markdown(&[]);
    }

    #[test]
    #[should_panic]
    fn rejects_blank() {
        panic!("blank");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn exports_async() {
        assert_eq!(to_markdown(&[]), "| total |");
    }

    #[rstest]
    fn reads_plain() {
        assert_eq!(to_markdown(&["a"]), "a");
    }

    #[rstest]
    #[case(0)]
    #[case(1)]
    fn exports_cases(#[case] n: usize) {
        assert_eq!(to_markdown(&vec!["a"; n]), "a");
    }

    #[test_case(vec![] ; "with no rows")]
    #[test_case(vec!["| total |"] ; "with one row")]
    fn exports_markdown(rows: Vec<&str>) {
        assert_eq!(to_markdown(&rows), "| total |");
    }

    #[test_case(vec!["a"] ; "with one row")]
    fn reads_rows(rows: Vec<&str>) {
        assert_eq!(to_markdown(&rows), "a");
    }
}
`

/** The tests the Rust file declares under the given names, as a proof adding it reads them. */
const rustTests = (names: ReadonlyArray<string>) => {
  const file = { insertion: 'new_file', code: RUST_DECLARATIONS, patch: null } as const
  const declared = addedTestNames(file)
  return addedTests(file).filter((_, at) => names.includes(declared[at] ?? ''))
}

/** Rust tests of a crate's `src/lib.rs`, declared in its `mod tests`. */
const inTests = (...names: ReadonlyArray<string>) =>
  names.map((rust) => ({ rust, modules: ['tests'] }))

/** cargo's line before the tests of the crate's library, which tells their binary. */
const LIB_BINARY = '     Running unittests src/lib.rs (target/debug/deps/acme-d5b7551ab0e24432)'

/** A libtest output with the line naming its binary, as cargo prints it above. */
const inLib = (output: string) =>
  output.includes('     Running ') ? output : `${LIB_BINARY}\n${output}`

describe('A red read from the failing names #260 still missed', () => {
  test('a failing Rust #[should_panic] test is a red, by name; one that panicked as expected is not', () => {
    const output = captured('cargo-test-should-panic')
    const path = 'src/lib.rs'
    expect(run(output, 101, path).classification).toBe('assertion_failed')
    expect(validRed(run(output, 101, path), path, rustTests(['rejects_empty']))).toBe(true)
    expect(validRed(run(output, 101, path), path, rustTests(['rejects_blank']))).toBe(false)
  })

  test('a python -m unittest or Django FAIL: heading is a red, by name; an ERROR:, a skipped or a passing test is not', () => {
    const unittest = captured('unittest')
    const path = 'tests/test_export.py'
    for (const name of ['test_exports_markdown', 'test_exports_rows']) {
      expect(validRed(run(unittest, 1, path), path, [name], true)).toBe(true)
    }
    for (const name of ['test_reads_back', 'test_exports_csv', 'test_one_is_one']) {
      expect(validRed(run(unittest, 1, path), path, [name])).toBe(false)
    }
    const django = captured('django')
    const tests = 'exports/tests.py'
    expect(validRed(run(django, 1, tests), tests, ['test_exports_markdown'], true)).toBe(true)
    expect(validRed(run(django, 1, tests), tests, ['test_one_is_one'])).toBe(false)
  })

  test('a log line saying FAIL: is not a unittest heading', () => {
    const output = ['FAIL: test_exports_markdown upload refused', 'AssertionError: no'].join('\n')
    expect(run(output, 1, 'tests/test_export.py').failingLines).toEqual([])
  })

  test('a log line saying FAIL: test_x (a word) is not a unittest heading', () => {
    const output = ['FAIL: test_exports_markdown (retrying)', 'AssertionError: no'].join('\n')
    const path = 'tests/test_export.py'
    expect(run(output, 1, path).failingLines).toEqual([])
    expect(validRed(run(output, 1, path), path, ['test_exports_markdown'])).toBe(false)
  })

  test('a cargo-nextest FAIL line is a red, by name; its PASS lines are not', () => {
    const output = captured('cargo-nextest')
    const path = 'src/lib.rs'
    expect(run(output, 100, path).failingLines).toContain(
      '        FAIL [   0.007s] ( 6/10) acme tests::exports_async',
    )
    expect(validRed(run(output, 100, path), path, rustTests(['exports_async']))).toBe(true)
    expect(validRed(run(output, 100, path), path, rustTests(['rejects_empty']))).toBe(true)
    for (const name of ['one_is_one', 'reads_plain', 'rejects_blank']) {
      expect(validRed(run(output, 100, path), path, rustTests([name]))).toBe(false)
    }
  })

  test('a gotestsum === FAIL: line is a red, by name with the key line (#462); its SKIP lines and a build failure are not', () => {
    const output = captured('gotestsum')
    const path = 'export_test.go'
    expect(run(output, 1, path).classification).toBe('assertion_failed')
    // gotestsum names its package from the folder it ran in: uncertain, the key line decides.
    expect(goRed(run(output, 1, path), path, ['TestExportMarkdown'])).toBe(false)
    expect(goRed(run(output, 1, path), path, ['TestExportMarkdown'], true)).toBe(true)
    expect(goRed(run(output, 1, path), path, ['TestExportMarkdownSkipped'])).toBe(false)
    expect(goRed(run(output, 1, path), path, ['TestOneIsOne'])).toBe(false)
    const broken = run(captured('gotestsum-build-failed'), 1, path)
    expect(broken.classification).not.toBe('assertion_failed')
    expect(broken.failingLines.filter((line) => line.startsWith('==='))).toEqual([])
  })

  test('a gotestsum === FAIL: line without its duration is not an assertion that failed', () => {
    for (const line of [
      '=== FAIL: . TestExportMarkdown (unknown)',
      '=== FAIL: . TestExportMarkdown (re-run 1) (0.00s)',
    ]) {
      expect(run(line, 1, 'export_test.go').classification).not.toBe('assertion_failed')
    }
  })

  test('Rust tests under #[tokio::test(…)], #[rstest] and #[test_case(…)] are named', () => {
    expect(addedTestNames({ insertion: 'new_file', code: RUST_DECLARATIONS, patch: null })).toEqual(
      [
        'one_is_one',
        'rejects_empty',
        'rejects_blank',
        'exports_async',
        'reads_plain',
        'exports_cases',
        'exports_markdown',
        'reads_rows',
      ],
    )
    const lines = [
      '#[test_case(',
      '    vec![] ;',
      '    "with no rows"',
      ')]',
      '#[should_panic(',
      '    expected = "no rows"',
      ')]',
      'fn rejects_markdown(rows: Vec<&str>) {}',
    ].join('\n')
    expect(addedTests({ insertion: 'new_file', code: lines, patch: null })).toEqual([
      { function: 'rejects_markdown', modules: [] },
    ])
  })

  test('the cases of an #[rstest] or #[test_case(…)] test failing are its red, in cargo test and cargo-nextest; a case passing is not', () => {
    const path = 'src/lib.rs'
    for (const output of [captured('cargo-test-cases'), captured('cargo-nextest')]) {
      for (const name of ['exports_async', 'exports_cases', 'exports_markdown']) {
        expect(validRed(run(output, 101, path), path, rustTests([name]))).toBe(true)
      }
      for (const name of ['reads_plain', 'reads_rows', 'one_is_one']) {
        expect(validRed(run(output, 101, path), path, rustTests([name]))).toBe(false)
      }
    }
  })

  test('a plain #[test] fn is not read from the cases of a module of the same name', () => {
    const path = 'src/lib.rs'
    const output = captured('cargo-test-cases')
    expect(validRed(run(output, 101, path), path, ['exports_markdown'])).toBe(false)
    expect(validRed(run(output, 101, path), path, ['exports'])).toBe(false)
  })

  test('a cased Rust test does not take the failures of a module of the same name', () => {
    const path = 'src/lib.rs'
    const render = [{ function: 'render', modules: ['tests'] }]
    // Each test's panic, named by its thread, as libtest and cargo-nextest print it, below the
    // line that tells its binary.
    const failed = (line: string) =>
      [
        line.startsWith('test ') ? LIB_BINARY : '    Starting 1 test across 1 binary',
        line,
        `thread '${line.replace(/^.* (\S+::\S+)(?: \.\.\. FAILED)?$/, '$1')}' panicked at src/lib.rs:9:5:`,
        'assertion `left == right` failed',
      ].join('\n')
    for (const line of [
      'test render::tests::handles_empty ... FAILED',
      '        FAIL [   0.004s] acme render::tests::handles_empty',
      'test render::other ... FAILED',
    ]) {
      expect(run(failed(line), 101, path).failingLines).toEqual([line])
      expect(validRed(run(failed(line), 101, path), path, render)).toBe(false)
    }
    for (const line of [
      'test tests::render::case_1 ... FAILED',
      'test tests::render::case_2_empty_rows ... FAILED',
      '        FAIL [   0.004s] acme tests::render::test_case_1_with_no_rows',
    ]) {
      expect(validRed(run(failed(line), 101, path), path, render)).toBe(true)
    }
  })

  test('jest’s file line with a project displayName is a failing line', () => {
    for (const [output, lines] of [
      [
        captured('jest-display-name'),
        [' FAIL   unit  tests/export.test.js', ' FAIL   unit  tests/broken.test.js'],
      ],
      [
        captured('jest-display-name-plain'),
        ['FAIL unit tests/export.test.js', 'FAIL unit tests/broken.test.js'],
      ],
    ] as const) {
      const failing = run(output, 1, 'tests/export.test.js').failingLines
      for (const line of lines) expect(failing).toContain(line)
    }
  })

  test('a log line or a passing file holding FAIL and a file name is not jest’s file line', () => {
    const output = [
      'FAIL to upload report.json',
      'FAIL upload of tests/export.test.js retried',
      ' PASS   unit  tests/export.test.js',
      ' × tests/export.test.ts > one is one 3ms',
      'AssertionError: no',
    ].join('\n')
    expect(run(output, 1).failingLines).toEqual([' × tests/export.test.ts > one is one 3ms'])
  })

  test('numbered log lines do not push mocha’s failure past the failing lines cap', () => {
    const output = captured('mocha-numbered-logs')
    const path = 'tests/upload.test.cjs'
    expect(validRed(run(output, 1, path), path, SCENARIO, true)).toBe(true)
    expect(run(output, 1, path).failingLines.length).toBeLessThanOrEqual(2)
    expect(validRed(run(output, 1, path), path, ['one is one'])).toBe(false)
  })

  test('a numbered log line without mocha’s failing count is not a failing line', () => {
    const output = ['  2) retrying upload', ' × tests/export.test.ts > one is one 3ms'].join('\n')
    expect(run(output, 1).failingLines).toEqual([' × tests/export.test.ts > one is one 3ms'])
  })

  test('jest’s Console and Test suite failed to run headings are not failing lines', () => {
    const failing = run(captured('jest-display-name'), 1, 'tests/export.test.js').failingLines
    expect(failing).toContain('  ● exports › the invoices export as Markdown')
    expect(failing).not.toContain('  ● Console')
    expect(failing).not.toContain('  ● Test suite failed to run')
  })

  test('a real vitest run, its tree and its coloured FAIL badge, is a red by name', () => {
    const output = captured('vitest-tree')
    const path = 'tests/export.test.ts'
    expect(output).toContain('\u001b[41m')
    expect(run(output, 1, path).failingLines).toEqual([
      '     × the invoices export as Markdown 3ms',
      ' FAIL  tests/export.test.ts > exports > the invoices export as Markdown',
    ])
    expect(validRed(run(output, 1, path), path, SCENARIO, true)).toBe(true)
    expect(validRed(run(output, 1, path), path, ['one is one'])).toBe(false)
    expect(validRed(run(output, 1, path), path, ['the invoices export as CSV'])).toBe(false)
  })
})

/** go test, Go 1.27: an older subtest `TestExport/csv/empty` fails; `TestExport/md/empty` passes. */
const GO_OTHER_BRANCH_FAILS = `--- FAIL: TestExport (0.00s)
    --- FAIL: TestExport/csv (0.00s)
        --- FAIL: TestExport/csv/empty (0.00s)
            export_test.go:8: got 1 rows, want 0
FAIL
FAIL	example.com/acme	0.001s
FAIL
`

/** go test, Go 1.27: the subtest `TestExport/md/empty` fails. */
const GO_BRANCH_FAILS = `--- FAIL: TestExport (0.00s)
    --- FAIL: TestExport/md (0.00s)
        --- FAIL: TestExport/md/empty (0.00s)
            export_test.go:12: got "x", want ""
FAIL
FAIL	example.com/acme	0.002s
FAIL
`

/** `git diff`: a subtest `md` with its own `empty`, added into an older TestExport. */
const GO_BRANCH_PATCH = [
  '@@ -8,4 +8,9 @@ func TestExport(t *testing.T) {',
  ' \t\t\tt.Errorf("got %d rows, want 0", 1)',
  ' \t\t})',
  ' \t})',
  '+\tt.Run("md", func(t *testing.T) {',
  '+\t\tt.Run("empty", func(t *testing.T) {',
  '+\t\t\tt.Errorf("got %q, want %q", "x", "")',
  '+\t\t})',
  '+\t})',
  ' }',
].join('\n')

/** `git diff -U0`: git names the hunk after a raw string's line, not the function it is in. */
const GO_PARENTLESS_PATCH = [
  '@@ -13,0 +14,3 @@ name,total',
  '+\tt.Run("md", func(t *testing.T) {',
  '+\t\tt.Errorf("got %q, want %q", "", "| total |")',
  '+\t})',
].join('\n')

/** go test, Go 1.27: the subtest that patch adds fails. */
const GO_PARENTLESS_FAILS = `--- FAIL: TestExport (0.00s)
    --- FAIL: TestExport/md (0.00s)
        export_test.go:15: got "", want "| total |"
FAIL
FAIL	example.com/acme	0.002s
FAIL
`

/** pytest 9.1: an older parametrised test fails on cases whose ids hold `::test_x[` and `::test_x - `; `test_x` passes. */
const PYTEST_ID_INSIDE_OTHER_FAILS = `============================= test session starts ==============================
platform linux -- Python 3.11.2, pytest-9.1.1, pluggy-1.6.0
rootdir: /work/acme/api
collected 5 items

tests/test_export.py FF...                                               [100%]

=================================== FAILURES ===================================
___________________________ test_other[a::test_x[1]] ___________________________

ref = 'a::test_x[1]'

    @pytest.mark.parametrize("ref", ["a::test_x[1]", "a::test_x - b", "b"])
    def test_other(ref):
>       assert ref == "b"
E       AssertionError: assert 'a::test_x[1]' == 'b'
E         
E         - b
E         + a::test_x[1]

tests/test_export.py:6: AssertionError
__________________________ test_other[a::test_x - b] ___________________________

ref = 'a::test_x - b'

    @pytest.mark.parametrize("ref", ["a::test_x[1]", "a::test_x - b", "b"])
    def test_other(ref):
>       assert ref == "b"
E       AssertionError: assert 'a::test_x - b' == 'b'
E         
E         - b
E         + a::test_x - b

tests/test_export.py:6: AssertionError
=========================== short test summary info ============================
FAILED tests/test_export.py::test_other[a::test_x[1]] - AssertionError: asser...
FAILED tests/test_export.py::test_other[a::test_x - b] - AssertionError: asse...
========================= 2 failed, 3 passed in 0.01s ==========================
`

/** pytest 9.1: the same, and `test_x[1]` fails. */
const PYTEST_ID_INSIDE_FAILS = `============================= test session starts ==============================
platform linux -- Python 3.11.2, pytest-9.1.1, pluggy-1.6.0
rootdir: /work/acme/api
collected 4 items

tests/test_export.py F.F.                                                [100%]

=================================== FAILURES ===================================
___________________________ test_other[a::test_x[1]] ___________________________

ref = 'a::test_x[1]'

    @pytest.mark.parametrize("ref", ["a::test_x[1]", "b"])
    def test_other(ref):
>       assert ref == "b"
E       AssertionError: assert 'a::test_x[1]' == 'b'
E         
E         - b
E         + a::test_x[1]

tests/test_export.py:6: AssertionError
__________________________________ test_x[1] ___________________________________

n = 1

    @pytest.mark.parametrize("n", [1, 2])
    def test_x(n):
>       assert n > 1
E       assert 1 > 1

tests/test_export.py:11: AssertionError
=========================== short test summary info ============================
FAILED tests/test_export.py::test_other[a::test_x[1]] - AssertionError: asser...
FAILED tests/test_export.py::test_x[1] - assert 1 > 1
========================= 2 failed, 2 passed in 0.01s ==========================
`

/** `git diff`: a testify suite method and its subtest, added under an older suite. */
const GO_SUITE_PATCH = [
  '@@ -13,3 +13,9 @@ func (s *ExportSuite) Run(name string, f func()) {',
  ' func TestExportSuite(t *testing.T) {',
  ' \tt.Run("TestMarkdown", func(t *testing.T) { (&ExportSuite{t}).TestMarkdown() })',
  ' }',
  '+',
  '+func (s *ExportSuite) TestMarkdown() {',
  '+\ts.Run("empty", func() {',
  '+\t\ts.t.Errorf("got %q, want %q", "| total |", "")',
  '+\t})',
  '+}',
].join('\n')

/** go test, Go 1.27: that method's subtest fails, under a suite run as testify runs one. */
const GO_SUITE_FAILS = `--- FAIL: TestExportSuite (0.00s)
    --- FAIL: TestExportSuite/TestMarkdown (0.00s)
        --- FAIL: TestExportSuite/TestMarkdown/empty (0.00s)
            export_test.go:19: got "| total |", want ""
FAIL
FAIL	example.com/acme	0.001s
FAIL
`

describe('A red read from the Go subtests and pytest ids #279 left', () => {
  test('a Go subtest under the same parent but another branch is not the red', () => {
    const path = 'export_test.go'
    const names = addedTests({ insertion: 'addition', code: '', patch: GO_BRANCH_PATCH })
    expect(names).toEqual([
      { parent: 'TestExport', subtest: 'md', nesting: [], whole: false },
      { parent: 'TestExport', subtest: 'empty', nesting: ['md'], whole: false },
    ])
    const empty = names.slice(1)
    expect(goRed(run(GO_OTHER_BRANCH_FAILS, 1, path), path, empty)).toBe(false)
    expect(goRed(run(GO_BRANCH_FAILS, 1, path), path, empty)).toBe(true)
  })

  test('a Go subtest in a new file is read under its whole path, braces in strings and comments aside', () => {
    const path = 'export_test.go'
    const code = [
      'func TestExport(t *testing.T) {',
      '\twant := `{"rows": [',
      '\t}`',
      '\tt.Run("md", func(t *testing.T) { // {',
      '\t\tif want == "}" || want == "{" || want == string(\'}\') {',
      '\t\t\tt.Skip()',
      '\t\t}',
      '\t\t/* } */ t.Run("empty", func(t *testing.T) {})',
      '\t})',
      '\tfor _, tc := range cases {',
      '\t\tt.Run(tc.name, func(t *testing.T) {',
      '\t\t\tt.Run("empty", func(t *testing.T) {})',
      '\t\t})',
      '\t}',
      '\tt.Run("empty", func(t *testing.T) {})',
      '}',
    ].join('\n')
    const names = addedTests({ insertion: 'new_file', code, patch: null })
    expect(names).toEqual([
      'TestExport',
      { parent: 'TestExport', subtest: 'md', nesting: [], whole: true },
      { parent: 'TestExport', subtest: 'empty', nesting: ['md'], whole: true },
      { parent: 'TestExport', subtest: 'empty', nesting: [null], whole: true },
      { parent: 'TestExport', subtest: 'empty', nesting: [], whole: true },
    ])
    const red = (output: string, at: number) =>
      goRed(run(output, 1, path), path, names.slice(at, at + 1))
    expect(red(GO_BRANCH_FAILS, 2)).toBe(true)
    expect(red(GO_OTHER_BRANCH_FAILS, 2)).toBe(false)
    expect(red(GO_OTHER_BRANCH_FAILS, 3)).toBe(true)
    expect(red(GO_OTHER_BRANCH_FAILS, 4)).toBe(false)
    expect(red(GO_OTHER_PARENT_FAILS, 4)).toBe(false)
  })

  test('a subtest seen with its parent unknown is decided by the key line when the proof has one', () => {
    const path = 'export_test.go'
    const names = addedTests({ insertion: 'addition', code: '', patch: GO_PARENTLESS_PATCH })
    expect(names).toEqual([{ parent: null, subtest: 'md', nesting: [], whole: false }])
    expect(goRed(run(GO_PARENTLESS_FAILS, 1, path), path, names, true)).toBe(true)
    expect(goRed(run(GO_PARENTLESS_FAILS, 1, path), path, names, false)).toBe(false)
    expect(goRed(run(GO_PARENTLESS_FAILS, 1, path), path, names, null)).toBe(true)
    const helper = ['func check(t *testing.T) {', '\tt.Run("empty", nil)', '}'].join('\n')
    expect(addedTests({ insertion: 'new_file', code: helper, patch: null })).toEqual([
      { parent: null, subtest: 'empty', nesting: [], whole: true },
    ])
    // A report that names the file decides by the key line too; a named test keeps its own rule.
    const junit = run(JUNIT_ASSERTION, 1)
    expect(validRed(junit, 'tests/export.test.mjs', names, true)).toBe(true)
    expect(validRed(junit, 'tests/export.test.mjs', names, false)).toBe(false)
    // A test the proof adds that the report does not name leaves it to the key line (#342).
    expect(validRed(junit, 'tests/export.test.mjs', [...names, 'exports as TSV'], true)).toBe(true)
    expect(validRed(junit, 'tests/export.test.mjs', [...names, 'exports as TSV'], null)).toBe(false)
  })

  test('a testify suite method’s subtest is a red on its exit code when the proof has no key line, and not when its key line differs', () => {
    const path = 'export_test.go'
    const names = addedTests({ insertion: 'addition', code: '', patch: GO_SUITE_PATCH })
    expect(names).toEqual([{ parent: null, subtest: 'empty', nesting: [], whole: true }])
    expect(goRed(run(GO_SUITE_FAILS, 1, path), path, names, null)).toBe(true)
    expect(goRed(run(GO_SUITE_FAILS, 1, path), path, names, false)).toBe(false)
    expect(goRed(run(GO_SUITE_FAILS, 1, path), path, names, true)).toBe(true)
    expect(validRed(run(JUNIT_ASSERTION, 1), 'tests/export.test.mjs', names, true)).toBe(true)
  })

  test('a pytest id inside another test’s case id is not that test', () => {
    const path = 'tests/test_export.py'
    expect(run(PYTEST_ID_INSIDE_OTHER_FAILS, 1, path).failingLines).toHaveLength(2)
    expect(validRed(run(PYTEST_ID_INSIDE_OTHER_FAILS, 1, path), path, ['test_x'])).toBe(false)
    expect(validRed(run(PYTEST_ID_INSIDE_OTHER_FAILS, 1, path), path, ['test_other'], true)).toBe(
      true,
    )
    expect(validRed(run(PYTEST_ID_INSIDE_FAILS, 1, path), path, ['test_x'], true)).toBe(true)
  })
})

/** go test, Go 1.27: an older `TestExport/csv/empty` and `TestExport/empty` fail; `TestExport/md/empty` passes. */
const GO_OTHER_EMPTY_FAILS = `--- FAIL: TestExport (0.00s)
    --- FAIL: TestExport/csv (0.00s)
        --- FAIL: TestExport/csv/empty (0.00s)
            export_test.go:8: got 1 rows, want 0
    --- FAIL: TestExport/empty (0.00s)
        export_test.go:12: got 2 rows, want 0
FAIL
FAIL	example.com/acme	0.004s
FAIL
`

/** go test, Go 1.27: an older subtest `TestExport/csv` fails, with no subtest of its own. */
const GO_CSV_FAILS = `--- FAIL: TestExport (0.00s)
    --- FAIL: TestExport/csv (0.00s)
        export_test.go:7: got 1 rows, want 0
FAIL
FAIL	example.com/acme	0.001s
FAIL
`

/** `git diff` (3 lines of context): `empty` added at the end of a long `md`, whose `t.Run` the hunk does not show. */
const GO_INSIDE_PATCH = [
  '@@ -17,5 +17,8 @@ func TestExport(t *testing.T) {',
  ' \t\tif len(rows) != 1 {',
  ' \t\t\tt.Fatalf("got %d rows", len(rows))',
  ' \t\t}',
  '+\t\tt.Run("empty", func(t *testing.T) {',
  '+\t\t\tt.Errorf("got %q, want %q", "x", "")',
  '+\t\t})',
  ' \t})',
  ' }',
].join('\n')

/** pytest 9.1: an older case id holds ` b::test_x[1]`, another test's message names `test_x[1]`; `test_x` passes. */
const PYTEST_SPACED_OTHER_FAILS = `================================================= test session starts ==================================================
platform linux -- Python 3.11.2, pytest-9.1.1, pluggy-1.6.0
rootdir: /work/acme/api
collected 5 items

tests/test_export.py F.F..                                                                                       [100%]

======================================================= FAILURES =======================================================
______________________________________________ test_other[a b::test_x[1]] ______________________________________________

ref = 'a b::test_x[1]'

    @pytest.mark.parametrize("ref", ["a b::test_x[1]", "b"])
    def test_other(ref):
>       assert ref == "b"
E       AssertionError: assert 'a b::test_x[1]' == 'b'
E         
E         - b
E         + a b::test_x[1]

tests/test_export.py:6: AssertionError
________________________________________________________ test_y ________________________________________________________

    def test_y():
>       assert False, "tests/test_export.py::test_x[1] failed"
E       AssertionError: tests/test_export.py::test_x[1] failed
E       assert False

tests/test_export.py:10: AssertionError
=============================================== short test summary info ================================================
FAILED tests/test_export.py::test_other[a b::test_x[1]] - AssertionError: assert 'a b::test_x[1]' == 'b'
FAILED tests/test_export.py::test_y - AssertionError: tests/test_export.py::test_x[1] failed
============================================= 2 failed, 3 passed in 0.01s ==============================================
`

/** go test, Go 1.27: an older top-level `TestExport/inner` fails; `TestExport/w/inner` passes. */
const GO_INNER_FAILS = `--- FAIL: TestExport (0.00s)
    --- FAIL: TestExport/inner (0.00s)
        export_test.go:9: got 1 rows, want 0
FAIL
FAIL	example.com/acme	0.003s
FAIL
`

/** go test, Go 1.27: `TestExport/w/inner`, run through a wrapper of its closure, fails. */
const GO_WRAPPED_FAILS = `--- FAIL: TestExport (0.00s)
    --- FAIL: TestExport/w (0.00s)
        --- FAIL: TestExport/w/inner (0.00s)
            export_test.go:12: got "x", want ""
FAIL
FAIL	example.com/acme	0.003s
FAIL
`

describe('A Go subtest’s nesting read at its own brace, and the pytest ids #291 left', () => {
  test('a Go subtest whose closure a wrapper call takes opens its level at the closure’s brace', () => {
    const path = 'export_test.go'
    const code = [
      'func TestExport(t *testing.T) {',
      '\tt.Run("w", withDB(func(t *testing.T) {',
      '\t\tt.Run("inner", func(t *testing.T) { t.Errorf("x") })',
      '\t}))',
      '}',
    ].join('\n')
    const names = addedTests({ insertion: 'new_file', code, patch: null })
    expect(names).toEqual([
      'TestExport',
      { parent: 'TestExport', subtest: 'w', nesting: [], whole: true },
      { parent: 'TestExport', subtest: 'inner', nesting: ['w'], whole: true },
    ])
    const inner = names.slice(2)
    expect(goRed(run(GO_INNER_FAILS, 1, path), path, inner)).toBe(false)
    expect(goRed(run(GO_WRAPPED_FAILS, 1, path), path, inner)).toBe(true)
  })

  test('a t.Run in a comment names no subtest and sets no level', () => {
    const path = 'export_test.go'
    const code = [
      'func TestExport(t *testing.T) {',
      '\t// Like t.Run("csv", …) below, for Markdown.',
      '\tfor _, tc := range cases {',
      '\t\tt.Run(tc.name, func(t *testing.T) { // like t.Run("csv", ...)',
      '\t\t\tt.Run("empty", func(t *testing.T) { t.Errorf("x") })',
      '\t\t})',
      '\t}',
      '}',
    ].join('\n')
    const names = addedTests({ insertion: 'new_file', code, patch: null })
    expect(names).toEqual([
      'TestExport',
      { parent: 'TestExport', subtest: 'empty', nesting: [null], whole: true },
    ])
    const subtests = names.slice(1)
    expect(goRed(run(GO_CSV_FAILS, 1, path), path, subtests)).toBe(false)
    expect(goRed(run(GO_BRANCH_FAILS, 1, path), path, subtests)).toBe(true)
  })

  test('a Go subtest’s level is read at its t.Run’s own brace, braces in their order on the line', () => {
    const path = 'export_test.go'
    const layouts = [
      [
        '\tt.Run("md", func(t *testing.T) { defer func() {',
        '\t\t_ = recover()',
        '\t}()',
        '\t\tt.Run("empty", func(t *testing.T) { t.Errorf("x") })',
        '\t})',
      ],
      [
        '\tt.Run("csv", func(t *testing.T) {',
        '\t}); t.Run("md", func(t *testing.T) {',
        '\t\tt.Run("empty", func(t *testing.T) { t.Errorf("x") })',
        '\t})',
      ],
      [
        '\tt.Run(',
        '\t\t"md", func(t *testing.T) {',
        '\t\t\tt.Run("empty", func(t *testing.T) { t.Errorf("x") })',
        '\t\t})',
      ],
    ]
    for (const layout of layouts) {
      const code = ['func TestExport(t *testing.T) {', ...layout, '}'].join('\n')
      const names = addedTests({ insertion: 'new_file', code, patch: null })
      const empty = names.filter(
        (name) => Predicate.hasProperty(name, 'subtest') && name.subtest === 'empty',
      )
      expect(empty).toEqual([
        { parent: 'TestExport', subtest: 'empty', nesting: ['md'], whole: true },
      ])
      expect(goRed(run(GO_OTHER_EMPTY_FAILS, 1, path), path, empty)).toBe(false)
      expect(goRed(run(GO_BRANCH_FAILS, 1, path), path, empty)).toBe(true)
    }
  })

  test('a subtest in a hunk that starts inside its t.Run block is still read by its name, a differing key line left to the user', () => {
    const path = 'export_test.go'
    const names = addedTests({ insertion: 'addition', code: '', patch: GO_INSIDE_PATCH })
    expect(names).toEqual([{ parent: 'TestExport', subtest: 'empty', nesting: [], whole: false }])
    // A red whose key line differs is a red the user is asked about (red_mismatch), not refused.
    expect(goRed(run(GO_BRANCH_FAILS, 1, path), path, names, false)).toBe(true)
    expect(goRed(run(GO_BRANCH_FAILS, 1, path), path, names, true)).toBe(true)
    expect(goRed(run(GO_BRANCH_FAILS, 1, path), path, names, null)).toBe(true)
  })

  test('a test under a describe name holding brackets, closed or not, is read by its name', () => {
    const path = 'src/a.test.ts'
    const lines = [
      '  ● with [[1,2],[3]] › reads a file',
      ' × src/a.test.ts > with [[1,2],[3]] > reads a file 3ms',
      ' FAIL  src/a.test.ts > matrix [ [ 1, 2 ], [ 3 ] ] > reads a file',
      ' × src/a.test.ts > range [0, 5) > reads a file 3ms',
      '  ● parser [x › reads a file',
    ]
    for (const line of lines) {
      const output = `${line}\nAssertionError: expected false to be true // Object.is equality`
      expect(validRed(run(output, 1, path), path, ['reads a file'], true)).toBe(true)
      expect(validRed(run(output, 1, path), path, ['reads a dir'])).toBe(false)
    }
  })

  test('a failing line of 300 KB is read quickly, cut to a few KB', () => {
    const path = 'src/a.test.ts'
    const output = (size: number) =>
      ` × src/a.test.ts > ${'[a] '.repeat(size)}> reads a file 3ms\nAssertionError: expected false to be true // Object.is equality`
    const classified = run(output(75_000), 1, path)
    expect(classified.failingLines[0]?.length).toBeLessThanOrEqual(8_192)
    expect(validRed(classified, path, ['reads a dir'])).toBe(false)
    // Read once cut, a line of 300 KB costs no more than one eight times shorter, wherever it runs.
    const read = (text: string) => validRed(run(text, 1, path), path, ['reads a dir'])
    expect(growth(output, 9_375, read)).toBeLessThan(24)
  })

  test('a pytest id after a space in a case id, or in a summary line’s message, is not that test', () => {
    const path = 'tests/test_export.py'
    expect(run(PYTEST_SPACED_OTHER_FAILS, 1, path).failingLines).toHaveLength(2)
    expect(validRed(run(PYTEST_SPACED_OTHER_FAILS, 1, path), path, ['test_x'])).toBe(false)
    expect(validRed(run(PYTEST_SPACED_OTHER_FAILS, 1, path), path, ['test_other'], true)).toBe(true)
    expect(validRed(run(PYTEST_SPACED_OTHER_FAILS, 1, path), path, ['test_y'], true)).toBe(true)
  })
})

/** pytest -v with -rN: no summary, each failing test read from its section in FAILURES. */
const PYTEST_VERBOSE_NEW_NAME_ERROR = `tests/test_export.py::test_one_is_one FAILED                              [ 50%]
tests/test_export.py::test_exports_markdown FAILED                        [100%]

=================================== FAILURES ===================================
_______________________________ test_one_is_one ________________________________

    def test_one_is_one():
>       assert 1 == 2
E       assert 1 == 2

tests/test_export.py:6: AssertionError
____________________________ test_exports_markdown _____________________________

    def test_exports_markdown():
>       assert to_markdown([]) == "| total |"
E       NameError: name 'to_markdown' is not defined

tests/test_export.py:10: NameError
============================== 2 failed in 0.01s ===============================
`

describe('A red read line by line and on the runner’s separators (#303)', () => {
  test('a pytest test the proof adds failing on a NameError, beside an older one failing on assert, is not a red', () => {
    const path = 'tests/test_export.py'
    const output = [
      'E   assert 1 == 2',
      'FAILED tests/test_export.py::test_one_is_one - assert 1 == 2',
      "FAILED tests/test_export.py::test_exports_markdown - NameError: name 'to_markdown' is not defined",
    ].join('\n')
    expect(validRed(run(output, 1, path), path, ['test_exports_markdown'])).toBe(false)
    expect(validRed(run(output, 1, path), path, ['test_one_is_one'], true)).toBe(true)
  })

  test('a jest test the proof adds that timed out, beside an older one failing on expect, is not a red', () => {
    const path = 'tests/export.test.js'
    const output = [
      '  ✕ one is one (3 ms)',
      '  ✕ the invoices export as Markdown (5003 ms)',
      '',
      '  ● one is one',
      '',
      '    expect(received).toBe(expected) // Object.is equality',
      '',
      '  ● the invoices export as Markdown',
      '',
      '    thrown: "Exceeded timeout of 5000 ms for a test.',
    ].join('\n')
    expect(validRed(run(output, 1, path), path, SCENARIO)).toBe(false)
    expect(validRed(run(output, 1, path), path, ['one is one'], true)).toBe(true)
  })

  test('a test the proof adds that threw a TypeError, its code frame holding an expect, is not a red', () => {
    const path = 'tests/export.test.ts'
    const output = [
      ' FAIL  tests/export.test.ts > the invoices export as Markdown',
      'TypeError: toMarkdown is not a function',
      ' ❯ tests/export.test.ts:4:12',
      '      4|   expect(toMarkdown([])).toBe("| total |")',
      ' FAIL  tests/export.test.ts > one is one',
      'AssertionError: expected 1 to be 2 // Object.is equality',
    ].join('\n')
    expect(validRed(run(output, 1, path), path, SCENARIO)).toBe(false)
    expect(validRed(run(output, 1, path), path, ['one is one'], true)).toBe(true)
  })

  test('a Go test the proof adds that panicked, beside an older one failing on t.Errorf, is not a red', () => {
    const path = 'export_test.go'
    const output = [
      '--- FAIL: TestOneIsOne (0.00s)',
      '    export_test.go:5: got 1, want 2',
      '--- FAIL: TestExportMarkdown (0.00s)',
      'panic: runtime error: invalid memory address or nil pointer dereference [recovered]',
      'FAIL\texample.com/acme\t0.01s',
    ].join('\n')
    expect(goRed(run(output, 1, path), path, ['TestExportMarkdown'])).toBe(false)
    expect(goRed(run(output, 1, path), path, ['TestOneIsOne'])).toBe(true)
  })

  test('a name is not matched inside a longer name: saves is not never saves, exports is not exports (csv)', () => {
    const path = 'tests/export.test.ts'
    const jest = [
      '  ✕ never saves (3 ms)',
      '  ✓ saves (1 ms)',
      '',
      '  ● never saves',
      '',
      '    expect(received).toBe(expected)',
    ].join('\n')
    expect(validRed(run(jest, 1, path), path, ['saves'])).toBe(false)
    expect(validRed(run(jest, 1, path), path, ['never saves'], true)).toBe(true)
    const vitest = [
      ' × tests/export.test.ts > export > never saves 3ms',
      ' ✓ tests/export.test.ts > export > saves 1ms',
      'AssertionError: expected 1 to be 2',
    ].join('\n')
    expect(validRed(run(vitest, 1, path), path, ['saves'])).toBe(false)
    expect(validRed(run(vitest, 1, path), path, ['never saves'], true)).toBe(true)
    const csv = ['  ✕ exports (csv) (3 ms)', '  ✓ exports (1 ms)', '    expect(received).toBe(1)']
    expect(validRed(run(csv.join('\n'), 1, path), path, ['exports'])).toBe(false)
    expect(validRed(run(csv.join('\n'), 1, path), path, ['exports (csv)'], true)).toBe(true)
    const later = ' × tests/export.test.ts > retries 3 ms later 3ms\nAssertionError: no'
    expect(validRed(run(later, 1, path), path, ['retries'])).toBe(false)
  })

  test('a template-literal name against a failing line of 300 KB is read quickly, the line cut to a few KB', () => {
    const path = 'tests/export.test.ts'
    const output = (size: number) => `× ${'a '.repeat(size)}\nexpect(1).toBe(2)\n`
    const classified = run(output(150_000), 1, path)
    expect(classified.failingLines[0]?.length).toBeLessThanOrEqual(8_192)
    expect(validRed(classified, path, [{ template: '${a} to ${b}' }])).toBe(false)
    // 17 s before the cut, growing faster than the line; cut, no more than a line eight times shorter.
    const read = (text: string) =>
      validRed(run(text, 1, path), path, [{ template: '${a} to ${b}' }])
    expect(growth(output, 18_750, read)).toBeLessThan(24)
  })

  test('a Go subtest Go renamed with #01, as a duplicate name, is a red by its name', () => {
    const path = 'export_test.go'
    const output =
      '--- FAIL: TestE (0.00s)\n    --- FAIL: TestE/csv#01 (0.00s)\nFAIL\texample.com/acme\t0.01s\n'
    const subtest = { parent: 'TestE', subtest: 'csv', nesting: [], whole: true }
    expect(goRed(run(output, 1, path), path, [subtest])).toBe(true)
    const other = { parent: 'TestE', subtest: 'cs', nesting: [], whole: true }
    expect(goRed(run(output, 1, path), path, [other])).toBe(false)
  })

  test('a Rust run with the terse format is a red by its name, from the failure’s stdout', () => {
    const path = 'src/lib.rs'
    const output = [
      LIB_BINARY,
      'running 2 tests',
      '.F',
      'failures:',
      '',
      '---- tests::exports stdout ----',
      "thread 'tests::exports' panicked at src/lib.rs:9:5:",
      'assertion `left == right` failed',
      '',
      'failures:',
      '    tests::exports',
    ].join('\n')
    expect(validRed(run(output, 101, path), path, inTests('exports'))).toBe(true)
    expect(validRed(run(output, 101, path), path, inTests('imports'))).toBe(false)
  })

  test('mocha’s dot reporter with a nested describe is a red by its name', () => {
    const path = 'test/export.spec.js'
    const output = [
      '  ..!',
      '',
      '  2 passing (4ms)',
      '  1 failing',
      '',
      '  1) export',
      '       writes markdown:',
      '     AssertionError [ERR_ASSERTION]: Expected values to be strictly equal',
    ].join('\n')
    expect(validRed(run(output, 1, path), path, ['writes markdown'], true)).toBe(true)
    expect(validRed(run(output, 1, path), path, ['markdown'])).toBe(false)
    const thrown = output.replace('AssertionError [ERR_ASSERTION]', 'TypeError')
    expect(validRed(run(thrown, 1, path), path, ['writes markdown'])).toBe(false)
  })

  test('pytest -v with -rN is read from its FAILURES sections, each test by its own error', () => {
    const path = 'tests/test_export.py'
    const output = PYTEST_VERBOSE_NEW_NAME_ERROR
    expect(validRed(run(output, 1, path), path, ['test_exports_markdown'])).toBe(false)
    expect(validRed(run(output, 1, path), path, ['test_one_is_one'], true)).toBe(true)
    const asserts = output.replace(
      "E       NameError: name 'to_markdown' is not defined",
      "E       AssertionError: assert '' == '| total |'",
    )
    expect(validRed(run(asserts, 1, path), path, ['test_exports_markdown'], true)).toBe(true)
  })

  test('go test -json is not read: it is never a red, whatever its key line', () => {
    const path = 'export_test.go'
    const output = [
      '{"Action":"output","Test":"TestExportMarkdown","Output":"--- FAIL: TestExportMarkdown (0.00s)\\n"}',
      '{"Action":"fail","Package":"example.com/acme","Test":"TestExportMarkdown","Elapsed":0}',
    ].join('\n')
    expect(run(output, 1, path).classification).not.toBe('assertion_failed')
    expect(goRed(run(output, 1, path), path, ['TestExportMarkdown'], true)).toBe(false)
  })
})

/** jest 30, its own words: an older test fails on expect, the one the proof adds times out. */
const JEST_TIMEOUT_WITH_FRAME = [
  ' FAIL  tests/export.test.js',
  '  export',
  '    ✕ one is one (3 ms)',
  '    ✕ the invoices export as Markdown (5003 ms)',
  '',
  '  ● export › one is one',
  '',
  '    expect(received).toBe(expected) // Object.is equality',
  '',
  '  ● export › the invoices export as Markdown',
  '',
  '    thrown: "Exceeded timeout of 5000 ms for a test.',
  '    Add a timeout value to this test to increase the timeout, if this is a long-running test. See https://jestjs.io/docs/api#testname-fn-timeout."',
  '',
  "      2 | describe('export', () => {",
  "    > 3 |   test('the invoices export as Markdown', async () => {",
  '        |   ^',
  '      4 |     expect(await toMarkdown()).toBe("| total |")',
  '      5 |   })',
  '',
].join('\n')

/** Go testify, its own words: assert.Equal failed in the test the proof adds. */
const GO_TESTIFY_FAILS = [
  '--- FAIL: TestExportMarkdown (0.00s)',
  '    export_test.go:12: ',
  '        \tError Trace:\t/work/acme/export_test.go:12',
  '        \tError:      \tNot equal: ',
  '        \t            \texpected: "| total |"',
  '        \t            \tactual  : ""',
  '        \tTest:       \tTestExportMarkdown',
  'FAIL',
  'FAIL\texample.com/acme\t0.01s',
].join('\n')

describe('A red read from what a runner prints around the error (#303, round 2)', () => {
  test('a jest test the proof adds that timed out, its code frame holding an expect, is not a red', () => {
    const path = 'tests/export.test.js'
    expect(validRed(run(JEST_TIMEOUT_WITH_FRAME, 1, path), path, SCENARIO)).toBe(false)
    expect(validRed(run(JEST_TIMEOUT_WITH_FRAME, 1, path), path, ['one is one'], true)).toBe(true)
  })

  test('a jest test that threw an error not named Error, or threw undefined, its frame holding an expect, is not a red', () => {
    const path = 'tests/export.test.js'
    const custom = [
      '  ● export › one is one',
      '',
      '    expect(received).toBe(expected)',
      '',
      '  ● export › the invoices export as Markdown',
      '',
      '    NotFound: no invoice',
      '',
      '    > 4 |     expect(await toMarkdown()).toBe("| total |")',
    ].join('\n')
    expect(validRed(run(custom, 1, path), path, SCENARIO)).toBe(false)
    const undefinedThrown = [
      '  ● one is one',
      '    expect(received).toBe(1)',
      '  ● the invoices export as Markdown',
      '    thrown: undefined',
      '    > 4 |     expect(toMarkdown()).toBe("| total |")',
    ].join('\n')
    expect(validRed(run(undefinedThrown, 1, path), path, SCENARIO)).toBe(false)
  })

  test('blank and space-only lines after a failure are read in linear time', () => {
    const path = 'tests/export.test.ts'
    const outputs = [
      [(size: number) => `× a\n${'\n'.repeat(size)}`, 5_000],
      [(size: number) => `× a\n${`${' '.repeat(1_000)}\n`.repeat(size)}`, 250],
    ] as const
    const read = (output: string) => expect(validRed(run(output, 1, path), path, ['b'])).toBe(false)
    // Quadratic, these took ten seconds and more: eight times the lines cost about eight times more.
    for (const [output, size] of outputs) expect(growth(output, size, read)).toBeLessThan(24)
  })

  test('a Go testify assertion that failed in the test the proof adds is a red', () => {
    const path = 'export_test.go'
    expect(goRed(run(GO_TESTIFY_FAILS, 1, path), path, ['TestExportMarkdown'])).toBe(true)
  })

  test('a pytest.raises or pytest.warns that did not raise or warn is a red', () => {
    const path = 'tests/test_export.py'
    for (const what of ["DID NOT RAISE <class 'ValueError'>", 'DID NOT WARN']) {
      const output = [
        '___________________________ test_rejects_empty ___________________________',
        '',
        '    def test_rejects_empty():',
        '        with pytest.raises(ValueError):',
        '>           to_markdown([])',
        `E           Failed: ${what}`,
        '',
        'tests/test_export.py:5: Failed',
        `FAILED tests/test_export.py::test_rejects_empty - Failed: ${what}`,
      ].join('\n')
      expect(validRed(run(output, 1, path), path, ['test_rejects_empty'], true)).toBe(true)
    }
  })

  test('a mocha test that threw is not a red because a later log line says AssertionError', () => {
    const path = 'test/export.spec.js'
    const output = [
      '  export',
      '    1) one is one',
      '    2) the invoices export as Markdown',
      'AssertionError: logged by a passing test',
      '    ✔ reads it back',
      '',
      '  1 passing',
      '  2 failing',
      '',
      '  1) export',
      '       one is one:',
      '     AssertionError [ERR_ASSERTION]: Expected values to be strictly equal',
      '',
      '  2) export',
      '       the invoices export as Markdown:',
      '     TypeError: toMarkdown is not a function',
    ].join('\n')
    expect(validRed(run(output, 1, path), path, SCENARIO)).toBe(false)
    expect(validRed(run(output, 1, path), path, ['one is one'], true)).toBe(true)
  })

  test('a duration is only one a runner prints: debounces is not debounces 300ms, expires in is not expires in 30s', () => {
    const path = 'tests/export.test.ts'
    const jest = ['  ✕ debounces 300ms', '  ● debounces 300ms', '    expect(received).toBe(1)']
    expect(validRed(run(jest.join('\n'), 1, path), path, ['debounces'])).toBe(false)
    const vitest = [
      ' × tests/export.test.ts > expires in 30s',
      'AssertionError: expected 1 to be 2',
    ]
    expect(validRed(run(vitest.join('\n'), 1, path), path, ['expires in'])).toBe(false)
    expect(validRed(run(vitest.join('\n'), 1, path), path, ['expires in 30s'], true)).toBe(true)
  })

  test('a Python exception named with its module is read as thrown, not as an assertion', () => {
    const path = 'tests/test_export.py'
    for (const error of [
      'app.errors.ValidationError: assertion of schema failed',
      'json.decoder.JSONDecodeError: Expecting value',
    ]) {
      const output = [
        'FAILED tests/test_export.py::test_one_is_one - assert 1 == 2',
        `FAILED tests/test_export.py::test_exports_markdown - ${error}`,
      ].join('\n')
      expect(validRed(run(output, 1, path), path, ['test_exports_markdown'])).toBe(false)
    }
  })
})

describe('A red read from its own lines only (#331)', () => {
  test('a pytest section’s source lines are not read as assertions: only its E lines and its trailer', () => {
    const path = 'tests/test_export.py'
    const names = ['test_saves_the_invoice']
    // A test the proof adds that hit pytest-timeout on a Playwright-style expect, and one that
    // raised an exception named without Error, beside an older test failing on assert.
    for (const name of ['pytest-timeout-source', 'pytest-unsuffixed-error-source']) {
      const output = captured(name)
      expect(validRed(run(output, 1, path), path, names)).toBe(false)
      expect(validRed(run(output, 1, path), path, ['test_one_is_one'], true)).toBe(true)
    }
    const asserts = captured('pytest-timeout-source')
      .replace(
        'E       Failed: Timeout (>2.0s) from pytest-timeout.',
        'E       AssertionError: the invoice is not saved',
      )
      .replace('- Failed: Timeout (>2.0s)...', '- AssertionError: the invoice...')
    expect(validRed(run(asserts, 1, path), path, names, true)).toBe(true)
  })

  test('a mocha log or diff line shaped like 1) name does not take a failure number’s place', () => {
    const path = 'test/export.spec.js'
    // A passing test that logs `  1) its name` below the tree, the older #1 asserting.
    const logged = captured('mocha-numbered-log-line')
    expect(validRed(run(logged, 1, path), path, SCENARIO)).toBe(false)
    expect(validRed(run(logged, 1, path), path, ['one is one'], true)).toBe(true)
    // A diff line `2) its name` inside #1's text, the older #2 asserting, the test passing.
    const diffed = captured('mocha-numbered-diff-line')
    expect(validRed(run(diffed, 1, path), path, SCENARIO)).toBe(false)
    expect(validRed(run(diffed, 1, path), path, ['one is one'], true)).toBe(true)
    expect(validRed(run(diffed, 1, path), path, ['reads it back'], true)).toBe(true)
  })

  test('lines that repeat expect( or assertion without closing them are read in linear time', () => {
    const path = 'tests/export.test.ts'
    // Lines that grow up to the 4 KB a line is read to, and one line far past it.
    const outputs = [
      [(size: number) => `× a\n${`${'expect('.repeat(size)}\n`.repeat(100)}`, 72],
      [(size: number) => `× a\n${`${'assertion '.repeat(size)}\n`.repeat(100)}`, 50],
      [(size: number) => `× a\n${'expect('.repeat(size)}`, 5_000],
    ] as const
    const read = (output: string) => expect(validRed(run(output, 1, path), path, ['b'])).toBe(false)
    // Quadratic in a line's length, these took fifteen seconds and more (about 50 times longer for
    // lines eight times longer); linear, about 8.
    for (const [output, size] of outputs) expect(growth(output, size, read)).toBeLessThan(24)
  })
})

describe('A red read from its own lines only, the real reds kept (#331, round 2)', () => {
  test('a pytest --tb=native section is read from its last traceback’s exception, its summary without a message', () => {
    const path = 'tests/test_export_of_the_invoices_as_markdown_files.py'
    const output = captured('pytest-native-long-path')
    expect(validRed(run(output, 1, path), path, ['test_one_is_one'], true)).toBe(true)
    expect(
      validRed(
        run(output, 1, path),
        path,
        ['test_the_invoices_export_as_markdown_with_headers'],
        true,
      ),
    ).toBe(true)
    // An assertion caught and a TypeError raised from it, a traceback printed by the test.
    const chained = captured('pytest-native-chained')
    const chainedPath = 'tests/test_export.py'
    expect(validRed(run(chained, 1, chainedPath), chainedPath, ['test_saves_the_invoice'])).toBe(
      false,
    )
    expect(validRed(run(chained, 1, chainedPath), chainedPath, ['test_one_is_one'], true)).toBe(
      true,
    )
  })

  test('a pytest section heading padded with a single underscore is read, never its frame separator', () => {
    const path = 'tests/test_export_of_the_invoices_as_markdown_files.py'
    const output = captured('pytest-long-section-heading')
    const names = ['test_the_invoices_export_as_markdown_with_headers']
    expect(validRed(run(output, 1, path), path, names, true)).toBe(true)
    expect(validRed(run(output, 1, path), path, ['test_one_is_one'], true)).toBe(true)
    const separated = captured('pytest-timeout-source')
    const timedOut = run(separated, 1, 'tests/test_export.py')
    expect(validRed(timedOut, 'tests/test_export.py', ['test_saves_the_invoice'])).toBe(false)
  })

  test('a mocha describe title ending with a colon keeps its test’s name', () => {
    const path = 'test/invoices.spec.js'
    const output = captured('mocha-describe-title-colon')
    expect(validRed(run(output, 1, path), path, ['one is one'], true)).toBe(true)
    expect(validRed(run(output, 1, path), path, ['saves'], true)).toBe(true)
    expect(validRed(run(output, 1, path), path, SCENARIO)).toBe(false)
  })

  test('an error message’s line shaped like a mocha list entry is not one: the real entry is read', () => {
    const path = 'test/export.spec.js'
    const output = captured('mocha-message-numbered-line')
    expect(validRed(run(output, 1, path), path, ['reads it back'], true)).toBe(true)
    expect(validRed(run(output, 1, path), path, ['one is one'], true)).toBe(true)
    expect(validRed(run(output, 1, path), path, SCENARIO)).toBe(false)
  })
})

describe('A red read failure by failure, each runner by its own reader (#342)', () => {
  test('a pytest ExceptionGroup holding an AssertionError is a red, its summary without a message; one holding a TypeError is not', () => {
    const path = 'tests/test_export_of_the_invoices_as_markdown_files.py'
    for (const name of ['pytest-group-long', 'pytest-group-native']) {
      const output = captured(name)
      const red = (declared: string) => validRed(run(output, 1, path), path, [declared], true)
      expect(red('test_the_invoices_export_as_markdown_in_a_task_group')).toBe(true)
      expect(red('test_the_invoices_export_as_markdown_with_a_type_error_in_a_task_group')).toBe(
        false,
      )
      expect(red('test_one_is_one')).toBe(true)
    }
    // A group holding an assertion and a TypeError: not every exception it holds is an assertion.
    const mixed = captured('pytest-group-mixed')
    const mixedPath = 'tests/test_group_mixed.py'
    const names = ['test_the_invoices_export_as_markdown_in_a_mixed_task_group']
    expect(validRed(run(mixed, 1, mixedPath), mixedPath, names)).toBe(false)
  })

  test('a pytest.fail message whose next line reads AssertionError is not a red', () => {
    const path = 'tests/test_export_of_the_invoices_as_markdown_files.py'
    for (const name of ['pytest-group-long', 'pytest-group-native']) {
      const output = captured(name)
      const names = ['test_the_invoices_export_as_markdown_failed_by_hand']
      expect(validRed(run(output, 1, path), path, names)).toBe(false)
    }
  })

  test('a mocha title starting with a space keeps its test’s name', () => {
    const path = 'test/export.spec.js'
    const output = captured('mocha-title-leading-space')
    expect(validRed(run(output, 1, path), path, [' writes markdown'], true)).toBe(true)
    expect(validRed(run(output, 1, path), path, ['one is one'], true)).toBe(true)
    expect(validRed(run(output, 1, path), path, SCENARIO)).toBe(false)
  })

  test('a mocha describe named like the test the proof adds is not that test', () => {
    const path = 'test/describe.spec.js'
    const output = captured('mocha-describe-named-like-a-test')
    expect(validRed(run(output, 1, path), path, ['saves'])).toBe(false)
    expect(validRed(run(output, 1, path), path, ['one is one'], true)).toBe(true)
  })

  test('a JUnit report’s pytest case and Rust path are read by the test’s declared name', () => {
    const path = 'tests/test_report.py'
    const pytest = captured('pytest-junit')
    expect(validRed(run(pytest, 1, path), path, ['test_exports'], true)).toBe(true)
    expect(validRed(run(pytest, 1, path), path, ['test_export'])).toBe(false)
    const nextest = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites name="nextest-run" tests="3" failures="2" errors="0">',
      '  <testsuite name="acme" tests="3" disabled="0" errors="0" failures="2">',
      '    <testcase name="tests::one_is_one" classname="acme" time="0.002"></testcase>',
      '    <testcase name="tests::exports_markdown" classname="acme" time="0.004">',
      '      <failure type="test failure">assertion `left == right` failed</failure>',
      '    </testcase>',
      '    <testcase name="tests::exports_cases::case_1" classname="acme" time="0.004">',
      '      <failure type="test failure">assertion `left == right` failed</failure>',
      '    </testcase>',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n')
    const lib = 'src/lib.rs'
    expect(validRed(run(nextest, 100, lib), lib, ['exports_markdown'])).toBe(true)
    expect(validRed(run(nextest, 100, lib), lib, rustTests(['exports_cases']))).toBe(true)
    expect(validRed(run(nextest, 100, lib), lib, ['one_is_one'])).toBe(false)
    expect(validRed(run(nextest, 100, lib), lib, rustTests(['reads_rows']))).toBe(false)
  })

  test('a libtest stdout heading a test prints before the failures list is not a failure', () => {
    const path = 'src/lib.rs'
    const output = [
      LIB_BINARY,
      'running 2 tests',
      '---- tests::exports_markdown stdout ----',
      'assertion `left == right` failed',
      'test tests::exports_markdown ... ok',
      'test tests::one_is_one ... FAILED',
      '',
      'failures:',
      '',
      '---- tests::one_is_one stdout ----',
      "thread 'tests::one_is_one' panicked at src/lib.rs:9:5:",
      'assertion `left == right` failed',
      '',
      'failures:',
      '    tests::one_is_one',
    ].join('\n')
    expect(validRed(run(output, 101, path), path, inTests('exports_markdown'))).toBe(false)
    expect(validRed(run(output, 101, path), path, inTests('one_is_one'))).toBe(true)
  })
})

/** go test, Go 1.27: a subtest the proof adds panicked on a nil stub, its parent failing with it. */
const GO_PANIC_SUBTEST = [
  '--- FAIL: TestExport (0.00s)',
  '    --- FAIL: TestExport/csv (0.00s)',
  'panic: runtime error: invalid memory address or nil pointer dereference [recovered]',
  '\tpanic: runtime error: invalid memory address or nil pointer dereference',
  '[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x4f3b2a]',
  '',
  'goroutine 7 [running]:',
  'testing.tRunner.func1.2({0x51c2a0, 0x6b5e30})',
  '\t/usr/lib/go/src/testing/testing.go:1632 +0x230',
  'FAIL\texample.com/acme\t0.005s',
  'FAIL',
].join('\n')

/** gotestsum: the same, each test's output under its own `=== FAIL:` line. */
const GOTESTSUM_PANIC_SUBTEST = [
  '=== FAIL: example.com/acme TestExport/csv (0.00s)',
  'panic: runtime error: invalid memory address or nil pointer dereference [recovered]',
  '\tpanic: runtime error: invalid memory address or nil pointer dereference',
  '',
  '=== FAIL: example.com/acme TestExport (0.00s)',
  '',
  'DONE 2 tests, 2 failures in 0.2s',
].join('\n')

describe('A red read block by block, a test vetoed by any block that is no assertion (#342, round 2)', () => {
  test('a Go parent whose subtest panicked is not a red, in go test and gotestsum', () => {
    const path = 'export_test.go'
    const csv = { parent: 'TestExport', subtest: 'csv', nesting: [], whole: true }
    for (const output of [GO_PANIC_SUBTEST, GOTESTSUM_PANIC_SUBTEST]) {
      expect(goRed(run(output, 1, path), path, ['TestExport'])).toBe(false)
      expect(goRed(run(output, 1, path), path, [csv])).toBe(false)
    }
  })

  test('a Go test that failed on an unreachable service is not a red, its log after the failure or under go test -v', () => {
    const path = 'saves_test.go'
    const after = [
      '--- FAIL: TestSaves (0.00s)',
      '    saves_test.go:9: dial tcp 127.0.0.1:5432: connect: connection refused',
      'FAIL',
      'FAIL\texample.com/acme\t0.01s',
    ].join('\n')
    const verbose = [
      '=== RUN   TestSaves',
      '    saves_test.go:9: dial tcp 127.0.0.1:5432: connect: connection refused',
      '--- FAIL: TestSaves (0.00s)',
      'FAIL',
      'FAIL\texample.com/acme\t0.01s',
    ].join('\n')
    // go test -v: a test's failure ends where the next test's run starts, its log not this one's.
    const next = [
      '=== RUN   TestOneIsOne',
      '    one_test.go:5: got 1, want 2',
      '--- FAIL: TestOneIsOne (0.00s)',
      '=== RUN   TestSaves',
      '    saves_test.go:9: dial tcp 127.0.0.1:5432: connect: connection refused',
      '--- FAIL: TestSaves (0.00s)',
      'FAIL',
      'FAIL\texample.com/acme\t0.01s',
    ].join('\n')
    expect(goRed(run(next, 1, path), path, ['TestOneIsOne'])).toBe(true)
    expect(goRed(run(next, 1, path), path, ['TestSaves'])).toBe(false)
    const unordered = [
      '--- FAIL: TestOneIsOne (0.00s)',
      '    one_test.go:5: got 1, want 2',
      '=== RUN   TestSaves',
      '    saves_test.go:9: dial tcp 127.0.0.1:5432: connect: connection refused',
      '--- FAIL: TestSaves (0.00s)',
      'FAIL',
      'FAIL\texample.com/acme\t0.01s',
    ].join('\n')
    expect(goRed(run(unordered, 1, path), path, ['TestOneIsOne'])).toBe(true)
    for (const output of [after, verbose]) {
      expect(goRed(run(output, 1, path), path, ['TestSaves'])).toBe(false)
      const asserted = output.replace(
        'dial tcp 127.0.0.1:5432: connect: connection refused',
        'got 0 rows, want 1',
      )
      expect(goRed(run(asserted, 1, path), path, ['TestSaves'])).toBe(true)
    }
  })

  test('a pytest test whose assertion was caught and turned into another error is not a red, in every traceback mode', () => {
    const path = 'tests/test_export.py'
    const withoutSummary = (output: string) =>
      output
        .split('\n')
        .filter((line) => !line.startsWith('FAILED '))
        .join('\n')
    for (const mode of ['long', 'short', 'native']) {
      for (const output of [
        captured(`pytest-chained-${mode}`),
        withoutSummary(captured(`pytest-chained-${mode}`)),
      ]) {
        const red = (declared: string) => validRed(run(output, 1, path), path, [declared], true)
        expect(red('test_chained')).toBe(false)
        expect(red('test_chained_reverse')).toBe(true)
        expect(red('test_unsuffixed')).toBe(false)
        expect(red('test_logs_assert')).toBe(false)
        expect(red('test_one_is_one')).toBe(true)
      }
    }
  })

  test('a pytest section is read above what the test printed: a captured E assert line is not its error', () => {
    const path = 't.py'
    const output = [
      '___ test_new ___',
      '',
      '    def test_new():',
      '>       raise NotFound(1)',
      'E       app.NotFound: 1',
      '',
      't.py:3: NotFound',
      '---- Captured stdout call ----',
      'E   assert printed by the app',
      '=== 1 failed ===',
    ].join('\n')
    expect(validRed(run(output, 1, path), path, ['test_new'])).toBe(false)
    // A traceback the test printed on its stderr, under its section's own error.
    const printedTraceback = [
      '___ test_new ___',
      '',
      '    def test_new():',
      '>       time.sleep(5)',
      'E       Failed: Timeout (>1.0s) from pytest-timeout.',
      '',
      't.py:3: Failed',
      '---- Captured stderr call ----',
      'Traceback (most recent call last):',
      '  File "/work/acme/api/t.py", line 2, in test_new',
      '    raise AssertionError("printed only")',
      'AssertionError: printed only',
      '=== 1 failed ===',
    ].join('\n')
    expect(validRed(run(printedTraceback, 1, path), path, ['test_new'])).toBe(false)
  })

  test('a unittest test whose assertion was caught and turned into another error is not a red', () => {
    const path = 'test_ut.py'
    const output = captured('unittest-chained')
    expect(validRed(run(output, 1, path), path, ['test_chained'])).toBe(false)
    expect(validRed(run(output, 1, path), path, ['test_saves'])).toBe(false)
    expect(validRed(run(output, 1, path), path, ['test_sub'], true)).toBe(true)
    expect(validRed(run(output, 1, path), path, ['test_one_is_one'], true)).toBe(true)
  })

  test('a pytest parametrised test with a case failing on an assertion and one on another error is not a red', () => {
    const path = 't.py'
    const output =
      'FAILED t.py::test_new[a] - assert 1 == 2\nFAILED t.py::test_new[b] - NameError: name x'
    expect(validRed(run(output, 1, path), path, ['test_new'])).toBe(false)
  })

  test('a vitest test that threw a string or a custom error is read by its own error line, never one below it', () => {
    const path = 'export.test.ts'
    const unhandled = captured('vitest-unhandled-error')
    expect(validRed(run(unhandled, 1, path), path, ['saves'])).toBe(false)
    const custom = captured('vitest-custom-error')
    expect(validRed(run(custom, 1, path), path, ['saves'])).toBe(false)
    expect(validRed(run(custom, 1, path), path, ['loads'])).toBe(false)
    expect(validRed(run(custom, 1, path), path, ['one is one'], true)).toBe(true)
    // A thrown object, then another test's unhandled assertion past vitest's rule.
    const thrownObject = unhandled.replace(
      'Unknown Error: not implemented',
      '{ code: 42, stacks: [] }',
    )
    expect(validRed(run(thrownObject, 1, path), path, ['saves'])).toBe(false)
    // An error whose cause was an assertion: the test threw that error, not the assertion.
    const caused = [
      ' FAIL  export.test.ts > saves',
      'NotImplemented: toMarkdown',
      ' ❯ export.test.ts:4:29',
      '',
      'Caused by: AssertionError: expected 1 to be 2 // Object.is equality',
      ' ❯ export.test.ts:3:38',
      '⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯',
    ].join('\n')
    expect(validRed(run(caused, 1, path), path, ['saves'])).toBe(false)
  })

  test('node:test’s failing list names a test by its own error, never a describe of the same name', () => {
    const path = 'a.test.mjs'
    const output = captured('node-spec-describe')
    expect(validRed(run(output, 1, path), path, ['saves'])).toBe(false)
    expect(validRed(run(output, 1, path), path, ['never saves'], true)).toBe(true)
  })

  test('a duration is stripped only where its runner prints one: vitest’s heading and jest’s ● keep the name whole', () => {
    const path = 'export.test.ts'
    const vitest = captured('vitest-duration-in-name')
    expect(validRed(run(vitest, 1, path), path, ['debounces'])).toBe(false)
    expect(validRed(run(vitest, 1, path), path, ['debounces 300ms'], true)).toBe(true)
    const jest = [
      '  ✕ times out (30s) (12 ms)',
      '  ✕ times out (3 ms)',
      '',
      '  ● times out (30s)',
      '',
      '    expect(received).toBe(1)',
      '',
      '  ● times out',
      '',
      '    TypeError: x is not a function',
    ].join('\n')
    expect(validRed(run(jest, 1, 't.test.js'), 't.test.js', ['times out'])).toBe(false)
    expect(validRed(run(jest, 1, 't.test.js'), 't.test.js', ['times out (30s)'], true)).toBe(true)
  })

  test('a dollar in a plain test name is the name’s own, not a placeholder', () => {
    const path = 't.test.js'
    const output =
      '  ✕ charges $10 for shipping (3 ms)\n  ● charges $10 for shipping\n    expect(received).toBe(1)'
    expect(validRed(run(output, 1, path), path, ['charges $5 for shipping'])).toBe(false)
    expect(validRed(run(output, 1, path), path, ['charges $10 for shipping'], true)).toBe(true)
    const declared = addedTests({
      insertion: 'new_file',
      code: "test('charges $5 for shipping', () => {})\ntest.each([[5]])('charges $amount', () => {})\ntest(`charges ${amount}`, () => {})\n",
      patch: null,
    })
    // Each could produce another's title (#342, round 5): none names its test.
    const generated = { scope: [], twin: true, clash: true }
    expect(declared).toEqual([
      { title: 'charges $5 for shipping', ...generated },
      { title: { template: 'charges $amount' }, ...generated },
      { title: { template: 'charges ${amount}' }, ...generated },
    ])
    expect(validRed(run(output, 1, path), path, [{ template: 'charges $amount' }], true)).toBe(true)
    // Written as a plain string, a name holding `$amount` is that name, never a template.
    expect(validRed(run(output, 1, path), path, ['charges $amount for shipping'])).toBe(false)
    // A template's last piece ends the title: `${kind} export` is not `md export later`.
    const later = '  ✕ md export later (3 ms)\n  ● md export later\n    expect(received).toBe(1)'
    expect(validRed(run(later, 1, path), path, [{ template: '${kind} export' }])).toBe(false)
    expect(validRed(run(later, 1, path), path, [{ template: '${kind} export later' }], true)).toBe(
      true,
    )
  })

  test('a Rust test that returned an error is not a red, beside an older one failing on an assertion', () => {
    const path = 'src/lib.rs'
    const output = [
      LIB_BINARY,
      'running 2 tests',
      'test tests::exports ... FAILED',
      'test tests::one_is_one ... FAILED',
      '',
      'failures:',
      '',
      '---- tests::exports stdout ----',
      'Error: ParseIntError { kind: InvalidDigit }',
      '',
      '---- tests::one_is_one stdout ----',
      "thread 'tests::one_is_one' panicked at src/lib.rs:9:5:",
      'assertion `left == right` failed',
      '',
      'failures:',
      '    tests::exports',
      '    tests::one_is_one',
    ].join('\n')
    expect(validRed(run(output, 101, path), path, inTests('exports'))).toBe(false)
    expect(validRed(run(output, 101, path), path, inTests('one_is_one'))).toBe(true)
  })

  test('a JUnit report’s pytest failure is read by its own error, never the source it prints', () => {
    const path = 'tests/test_report.py'
    const output = captured('pytest-junit-name-error')
    expect(validRed(run(output, 1, path), path, ['test_saves_the_invoice'])).toBe(false)
  })

  test('a vitest red coloured by the runner, with Windows line endings, is a red', () => {
    const path = 't.test.ts'
    const output =
      ' \u001b[31m×\u001b[39m t.test.ts > export > saves 3ms\r\n\u001b[31mAssertionError\u001b[39m: x\r\n'
    expect(validRed(run(output, 1, path), path, ['saves'], true)).toBe(true)
  })

  test('a name with four placeholders against a line of 4 KB is read in linear time', () => {
    const path = 't.test.ts'
    const name = [{ template: '${a} to ${b} to ${c} to ${d}' }]
    const output = (size: number) => `× ${'a to '.repeat(size)}x>\nexpect(1).toBe(2)\n`
    const read = (text: string) => validRed(run(text, 1, path), path, name)
    expect(read(output(810))).toBe(false)
    // 190 s with a pattern built from the name; matched piece by piece, a line eight times longer
    // costs about eight times more.
    expect(growth(output, 100, read)).toBeLessThan(24)
  })
})

/** A patch adding the lines `from` to `to` (from 1) of a test file's code, as `git diff -U0` does. */
const addition = (code: string, from: number, to: number) => ({
  insertion: 'addition' as const,
  code,
  patch: [
    '--- a/test',
    '+++ b/test',
    `@@ -${String(from - 1)},0 +${String(from)},${String(to - from + 1)} @@`,
    ...code
      .split('\n')
      .slice(from - 1, to)
      .map((line) => `+${line}`),
  ].join('\n'),
})

const VITEST_SAME_TITLE_SOURCE = [
  "import { describe, expect, test } from 'vite-plus/test'",
  "describe('export', () => {",
  "  test('saves', () => { throw { code: 42 } })",
  "  test('rejects', () => { expect(() => { throw new TypeError('Error: x is not a function') }).toThrow('not found') })",
  "  test('rejects async', async () => { await expect(Promise.reject(new Error('TypeError: boom'))).rejects.toThrow('nope') })",
  '})',
  "describe('import', () => {",
  "  test('saves', () => { expect(1).toBe(2) })",
  '})',
  "describe('archive', () => {",
  "  test('keeps', () => { expect(1).toBe(1) })",
  '})',
  "describe('restore', () => {",
  "  test('keeps', () => { expect(1).toBe(2) })",
  '})',
].join('\n')

const NODE_SAME_TITLE_SOURCE = [
  "import { test, describe } from 'node:test'",
  "import assert from 'node:assert'",
  "describe('export', () => { test('saves', () => { throw 'not implemented' }) })",
  "describe('import', () => { test('saves', () => { assert.strictEqual(1, 2) }) })",
].join('\n')

const PYTEST_SAME_TITLE_SOURCE = [
  'class TestExport:',
  '    def test_saves(self):',
  '        raise {}["x"] if False else ValueError("not implemented")',
  '',
  'class TestImport:',
  '    def test_saves(self):',
  '        assert 1 == 2',
  '',
  'class TestArchive:',
  '    def test_keeps(self):',
  '        assert 1 == 1',
  '',
  'class TestRestore:',
  '    def test_keeps(self):',
  '        assert 1 == 2',
].join('\n')

const RUST_PANICS = {
  asserts: ['eq', 'plain_assert', 'eq_msg'],
  errs: ['uses_todo', 'uses_unimplemented', 'unwraps', 'index'],
  says_nothing: ['assert_msg', 'expects', 'panics'],
}

describe('A red read by its test’s path, its errors and its panics, the key line deciding what they leave open (#342, round 3)', () => {
  test('a vitest test the proof adds is not another describe’s test of the same title', () => {
    const path = 'export.test.ts'
    const output = run(captured('vitest-same-title'), 1, path)
    // archive > keeps passes, restore > keeps fails on an assertion.
    const keeps = addedTests(addition(VITEST_SAME_TITLE_SOURCE, 10, 12))
    expect(validRed(output, path, keeps)).toBe(false)
    expect(
      validRed(output, path, addedTests(addition(VITEST_SAME_TITLE_SOURCE, 13, 15)), true),
    ).toBe(true)
    // export > saves threw an object, import > saves failed on an assertion.
    const saves = addedTests(addition(VITEST_SAME_TITLE_SOURCE, 3, 3))
    expect(validRed(output, path, saves)).toBe(false)
    expect(validRed(output, path, addedTests(addition(VITEST_SAME_TITLE_SOURCE, 7, 9)), true)).toBe(
      true,
    )
  })

  test('a node:test test whose title another describe repeats is named by nothing its list prints: the key line decides', () => {
    const path = 'b.test.mjs'
    const output = run(captured('node-same-title'), 1, path)
    const saves = addedTests(addition(NODE_SAME_TITLE_SOURCE, 3, 3))
    expect(validRed(output, path, saves)).toBe(false)
    const imports = addedTests(addition(NODE_SAME_TITLE_SOURCE, 4, 4))
    expect(validRed(output, path, imports)).toBe(false)
    expect(validRed(output, path, imports, true)).toBe(true)
  })

  test('a pytest test the proof adds is not another class’s test of the same name', () => {
    const path = 'tests/test_dup.py'
    const output = run(captured('pytest-same-title'), 1, path)
    expect(validRed(output, path, addedTests(addition(PYTEST_SAME_TITLE_SOURCE, 1, 3)))).toBe(false)
    expect(validRed(output, path, addedTests(addition(PYTEST_SAME_TITLE_SOURCE, 9, 11)))).toBe(
      false,
    )
    expect(
      validRed(output, path, addedTests(addition(PYTEST_SAME_TITLE_SOURCE, 13, 15)), true),
    ).toBe(true)
  })

  test('two tests declared with the same path are named by nothing: the key line decides', () => {
    const path = 'tests/export.test.ts'
    const code = ["test('keeps', () => {})", "test('keeps', () => {})"].join('\n')
    const names = addedTests({ insertion: 'new_file', code, patch: null })
    for (const printed of [' × keeps 3ms', ' FAIL  tests/export.test.ts > keeps']) {
      const output = run(`${printed}\nAssertionError: expected 1 to be 2`, 1, path)
      expect(validRed(output, path, names)).toBe(false)
      expect(validRed(output, path, names, true)).toBe(true)
    }
  })

  test('a jest or unittest test whose title another describe or class repeats is told apart by the path its runner prints; mocha’s, printed with no file, by the key line', () => {
    const js = [
      "describe('export', () => {",
      "  test('saves', () => { toMarkdown() })",
      '})',
      "describe('import', () => {",
      "  test('saves', () => { expect(1).toBe(2) })",
      '})',
    ].join('\n')
    const jest = [
      'FAIL tests/export.test.js',
      '  ● export › saves',
      '',
      '    TypeError: toMarkdown is not a function',
      '',
      '  ● import › saves',
      '',
      '    expect(received).toBe(expected) // Object.is equality',
    ].join('\n')
    const mocha = [
      '  0 passing (4ms)',
      '  2 failing',
      '',
      '  1) export',
      '       saves:',
      '     TypeError: toMarkdown is not a function',
      '',
      '  2) import',
      '       saves:',
      '     AssertionError [ERR_ASSERTION]: Expected values to be strictly equal',
    ].join('\n')
    const jestPath = 'tests/export.test.js'
    expect(validRed(run(jest, 1, jestPath), jestPath, addedTests(addition(js, 4, 6)), true)).toBe(
      true,
    )
    expect(validRed(run(jest, 1, jestPath), jestPath, addedTests(addition(js, 1, 3)))).toBe(false)
    // mocha prints no file: another file's test may have the same path (#342, round 5).
    const mochaPath = 'test/export.spec.js'
    const mochaRun = run(mocha, 1, mochaPath)
    expect(validRed(mochaRun, mochaPath, addedTests(addition(js, 4, 6)))).toBe(false)
    expect(validRed(mochaRun, mochaPath, addedTests(addition(js, 4, 6)), true)).toBe(true)
    const python = [
      'import unittest',
      'class Export(unittest.TestCase):',
      '    def test_saves(self):',
      '        to_markdown([])',
      'class Import(unittest.TestCase):',
      '    def test_saves(self):',
      '        self.assertEqual(1, 2)',
    ].join('\n')
    const unittest = [
      'ERROR: test_saves (test_export.Export.test_saves)',
      '----------------------------------------------------------------------',
      "NameError: name 'to_markdown' is not defined",
      '',
      'FAIL: test_saves (test_export.Import.test_saves)',
      '----------------------------------------------------------------------',
      'AssertionError: 1 != 2',
    ].join('\n')
    const path = 'test_export.py'
    expect(validRed(run(unittest, 1, path), path, addedTests(addition(python, 5, 7)), true)).toBe(
      true,
    )
    expect(validRed(run(unittest, 1, path), path, addedTests(addition(python, 2, 4)))).toBe(false)
  })

  test('a unittest test with an ERROR beside its FAIL is not a red, a subTest’s or a cleanup’s', () => {
    const path = 'test_ut2.py'
    const output = run(captured('unittest-error-subtest'), 1, path)
    expect(validRed(output, path, ['test_sub'])).toBe(false)
    expect(validRed(output, path, ['test_teardown'])).toBe(false)
    expect(validRed(output, path, ['test_sub'], true)).toBe(false)
  })

  test('a Rust panic is an assertion only when its message says one, a known runtime error is not, any other leaves it to the key line', () => {
    const path = 'src/lib.rs'
    for (const name of ['cargo-test-panics', 'cargo-test-panics-nocapture-v']) {
      const output = run(inLib(captured(name)), 101, path)
      for (const one of RUST_PANICS.asserts) {
        expect([name, one, validRed(output, path, inTests(one))]).toEqual([name, one, true])
      }
      for (const one of RUST_PANICS.errs) {
        expect([name, one, validRed(output, path, inTests(one), true)]).toEqual([name, one, false])
      }
      for (const one of RUST_PANICS.says_nothing) {
        expect([name, one, validRed(output, path, inTests(one))]).toEqual([name, one, false])
        expect([name, one, validRed(output, path, inTests(one), true)]).toEqual([name, one, true])
      }
    }
    // A test that returned `Err` says so under its own heading; with --nocapture, its `Error:`
    // line is no test's, and the key line decides.
    const headed = run(inLib(captured('cargo-test-panics')), 101, path)
    expect(validRed(headed, path, inTests('returns_err'), true)).toBe(false)
    const nocapture = run(captured('cargo-test-panics-nocapture-v'), 101, path)
    expect(validRed(nocapture, path, inTests('returns_err'))).toBe(false)
  })

  test('a Rust panic printed with --nocapture is its thread’s test’s, wherever its result line lands', () => {
    const path = 'src/lib.rs'
    const output = run(inLib(captured('cargo-test-panics-nocapture')), 101, path)
    for (const one of RUST_PANICS.asserts) {
      expect([one, validRed(output, path, inTests(one))]).toEqual([one, true])
    }
    for (const one of ['uses_todo', 'uses_unimplemented', 'unwraps', 'index']) {
      expect([one, validRed(output, path, inTests(one), true)]).toEqual([one, false])
    }
    expect(validRed(output, path, inTests('assert_msg'))).toBe(false)
  })

  test('a cargo-nextest test that hit todo!() is not a red', () => {
    const path = 'src/lib.rs'
    const output = captured('cargo-nextest').replace(
      [
        "    thread 'tests::exports_async' (1510128) panicked at src/lib.rs:30:9:",
        '    assertion `left == right` failed',
      ].join('\n'),
      [
        "    thread 'tests::exports_async' (1510128) panicked at src/lib.rs:1:48:",
        '    not yet implemented',
      ].join('\n'),
    )
    expect(validRed(run(output, 100, path), path, inTests('exports_async'), true)).toBe(false)
    expect(validRed(run(output, 100, path), path, inTests('rejects_empty'))).toBe(true)
  })

  test('a TAP report where another test errors still names the red of the test the proof adds', () => {
    const path = 'tests/export.test.mjs'
    const output = [
      'TAP version 13',
      '# Subtest: one is one',
      'not ok 1 - one is one',
      '  ---',
      "  location: '/work/acme/api/tests/export.test.mjs:3:1'",
      "  failureType: 'testCodeFailure'",
      "  error: 'x is not a function'",
      "  code: 'ERR_TEST_FAILURE'",
      "  name: 'TypeError'",
      '  ...',
      '# Subtest: saves',
      'not ok 2 - saves',
      '  ---',
      "  location: '/work/acme/api/tests/export.test.mjs:9:1'",
      "  failureType: 'testCodeFailure'",
      "  error: 'Expected values to be strictly equal'",
      "  code: 'ERR_ASSERTION'",
      "  name: 'AssertionError'",
      '  ...',
      '1..2',
      '# tests 2',
      '# fail 2',
    ].join('\n')
    expect(validRed(run(output, 1, path), path, ['saves'], true)).toBe(true)
    expect(validRed(run(output, 1, path), path, ['one is one'], true)).toBe(false)
  })

  test('a jest-junit report naming its case by describe and title leaves it to the key line', () => {
    const path = 'tests/export.test.js'
    const output = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<testsuites name="jest tests" tests="1" failures="1">',
      '  <testsuite name="tests/export.test.js" tests="1" failures="1">',
      '    <testcase classname="export saves" name="export saves" time="0.003" file="tests/export.test.js">',
      '      <failure>Error: expect(received).toBe(expected) // Object.is equality',
      'Expected: 2',
      'Received: 1</failure>',
      '    </testcase>',
      '  </testsuite>',
      '</testsuites>',
    ].join('\n')
    expect(validRed(run(output, 1, path), path, ['saves'], true)).toBe(true)
    expect(validRed(run(output, 1, path), path, ['saves'])).toBe(false)
  })

  test('a jest test that called fewer assertions than expect.assertions asked is a red', () => {
    const path = 'tests/a.test.js'
    const output = (said: string) =>
      [
        '  ● saves',
        '',
        `    ${said}`,
        '',
        '      at Object.<anonymous> (tests/a.test.js:3:10)',
      ].join('\n')
    for (const said of [
      'expect.assertions(1)\n\n    Expected one assertion to be called but received zero assertion calls.',
      'expect.hasAssertions()\n\n    Expected at least one assertion to be called but received none.',
    ]) {
      expect(validRed(run(output(said), 1, path), path, ['saves'], true)).toBe(true)
    }
  })

  test('a file’s tests are read with their describes in linear time, nested as deep as they go', () => {
    const code = (size: number) =>
      `${"describe('a', () => {\n".repeat(size)}test('b', () => {})\n${'})\n'.repeat(size)}`
    const read = (text: string) => {
      addedTests({ insertion: 'new_file', code: text, patch: null })
    }
    expect(addedTests({ insertion: 'new_file', code: code(3), patch: null })).toEqual([
      { title: 'b', scope: ['a', 'a', 'a'], twin: false, clash: false },
    ])
    expect(growth(code, 400, read)).toBeLessThan(24)
  })

  test('a test the proof adds whose own failure is another error is not a red, whatever the key line', () => {
    const path = 't.py'
    const output =
      'E   assert 1 == 2\nFAILED t.py::test_one - assert 1 == 2\nFAILED t.py::test_new - NameError'
    expect(validRed(run(output, 1, path), path, ['test_new'], true)).toBe(false)
  })
})

const REGEX_PAREN_SOURCE = [
  "import { describe, expect, test } from 'vite-plus/test'",
  '',
  "describe('a', () => {",
  "  describe('b', () => {",
  '    const closing = /\\)/',
  "    test('saves', () => { expect(closing.test(')')).toBe(true) })",
  '  })',
  "  test('saves', () => { expect(1).toBe(2) })",
  '})',
].join('\n')

const STRING_INDENT_SOURCE = [
  'class TestA:',
  '    class TestB:',
  '        def test_render(self):',
  '            expected = """',
  '    indented four',
  '    """',
  '            assert expected',
  '        def test_saves(self):',
  '            assert 1 == 1',
  '',
  '    def test_report(self):',
  '        expected = """',
  'flush left',
  '"""',
  '        assert expected',
  '',
  '    def test_saves(self):',
  '        assert 1 == 2',
].join('\n')

describe('A name that decides only when read with certainty, the key line deciding any doubt (#342, round 4)', () => {
  test('a patch whose hunks do not place in the code names no test: the key line decides', () => {
    const path = 'export.test.ts'
    const output = run(captured('vitest-same-title'), 1, path)
    // The archive block added below import's, its header two lines off (`git apply` takes it).
    const patch = [
      '--- a/export.test.ts',
      '+++ b/export.test.ts',
      '@@ -9,6 +9,9 @@',
      " describe('import', () => {",
      "   test('saves', () => { expect(1).toBe(2) })",
      ' })',
      "+describe('archive', () => {",
      "+  test('keeps', () => { expect(1).toBe(1) })",
      '+})',
      " describe('restore', () => {",
      "   test('keeps', () => { expect(1).toBe(2) })",
      ' })',
    ].join('\n')
    const names = addedTests({ insertion: 'addition', code: VITEST_SAME_TITLE_SOURCE, patch })
    expect(names.some((name) => Predicate.isString(name))).toBe(false)
    expect(validRed(output, path, names)).toBe(false)
    expect(validRed(output, path, names, true)).toBe(true)
    // Placed exactly, the same patch names its test.
    const placed = patch.replace('@@ -9,6 +9,9 @@', '@@ -7,6 +7,9 @@')
    const exact = addedTests({
      insertion: 'addition',
      code: VITEST_SAME_TITLE_SOURCE,
      patch: placed,
    })
    expect(validRed(output, path, exact)).toBe(false)
  })

  test('a regex literal holding a parenthesis does not move a test into another describe', () => {
    const path = 'paren.test.ts'
    const patch = [
      '--- a/paren.test.ts',
      '+++ b/paren.test.ts',
      '@@ -1,5 +1,9 @@',
      " import { describe, expect, test } from 'vite-plus/test'",
      ' ',
      " describe('a', () => {",
      "+  describe('b', () => {",
      '+    const closing = /\\)/',
      "+    test('saves', () => { expect(closing.test(')')).toBe(true) })",
      '+  })',
      "   test('saves', () => { expect(1).toBe(2) })",
      ' })',
    ].join('\n')
    const adding = { insertion: 'addition' as const, code: REGEX_PAREN_SOURCE, patch }
    expect(addedTests(adding)).toEqual([
      { title: 'saves', scope: ['a', 'b'], twin: true, clash: false },
    ])
    expect(validRed(run(captured('vitest-regex-paren'), 1, path), path, addedTests(adding))).toBe(
      false,
    )
  })

  test('a Python string spanning lines at a lower indentation does not close a class', () => {
    const path = 'tests/test_doc.py'
    const patch = [
      '--- a/tests/test_doc.py',
      '+++ b/tests/test_doc.py',
      '@@ -6,3 +6,5 @@',
      '     """',
      '             assert expected',
      '+        def test_saves(self):',
      '+            assert 1 == 1',
      ' ',
    ].join('\n')
    const names = addedTests({ insertion: 'addition', code: STRING_INDENT_SOURCE, patch })
    expect(names).toEqual([
      { title: 'test_saves', scope: ['TestA', 'TestB'], twin: true, clash: false },
    ])
    expect(validRed(run(captured('pytest-string-indent'), 1, path), path, names)).toBe(false)
  })

  test('a failing test of the same title in another file is not the proof’s test', () => {
    const path = 'export.test.ts'
    const code = [
      "import { expect, test } from 'vite-plus/test'",
      '',
      "test('one is one', () => { expect(1).toBe(1) })",
      "test('exports csv', () => { expect('a,b').toBe('a,b') })",
    ].join('\n')
    const names = addedTests(addition(code, 4, 4))
    expect(validRed(run(captured('vitest-two-files'), 1, path), path, names)).toBe(false)
    // pytest's node id and jest's file line say the file too.
    const pytest = [
      '___ test_saves ___',
      '',
      '    def test_saves():',
      '>       assert 1 == 2',
      'E       assert 1 == 2',
      '',
      'tests/test_other.py:2: AssertionError',
      'FAILED tests/test_other.py::test_saves - assert 1 == 2',
    ].join('\n')
    const python = addedTests({
      insertion: 'new_file',
      code: 'def test_saves():\n    assert 1 == 1\n',
      patch: null,
    })
    const pyPath = 'tests/test_export.py'
    expect(validRed(run(pytest, 1, pyPath), pyPath, python)).toBe(false)
    const jest = [
      'PASS tests/export.test.js',
      'FAIL tests/other.test.js',
      '  ✕ saves (3 ms)',
      '',
      '  ● saves',
      '',
      '    expect(received).toBe(expected) // Object.is equality',
    ].join('\n')
    const js = addedTests({ insertion: 'new_file', code: "test('saves', () => {})\n", patch: null })
    const jsPath = 'tests/export.test.js'
    expect(validRed(run(jest, 1, jsPath), jsPath, js)).toBe(false)
    expect(validRed(run(jest.replace('other', 'export'), 1, jsPath), jsPath, js, true)).toBe(true)
  })

  test('a JavaScript file read with any doubt, a slash or a parenthesis, gives no path: the key line decides', () => {
    const path = 't.test.ts'
    const output = run(' FAIL  t.test.ts > a > saves\nAssertionError: expected 1 to be 2', 1, path)
    for (const doubt of [
      // A slash after a closing brace: a division, or a regex after a block.
      'const o = {}\n  /x/.test("x")',
      // JSX text holding a parenthesis.
      'render(<li>1) step</li>)',
      // A string never closed.
      "const s = 'never closed",
      // Brackets closed by another kind.
      'f(1]\n  g[2)',
      // A call never closed.
      'f(',
    ]) {
      const code = ["describe('a', () => {", `  ${doubt}`, "  test('saves', () => {})", '})'].join(
        '\n',
      )
      const names = addedTests({ insertion: 'new_file', code, patch: null })
      expect([doubt, validRed(output, path, names)]).toEqual([doubt, false])
      expect([doubt, validRed(output, path, names, true)]).toEqual([doubt, true])
    }
    // A describe never closed.
    const open = addedTests({
      insertion: 'new_file',
      code: "describe('a', () => {\n  test('saves', () => {})\n",
      patch: null,
    })
    expect(validRed(output, path, open)).toBe(false)
    // Read for certain, the same file names its test: a division, a regex after a condition.
    const sure = [
      "describe('a', () => {",
      '  const x = (1 + 2) / 3',
      "  if (x) /\\(/.test('(')",
      "  test('saves', () => {})",
      '})',
    ]
    const names = addedTests({ insertion: 'new_file', code: sure.join('\n'), patch: null })
    expect(validRed(output, path, names, true)).toBe(true)
  })

  test('a Python file read with any doubt, a string never closed or a dedent to no block, gives no path', () => {
    const path = 'tests/test_export.py'
    const output = run('FAILED tests/test_export.py::TestA::test_saves - assert 1 == 2', 1, path)
    for (const doubt of [
      ['class TestA:', '    def test_saves(self):', '        x = """never closed'],
      ['class TestA:', '        x = 1', '    def test_saves(self):', '        pass'],
    ]) {
      const names = addedTests({ insertion: 'new_file', code: doubt.join('\n'), patch: null })
      expect([doubt, validRed(output, path, names)]).toEqual([doubt, false])
    }
    // A test read at the top of a file whose indentation opens or closes no block.
    const top = run('FAILED tests/test_export.py::test_saves - assert 1 == 2', 1, path)
    for (const doubt of [
      ['class TestA:', '        x = 1', 'def test_saves():', '    pass', '  y = 2'],
      ['x = 1', '    def test_saves():', '        pass'],
    ]) {
      const names = addedTests({ insertion: 'new_file', code: doubt.join('\n'), patch: null })
      expect([doubt, validRed(top, path, names)]).toEqual([doubt, false])
    }
    const sure = [
      "class TestA:  # the export's tests",
      '    # a comment',
      '    def test_saves(self):',
      '        pass',
    ]
    const names = addedTests({ insertion: 'new_file', code: sure.join('\n'), patch: null })
    expect(validRed(output, path, names, true)).toBe(true)
  })

  test('a test whose title is not one literal names nothing', () => {
    const js = "test('sa' + 'ves', () => {})\n"
    expect(addedTestNames({ insertion: 'new_file', code: js, patch: null })).toEqual([])
  })

  test('a unittest failure of another module’s test of the same class and name is not the proof’s', () => {
    const path = 'test_export.py'
    const code = [
      'import unittest',
      'class Import(unittest.TestCase):',
      '    def test_saves(self):',
      '        self.assertEqual(1, 2)',
    ].join('\n')
    const names = addedTests({ insertion: 'new_file', code, patch: null })
    const output = (module: string) =>
      [
        `FAIL: test_saves (${module}.Import.test_saves)`,
        '----------------------------------------------------------------------',
        'AssertionError: 1 != 2',
      ].join('\n')
    expect(validRed(run(output('test_other'), 1, path), path, names)).toBe(false)
    expect(validRed(run(output('test_export'), 1, path), path, names, true)).toBe(true)
  })

  test('a method named test is not a test, nor a def inside a function', () => {
    const js = "test('saves', () => { expect(/x/.test(')')).toBe(false) })\n"
    expect(addedTestNames({ insertion: 'new_file', code: js, patch: null })).toEqual(['saves'])
    const py = [
      'def test_outer():',
      '    def test_inner():',
      '        pass',
      '    test_inner()',
    ].join('\n')
    expect(addedTestNames({ insertion: 'new_file', code: py, patch: null })).toEqual(['test_outer'])
  })

  test('a Rust test whose name another module of the file repeats is named by nothing: the key line decides', () => {
    const path = 'src/lib.rs'
    const code = [
      'mod a {',
      '    #[test]',
      '    fn eq() { assert_eq!(1, 1); }',
      '}',
      'mod b {',
      '    #[test]',
      '    fn eq() { assert_eq!(1, 2); }',
      '}',
    ].join('\n')
    const output = [
      'test b::eq ... FAILED',
      '',
      'failures:',
      '',
      '---- b::eq stdout ----',
      "thread 'b::eq' panicked at src/lib.rs:7:15:",
      'assertion `left == right` failed',
      '',
      'failures:',
      '    b::eq',
    ].join('\n')
    const names = addedTests(addition(code, 1, 4))
    expect(validRed(run(output, 101, path), path, names)).toBe(false)
    expect(validRed(run(output, 101, path), path, names, true)).toBe(true)
  })

  test('source that never closes a describe.each, a comment or a test.each is read in linear time', () => {
    const read = (code: string) => {
      addedTests({ insertion: 'new_file', code, patch: null })
    }
    for (const unit of ['describe.each(', 'a /* x\n', 'test.each(']) {
      expect([unit, growth((size) => unit.repeat(size), 2_000, read) < 24]).toEqual([unit, true])
    }
  })
})

describe('A generated title and a failure printed with no file, each read only with certainty (#342, round 5)', () => {
  test('a literal title a test.each of its file could produce names no test: the key line decides', () => {
    const path = 'export.test.ts'
    const code = [
      "import { expect, test } from 'vite-plus/test'",
      '',
      "test.each(['csv', 'md'])('exports %s', (kind) => { expect(kind).toBe('txt') })",
      "test('exports csv', () => { expect(1).toBe(1) })",
    ].join('\n')
    const output = run(captured('vitest-each-twin'), 1, path)
    const names = addedTests(addition(code, 4, 4))
    expect(validRed(output, path, names)).toBe(false)
    expect(validRed(output, path, names, false)).toBe(false)
  })

  test('a literal title a loop’s template literal could produce names no test: the key line decides', () => {
    const path = 'loop.test.ts'
    const code = [
      "import { expect, test } from 'vite-plus/test'",
      '',
      "for (const kind of ['csv', 'md']) test(`exports ${kind}`, () => { expect(kind).toBe('txt') })",
      "test('exports csv', () => { expect(1).toBe(1) })",
    ].join('\n')
    const output = run(captured('vitest-loop-titles'), 1, path)
    expect(validRed(output, path, addedTests(addition(code, 4, 4)))).toBe(false)
  })

  test('a test whose title is a variable makes its file uncertain: the key line decides', () => {
    const path = 'loop.test.ts'
    const code = [
      "import { expect, test } from 'vite-plus/test'",
      '',
      "const name = 'saves'",
      'test(name, () => { expect(1).toBe(2) })',
      "test('saves', () => { expect(1).toBe(1) })",
    ].join('\n')
    const output = run(captured('vitest-loop-titles'), 1, path)
    const names = addedTests(addition(code, 5, 5))
    expect(validRed(output, path, names)).toBe(false)
    expect(validRed(output, path, names, true)).toBe(true)
  })

  test('a literal title in a node:test file with a loop’s template literal names no test', () => {
    const path = 'a.test.mjs'
    const code = [
      "import { test } from 'node:test'",
      "import assert from 'node:assert'",
      '',
      "for (const kind of ['csv', 'md']) test(`exports ${kind}`, () => { assert.strictEqual(kind, 'txt') })",
      "test('exports csv', () => {})",
    ].join('\n')
    const output = run(captured('node-loop-titles'), 1, path)
    expect(validRed(output, path, addedTests(addition(code, 5, 5)))).toBe(false)
  })

  test('a template that could produce a literal of its file names no test either', () => {
    const code = [
      "import { expect, test } from 'vite-plus/test'",
      "test.each(['csv', 'md'])('exports %s', (kind) => { expect(kind).toBe('txt') })",
      "test('exports csv', () => { expect(1).toBe(1) })",
    ].join('\n')
    expect(addedTests(addition(code, 2, 2))).toEqual([
      { title: { template: 'exports %s' }, scope: [], twin: true, clash: true },
    ])
  })

  test('a path a describe.each of its file could produce names no test; one only its title shares is told apart by its path', () => {
    const path = 'export.test.ts'
    const code = [
      "describe.each(['csv', 'md'])('export %s', (kind) => { test('saves', () => { expect(kind).toBe('txt') }) })",
      "describe('export csv', () => { test('saves', () => { expect(1).toBe(1) }) })",
      "describe('import', () => { test('saves', () => { expect(1).toBe(2) }) })",
    ].join('\n')
    const failing = (title: string) =>
      run(` FAIL  export.test.ts > ${title}\nAssertionError: expected 1 to be 2`, 1, path)
    const exportCsv = addedTests(addition(code, 2, 2))
    expect(exportCsv).toEqual([{ title: 'saves', scope: ['export csv'], twin: true, clash: true }])
    expect(validRed(failing('export csv > saves'), path, exportCsv)).toBe(false)
    const imported = addedTests(addition(code, 3, 3))
    expect(imported).toEqual([{ title: 'saves', scope: ['import'], twin: true, clash: false }])
    expect(validRed(failing('import > saves'), path, imported, true)).toBe(true)
  })

  test('a template of placeholders alone, or another template, could produce a title: neither names its test', () => {
    const alone = [
      "test.each(['exports csv'])('%s', (title) => { expect(title).toBe('') })",
      "test('exports csv', () => { expect(1).toBe(1) })",
    ].join('\n')
    expect(addedTests(addition(alone, 2, 2))).toEqual([
      { title: 'exports csv', scope: [], twin: true, clash: true },
    ])
    const two = [
      "test.each(['csv'])('exports %s', (kind) => { expect(kind).toBe('') })",
      "for (const kind of ['md']) test(`exports ${kind}`, () => { expect(kind).toBe('') })",
      "test.each(['csv'])('imports %s', (kind) => { expect(kind).toBe('') })",
    ].join('\n')
    expect(addedTests(addition(two, 1, 1))).toEqual([
      { title: { template: 'exports %s' }, scope: [], twin: true, clash: true },
    ])
    expect(addedTests(addition(two, 3, 3))).toEqual([
      { title: { template: 'imports %s' }, scope: [], twin: false, clash: false },
    ])
  })

  test('a describe whose title is not a literal leaves its tests’ paths unknown', () => {
    const code = "const name = 'export'\ndescribe(name, () => { test('saves', () => {}) })"
    expect(addedTests({ insertion: 'new_file', code, patch: null })).toEqual([
      { title: 'saves', scope: null, twin: false, clash: false },
    ])
  })

  test('a literal title no template of its file could produce still names its test', () => {
    const path = 'export.test.ts'
    const code = [
      "import { expect, test } from 'vite-plus/test'",
      "test.each(['csv', 'md'])('exports %s', (kind) => { expect(kind).toBe(kind) })",
      "test('saves', () => { expect(1).toBe(2) })",
    ].join('\n')
    const output = [
      ' FAIL  export.test.ts > saves',
      'AssertionError: expected 1 to be 2 // Object.is equality',
    ].join('\n')
    const names = addedTests(addition(code, 3, 3))
    expect(names).toEqual([{ title: 'saves', scope: [], twin: false, clash: false }])
    expect(validRed(run(output, 1, path), path, names, true)).toBe(true)
  })

  test('node:test’s failing test is read in the file its `test at` line names', () => {
    const output = run(captured('node-two-files'), 1, 'c.test.mjs')
    const added = addedTests({
      insertion: 'new_file',
      code: "import { test } from 'node:test'\n\ntest('saves', () => {})",
      patch: null,
    })
    expect(validRed(output, 'c.test.mjs', added)).toBe(false)
    const failing = addedTests({
      insertion: 'new_file',
      code: "import { test } from 'node:test'\nimport assert from 'node:assert'\n\ntest('saves', () => { assert.strictEqual(1, 2) })",
      patch: null,
    })
    expect(
      validRed(run(captured('node-two-files'), 1, 'b.test.mjs'), 'b.test.mjs', failing, true),
    ).toBe(true)
  })

  test('a bare name is not answered by a section printed with no file when its summary names another file', () => {
    const output = (path: string) => run(captured('pytest-two-files'), 1, path)
    expect(validRed(output('tests/test_a.py'), 'tests/test_a.py', ['test_saves'])).toBe(false)
    expect(validRed(output('tests/test_b.py'), 'tests/test_b.py', ['test_saves'], true)).toBe(true)
  })

  test('a report’s failure is read in its file, so it names a declared test of that file', () => {
    const path = 'tests/export.test.mjs'
    const names = addedTests({
      insertion: 'new_file',
      code: "test('exports as CSV', () => { assert.strictEqual('a,b', 'a;b') })",
      patch: null,
    })
    expect(validRed(run(JUNIT_ASSERTION, 1, path), path, names, true)).toBe(true)
  })

  test('a pytest section printed with no file names no test: the key line decides', () => {
    const path = 'tests/test_a.py'
    const code = 'def test_one_is_one():\n    assert 1 == 1\n\ndef test_saves():\n    assert 1 == 1'
    const names = addedTests(addition(code, 4, 5))
    const output = run(captured('pytest-two-files-rN'), 1, path)
    expect(validRed(output, path, names)).toBe(false)
    expect(validRed(output, path, names, true)).toBe(true)
  })

  test('pytest’s summary line reads its failure in its own file', () => {
    const names = addedTests(addition('def test_saves():\n    assert 1 == 1', 1, 2))
    const failing = addedTests(addition('def test_saves():\n    assert 1 == 2', 1, 2))
    const output = (path: string) => run(captured('pytest-two-files'), 1, path)
    expect(validRed(output('tests/test_a.py'), 'tests/test_a.py', names)).toBe(false)
    expect(validRed(output('tests/test_b.py'), 'tests/test_b.py', failing, true)).toBe(true)
  })

  test('a call with a literal title followed by a block is a test: no method takes a literal parameter', () => {
    const code = "const o = { test('x') { return 1 } }\ntest('y', () => {})"
    expect(addedTests({ insertion: 'new_file', code, patch: null })).toEqual([
      { title: 'x', scope: [], twin: false, clash: false },
      { title: 'y', scope: [], twin: false, clash: false },
    ])
  })

  test('a function or a method of the file’s own named test makes its file uncertain; one taking nothing does not', () => {
    const own = [
      'function test(name) { return name }',
      'class Probe { test(name: string): boolean { return name.length > 0 } }',
      "test('y', () => {})",
    ].join('\n')
    expect(addedTests({ insertion: 'new_file', code: own, patch: null })).toEqual([
      { title: 'y', scope: null, twin: false, clash: false },
    ])
    const zero = "function test() { return 1 }\ntest('y', () => {})"
    expect(addedTests({ insertion: 'new_file', code: zero, patch: null })).toEqual([
      { title: 'y', scope: null, twin: false, clash: false },
    ])
    const method = "class Probe { test() { return 1 } }\ntest('y', () => {})"
    expect(addedTests({ insertion: 'new_file', code: method, patch: null })).toEqual([
      { title: 'y', scope: [], twin: false, clash: false },
    ])
  })

  test('tests beside many test.each templates are read in linear time', () => {
    const read = (code: string) => {
      addedTests({ insertion: 'new_file', code, patch: null })
    }
    const templates = "test.each([1])('saves %s', () => {})\n"
    const beside = (size: number) =>
      `${templates.repeat(60)}${"test('saves x', () => {})\n".repeat(size)}`
    expect(growth(beside, 400, read)).toBeLessThan(24)
    expect(growth((size) => templates.repeat(size), 400, read)).toBeLessThan(24)
  })

  test('describes nested deep, each holding a test, are read in linear time', () => {
    const read = (code: string) => {
      addedTests({ insertion: 'new_file', code, patch: null })
    }
    const nested = (size: number) =>
      `${"describe('d', () => { test('t', () => {})\n".repeat(size)}${'})\n'.repeat(size)}`
    expect(growth(nested, 400, read)).toBeLessThan(24)
    const innermost = (size: number) =>
      `${"describe('d', () => {\n".repeat(size)}${"test('t', () => {})\n".repeat(size)}${'})\n'.repeat(size)}`
    expect(growth(innermost, 400, read)).toBeLessThan(24)
  })
})

describe('A reader certain only of the shapes it knows whole, a template only of what it reads, a title never holding a separator (#342, round 6)', () => {
  const vitest = (lines: ReadonlyArray<string>) =>
    ["import { describe, expect, test } from 'vite-plus/test'", '', ...lines].join('\n')

  test('a test declared through test.extend’s alias leaves its file uncertain: the key line decides', () => {
    const path = 'extend.test.ts'
    const code = vitest([
      "const withKind = test.extend({ kind: 'csv' })",
      "withKind('saves', ({ kind }) => { expect(kind).toBe('md') })",
      "test('saves', () => { expect(1).toBe(1) })",
    ])
    const names = addedTests(addition(code, 5, 5))
    const output = run(captured('vitest-extend-alias'), 1, path)
    expect(validRed(output, path, names)).toBe(false)
    expect(validRed(output, path, names, true)).toBe(true)
  })

  test('a test whose callee is a ternary leaves its file uncertain', () => {
    const path = 'ternary.test.ts'
    const code = vitest([
      ";(process.env.SKIP_SAVES ? test.skip : test)('saves', () => { expect(1).toBe(2) })",
      "test('saves', () => { expect(1).toBe(1) })",
    ])
    const output = run(captured('vitest-ternary-callee'), 1, path)
    expect(validRed(output, path, addedTests(addition(code, 4, 4)))).toBe(false)
  })

  test('a test declared in a ternary’s branch is read, a twin of the test of its title', () => {
    const path = 'ternary2.test.ts'
    const code = vitest([
      'const enabled = true',
      "enabled ? test('saves', () => { expect(1).toBe(2) }) : test.skip('skipped', () => {})",
      "test('saves', () => { expect(1).toBe(1) })",
    ])
    const names = addedTests(addition(code, 5, 5))
    expect(names).toEqual([{ title: 'saves', scope: [], twin: true, clash: true }])
    expect(validRed(run(captured('vitest-ternary-calls'), 1, path), path, names)).toBe(false)
  })

  test('a test with a type argument, test.each<T> or test<T>, leaves its file uncertain', () => {
    const path = 'generic.test.ts'
    const code = vitest([
      "test.each<string>(['csv', 'md'])('exports %s', (kind) => { expect(kind).toBe('txt') })",
      "test('exports csv', () => { expect(1).toBe(1) })",
    ])
    const output = run(captured('vitest-each-generic'), 1, path)
    expect(validRed(output, path, addedTests(addition(code, 4, 4)))).toBe(false)
    const typed = "test<{ a: number }>('saves', () => {})\ntest('saves', () => {})"
    expect(addedTests(addition(typed, 2, 2))).toEqual([
      { title: 'saves', scope: null, twin: false, clash: false },
    ])
  })

  test('a test followed by a block on the next line is still read', () => {
    const code = "test('saves', () => {})\n{\n  const x = 1\n}\ntest('other', () => {})"
    expect(addedTests({ insertion: 'new_file', code, patch: null })).toEqual([
      { title: 'saves', scope: [], twin: false, clash: false },
      { title: 'other', scope: [], twin: false, clash: false },
    ])
  })

  test('node:test’s subtest t.test(…) leaves its file uncertain', () => {
    const path = 'sub.test.mjs'
    const code = [
      "import { test } from 'node:test'",
      "import assert from 'node:assert'",
      '',
      "test('outer', async (t) => {",
      "  await t.test('saves', () => { assert.strictEqual(1, 2) })",
      '})',
      "test('saves', () => {})",
    ].join('\n')
    const output = run(captured('node-subtest'), 1, path)
    expect(validRed(output, path, addedTests(addition(code, 7, 7)))).toBe(false)
  })

  test('a test an imported helper declares is never named from the console: the key line decides, and the reader reads the file as it stands', () => {
    const path = 'helper.test.ts'
    const code = [
      "import { expect, test } from 'vite-plus/test'",
      "import { failingTest } from './helpers.ts'",
      '',
      "failingTest('saves')",
      "test('saves', () => { expect(1).toBe(1) })",
    ].join('\n')
    const names = addedTests(addition(code, 5, 5))
    const output = run(captured('vitest-imported-helper'), 1, path)
    expect(validRed(output, path, names)).toBe(false)
    expect(validRed(output, path, names, true)).toBe(true)
    const nested = [
      "import { describe, test } from 'vite-plus/test'",
      "import * as helpers from './helpers.ts'",
      "describe('export', () => {",
      "  helpers.failingTest('saves')",
      "  test('keeps', () => {})",
      '})',
    ].join('\n')
    expect(addedTests(addition(nested, 5, 5))).toEqual([
      { title: 'keeps', scope: ['export'], twin: false, clash: false },
    ])
    const hooks = [
      "import { beforeEach, describe, expect, test, vi } from 'vite-plus/test'",
      "import { render } from './render.ts'",
      "vi.mock('./store.ts')",
      "describe('export', () => {",
      '  beforeEach(() => { render() })',
      "  test('keeps', () => { expect(render()).toBe(1) })",
      '})',
    ].join('\n')
    expect(addedTests(addition(hooks, 6, 6))).toEqual([
      { title: 'keeps', scope: ['export'], twin: false, clash: false },
    ])
  })

  test('a member the reader does not know leaves its file uncertain, even with a literal title', () => {
    const code = "test.repeats('saves', () => {})\ntest('keeps', () => {})"
    expect(addedTests(addition(code, 2, 2))).toEqual([
      { title: 'keeps', scope: null, twin: false, clash: false },
    ])
  })

  test('node:test required by destructuring keeps its file certain', () => {
    const code = [
      "const { describe, it } = require('node:test')",
      "const assert = require('node:assert')",
      "describe('export', () => {",
      "  it('saves', () => { assert.strictEqual(1, 2) })",
      '})',
    ].join('\n')
    expect(addedTests(addition(code, 4, 4))).toEqual([
      { title: 'saves', scope: ['export'], twin: false, clash: false },
    ])
  })

  test('the test function under another name leaves its file uncertain; a module imported for its effects is left to the report', () => {
    expect(
      addedTests(
        addition("import { test as base } from 'vite-plus/test'\ntest('saves', () => {})", 2, 2),
      ),
    ).toEqual([{ title: 'saves', scope: null, twin: false, clash: false }])
    expect(
      addedTests(addition("import './shared-tests.ts'\ntest('saves', () => {})", 2, 2)),
    ).toEqual([{ title: 'saves', scope: [], twin: false, clash: false }])
  })

  test('a test.each title with %$ is a template its index fills: a literal it could produce names no test', () => {
    const path = 'index.test.ts'
    const code = vitest([
      "test.each(['csv', 'md'])('exports %$', (kind) => { expect(kind).toBe('txt') })",
      "test('exports 1', () => { expect(1).toBe(1) })",
    ])
    const output = run(captured('vitest-each-index'), 1, path)
    expect(validRed(output, path, addedTests(addition(code, 4, 4)))).toBe(false)
  })

  test('a template literal whose ${…} holds a brace produces any title', () => {
    const path = 'interp.test.ts'
    const code = vitest([
      'const label = (row: { kind: string }) => row.kind',
      "for (const kind of ['csv', 'md']) {",
      "  test(`exports ${label({ kind })}`, () => { expect(kind).toBe('txt') })",
      '}',
      "test('exports csv', () => { expect(1).toBe(1) })",
    ])
    const output = run(captured('vitest-interpolated-call'), 1, path)
    expect(validRed(output, path, addedTests(addition(code, 7, 7)))).toBe(false)
    for (const loop of ['`exports ${`${k}`}`', "`exports ${k ?? '}'}`", '`exports ${k}%x`']) {
      const source = `for (const k of ['csv']) test(${loop}, () => {})\ntest('saves', () => {})`
      expect([loop, addedTests(addition(source, 2, 2))]).toEqual([
        loop,
        [{ title: 'saves', scope: [], twin: true, clash: true }],
      ])
    }
  })

  test('a placeholder may stand for an empty value', () => {
    const code = "test.each([''])('exports%s', () => {})\ntest('exports', () => {})"
    expect(addedTests(addition(code, 2, 2))).toEqual([
      { title: 'exports', scope: [], twin: true, clash: true },
    ])
  })

  test('a title holding a runner’s separator makes its file’s paths uncertain: the key line decides', () => {
    const path = 'gt.test.ts'
    const code = vitest([
      "test('a > b', () => { expect(1).toBe(2) })",
      "describe('a', () => {",
      "  test('b', () => { expect(1).toBe(1) })",
      '})',
    ])
    const names = addedTests(addition(code, 4, 6))
    expect(names).toEqual([{ title: 'b', scope: null, twin: false, clash: false }])
    const output = run(captured('vitest-separator-title'), 1, path)
    expect(validRed(output, path, names)).toBe(false)
    expect(validRed(output, path, names, true)).toBe(true)
  })

  test('a template whose placeholder could hold a separator clashes with the path it could print', () => {
    const code = [
      "test.each(['x > b'])('a %s', () => {})",
      "describe('a x', () => { test('b', () => {}) })",
    ].join('\n')
    expect(addedTests(addition(code, 2, 2))).toEqual([
      { title: 'b', scope: ['a x'], twin: false, clash: true },
    ])
  })

  test('imports, member calls and helpers are read in linear time', () => {
    const read = (code: string) => {
      addedTests({ insertion: 'new_file', code, patch: null })
    }
    const inputs: ReadonlyArray<readonly [string, (size: number) => string]> = [
      ['import clauses never closed', (size) => 'import { a,\n'.repeat(size)],
      ['imports', (size) => "import { a } from './a.ts'\n".repeat(size)],
      [
        'helper calls',
        (size) =>
          `import { h } from './h.ts'\n${"h('x')\ndescribe('d', () => { h('y') })\n".repeat(size)}`,
      ],
      ['member calls', (size) => "t.test('x', () => {})\n".repeat(size)],
      ['template braces', (size) => `test(\`a \${f({ a })}\`, () => {})\n`.repeat(size)],
      [
        'long titles beside templates',
        (size) =>
          `${Array.from({ length: 64 }, (_, at) => `test.each([1])('${'a'.repeat(size)}${String(at)} %s', () => {})\n`).join('')}${`test('${'a'.repeat(size)}', () => {})\n`.repeat(64)}`,
      ],
    ]
    for (const [label, make] of inputs) {
      expect([label, growth(make, 400, read) < 24]).toEqual([label, true])
    }
  })
})

/** A fixture file as the runner wrote it: a report or an output. */
const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/proof-runs/${name}`, import.meta.url), 'utf8')

/** A run classified with the report the runner wrote and the test file as it ran. */
const reported = (
  output: string,
  testPath: string,
  reporting: TestReporting,
  found: ReportFound,
  source: string,
) => classifyProofRun({ output, exitCode: 1, testPath, report: { reporting, found, source } })

/** Where Hemera asks each runner for its report: a folder of the run's own, outside the repository. */
const VITEST_REPORT: TestReporting = {
  runner: 'vitest',
  report: { format: 'json', path: '/tmp/hemera-report/report.json' },
}
const NODE_REPORT: TestReporting = {
  runner: 'node',
  report: { format: 'junit', path: '/tmp/hemera-report/report.xml' },
}
const PYTEST_REPORT: TestReporting = {
  runner: 'pytest',
  report: { format: 'junit', path: '/tmp/hemera-report/report.xml' },
}

/** The vitest 5.0.1 run of `export.test.ts`: `saves` fails on an assertion, `keeps` passes, `throws` throws. */
const VITEST_SOURCE = `import { describe, expect, test } from 'vite-plus/test'

describe('export', () => {
  test('saves', () => {
    expect(1).toBe(2)
  })
  test('keeps', () => {
    expect(1).toBe(1)
  })
  test('throws', () => {
    const missing: { run?: () => void } = {}
    missing.run?.call(null)
    ;(missing as unknown as { run: () => void }).run()
  })
})`
/** The pytest 9.1.1 run of `tests/test_export.py`: two assertions fail, one test passes, one throws. */
const PYTEST_SOURCE = `class TestExport:
    def test_saves(self):
        assert 1 == 2

    def test_keeps(self):
        assert 1 == 1

    def test_throws(self):
        missing = None
        missing.run()


def test_alone():
    assert "csv" == "md"`

/** The test a proof adds, as the source reads it: the added lines of a file. */
const addedAt = (code: string, from: number, to: number) => addedTests(addition(code, from, to))

/** vitest's run of `export.test.ts` with Hemera's reporting: its verbose listing, its JSON report. */
const vitestRun = (output = fixture('vitest-verbose.txt'), text = fixture('vitest-verbose.json')) =>
  reported(output, 'export.test.ts', VITEST_REPORT, { kind: 'read', text }, VITEST_SOURCE)
/** pytest's run of `tests/test_export.py` with Hemera's reporting: its `-rA` summary, its JUnit report. */
const pytestRun = (output = fixture('pytest-ra.txt'), text = fixture('pytest-ra.junit.xml')) =>
  reported(output, 'tests/test_export.py', PYTEST_REPORT, { kind: 'read', text }, PYTEST_SOURCE)
/** node's run of `tests/export.test.mjs` with Hemera's reporting: its spec listing, its JUnit report. */
const NODE_SOURCE = fixture('node-report.test.mjs.txt')
const nodeRun = (output = fixture('node-spec.txt'), text = fixture('node-spec.junit.xml')) =>
  reported(output, 'tests/export.test.mjs', NODE_REPORT, { kind: 'read', text }, NODE_SOURCE)

/** The vitest JSON report with one test's result replaced. */
const vitestJsonWith = (
  title: string,
  result: { readonly status: string; readonly failureMessages: ReadonlyArray<string> },
) => {
  const report = JSON.parse(fixture('vitest-verbose.json'))
  for (const file of report.testResults) {
    for (const one of file.assertionResults) {
      if (one.title === title) Object.assign(one, result)
    }
  }
  return JSON.stringify(report)
}

describe('A red named by the report Hemera asks the runner for, its listing agreeing (#342, round 9)', () => {
  test('a vitest JSON report, its verbose listing agreeing, names the added test failed on an assertion: a red with no key line', () => {
    expect(validRed(vitestRun(), 'export.test.ts', addedAt(VITEST_SOURCE, 4, 6))).toBe(true)
  })

  test('a report that names the added test failed on another error, or passed, is no red, whatever the key line', () => {
    expect(validRed(vitestRun(), 'export.test.ts', addedAt(VITEST_SOURCE, 10, 14), true)).toBe(
      false,
    )
    expect(validRed(vitestRun(), 'export.test.ts', addedAt(VITEST_SOURCE, 7, 9), true)).toBe(false)
  })

  test('a pytest JUnit report, its -rA summary agreeing, names a test in a class and one at the top of the module', () => {
    const at = (from: number, to: number) => addedAt(PYTEST_SOURCE, from, to)
    expect(validRed(pytestRun(), 'tests/test_export.py', at(2, 3))).toBe(true)
    expect(validRed(pytestRun(), 'tests/test_export.py', at(13, 14))).toBe(true)
    expect(validRed(pytestRun(), 'tests/test_export.py', at(8, 10), true)).toBe(false)
    expect(validRed(pytestRun(), 'tests/test_export.py', at(5, 6), true)).toBe(false)
  })

  test('a node --test JUnit report, its spec listing agreeing, names a test in a describe and one at the top, by the cause of its failure', () => {
    const at = (from: number, to: number) => addedAt(NODE_SOURCE, from, to)
    expect(validRed(nodeRun(), 'tests/export.test.mjs', at(5, 7))).toBe(true)
    expect(validRed(nodeRun(), 'tests/export.test.mjs', at(13, 16))).toBe(true)
    expect(validRed(nodeRun(), 'tests/export.test.mjs', at(8, 8), true)).toBe(false)
    // Its TypeError's message forges a cause line: every cause must be an assertion.
    expect(validRed(nodeRun(), 'tests/export.test.mjs', at(9, 11), true)).toBe(false)
  })

  test('a report swapped after the runner wrote it is contradicted by the runner’s own listing of the added test', () => {
    const saves =
      "import { expect, test } from 'vite-plus/test'\n\ntest('saves', () => {\n  expect(1).toBe(1)\n})\n"
    const vitest = reported(
      fixture('vitest-swap.txt'),
      'saves.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-swap.json') },
      saves,
    )
    expect(validRed(vitest, 'saves.test.ts', addedAt(saves, 3, 5))).toBe(false)
    const python = 'def test_saves():\n    assert 1 == 1\n'
    const pytest = reported(
      fixture('pytest-swap.txt'),
      'tests/test_saves.py',
      PYTEST_REPORT,
      { kind: 'read', text: fixture('pytest-swap.junit.xml') },
      python,
    )
    expect(validRed(pytest, 'tests/test_saves.py', addedAt(python, 1, 2))).toBe(false)
  })

  test('an added test the console does not list leaves the red to the key line', () => {
    const output = fixture('vitest-verbose.txt').replace(
      /^.*× export\.test\.ts > export > saves.*$/m,
      '',
    )
    const names = addedAt(VITEST_SOURCE, 4, 6)
    expect(validRed(vitestRun(output), 'export.test.ts', names)).toBe(false)
    expect(validRed(vitestRun(output), 'export.test.ts', names, true)).toBe(true)
    const pytest = fixture('pytest-ra.txt').replace(
      /^FAILED tests\/test_export\.py::TestExport::test_saves.*$/m,
      '',
    )
    expect(validRed(pytestRun(pytest), 'tests/test_export.py', addedAt(PYTEST_SOURCE, 2, 3))).toBe(
      false,
    )
  })

  test('a node title two tests share, one ending otherwise than the listing shows, leaves the red to the key line', () => {
    const code = `${NODE_SOURCE}\ntest('saves', () => {})\n`
    const classified = reported(
      fixture('node-spec.txt'),
      'tests/export.test.mjs',
      NODE_REPORT,
      {
        kind: 'read',
        text: fixture('node-spec.junit.xml').replace(
          '</testsuites>',
          '<testcase name="saves" classname="test" file="/work/acme/api/tests/export.test.mjs"/></testsuites>',
        ),
      },
      code,
    )
    expect(validRed(classified, 'tests/export.test.mjs', addedAt(code, 5, 7))).toBe(false)
  })

  test('a listing that gives another test of the file a status the report does not leaves the red to the key line', () => {
    const vitest = fixture('vitest-verbose.txt').replace(
      '✓ export.test.ts > export > keeps',
      '× export.test.ts > export > keeps',
    )
    expect(validRed(vitestRun(vitest), 'export.test.ts', addedAt(VITEST_SOURCE, 4, 6))).toBe(false)
    const pytest = `${fixture('pytest-ra.txt')}\nFAILED tests/test_export.py::TestExport::test_keeps - assert 1 == 2`
    expect(validRed(pytestRun(pytest), 'tests/test_export.py', addedAt(PYTEST_SOURCE, 2, 3))).toBe(
      false,
    )
    const node = `${fixture('node-spec.txt')}\n  ✖ keeps (0.1ms)`
    expect(validRed(nodeRun(node), 'tests/export.test.mjs', addedAt(NODE_SOURCE, 5, 7))).toBe(false)
  })

  test('a report that says the added test failed on an assertion while the console shows another error is no red', () => {
    const text = vitestJsonWith('throws', {
      status: 'failed',
      failureMessages: ['AssertionError: expected 1 to be 2'],
    })
    expect(
      validRed(vitestRun(undefined, text), 'export.test.ts', addedAt(VITEST_SOURCE, 10, 14), true),
    ).toBe(false)
  })

  test('a JSON failure that also holds another error, or holds no message at all, is no assertion', () => {
    for (const failureMessages of [
      ['AssertionError: expected 1 to be 2', 'TypeError: rows.map is not a function'],
      [],
    ]) {
      const text = vitestJsonWith('saves', { status: 'failed', failureMessages })
      expect([
        failureMessages,
        validRed(vitestRun(undefined, text), 'export.test.ts', addedAt(VITEST_SOURCE, 4, 6), true),
      ]).toEqual([failureMessages, false])
    }
  })

  test('a node failure with no cause, a timeout, is no assertion', () => {
    const xml = fixture('node-spec.junit.xml')
    const saves = xml.indexOf('<testcase name="saves"')
    const end = xml.indexOf('</testcase>', saves)
    const failure = xml.slice(saves, end).replace(/\n\s*cause: [\s\S]*?(?=\n\s*})/, '')
    const text = `${xml.slice(0, saves)}${failure}${xml.slice(end)}`
    expect(text).not.toBe(xml)
    expect(
      validRed(nodeRun(undefined, text), 'tests/export.test.mjs', addedAt(NODE_SOURCE, 5, 7), true),
    ).toBe(false)
  })

  test('a pytest failure raised by pytest.fail, and a pytest error whose traceback ends on an AssertionError, are no assertion', () => {
    const xml = fixture('pytest-ra.junit.xml')
    const failed = xml.replace(
      'tests/test_export.py:3: AssertionError',
      'tests/test_export.py:3: Failed',
    )
    expect(failed).not.toBe(xml)
    const at = addedAt(PYTEST_SOURCE, 2, 3)
    expect(validRed(pytestRun(undefined, failed), 'tests/test_export.py', at, true)).toBe(false)
    const saves = xml.indexOf('name="test_saves"')
    const open = xml.indexOf('<failure', saves)
    const close = xml.indexOf('</failure>', saves)
    const errored = `${xml.slice(0, open)}<error${xml.slice(open + '<failure'.length, close)}</error>${xml.slice(close + '</failure>'.length)}`
    expect(validRed(pytestRun(undefined, errored), 'tests/test_export.py', at, true)).toBe(false)
  })

  test('two added tests, one failing on an assertion and one on another error, are no red', () => {
    expect(validRed(vitestRun(), 'export.test.ts', addedAt(VITEST_SOURCE, 4, 14), true)).toBe(false)
  })

  test('an added test the report shows skipped is left to the key line', () => {
    const text = vitestJsonWith('saves', { status: 'skipped', failureMessages: [] })
    const output = fixture('vitest-verbose.txt').replace(
      '× export.test.ts > export > saves 5ms',
      '↓ export.test.ts > export > saves',
    )
    const names = addedAt(VITEST_SOURCE, 4, 6)
    expect(validRed(vitestRun(output, text), 'export.test.ts', names)).toBe(false)
    expect(validRed(vitestRun(output, text), 'export.test.ts', names, true)).toBe(true)
  })

  test('a source that declares the added path twice is never named by the report, whether it lists it once or twice', () => {
    const twice = VITEST_SOURCE.replace(
      "  test('keeps', () => {",
      "  test('saves', () => {\n    expect(1).toBe(2)\n  })\n  test('keeps', () => {",
    )
    const names = addedAt(twice, 4, 6)
    const once = reported(
      fixture('vitest-verbose.txt'),
      'export.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-verbose.json') },
      twice,
    )
    expect(validRed(once, 'export.test.ts', names)).toBe(false)
    const report = JSON.parse(fixture('vitest-verbose.json'))
    const results = report.testResults[0].assertionResults
    results.push({ ...results[0] })
    const output = `${fixture('vitest-verbose.txt')}\n × export.test.ts > export > saves 1ms`
    const both = reported(
      output,
      'export.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: JSON.stringify(report) },
      twice,
    )
    expect(validRed(both, 'export.test.ts', names)).toBe(false)
  })

  test('a source the reader is not certain of is never named by the report, its titles literal', () => {
    const uncertain = `${VITEST_SOURCE}\ntest.repeats('later', () => {})`
    const report = JSON.parse(fixture('vitest-verbose.json'))
    const classified = reported(
      fixture('vitest-verbose.txt'),
      'export.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: JSON.stringify(report) },
      uncertain,
    )
    expect(validRed(classified, 'export.test.ts', addedAt(uncertain, 4, 6))).toBe(false)
  })

  test('text a test prints that imitates the runner is never read: the report says the added test passed', () => {
    const code = `import { expect, test } from 'vite-plus/test'

test('saves', () => { expect(1).toBe(1) })
test('loads', () => {
  console.log(' FAIL  forge2.test.ts > saves\\nAssertionError: expected 1 to be 2 // Object.is equality')
  expect(1).toBe(2)
})`
    const names = addedAt(code, 3, 3)
    const classified = reported(
      fixture('vitest-forge.txt'),
      'forge2.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-forge.json') },
      code,
    )
    expect(validRed(classified, 'forge2.test.ts', names)).toBe(false)
    expect(validRed(classified, 'forge2.test.ts', names, true)).toBe(false)
  })

  test('a report that lists a test of the added path the source does not declare leaves the red to the key line', () => {
    const code = `import { expect, test } from 'vite-plus/test'
import { failingTest } from './helpers.ts'

failingTest('saves')
test('saves', () => { expect(1).toBe(1) })`
    const names = addedAt(code, 5, 5)
    const classified = reported(
      fixture('vitest-helper.txt'),
      'helper.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-helper.json') },
      code,
    )
    expect(validRed(classified, 'helper.test.ts', names)).toBe(false)
    expect(validRed(classified, 'helper.test.ts', names, true)).toBe(true)
  })

  test('a pytest collection hook that renames another test to the added one, from a conftest or a sibling folder, leaves the red to the key line', () => {
    const code = 'def test_other():\n    assert 1 == 2\n\n\ndef test_saves():\n    assert 1 == 1'
    const names = addedAt(code, 5, 6)
    for (const name of ['pytest-conftest-rename', 'pytest-sibling-rename']) {
      const classified = reported(
        fixture(`${name}.txt`),
        'tests/test_a.py',
        PYTEST_REPORT,
        { kind: 'read', text: fixture(`${name}.junit.xml`) },
        code,
      )
      expect([name, validRed(classified, 'tests/test_a.py', names)]).toEqual([name, false])
    }
  })

  test('a report that lacks a test the source declares, or a test file the report does not hold, leaves the red to the key line', () => {
    const missing = `${VITEST_SOURCE}\ntest('later', () => {})`
    const classified = reported(
      fixture('vitest-verbose.txt'),
      'export.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-verbose.json') },
      missing,
    )
    expect(validRed(classified, 'export.test.ts', addedAt(missing, 4, 6))).toBe(false)
    const elsewhere = reported(
      fixture('vitest-verbose.txt'),
      'import.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-verbose.json') },
      VITEST_SOURCE,
    )
    expect(validRed(elsewhere, 'import.test.ts', addedAt(VITEST_SOURCE, 4, 6))).toBe(false)
  })

  test('a report holds only the tests of its own file: another file, of the same name elsewhere or of the same module name, is not read as it', () => {
    const json = JSON.parse(fixture('vitest-verbose.json'))
    const ours = json.testResults[0]
    json.testResults = [
      { ...ours, name: '/work/acme/api/other/export.test.ts' },
      { ...ours, name: '/work/acme/api/import.test.ts' },
    ]
    expect(reportedTests(VITEST_REPORT, JSON.stringify(json), 'tests/export.test.ts')).toEqual([])
    json.testResults = [ours, { ...ours, name: '/work/acme/api/import.test.ts' }]
    expect(reportedTests(VITEST_REPORT, JSON.stringify(json), 'export.test.ts')?.length).toBe(3)
    const xml = fixture('pytest-ra.junit.xml').replaceAll(
      'classname="tests.test_export',
      'classname="tests.test_import',
    )
    expect(reportedTests(PYTEST_REPORT, xml, 'tests/test_export.py')).toEqual([])
  })

  test('a report that is missing, truncated, does not parse, is too large or older than the run leaves the red to the key line', () => {
    const json = fixture('vitest-verbose.json')
    const names = addedAt(VITEST_SOURCE, 4, 6)
    for (const found of [
      { kind: 'unreadable', reason: 'missing' },
      { kind: 'unreadable', reason: 'older than the run' },
      { kind: 'unreadable', reason: 'over its size cap' },
      { kind: 'read', text: json.slice(0, json.length / 2) },
      { kind: 'read', text: '{ "testResults": [' },
      { kind: 'read', text: '' },
    ] as const) {
      const classified = reported(
        fixture('vitest-verbose.txt'),
        'export.test.ts',
        VITEST_REPORT,
        found,
        VITEST_SOURCE,
      )
      expect([found, validRed(classified, 'export.test.ts', names)]).toEqual([found, false])
      expect([found, validRed(classified, 'export.test.ts', names, true)]).toEqual([found, true])
    }
  })

  test('a JUnit report cut short, or holding CDATA, a doctype or a comment never closed, is not read', () => {
    const xml = fixture('pytest-ra.junit.xml')
    const at = addedAt(PYTEST_SOURCE, 2, 3)
    for (const text of [
      xml.slice(0, xml.indexOf('</testsuite>')),
      xml.replace('</testsuites>', ''),
      xml.replace('<testsuites', '<!DOCTYPE testsuites><testsuites'),
      xml.replace('assert 1 == 2', '<![CDATA[assert 1 == 2]]>'),
      `${xml}\n<!-- never closed`,
    ]) {
      expect([
        text.slice(-40),
        validRed(pytestRun(undefined, text), 'tests/test_export.py', at),
      ]).toEqual([text.slice(-40), false])
    }
  })

  test('a JUnit report nested deeper than 64 suites is not read, in bounded memory', () => {
    const depth = 16_000
    const text = `<testsuites>${'<testsuite name="s">'.repeat(depth)}${'<testcase name="t" classname="test" file="/work/acme/api/tests/export.test.mjs"/>'.repeat(depth)}${'</testsuite>'.repeat(depth)}</testsuites>`
    const before = process.memoryUsage().heapUsed
    expect(reportedTests(NODE_REPORT, text, 'tests/export.test.mjs')).toBeNull()
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(256 * 1024 * 1024)
    const shallow = `<testsuites>${'<testsuite name="s">'.repeat(64)}<testcase name="t" classname="test" file="/work/acme/api/tests/export.test.mjs"/>${'</testsuite>'.repeat(64)}</testsuites>`
    expect(reportedTests(NODE_REPORT, shallow, 'tests/export.test.mjs')?.length).toBe(1)
    // One suite deeper, its one test's path far under the paths' cap, is not read either.
    const deeper = `<testsuites>${'<testsuite name="s">'.repeat(65)}<testcase name="t" classname="test" file="/work/acme/api/tests/export.test.mjs"/>${'</testsuite>'.repeat(65)}</testsuites>`
    expect(reportedTests(NODE_REPORT, deeper, 'tests/export.test.mjs')).toBeNull()
  })

  test('the report reader names each test of the file by its path, with how it ended', () => {
    expect(
      reportedTests(NODE_REPORT, fixture('node-spec.junit.xml'), 'tests/export.test.mjs'),
    ).toEqual([
      { key: 'export > saves', verdict: 'assertion' },
      { key: 'export > keeps', verdict: 'passed' },
      // Its TypeError's message prints a cause line of an assertion: one cause that is not makes it an error.
      { key: 'export > throws', verdict: 'error' },
      { key: 'the scenario holds', verdict: 'assertion' },
    ])
    expect(
      reportedTests(PYTEST_REPORT, fixture('pytest-ra.junit.xml'), 'tests/test_export.py'),
    ).toEqual([
      { key: 'TestExport::test_saves', verdict: 'assertion' },
      { key: 'TestExport::test_keeps', verdict: 'passed' },
      // An AttributeError is an error, whatever its name ends with.
      { key: 'TestExport::test_throws', verdict: 'error' },
      { key: 'test_alone', verdict: 'assertion' },
    ])
    expect(reportedTests(VITEST_REPORT, fixture('vitest-verbose.json'), 'export.test.ts')).toEqual([
      { key: 'export > saves', verdict: 'assertion' },
      { key: 'export > keeps', verdict: 'passed' },
      { key: 'export > throws', verdict: 'error' },
    ])
  })

  test('a JUnit name written with an entity is read as the title it stands for', () => {
    const text =
      '<testsuites><testsuite name="export"><testcase name="saves &amp; loads &quot;csv&quot;" classname="test" file="/work/acme/api/tests/a.test.mjs"/></testsuite></testsuites>'
    expect(reportedTests(NODE_REPORT, text, 'tests/a.test.mjs')).toEqual([
      { key: 'export > saves & loads "csv"', verdict: 'passed' },
    ])
  })

  test('a JUnit report with a comment never closed before its tests is not read', () => {
    const xml = fixture('pytest-ra.junit.xml')
    const open = xml.replace('<testcase ', '<!-- <testcase ')
    expect(open).not.toBe(xml)
    const at = addedAt(PYTEST_SOURCE, 2, 3)
    expect(validRed(pytestRun(undefined, xml), 'tests/test_export.py', at)).toBe(true)
    expect(validRed(pytestRun(undefined, open), 'tests/test_export.py', at)).toBe(false)
  })

  test('a file as it ran that the reader is not certain of is never named by the report, even when the proof’s code is read for certain', () => {
    const uncertain = `${VITEST_SOURCE}
const rows = [1, 2)`
    const classified = reported(
      fixture('vitest-verbose.txt'),
      'export.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-verbose.json') },
      uncertain,
    )
    expect(validRed(classified, 'export.test.ts', addedAt(VITEST_SOURCE, 4, 6))).toBe(false)
    const certain = reported(
      fixture('vitest-verbose.txt'),
      'export.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-verbose.json') },
      VITEST_SOURCE,
    )
    expect(validRed(certain, 'export.test.ts', addedAt(VITEST_SOURCE, 4, 6))).toBe(true)
  })

  test('an added path the file declares twice is never named, even when the listing shows both failing and the report names one an assertion', () => {
    const twice = VITEST_SOURCE.replace(
      "  test('keeps', () => {",
      "  test('saves', () => {\n    expect(1).toBe(2)\n  })\n  test('keeps', () => {",
    )
    const report = JSON.parse(fixture('vitest-verbose.json'))
    const results = report.testResults[0].assertionResults
    results.push({ ...results[0], failureMessages: ['TypeError: rows.map is not a function'] })
    const output = `${fixture('vitest-verbose.txt')}\n × export.test.ts > export > saves 1ms`
    const classified = reported(
      output,
      'export.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: JSON.stringify(report) },
      twice,
    )
    expect(validRed(classified, 'export.test.ts', addedAt(twice, 4, 6))).toBe(false)
  })

  test('a test’s output glued before the runner’s own line, however long, never hides it', () => {
    const code =
      "import { expect, test } from 'vite-plus/test'\n\ntest('saves', () => {\n  expect(1).toBe(1)\n})\n"
    for (const glued of ['junk ✓ x × saves.test.ts > saves ', `${'x'.repeat(5_000)}`]) {
      const output = fixture('vitest-swap.txt')
        .replace(' ✓ saves.test.ts > saves', `${glued} ✓ saves.test.ts > saves`)
        .concat('\n × saves.test.ts > saves 1ms\n')
      const classified = reported(
        output,
        'saves.test.ts',
        VITEST_REPORT,
        { kind: 'read', text: fixture('vitest-swap.json') },
        code,
      )
      expect([glued.length, validRed(classified, 'saves.test.ts', addedAt(code, 3, 5))]).toEqual([
        glued.length,
        false,
      ])
    }
  })

  test('a test of the same path in another file the run lists does not count against the test file’s', () => {
    const output = `${fixture('vitest-verbose.txt')}\n ✓ import.test.ts > export > saves 1ms`
    expect(validRed(vitestRun(output), 'export.test.ts', addedAt(VITEST_SOURCE, 4, 6))).toBe(true)
  })

  test('a pytest test the summary lists as an ERROR agrees with a report that says it failed', () => {
    const output = fixture('pytest-ra.txt').replace(
      'FAILED tests/test_export.py::TestExport::test_throws',
      'ERROR tests/test_export.py::TestExport::test_throws',
    )
    expect(output).not.toBe(fixture('pytest-ra.txt'))
    expect(validRed(pytestRun(output), 'tests/test_export.py', addedAt(PYTEST_SOURCE, 2, 3))).toBe(
      true,
    )
  })

  test('a report too large or older than the run is refused before it is read', () => {
    const reads: string[] = []
    const read = () => {
      reads.push('read')
      return '<testsuites></testsuites>'
    }
    expect(foundReport(null, 1_000, read)).toEqual({ kind: 'unreadable', reason: 'missing' })
    expect(foundReport({ size: REPORT_CAP + 1, modifiedMs: 2_000 }, 1_000, read)).toEqual({
      kind: 'unreadable',
      reason: 'over its size cap',
    })
    expect(foundReport({ size: 10, modifiedMs: 999 }, 1_000, read)).toEqual({
      kind: 'unreadable',
      reason: 'older than the run',
    })
    expect(reads).toEqual([])
    expect(foundReport({ size: 10, modifiedMs: 1_000 }, 1_000, read)).toEqual({
      kind: 'read',
      text: '<testsuites></testsuites>',
    })
  })

  test('a report in a format its runner is not read in, or an added test the source does not read whole, leaves the red to the key line', () => {
    const names = addedAt(VITEST_SOURCE, 4, 6)
    for (const reporting of [
      { runner: 'vitest', report: { format: 'junit', path: 'report.xml' } },
      { runner: 'jest', report: { format: 'json', path: 'report.json' } },
      { runner: 'node', report: { format: 'json', path: 'report.json' } },
      { runner: 'pytest', report: { format: 'json', path: 'report.json' } },
      { runner: 'vitest' },
    ] as const) {
      const classified = reported(
        fixture('vitest-verbose.txt'),
        'export.test.ts',
        reporting,
        { kind: 'read', text: fixture('vitest-verbose.json') },
        VITEST_SOURCE,
      )
      expect([reporting, validRed(classified, 'export.test.ts', names)]).toEqual([reporting, false])
    }
    const each = VITEST_SOURCE.replace(
      "test('saves', () => {",
      "test.each([1])('saves %s', () => {",
    )
    const classified = reported(
      fixture('vitest-verbose.txt'),
      'export.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-verbose.json') },
      each,
    )
    expect(validRed(classified, 'export.test.ts', addedAt(each, 4, 6))).toBe(false)
  })

  test('without a report, a JavaScript or Python test named failing on an assertion by the console is left to the key line', () => {
    const plain = classifyProofRun({
      output: fixture('vitest-verbose.txt'),
      exitCode: 1,
      testPath: 'export.test.ts',
    })
    const names = addedAt(VITEST_SOURCE, 4, 6)
    expect(validRed(plain, 'export.test.ts', names)).toBe(false)
    expect(validRed(plain, 'export.test.ts', names, true)).toBe(true)
    // The console still refuses a test it shows failing on another error.
    expect(validRed(plain, 'export.test.ts', addedAt(VITEST_SOURCE, 10, 14), true)).toBe(false)
  })

  test('the round-6 review’s rows, run without a report, are left to the key line', () => {
    for (const [name, path] of [
      ['vitest-barrel', 'barrel.test.ts'],
      ['vitest-dynamic-import', 'dynamic.test.ts'],
      ['vitest-local-function', 'local.test.ts'],
      ['vitest-arrow-describe', 'arrow.test.ts'],
      ['vitest-foreach-helper', 'foreach.test.ts'],
      ['vitest-assigned-helper', 'assign.test.ts'],
      ['vitest-if-helper', 'ifblock.test.ts'],
      ['vitest-module-tests', 'binding.test.ts'],
      ['vitest-setup-global', 'global.test.ts'],
      ['vitest-setup-declares', 'own.test.ts'],
      ['vitest-create-require', 'require.test.ts'],
      ['node-require-helper', 'req.test.cjs'],
      ['node-require-alias', 'alias.test.cjs'],
      ['node-import-default', 'alias2.test.mjs'],
      ['jest-require-helper', 'helper.test.js'],
    ] as const) {
      const code = "import { test } from 'vite-plus/test'\n\ntest('saves', () => {})"
      const classified = classifyProofRun({ output: captured(name), exitCode: 1, testPath: path })
      expect([name, validRed(classified, path, addedAt(code, 3, 3))]).toEqual([name, false])
    }
  })

  test('a report is read in linear time, its tests compared with the file’s and the listing’s once', () => {
    const titles = (size: number) => Array.from({ length: size }, (_, at) => `t${String(at)}`)
    const make = (size: number) =>
      JSON.stringify({
        testResults: [
          {
            name: '/work/acme/api/export.test.ts',
            assertionResults: titles(size).map((title) => ({
              ancestorTitles: ['export'],
              title,
              status: 'failed',
              failureMessages: ['AssertionError: e'],
            })),
          },
        ],
      })
    const sources = new Map<string, readonly [string, string]>()
    const read = (text: string) => {
      const [code, output] = sources.get(String(text.length)) ?? ['', '']
      reported(output, 'export.test.ts', VITEST_REPORT, { kind: 'read', text }, code)
    }
    const built = (size: number) => {
      const text = make(size)
      sources.set(String(text.length), [
        `describe('export', () => {\n${titles(size)
          .map((title) => `test('${title}', () => {})`)
          .join('\n')}\n})`,
        titles(size)
          .map((title) => ` × export.test.ts > export > ${title} 1ms`)
          .join('\n'),
      ])
      return text
    }
    expect(growth(built, 400, read)).toBeLessThan(24)
  })

  test('a report’s long attribute names, a pytest failure’s long last line and the listing’s lines are read in linear time', () => {
    const inputs: ReadonlyArray<readonly [string, (size: number) => string, TestReporting]> = [
      [
        'an attribute name never given a value',
        (size) =>
          `<testsuites><testsuite><testcase classname="test" ${'a'.repeat(size * 40)}></testcase></testsuite></testsuites>`,
        NODE_REPORT,
      ],
      [
        'a last traceback line of many locations',
        (size) =>
          `<testsuites><testsuite><testcase classname="tests.test_export" name="test_saves"><failure message="m">x:1: ${'a:1: '.repeat(size * 8)}!</failure></testcase></testsuite></testsuites>`,
        PYTEST_REPORT,
      ],
    ]
    for (const [label, make, reporting] of inputs) {
      const read = (text: string) => {
        reported('', 'tests/test_export.py', reporting, { kind: 'read', text }, '')
      }
      expect([label, growth(make, 400, read) < 24]).toEqual([label, true])
    }
    // Each line's length grows, up to the cap a line is cut to.
    for (const [label, make, reporting, path] of [
      [
        'spaces in a ✓ line',
        (size: number) => ` ✓ a${' '.repeat(size)}b\n`.repeat(20),
        VITEST_REPORT,
        'export.test.ts',
      ],
      [
        'ids in a PASSED line',
        (size: number) => `PASSED ${'a::'.repeat(size / 4)}b x\n`.repeat(20),
        PYTEST_REPORT,
        'tests/test_export.py',
      ],
      [
        'spaces and brackets in a ✔ line',
        (size: number) => ` ✔ a${' ('.repeat(size / 2)}b\n`.repeat(20),
        NODE_REPORT,
        'tests/export.test.mjs',
      ],
    ] as const) {
      const listed = (output: string) => {
        reported(
          output,
          path,
          reporting,
          { kind: 'read', text: fixture('vitest-verbose.json') },
          VITEST_SOURCE,
        )
      }
      expect([label, growth(make, 400, listed) < 24]).toEqual([label, true])
    }
  })

  test('a template holding many ${ never closed is read in linear time', () => {
    const read = (code: string) => {
      addedTests({ insertion: 'new_file', code, patch: null })
    }
    const template = (size: number) =>
      `test.each([1])('${'${'.repeat(size)}', () => {})\ntest('a', () => {})`
    expect(growth(template, 20_000, read)).toBeLessThan(24)
  })

  test('twenty thousand awaits before a call are read without exhausting the stack', () => {
    const code = `import { test } from 'vite-plus/test'\n${'await '.repeat(20_000)}h('x')\ntest('saves', () => {})`
    expect(addedTests(addition(code, 3, 3))).toEqual([
      { title: 'saves', scope: [], twin: false, clash: false },
    ])
  })

  test('vitest’s %$ is a placeholder read whole: its template makes no title unlike its own', () => {
    const code = "test.each([1])('exports %$', () => {})\ntest('saves', () => {})"
    expect(addedTests(addition(code, 2, 2))).toEqual([
      { title: 'saves', scope: [], twin: false, clash: false },
    ])
  })

  test('a bracket closed by a bracket of another kind leaves the file uncertain', () => {
    const code = "test('keeps', () => { const rows = [1, 2) })\ntest('saves', () => {})"
    expect(addedTests(addition(code, 2, 2))).toEqual([
      { title: 'saves', scope: null, twin: false, clash: false },
    ])
  })
})

describe('What a test threw, as its runner and its report say it (#342, round 10)', () => {
  /** A file of one test, `saves`, whose body is `body`. */
  const vitestFile = (body: string) =>
    `import { test } from 'vite-plus/test'\n\ntest('saves', () => {\n${body}\n})\n`

  test('a vitest test that throws a string reading like an assertion is no red, whatever the key line', () => {
    const code = vitestFile("  throw 'AssertionError: expected 1 to be 2'")
    const classified = reported(
      fixture('vitest-string.txt'),
      'saves.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-string.json') },
      code,
    )
    expect(validRed(classified, 'saves.test.ts', addedAt(code, 3, 5))).toBe(false)
    expect(validRed(classified, 'saves.test.ts', addedAt(code, 3, 5), true)).toBe(false)
  })

  test('an error renamed AssertionError is an assertion, as its name says: the test’s honesty is not the classifier’s to judge', () => {
    const code = vitestFile(
      "  const failure = new TypeError('expected 1 to be 2')\n  failure.name = 'AssertionError'\n  throw failure",
    )
    const classified = reported(
      fixture('vitest-renamed.txt'),
      'saves.test.ts',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-renamed.json') },
      code,
    )
    expect(validRed(classified, 'saves.test.ts', addedAt(code, 3, 7))).toBe(true)
  })

  test('a node test that throws a string, or an object named AssertionError, is no red, whatever the key line', () => {
    for (const [path, code] of [
      [
        'tests/string.test.mjs',
        "import { test } from 'node:test'\n\ntest('saves', () => {\n  throw 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal'\n})\n",
      ],
      [
        'tests/object.test.mjs',
        "import { test } from 'node:test'\n\ntest('saves', () => {\n  throw { name: 'AssertionError', message: 'x', toString() { return 'AssertionError: x' } }\n})\n",
      ],
    ] as const) {
      const classified = reported(
        fixture('node-thrown.txt'),
        path,
        NODE_REPORT,
        { kind: 'read', text: fixture('node-thrown.junit.xml') },
        code,
      )
      expect([path, validRed(classified, path, addedAt(code, 3, 5), true)]).toEqual([path, false])
    }
  })

  test('a pytest test that raises a string is no red; an exception class of its own named AssertionError is an assertion', () => {
    const code =
      'def test_saves():\n    raise "AssertionError: assert 1 == 2"\n\n\ndef test_keeps():\n    class AssertionError(Exception):\n        pass\n\n    raise AssertionError("assert 1 == 2")\n'
    const classified = reported(
      fixture('pytest-raised.txt'),
      'tests/test_raised.py',
      PYTEST_REPORT,
      { kind: 'read', text: fixture('pytest-raised.junit.xml') },
      code,
    )
    expect(validRed(classified, 'tests/test_raised.py', addedAt(code, 1, 2), true)).toBe(false)
    expect(validRed(classified, 'tests/test_raised.py', addedAt(code, 5, 9))).toBe(true)
  })

  test('a pytest test of the same id in another file the summary lists does not count against the test file’s', () => {
    const output = `${fixture('pytest-ra.txt')}\nPASSED tests/other/test_export.py::TestExport::test_saves`
    expect(validRed(pytestRun(output), 'tests/test_export.py', addedAt(PYTEST_SOURCE, 2, 3))).toBe(
      true,
    )
  })

  test('a test of the file that the listing and the report both show skipped agrees with the report', () => {
    const text = vitestJsonWith('keeps', { status: 'skipped', failureMessages: [] })
    const output = fixture('vitest-verbose.txt').replace(
      '✓ export.test.ts > export > keeps 0ms',
      '↓ export.test.ts > export > keeps',
    )
    expect(output).not.toBe(fixture('vitest-verbose.txt'))
    expect(validRed(vitestRun(output, text), 'export.test.ts', addedAt(VITEST_SOURCE, 4, 6))).toBe(
      true,
    )
  })
})

/**
 * A worker that classifies the run it is given and posts how long that took and how many tests
 * the report names (null when it is not read).
 */
const CLASSIFY_IN_WORKER = `
import { parentPort, workerData } from 'node:worker_threads'
const { classifyProofRun } = await import(workerData.module)
const started = performance.now()
const { reported } = classifyProofRun(workerData.run)
parentPort.postMessage({ ms: performance.now() - started, reported: reported === null ? null : reported.length })
`

/**
 * A run classified in a worker whose heap is capped at `heapMb`: a report that takes more ends the
 * worker, never the process, and the promise rejects.
 */
const classifiedInHeap = (classified: Parameters<typeof classifyProofRun>[0], heapMb: number) =>
  new Promise<{ readonly ms: number; readonly reported: number | null }>((resolve, reject) => {
    const worker = new Worker(
      new URL(`data:text/javascript,${encodeURIComponent(CLASSIFY_IN_WORKER)}`),
      {
        workerData: {
          module: new URL('../src/domain/proof-runs.ts', import.meta.url).href,
          run: classified,
        },
        resourceLimits: { maxOldGenerationSizeMb: heapMb },
      },
    )
    worker.once('message', resolve)
    worker.once('error', reject)
  })

/** A node run of `a.test.mjs`, one test `t`, with the JUnit report given. */
const nodeReportRun = (text: string) => ({
  output: '✖ t (1ms)',
  exitCode: 1,
  testPath: 'a.test.mjs',
  report: {
    reporting: NODE_REPORT,
    found: { kind: 'read' as const, text },
    source: "import { test } from 'node:test'\n\ntest('t', () => {})\n",
  },
})

/** The review's report: one suite named by `length` characters around `suites` suites of one test. */
const longSuiteReport = (length: number, suites: number) =>
  `<testsuites><testsuite name="${'a'.repeat(length)}">${'<testsuite name="x"><testcase name="t" file="a.test.mjs"/></testsuite>'.repeat(suites)}</testsuite></testsuites>`

/** As many copies of `unit` as fit between `head` and `tail` in a report of `REPORT_CAP` bytes. */
const filled = (head: string, unit: string, tail: string) =>
  `${head}${unit.repeat(Math.floor((REPORT_CAP - head.length - tail.length) / unit.length))}${tail}`

describe('A report read in bounded memory, whatever its names (#342, round 11)', () => {
  const name = 'a'.repeat(NAME_CAP)
  const classname = `tests.test_a.${'A'.repeat(NAME_CAP - 'tests.test_a.'.length)}`

  for (const [megabytes, suites] of [
    [1, 4_000],
    [2, 8_000],
  ] as const) {
    test(`the review’s report, a suite of a ${megabytes} MB name around ${suites} suites, is not read, in a heap of 256 MB`, async () => {
      const text = longSuiteReport(megabytes * 1_000_000, suites)
      await expect(classifiedInHeap(nodeReportRun(text), 256)).resolves.toMatchObject({
        reported: null,
      })
    })
  }

  /** A run of the shapes a report at its cap can take, each name at its cap where it has one. */
  const worst = {
    'node’s suites at their deepest, each named at the cap, around the most empty test cases': () =>
      nodeReportRun(
        filled(
          `<testsuites>${`<testsuite name="${name}">`.repeat(63)}`,
          '<testcase name="t" file="a.test.mjs"/>',
          `${'</testsuite>'.repeat(63)}</testsuites>`,
        ),
      ),
    'node’s suites side by side, each and its test named at the cap': () =>
      nodeReportRun(
        filled(
          '<testsuites>',
          `<testsuite name="${name}"><testcase name="${name}" file="a.test.mjs"/></testsuite>`,
          '</testsuites>',
        ),
      ),
    'pytest’s test cases, each class and function named at the cap': () => ({
      ...nodeReportRun(''),
      testPath: 'tests/test_a.py',
      report: {
        reporting: PYTEST_REPORT,
        found: {
          kind: 'read' as const,
          text: filled(
            '<testsuites><testsuite name="pytest">',
            `<testcase classname="${classname}" name="${name}"/>`,
            '</testsuite></testsuites>',
          ),
        },
        source: 'def test_t():\n    pass\n',
      },
    }),
    'vitest’s tests, each under a thousand describes of an empty title': () => ({
      ...nodeReportRun(''),
      testPath: 'a.test.ts',
      report: {
        reporting: VITEST_REPORT,
        found: {
          kind: 'read' as const,
          text: filled(
            '{"testResults":[{"name":"/work/acme/api/a.test.ts","assertionResults":[',
            `{"ancestorTitles":[${'""'.concat(',""'.repeat(999))}],"title":"t","status":"passed"},`,
            '{"ancestorTitles":[],"title":"t","status":"passed"}]}]}',
          ),
        },
        source: "import { test } from 'vite-plus/test'\n\ntest('t', () => {})\n",
      },
    }),
  }
  for (const [shape, made] of Object.entries(worst)) {
    test(`a report at the cap of ${shape} is classified in a heap of 256 MB and within seconds`, async () => {
      const classified = made()
      expect(classified.report.found.text.length).toBeLessThanOrEqual(REPORT_CAP)
      const { ms } = await classifiedInHeap(classified, 256)
      expect(ms).toBeLessThan(5_000)
    })
  }

  test('a JUnit report holding a suite name or a test name longer than its cap is not read, one at the cap is', () => {
    const node = (suite: string, title: string) =>
      reportedTests(
        NODE_REPORT,
        `<testsuites><testsuite name="${suite}"><testcase name="${title}" file="a.test.mjs"/></testsuite></testsuites>`,
        'a.test.mjs',
      )
    const pytest = (scope: string, title: string) =>
      reportedTests(
        PYTEST_REPORT,
        `<testsuites><testsuite name="pytest"><testcase classname="${scope}" name="${title}"/></testsuite></testsuites>`,
        'tests/test_a.py',
      )
    expect([
      node(name, 't')?.length,
      node(`${name}a`, 't'),
      node('s', name)?.length,
      node('s', `${name}a`),
      pytest(classname, 'test_t')?.length,
      pytest(`${classname}A`, 'test_t'),
      pytest('tests.test_a', name)?.length,
      pytest('tests.test_a', `${name}a`),
    ]).toEqual([1, null, 1, null, 1, null, 1, null])
  })

  test('a vitest JSON report holding a describe or a test title longer than its cap is not read, one at the cap is', () => {
    const json = (ancestor: string, title: string) =>
      reportedTests(
        VITEST_REPORT,
        JSON.stringify({
          testResults: [
            {
              name: '/work/acme/api/a.test.ts',
              assertionResults: [{ ancestorTitles: [ancestor], title, status: 'passed' }],
            },
          ],
        }),
        'a.test.ts',
      )
    expect([
      json(name, 't')?.length,
      json(`${name}a`, 't'),
      json('d', name)?.length,
      json('d', `${name}a`),
    ]).toEqual([1, null, 1, null])
  })

  test('a report whose test paths add up to more than their cap is not read, one at the cap is', () => {
    // Each test's path is the suite's name, ` > ` and `t`: 4,096 characters, 2,048 of them the cap.
    const suite = 'a'.repeat(4_096 - ' > t'.length)
    // `count` tests named `t`, then one named `last`.
    const tests = (count: number, last = 't') =>
      reportedTests(
        NODE_REPORT,
        `<testsuites><testsuite name="${suite}">${'<testcase name="t" file="a.test.mjs"/>'.repeat(count)}<testcase name="${last}" file="a.test.mjs"/></testsuite></testsuites>`,
        'a.test.mjs',
      )
    const most = KEYS_CAP / 4_096
    expect(Number.isInteger(most)).toBe(true)
    // At the cap, a whole path over it, and a single character over it.
    expect([tests(most - 1)?.length, tests(most), tests(most - 1, 'tt')]).toEqual([
      most,
      null,
      null,
    ])
  })
})

describe('The reporting Hemera adds to a proof’s command (#342, round 9)', () => {
  const PATH = '/tmp/hemera-report/report.json'
  const XML = '/tmp/hemera-report/report.xml'

  test('a vitest run, however it is launched, gets its verbose listing and a JSON report at Hemera’s path', () => {
    for (const command of [
      'vp test run export.test.ts',
      'vitest run export.test.ts',
      'npx vitest run export.test.ts',
      'pnpm exec vitest run export.test.ts',
    ]) {
      expect(withReporting(command, PATH)).toEqual({
        line: `${command} --reporter=verbose --reporter=json --outputFile.json='${PATH}'`,
        added: `--reporter=verbose --reporter=json --outputFile.json='${PATH}'`,
        reporting: { runner: 'vitest', report: { format: 'json', path: PATH } },
      })
    }
  })

  test('a pytest run gets its -rA summary and a JUnit report at Hemera’s path', () => {
    for (const command of ['pytest tests/test_export.py', 'python -m pytest -q', 'uv run pytest']) {
      expect(withReporting(command, XML)).toEqual({
        line: `${command} -rA --junitxml='${XML}'`,
        added: `-rA --junitxml='${XML}'`,
        reporting: { runner: 'pytest', report: { format: 'junit', path: XML } },
      })
    }
  })

  test('a node --test run gets its spec listing and a JUnit report, each reporter of its own given its destination', () => {
    const added = `--test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination='${XML}'`
    expect(withReporting('node --test tests/', XML)).toEqual({
      line: `node --test ${added} tests/`,
      added,
      reporting: { runner: 'node', report: { format: 'junit', path: XML } },
    })
    const windows =
      '"C:\\Program Files\\nodejs\\node.exe" --test --test-reporter=tap tests/export.test.mjs'
    expect(withReporting(windows, XML)?.line).toBe(
      `"C:\\Program Files\\nodejs\\node.exe" --test ${added} --test-reporter-destination=stdout --test-reporter=tap tests/export.test.mjs`,
    )
    const paired = 'node --test --test-reporter tap --test-reporter-destination stdout tests/'
    expect(withReporting(paired, XML)?.line).toBe(
      `node --test ${added} --test-reporter tap --test-reporter-destination stdout tests/`,
    )
  })

  test('a command Hemera cannot add its reporting to keeps its line, with no report: the key line decides', () => {
    for (const command of [
      'npm test',
      'pnpm test',
      'npx jest',
      'go test ./...',
      'cargo test',
      'make check',
      'npx mocha',
      'python -m unittest tests.test_export',
      'vitest run --outputFile=out.json',
      'vp test run --outputFile.json out.json',
      'pytest --junitxml=out.xml',
      'node --test --test-reporter=tap --test-reporter=dot --test-reporter-destination=stdout tests/',
      'node tests/export.test.mjs',
      'echo vitest',
    ]) {
      expect([command, withReporting(command, PATH)]).toEqual([command, null])
    }
    expect(withReporting('vitest run', "/tmp/it's/report.json")).toBeNull()
  })

  test('the line Hemera runs is free of shell syntax and keeps its report path whole, spaces and all', () => {
    const path = 'C:\\Users\\Ada Lovelace\\AppData\\Local\\Temp\\hemera-report-1\\report.json'
    const line = withReporting('vp test run', path)?.line ?? ''
    expect(shellSyntaxIn(line)).toBeNull()
    expect(wordsOf(line)).toContain(`--outputFile.json=${path}`)
    const node = withReporting('node --test tests/', path)?.line ?? ''
    expect(wordsOf(node)).toContain(`--test-reporter-destination=${path}`)
  })
})

/** A Rust module of the crate `acme` whose test `saves` fails (`src/a.rs`). */
const RUST_MODULE_A = `#[cfg(test)]
mod tests {
    #[test]
    fn saves() {
        println!("saving from a");
        assert_eq!(super::super::double(1), 3);
    }
}
`
/** Another module of the crate, its test of the same name passing (`src/b.rs`). */
const RUST_MODULE_B = RUST_MODULE_A.replace('from a', 'from b').replace('3);', '2);')
/** The crate's root (`src/lib.rs`): a doctest of `double` that fails, and a test `double`. */
const RUST_CRATE_ROOT = `//! \`\`\`
//! assert_eq!(acme::double(2), 5);
//! \`\`\`
pub mod a;
pub mod b;

/// \`\`\`
/// assert_eq!(acme::double(1), 3);
/// \`\`\`
pub fn double(n: i32) -> i32 {
    n * 2
}

#[cfg(test)]
mod tests {
    #[test]
    fn double() {
        assert_eq!(super::double(2), 4);
    }
}
`
/** Two integration tests of the crate: \`tests/c.rs\`, which fails, and \`tests/d.rs\`. */
const RUST_INTEGRATION_C = `#[test]
fn saves() {
    assert_eq!(acme::double(2), 5);
}
`
const RUST_INTEGRATION_D = RUST_INTEGRATION_C.replace('5);', '4);')

/** The tests a new Rust file declares, as a proof adding it reads them. */
const rustFile = (code: string) => addedTests({ insertion: 'new_file', code, patch: null })

/** go test, Go 1.27, `./...`: `TestSaves` fails in package `pkg/a`; its namesake of `pkg/b` passes. */
const GO_TWO_PACKAGES = [
  '--- FAIL: TestSaves (0.00s)',
  '    saves_test.go:6: got 1, want 2',
  'FAIL',
  'FAIL\texample.com/acme/pkg/a\t0.002s',
  'ok  \texample.com/acme/pkg/b\t0.002s',
  '?   \texample.com/acme/cmd/acme\t[no test files]',
  'FAIL',
].join('\n')

/** A Go test file of package `b` whose test runs a subtest `case 1`. */
const GO_SUBTEST_FILE = `package b

import "testing"

func TestSaves(t *testing.T) {
	t.Run("case 1", func(t *testing.T) {
		if got := 1; got != 2 {
			t.Errorf("got %d, want 2", got)
		}
	})
}
`

describe('A Go or Rust red is read within its package (#384)', () => {
  const twoModules = captured('cargo-test-two-modules-binaries')

  test('Rust: a test failing in module a is not the red of a same-named test of module b', () => {
    expect(run(twoModules, 101, 'src/b.rs').classification).toBe('assertion_failed')
    expect(validRed(run(twoModules, 101, 'src/b.rs'), 'src/b.rs', rustFile(RUST_MODULE_B))).toBe(
      false,
    )
    expect(validRed(run(twoModules, 101, 'src/a.rs'), 'src/a.rs', rustFile(RUST_MODULE_A))).toBe(
      true,
    )
    // Its panic raised in the declared test's file (a helper there) does not make it the test's.
    const helped = twoModules.replace('panicked at src/a.rs:6:9:', 'panicked at src/b.rs:3:5:')
    expect(validRed(run(helped, 101, 'src/b.rs'), 'src/b.rs', rustFile(RUST_MODULE_B))).toBe(false)
  })

  test('Rust: an integration test failing in tests/c.rs is not the red of a same-named test of tests/d.rs', () => {
    const d = 'tests/d.rs'
    expect(validRed(run(twoModules, 101, d), d, rustFile(RUST_INTEGRATION_D))).toBe(false)
    const c = 'tests/c.rs'
    expect(validRed(run(twoModules, 101, c), c, rustFile(RUST_INTEGRATION_C))).toBe(true)
    // A module's test of the same name is no integration test's either way round.
    expect(validRed(run(twoModules, 101, d), d, rustFile(RUST_MODULE_A))).toBe(false)
  })

  test('Rust: a doctest failing is not the red of a test of the same name', () => {
    const path = 'src/lib.rs'
    expect(validRed(run(twoModules, 101, path), path, rustFile(RUST_CRATE_ROOT))).toBe(false)
  })

  test('Rust: with --nocapture, the tests of two modules and two binaries interleaved are each read in their own', () => {
    const output = captured('cargo-test-two-modules-nocapture')
    const cases = [
      ['src/a.rs', RUST_MODULE_A, true],
      ['src/b.rs', RUST_MODULE_B, false],
      ['tests/c.rs', RUST_INTEGRATION_C, true],
      ['tests/d.rs', RUST_INTEGRATION_D, false],
    ] as const
    for (const [path, code, red] of cases) {
      expect([path, validRed(run(output, 101, path), path, rustFile(code))]).toEqual([path, red])
    }
  })

  test('Rust: a panic that is another error in tests/c.rs does not refuse the assertion of tests/d.rs', () => {
    const output = twoModules
      .replace(
        'panicked at tests/c.rs:3:5:\nassertion `left == right` failed',
        'panicked at tests/c.rs:3:5:\ncalled `Option::unwrap()` on a `None` value',
      )
      .replace(
        'running 1 test\ntest saves ... ok',
        [
          'running 1 test',
          'test saves ... FAILED',
          '',
          'failures:',
          '',
          '---- saves stdout ----',
          '',
          "thread 'saves' (469210) panicked at tests/d.rs:3:5:",
          'assertion `left == right` failed',
          '  left: 4',
          ' right: 5',
          '',
          'failures:',
          '    saves',
        ].join('\n'),
      )
    const d = 'tests/d.rs'
    expect(validRed(run(output, 101, d), d, rustFile(RUST_INTEGRATION_D))).toBe(true)
    const c = 'tests/c.rs'
    expect(validRed(run(output, 101, c), c, rustFile(RUST_INTEGRATION_C), true)).toBe(false)
  })

  test("Rust: in a workspace's run, a member's red is told apart from no other member's: the key line decides", () => {
    const output = captured('cargo-test-workspace')
    for (const path of ['a/src/lib.rs', 'b/src/lib.rs']) {
      const names = rustFile(RUST_MODULE_A)
      expect(validRed(run(output, 101, path), path, names)).toBe(false)
      expect(validRed(run(output, 101, path), path, names, true)).toBe(true)
    }
  })

  test("Rust: a workspace's run stopped at a member's red is not the red of the root crate's test of the same path", () => {
    const output = captured('cargo-test-workspace-stopped')
    const path = 'src/lib.rs'
    expect(validRed(run(output, 101, path), path, rustFile(RUST_MODULE_A))).toBe(false)
    expect(validRed(run(output, 101, path), path, rustFile(RUST_MODULE_A), true)).toBe(true)
    // Its panic raised in the declared test's file (a helper there) does not make it the test's.
    const helped = output.replace('panicked at a/src/lib.rs:5:9:', 'panicked at src/lib.rs:5:9:')
    expect(validRed(run(helped, 101, path), path, rustFile(RUST_MODULE_A))).toBe(false)
  })

  test("Rust: a member's red run through its own manifest is not the red of the root crate's test of the same path", () => {
    // `cargo test --manifest-path member/Cargo.toml; cargo test`: no rerun hint names a package.
    const output = captured('cargo-test-two-manifests')
    const path = 'src/lib.rs'
    expect(validRed(run(output, 0, path), path, rustFile(RUST_MODULE_A))).toBe(false)
    expect(validRed(run(output, 101, path), path, rustFile(RUST_MODULE_A))).toBe(false)
    // The member's run alone: one binary, but its panic was raised in another file.
    const member = output.slice(0, output.indexOf('   Compiling acme'))
    expect(validRed(run(member, 101, path), path, rustFile(RUST_MODULE_A))).toBe(false)
    expect(validRed(run(member, 101, path), path, rustFile(RUST_MODULE_A), true)).toBe(true)
    // Its panic raised in the declared test's file (a helper there) does not make it the test's.
    const helped = output.replace(
      'panicked at member/src/lib.rs:5:9:',
      'panicked at src/lib.rs:5:9:',
    )
    expect(validRed(run(helped, 101, path), path, rustFile(RUST_MODULE_A))).toBe(false)
  })

  test('Rust: a crate in a folder of the repository is told apart from no other crate: the key line decides', () => {
    const output = captured('cargo-test-workspace-root')
    expect(validRed(run(output, 101, 'src/lib.rs'), 'src/lib.rs', rustFile(RUST_MODULE_A))).toBe(
      true,
    )
    const member = 'm/src/lib.rs'
    expect(validRed(run(output, 101, member), member, rustFile(RUST_MODULE_A))).toBe(false)
    expect(validRed(run(output, 101, member), member, rustFile(RUST_MODULE_A), true)).toBe(true)
    // Its panic raised in the declared test's file (a helper there) does not make it the test's.
    const helped = output.replace('panicked at src/lib.rs:5:9:', 'panicked at m/src/lib.rs:5:9:')
    expect(validRed(run(helped, 101, member), member, rustFile(RUST_MODULE_A))).toBe(false)
  })

  test('Rust: a failure whose Running line was cut off is uncertain: the key line decides', () => {
    const cut = twoModules.slice(twoModules.indexOf('\nrunning 3 tests'))
    for (const path of ['src/a.rs', 'src/b.rs']) {
      const names = rustFile(path === 'src/a.rs' ? RUST_MODULE_A : RUST_MODULE_B)
      expect(validRed(run(cut, 101, path), path, names)).toBe(false)
      expect(validRed(run(cut, 101, path), path, names, true)).toBe(true)
    }
    // Uncertain, a failure that may be the test's still refuses it when it is another error.
    const unwrapped = cut.replace(
      'panicked at src/a.rs:6:9:\nassertion `left == right` failed',
      'panicked at src/a.rs:6:9:\ncalled `Option::unwrap()` on a `None` value',
    )
    const a = 'src/a.rs'
    expect(validRed(run(unwrapped, 101, a), a, rustFile(RUST_MODULE_A), true)).toBe(false)
  })

  test('Rust: Windows paths and CRLF line ends are read as on Linux', () => {
    const output = twoModules
      .replace(
        'unittests src/lib.rs (target/debug/deps/',
        'unittests src\\lib.rs (target\\debug\\deps\\',
      )
      .replace(
        'tests/c.rs (target/debug/deps/c-0e8fa604be354400)',
        'tests\\c.rs (target\\debug\\deps\\c-0e8fa604be354400.exe)',
      )
      .replace(
        'tests/d.rs (target/debug/deps/d-53b860629dae7d46)',
        'tests\\d.rs (target\\debug\\deps\\d-53b860629dae7d46.exe)',
      )
      .replaceAll('\n', '\r\n')
    const cases = [
      ['src\\a.rs', RUST_MODULE_A, true],
      ['src/b.rs', RUST_MODULE_B, false],
      ['tests\\c.rs', RUST_INTEGRATION_C, true],
      ['tests\\d.rs', RUST_INTEGRATION_D, false],
    ] as const
    for (const [path, code, red] of cases) {
      expect([path, validRed(run(output, 101, path), path, rustFile(code))]).toEqual([path, red])
    }
  })

  test("Rust: cargo-nextest's binary names the test's binary; two crates, or a binary it did not show, make it uncertain", () => {
    const failing = (id: string) => [
      `        FAIL [   0.004s] (1/2) ${id} saves`,
      '  stderr ───',
      '',
      "    thread 'saves' (1510136) panicked at tests/c.rs:3:5:",
      '    assertion `left == right` failed',
      '',
    ]
    const nextest = (binaries: number, ids: ReadonlyArray<string>) =>
      [
        `    Starting 2 tests across ${String(binaries)} binaries`,
        ...failing(ids[0] ?? ''),
        ...ids.slice(1).map((id) => `        PASS [   0.004s] (2/2) ${id} saves`),
        '────────────',
        '     Summary [   0.005s] 2 tests run: 1 passed, 1 failed, 0 skipped',
        `        FAIL [   0.004s] (1/2) ${ids[0] ?? ''} saves`,
        'error: test run failed',
      ].join('\n')
    const c = 'tests/c.rs'
    const d = 'tests/d.rs'
    const one = nextest(2, ['acme::c', 'acme::d'])
    expect(validRed(run(one, 100, c), c, rustFile(RUST_INTEGRATION_C))).toBe(true)
    expect(validRed(run(one, 100, d), d, rustFile(RUST_INTEGRATION_D))).toBe(false)
    // Two crates of a workspace, each with a tests/c.rs: either one's.
    const two = nextest(2, ['acme::c', 'other::c'])
    expect(validRed(run(two, 100, c), c, rustFile(RUST_INTEGRATION_C))).toBe(false)
    expect(validRed(run(two, 100, c), c, rustFile(RUST_INTEGRATION_C), true)).toBe(true)
    // Stopped at the first failure: the binary it never showed may be another crate's tests/c.rs.
    const stopped = nextest(2, ['acme::c'])
    expect(validRed(run(stopped, 100, c), c, rustFile(RUST_INTEGRATION_C))).toBe(false)
  })

  test("Rust: a test's modules are read from its file, its strings, chars, lifetimes and comments aside", () => {
    const code = [
      'mod outer {',
      "    const OPEN: char = '{';",
      '    const RAW: &str = r#"} " mod fake { "#;',
      '    /* } /* nested } */ still a comment { */',
      "    fn keep<'a>(text: &'a str) -> &'a str { text }",
      '    #[cfg(test)]',
      '    pub(crate) mod tests {',
      '        // mod commented {',
      '        #[test]',
      '        fn saves() {',
      '            assert_eq!("}", "{");',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n')
    const output = [
      '     Running unittests src/lib.rs (target/debug/deps/acme-d5b7551ab0e24432)',
      '',
      'running 1 test',
      'test b::outer::tests::saves ... FAILED',
      '',
      'failures:',
      '',
      '---- b::outer::tests::saves stdout ----',
      "thread 'b::outer::tests::saves' (1) panicked at src/b.rs:11:13:",
      'assertion `left == right` failed',
      '',
      'failures:',
      '    b::outer::tests::saves',
      '',
      'error: test failed, to rerun pass `--lib`',
    ].join('\n')
    const path = 'src/b.rs'
    expect(validRed(run(output, 101, path), path, rustFile(code))).toBe(true)
    // Its module path is not another module's.
    const other = output.replaceAll('b::outer::tests::saves', 'b::tests::saves')
    expect(validRed(run(other, 101, path), path, rustFile(code))).toBe(false)
    // A file its reader is not certain of (a string never closed) names no module: the key line decides.
    const broken = `${code}const NEVER: &str = "`
    expect(validRed(run(output, 101, path), path, rustFile(broken))).toBe(false)
    expect(validRed(run(output, 101, path), path, rustFile(broken), true)).toBe(true)
  })

  test('Go: a test failing in package pkg/a is not the red of a same-named test of package pkg/b', () => {
    const b = 'pkg/b/saves_test.go'
    expect(run(GO_TWO_PACKAGES, 1, b).classification).toBe('assertion_failed')
    expect(goRed(run(GO_TWO_PACKAGES, 1, b), b, ['TestSaves'])).toBe(false)
    expect(goRed(run(GO_TWO_PACKAGES, 1, b), b, ['TestSaves'], true)).toBe(true)
    const a = 'pkg/a/saves_test.go'
    expect(goRed(run(GO_TWO_PACKAGES, 1, a), a, ['TestSaves'])).toBe(true)
  })

  test('Go: with go test -v, two packages each read in their own', () => {
    const output = [
      '=== RUN   TestSaves',
      '    saves_test.go:6: got 1, want 2',
      '--- FAIL: TestSaves (0.00s)',
      'FAIL',
      'FAIL\texample.com/acme/pkg/a\t0.002s',
      '=== RUN   TestSaves',
      '--- PASS: TestSaves (0.00s)',
      'PASS',
      'ok  \texample.com/acme/pkg/b\t0.002s',
      'FAIL',
    ].join('\n')
    const b = 'pkg/b/saves_test.go'
    expect(goRed(run(output, 1, b), b, ['TestSaves'])).toBe(false)
    const a = 'pkg/a/saves_test.go'
    expect(goRed(run(output, 1, a), a, ['TestSaves'])).toBe(true)
  })

  test('Go: a subtest failing in package pkg/a is not the red of a same-named subtest of package pkg/b', () => {
    const output = [
      '--- FAIL: TestSaves (0.00s)',
      '    --- FAIL: TestSaves/case_1 (0.00s)',
      '        saves_test.go:9: got 1, want 2',
      'FAIL',
      'FAIL\texample.com/acme/pkg/a\t0.002s',
      'ok  \texample.com/acme/pkg/b\t0.002s',
      'FAIL',
    ].join('\n')
    const subtests = addedTests({
      insertion: 'new_file',
      code: GO_SUBTEST_FILE,
      patch: null,
    }).filter((name) => Predicate.hasProperty(name, 'subtest'))
    expect(subtests).toHaveLength(1)
    const b = 'pkg/b/saves_test.go'
    expect(goRed(run(output, 1, b), b, subtests)).toBe(false)
    const a = 'pkg/a/saves_test.go'
    expect(goRed(run(output, 1, a), a, subtests)).toBe(true)
  })

  test("Go: a panic in package pkg/a does not refuse the assertion of package pkg/b's test of the same name", () => {
    const output = [
      '--- FAIL: TestSaves (0.00s)',
      'panic: runtime error: invalid memory address or nil pointer dereference [recovered]',
      '\tpanic: runtime error: invalid memory address or nil pointer dereference',
      '[signal SIGSEGV: segmentation violation code=0x1 addr=0x0 pc=0x4f1b2a]',
      'FAIL\texample.com/acme/pkg/a\t0.003s',
      '--- FAIL: TestSaves (0.00s)',
      '    saves_test.go:6: got 1, want 2',
      'FAIL',
      'FAIL\texample.com/acme/pkg/b\t0.002s',
      'FAIL',
    ].join('\n')
    const b = 'pkg/b/saves_test.go'
    expect(goRed(run(output, 1, b), b, ['TestSaves'])).toBe(true)
  })

  test("Go: gotestsum's package, a path from the folder it ran in, is uncertain (#462): the key line decides", () => {
    const output = [
      '✖  pkg/a (2ms)',
      '✓  pkg/b (1ms)',
      '',
      '=== Failed',
      '=== FAIL: pkg/a TestSaves (0.00s)',
      '    saves_test.go:6: got 1, want 2',
      '',
      'DONE 2 tests, 1 failure in 0.002s',
    ].join('\n')
    const b = 'pkg/b/saves_test.go'
    expect(goRed(run(output, 1, b), b, ['TestSaves'])).toBe(false)
    const a = 'pkg/a/saves_test.go'
    expect(goRed(run(output, 1, a), a, ['TestSaves'])).toBe(false)
    expect(goRed(run(output, 1, a), a, ['TestSaves'], true)).toBe(true)
  })

  test('Go: go test -json of two packages is not read: never a red by name', () => {
    const output = [
      '{"Action":"output","Package":"example.com/acme/pkg/a","Test":"TestSaves","Output":"--- FAIL: TestSaves (0.00s)\\n"}',
      '{"Action":"fail","Package":"example.com/acme/pkg/a","Test":"TestSaves","Elapsed":0}',
      '{"Action":"pass","Package":"example.com/acme/pkg/b","Test":"TestSaves","Elapsed":0}',
    ].join('\n')
    const b = 'pkg/b/saves_test.go'
    expect(goRed(run(output, 1, b), b, ['TestSaves'])).toBe(false)
  })

  test('Go: a failure whose package line is missing (the output cut short) is uncertain: the key line decides', () => {
    const output = ['--- FAIL: TestSaves (0.00s)', '    saves_test.go:6: got 1, want 2'].join('\n')
    const b = 'pkg/b/saves_test.go'
    expect(goRed(run(output, 1, b), b, ['TestSaves'])).toBe(false)
    expect(goRed(run(output, 1, b), b, ['TestSaves'], true)).toBe(true)
    // Uncertain, a failure that may be the test's still refuses it when it is another error.
    const panicked = output.replace('    saves_test.go:6: got 1, want 2', 'panic: boom [recovered]')
    expect(goRed(run(panicked, 1, b), b, ['TestSaves'], true)).toBe(false)
  })

  test("Go: a test's folder that two printed packages end with is told apart by its module's path (#462)", () => {
    const output = GO_TWO_PACKAGES.replace('example.com/acme/pkg/b', 'example.com/acme/x/pkg/a')
    const a = 'pkg/a/saves_test.go'
    expect(goRed(run(output, 1, a), a, ['TestSaves'])).toBe(true)
    const xa = 'x/pkg/a/saves_test.go'
    expect(goRed(run(output, 1, xa), xa, ['TestSaves'])).toBe(false)
    expect(goRed(run(output, 1, xa), xa, ['TestSaves'], true)).toBe(true)
  })

  test("Go: a test at the module's root is its module path's package, whatever else is printed (#462)", () => {
    const path = 'saves_test.go'
    const output = GO_TWO_PACKAGES.replace('example.com/acme/pkg/a', 'example.com/acme')
    expect(goRed(run(output, 1, path), path, ['TestSaves'])).toBe(true)
    // A package outside the module printed beside it: the module's path still names the root.
    const outside = output.replace('example.com/acme/pkg/b', 'example.com/other')
    expect(goRed(run(outside, 1, path), path, ['TestSaves'])).toBe(true)
    // A package's test is not the root's.
    expect(goRed(run(GO_TWO_PACKAGES, 1, path), path, ['TestSaves'])).toBe(false)
    // gotestsum's `.` is the folder it ran in, not certainly the module's root.
    const gotestsum = '=== FAIL: . TestSaves (0.00s)\n    saves_test.go:6: got 1, want 2\n'
    expect(goRed(run(gotestsum, 1, path), path, ['TestSaves'])).toBe(false)
    expect(goRed(run(gotestsum, 1, path), path, ['TestSaves'], true)).toBe(true)
    const elsewhere = gotestsum.replace('FAIL: .', 'FAIL: pkg/a')
    expect(goRed(run(elsewhere, 1, path), path, ['TestSaves'])).toBe(false)
  })

  test('Go: Windows paths and CRLF line ends are read as on Linux', () => {
    const output = GO_TWO_PACKAGES.replaceAll('\n', '\r\n')
    const b = 'pkg\\b\\saves_test.go'
    expect(goRed(run(output, 1, b), b, ['TestSaves'])).toBe(false)
    const a = 'pkg\\a\\saves_test.go'
    expect(goRed(run(output, 1, a), a, ['TestSaves'])).toBe(true)
  })

  test('the package of each Go and Rust failure is read in linear time on long outputs', () => {
    const go = (size: number) =>
      Array.from({ length: size }, (_, at) =>
        [
          '--- FAIL: TestSaves (0.00s)',
          '    saves_test.go:6: got 1, want 2',
          'FAIL',
          `FAIL\texample.com/acme/pkg/p${String(at)}\t0.002s`,
        ].join('\n'),
      ).join('\n')
    const goPath = 'pkg/b/saves_test.go'
    const goRead = (output: string) =>
      expect(goRed(run(output, 1, goPath), goPath, ['TestSaves'])).toBe(false)
    expect(growth(go, 2_000, goRead)).toBeLessThan(24)
    const rust = (size: number) =>
      Array.from({ length: size }, (_, at) =>
        [
          `     Running tests/t${String(at)}.rs (target/debug/deps/t${String(at)}-0e8fa604be354400)`,
          '',
          'running 1 test',
          'test saves ... FAILED',
          '',
          'failures:',
          '    saves',
          '',
          `error: test failed, to rerun pass \`--test t${String(at)}\``,
        ].join('\n'),
      ).join('\n')
    const rustPath = 'tests/d.rs'
    const rustRead = (output: string) =>
      expect(validRed(run(output, 101, rustPath), rustPath, rustFile(RUST_INTEGRATION_D))).toBe(
        false,
      )
    expect(growth(rust, 500, rustRead)).toBeLessThan(24)
    const source = (size: number) =>
      Array.from(
        { length: size },
        (_, at) =>
          `mod m${String(at)} {\n    const C: char = '{';\n    #[test]\n    fn saves_${String(at)}() {}\n}\n`,
      ).join('')
    const sourceRead = (code: string) =>
      expect(rustFile(code)).toHaveLength(code.split('#[test]').length - 1)
    expect(growth(source, 500, sourceRead)).toBeLessThan(24)
  })
})

/** Module `example.com/m`, its `go.mod` at the repository's root. */
const MODULE_M: GoModule = { path: 'example.com/m', folder: '' }

/** go test ./internal/... of module `example.com/m`: `TestSaves` fails in package `internal/pkg`. */
const GO_INTERNAL_PKG = [
  '--- FAIL: TestSaves (0.00s)',
  '    saves_test.go:6: got 1, want 2',
  'FAIL',
  'FAIL\texample.com/m/internal/pkg\t0.002s',
  'FAIL',
].join('\n')

describe('A Go red is read against the module its go.mod names (#462)', () => {
  test('Go: a test file at pkg/ is not the red of package example.com/m/internal/pkg: the key line decides', () => {
    const path = 'pkg/saves_test.go'
    expect(run(GO_INTERNAL_PKG, 1, path).classification).toBe('assertion_failed')
    expect(validRed(run(GO_INTERNAL_PKG, 1, path), path, ['TestSaves'], null, MODULE_M)).toBe(false)
    expect(validRed(run(GO_INTERNAL_PKG, 1, path), path, ['TestSaves'], true, MODULE_M)).toBe(true)
  })

  test('Go: the same output is the red of a test file at internal/pkg', () => {
    const path = 'internal/pkg/saves_test.go'
    expect(validRed(run(GO_INTERNAL_PKG, 1, path), path, ['TestSaves'], null, MODULE_M)).toBe(true)
  })

  test("Go: a test at the module's root is the red of the module's own package only", () => {
    const path = 'saves_test.go'
    const root = GO_INTERNAL_PKG.replace('example.com/m/internal/pkg', 'example.com/m')
    expect(validRed(run(root, 1, path), path, ['TestSaves'], null, MODULE_M)).toBe(true)
    // Another module printed beside it no longer hides which package is the root's.
    const beside = `${root}\nok  \texample.com/other\t0.001s`
    expect(validRed(run(beside, 1, path), path, ['TestSaves'], null, MODULE_M)).toBe(true)
    expect(validRed(run(GO_INTERNAL_PKG, 1, path), path, ['TestSaves'], null, MODULE_M)).toBe(false)
    // A module whose path only begins like the printed package is another module.
    const longer = GO_INTERNAL_PKG.replace('example.com/m/internal/pkg', 'example.com/m2')
    expect(validRed(run(longer, 1, path), path, ['TestSaves'], null, MODULE_M)).toBe(false)
  })

  test("Go: in nested modules the nearest go.mod names the package: the outer module's red is not the inner one's", () => {
    const inner: GoModule = { path: 'example.com/tools', folder: 'tools' }
    const path = 'tools/gen/saves_test.go'
    const own = GO_INTERNAL_PKG.replace('example.com/m/internal/pkg', 'example.com/tools/gen')
    expect(validRed(run(own, 1, path), path, ['TestSaves'], null, inner)).toBe(true)
    // The package the outer module would hold at that folder is not the inner module's.
    const outer = GO_INTERNAL_PKG.replace('example.com/m/internal/pkg', 'example.com/m/tools/gen')
    expect(validRed(run(outer, 1, path), path, ['TestSaves'], null, inner)).toBe(false)
    expect(validRed(run(outer, 1, path), path, ['TestSaves'], true, inner)).toBe(true)
    // The inner module's root package.
    const top = GO_INTERNAL_PKG.replace('example.com/m/internal/pkg', 'example.com/tools')
    expect(
      validRed(
        run(top, 1, 'tools/saves_test.go'),
        'tools/saves_test.go',
        ['TestSaves'],
        null,
        inner,
      ),
    ).toBe(true)
  })

  test("Go: a test file outside its module's folder is uncertain: the key line decides", () => {
    const inner: GoModule = { path: 'example.com/m', folder: 'tools' }
    const path = 'svc/internal/pkg/saves_test.go'
    expect(validRed(run(GO_INTERNAL_PKG, 1, path), path, ['TestSaves'], null, inner)).toBe(false)
    expect(validRed(run(GO_INTERNAL_PKG, 1, path), path, ['TestSaves'], true, inner)).toBe(true)
  })

  test('Go: without a readable go.mod every Go failure is uncertain: the key line decides, another error still refuses', () => {
    const path = 'internal/pkg/saves_test.go'
    expect(validRed(run(GO_INTERNAL_PKG, 1, path), path, ['TestSaves'])).toBe(false)
    expect(validRed(run(GO_INTERNAL_PKG, 1, path), path, ['TestSaves'], null, null)).toBe(false)
    expect(validRed(run(GO_INTERNAL_PKG, 1, path), path, ['TestSaves'], true, null)).toBe(true)
    const panicked = GO_INTERNAL_PKG.replace(
      '    saves_test.go:6: got 1, want 2',
      'panic: boom [recovered]',
    )
    expect(validRed(run(panicked, 1, path), path, ['TestSaves'], true, null)).toBe(false)
  })

  test("Go: gotestsum's path from the module's root is uncertain: the key line decides", () => {
    const output = [
      '=== Failed',
      '=== FAIL: internal/pkg TestSaves (0.00s)',
      '    saves_test.go:6: got 1, want 2',
      '',
      'DONE 1 tests, 1 failure in 0.002s',
    ].join('\n')
    const path = 'internal/pkg/saves_test.go'
    expect(validRed(run(output, 1, path), path, ['TestSaves'], null, MODULE_M)).toBe(false)
    expect(validRed(run(output, 1, path), path, ['TestSaves'], true, MODULE_M)).toBe(true)
    const root = output.replace('FAIL: internal/pkg', 'FAIL: .')
    expect(
      validRed(run(root, 1, 'saves_test.go'), 'saves_test.go', ['TestSaves'], null, MODULE_M),
    ).toBe(false)
    // Uncertain, it may still be the test's: another error refuses it.
    const panicked = output.replace('    saves_test.go:6: got 1, want 2', 'panic: boom [recovered]')
    expect(validRed(run(panicked, 1, path), path, ['TestSaves'], true, MODULE_M)).toBe(false)
  })

  test('Go: Windows paths and CRLF line ends are read against the module as on Linux', () => {
    const output = GO_INTERNAL_PKG.replaceAll('\n', '\r\n')
    const windows: GoModule = { path: 'example.com/m', folder: '' }
    const pkg = 'pkg\\saves_test.go'
    expect(validRed(run(output, 1, pkg), pkg, ['TestSaves'], null, windows)).toBe(false)
    const internal = 'internal\\pkg\\saves_test.go'
    expect(validRed(run(output, 1, internal), internal, ['TestSaves'], null, windows)).toBe(true)
    const inner: GoModule = { path: 'example.com/m', folder: 'svc\\api' }
    const nested = 'svc\\api\\internal\\pkg\\saves_test.go'
    expect(validRed(run(output, 1, nested), nested, ['TestSaves'], null, inner)).toBe(true)
  })

  test('go.mod: the module line names the path, comments, dependencies, quotes and CRLF aside', () => {
    expect(goModulePath('module example.com/m\n\ngo 1.22\n')).toBe('example.com/m')
    expect(
      goModulePath(
        [
          '// module example.com/fake',
          '// Deprecated: use example.com/n.',
          'module example.com/m // the module',
          '',
          'require (',
          '\texample.com/module v1.0.0 // indirect',
          '\tmodule.example/x v0.1.0',
          ')',
          'replace example.com/module => ./module',
        ].join('\n'),
      ),
    ).toBe('example.com/m')
    expect(goModulePath('module "example.com/m"\r\ngo 1.22\r\n')).toBe('example.com/m')
    expect(goModulePath('module `example.com/m`\n')).toBe('example.com/m')
    expect(goModulePath('\uFEFFmodule example.com/m\r\n')).toBe('example.com/m')
    expect(goModulePath('  module\texample.com/m  \n')).toBe('example.com/m')
  })

  test('go.mod: no module line, two of them, a block or a path that does not read names no module', () => {
    expect(goModulePath('go 1.22\n')).toBeNull()
    expect(goModulePath('')).toBeNull()
    expect(goModulePath('module example.com/m\nmodule example.com/n\n')).toBeNull()
    expect(goModulePath('module (\n\texample.com/m\n)\n')).toBeNull()
    expect(goModulePath('module "example.com/m\n')).toBeNull()
    expect(goModulePath('module "example.com/\\u006d"\n')).toBeNull()
    expect(goModulePath('module example.com/m extra\n')).toBeNull()
    expect(goModulePath('module\n')).toBeNull()
    expect(goModulePath('modules example.com/m\n')).toBeNull()
    expect(goModulePath('/* module example.com/m */\n')).toBeNull()
  })
})

/** A tree of a red's repository: its files and its links, by path. */
const treeOf = (files: ReadonlyArray<string>, links: Readonly<Record<string, string>> = {}) => ({
  files: [...files, ...Object.keys(links)],
  links: new Map(Object.entries(links)),
})

/** A red's patch (#479): what changed since the base, and the texts of the runner files read. */
const patchOf = (
  changed: ReadonlyArray<readonly [string, string | null, string | null] | string>,
  more: {
    readonly files?: ReadonlyArray<string>
    readonly links?: Readonly<Record<string, string>>
    readonly read?: Readonly<Record<string, string>>
    readonly testPath?: string
    readonly command?: string
  } = {},
) => {
  const sides = changed.map((one) =>
    Predicate.isString(one)
      ? { path: one, before: null, after: null }
      : { path: one[0], before: one[1], after: one[2] },
  )
  return {
    tree: treeOf([...(more.files ?? []), ...sides.map((one) => one.path)], more.links),
    changed: sides,
    read: new Map(Object.entries(more.read ?? {})),
    testPath: more.testPath ?? 'tests/test_a.py',
    command: more.command ?? 'pytest tests/test_a.py',
  }
}

const HOOK = 'def pytest_runtest_makereport(item, call):\n    pass\n'

describe('A red whose patch changes how the runner judges (#479)', () => {
  const PYTEST_CODE =
    'def test_other():\n    assert 1 == 1\n\n\ndef test_saves():\n    assert "md" == "md"\n'
  const pytestRed = (name: string, code: string) =>
    reported(
      fixture(`${name}.txt`),
      'tests/test_a.py',
      PYTEST_REPORT,
      { kind: 'read', text: fixture(`${name}.junit.xml`) },
      code,
    )

  test('a conftest.py whose pytest_runtest_makereport turns the added passing test into a failed assertion: a red by its run, refused by its patch', () => {
    // pytest 9.1.1: the listing and the report agree that the added test failed on an assertion.
    expect(
      validRed(
        pytestRed('pytest-makereport', PYTEST_CODE),
        'tests/test_a.py',
        addedAt(PYTEST_CODE, 5, 6),
        true,
      ),
    ).toBe(true)
    expect(runnerChange(patchOf([['conftest.py', null, HOOK], 'tests/test_a.py']))).toEqual({
      path: 'conftest.py',
      why: 'a conftest.py',
    })
  })

  test('a vitest setup file whose afterEach throws an AssertionError for the added test: a red by its run, refused by its patch', () => {
    const code =
      "import { describe, expect, test } from 'vitest'\n\ndescribe('export', () => {\n  test('keeps', () => {\n    expect(1).toBe(1)\n  })\n  test('saves', () => {\n    expect('md').toBe('md')\n  })\n})\n"
    // vitest 5.0.1: the listing and the JSON report agree that `saves` failed on an assertion.
    const classified = reported(
      fixture('vitest-setup-after-each.txt'),
      'tests/export.test.mjs',
      VITEST_REPORT,
      { kind: 'read', text: fixture('vitest-setup-after-each.json') },
      code,
    )
    expect(validRed(classified, 'tests/export.test.mjs', addedAt(code, 7, 9), true)).toBe(true)
    // Its configuration did not change: the setup file it names did.
    const config = "export default defineConfig({ test: { setupFiles: ['./tests/setup.mjs'] } })\n"
    expect(
      runnerChange(
        patchOf(['tests/setup.mjs', 'tests/export.test.mjs'], {
          files: ['vitest.config.mjs'],
          read: { 'vitest.config.mjs': config },
          testPath: 'tests/export.test.mjs',
          command: 'pnpm exec vitest run tests/export.test.mjs',
        }),
      ),
    ).toEqual({ path: 'tests/setup.mjs', why: 'named by vitest.config.mjs' })
  })

  test('a collection hook that swaps the added test’s name with an old failing one: a red by its run and its key line, refused by its patch', () => {
    const code =
      'def test_other():\n    assert 1 == 2\n\n\ndef test_saves():\n    assert "md" == "md"\n'
    expect(
      validRed(
        pytestRed('pytest-collection-swap', code),
        'tests/test_a.py',
        addedAt(code, 5, 6),
        true,
      ),
    ).toBe(true)
    const hook = 'def pytest_collection_modifyitems(items):\n    pass\n'
    expect(runnerChange(patchOf([['conftest.py', null, hook]]))).toEqual({
      path: 'conftest.py',
      why: 'a conftest.py',
    })
  })

  test('a red whose patch touches none of these files has no runner change', () => {
    const pyproject = '[project]\nname = "api"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n'
    expect(
      runnerChange(
        patchOf(['tests/test_a.py', 'api/invoices.py', 'README.md', 'src/export.ts'], {
          files: ['conftest.py', 'pyproject.toml', 'vitest.config.ts', 'tests/setup.ts'],
          read: {
            'conftest.py': 'import pytest\n',
            'pyproject.toml': pyproject,
            'vitest.config.ts': "export default { test: { setupFiles: ['tests/setup.ts'] } }\n",
          },
          command: 'NODE_OPTIONS="--require ./tests/register.cjs" pytest tests/test_a.py',
        }),
      ),
    ).toBeNull()
    expect(runnerChange(patchOf([]))).toBeNull()
  })

  test('a conftest.py at any level, in a folder above the test or beside it, in any case', () => {
    for (const path of [
      'conftest.py',
      'tests/conftest.py',
      'other/deep/conftest.py',
      'tests/Conftest.py',
      'CONFTEST.PY',
    ]) {
      expect([path, runnerChange(patchOf([[path, null, HOOK]]))]).toEqual([
        path,
        { path, why: 'a conftest.py' },
      ])
    }
    // Removed, it changes the verdict too.
    expect(runnerChange(patchOf([['tests/conftest.py', HOOK, null]]))?.path).toBe(
      'tests/conftest.py',
    )
  })

  test('a runner file renamed or moved changed on both sides: the name it left and the name it took', () => {
    const ini = '[pytest]\naddopts = -p no:randomly\n'
    // A rename is given as the file removed at its old path and added at its new one.
    expect(
      runnerChange(
        patchOf([
          ['pytest.ini', ini, null],
          ['pytest.ini.bak', null, ini],
        ]),
      ),
    ).toEqual({
      path: 'pytest.ini',
      why: 'pytest’s configuration',
    })
    expect(
      runnerChange(
        patchOf([
          ['vitest.config.ts', 'export default {}\n', null],
          ['config/vitest.config.mts', null, 'export default {}\n'],
        ]),
      ),
    ).toEqual({ path: 'vitest.config.ts', why: 'vitest’s configuration' })
    expect(
      runnerChange(
        patchOf([
          ['old/conftest.py', HOOK, null],
          ['tests/conftest.py', null, HOOK],
        ]),
      )?.path,
    ).toBe('old/conftest.py')
  })

  test('a runner file reached through a link: the file it leads to changed', () => {
    expect(
      runnerChange(
        patchOf(['shared/hooks.py'], {
          links: { 'tests/conftest.py': '../shared/hooks.py' },
          read: { 'tests/conftest.py': HOOK },
        }),
      ),
    ).toEqual({ path: 'shared/hooks.py', why: 'through the link tests/conftest.py' })
    // A folder of the path that is a link, and a setup file named through one.
    expect(
      runnerChange(
        patchOf(['support/setup.ts'], {
          files: ['vitest.config.ts'],
          links: { setup: 'support' },
          read: {
            'vitest.config.ts': "export default { test: { setupFiles: ['./setup/setup.ts'] } }\n",
          },
          testPath: 'tests/export.test.ts',
          command: 'vitest run tests/export.test.ts',
        }),
      ),
    ).toEqual({ path: 'support/setup.ts', why: 'named by vitest.config.ts' })
    // A link that leaves the repository leads nowhere Hemera judges.
    expect(
      runnerChange(
        patchOf(['shared/hooks.py'], { links: { 'conftest.py': '../../elsewhere/hooks.py' } }),
      ),
    ).toBeNull()
  })

  test('pyproject.toml changed outside its [tool.pytest] table is no runner change; inside it, or the table added or removed, it is', () => {
    const before =
      '[project]\nname = "api"\nversion = "1.0"\n\n[tool.pytest.ini_options]\naddopts = "-q"\n'
    const outside = before.replace('1.0', '1.1').concat('\n[tool.black]\nline-length = 100\n')
    const at = (after: string | null, from: string | null = before) =>
      runnerChange(patchOf([['pyproject.toml', from, after]]))
    expect(at(outside)).toBeNull()
    // The same table written otherwise reads the same.
    expect(
      at(
        '[project]\nname = "api"\nversion = "1.0"\n\n[tool.pytest]\nini_options = { addopts = "-q" }\n',
      ),
    ).toBeNull()
    const changed = { path: 'pyproject.toml', why: 'its [tool.pytest] table' }
    expect(at(before.replace('"-q"', '"-q -p tests.plugin"'))).toEqual(changed)
    expect(at('[project]\nname = "api"\n')).toEqual(changed)
    expect(at(`${outside}`, '[project]\nname = "api"\n')).toEqual(changed)
    // pytest 9's own table, a dotted key at the top, and a table whose name is quoted.
    expect(at(`${before}\n[tool.pytest]\nminversion = "9.0"\n`)).toEqual(changed)
    expect(
      at(`tool.pytest.ini_options.addopts = "-q -x"\n${before.replace(/\[tool[^]*$/, '')}`),
    ).toEqual(changed)
    expect(
      at(
        before
          .replace('[tool.pytest.ini_options]', '[tool."pytest".ini_options]')
          .replace('"-q"', '"-x"'),
      ),
    ).toEqual(changed)
    // A table hidden in a multi-line string is no table: the file read as TOML says so.
    expect(
      at(
        before.replace(
          'version = "1.0"',
          'version = "1.0"\ndescription = """\n[tool.pytest.ini_options]\naddopts = "-x"\n"""',
        ),
      ),
    ).toBeNull()
    expect(
      at(before.replace('addopts = "-q"', 'addopts = """\n[project]\n-p tests.plugin\n"""')),
    ).toEqual(changed)
    // A file that does not read as TOML is judged whole.
    expect(at('[project\nname = "api"\n')).toEqual(changed)
  })

  test('setup.cfg and tox.ini: only their pytest section; pytest.ini and pytest.toml whole', () => {
    const cfg = '[metadata]\nname = api\n\n[tool:pytest]\naddopts = -q\n'
    expect(
      runnerChange(patchOf([['setup.cfg', cfg, cfg.replace('name = api', 'name = acme')]])),
    ).toBeNull()
    expect(
      runnerChange(patchOf([['setup.cfg', cfg, cfg.replace('-q', '-q -p tests.plugin')]])),
    ).toEqual({
      path: 'setup.cfg',
      why: 'its [tool:pytest] section',
    })
    // A continuation line that looks like a header stays in its section.
    expect(
      runnerChange(
        patchOf([
          [
            'setup.cfg',
            cfg,
            cfg.replace('addopts = -q', 'addopts = -q\n  [metadata]\n  -p tests.plugin'),
          ],
        ]),
      )?.path,
    ).toBe('setup.cfg')
    const tox = '[tox]\nenvlist = py313\n\n[pytest]\naddopts = -q\n'
    expect(runnerChange(patchOf([['tox.ini', tox, tox.replace('py313', 'py314')]]))).toBeNull()
    expect(runnerChange(patchOf([['tox.ini', tox, tox.replace('-q', '-x')]]))).toEqual({
      path: 'tox.ini',
      why: 'its [pytest] section',
    })
    for (const path of ['pytest.ini', 'tests/.pytest.ini', 'pytest.toml', '.pytest.toml']) {
      expect([
        path,
        runnerChange(patchOf([[path, '[pytest]\n', '[pytest]\n# a comment\n']]))?.path,
      ]).toEqual([path, path])
    }
  })

  test('line endings alone change no runner file; a change under them does', () => {
    const crlf = (text: string) => text.replaceAll('\n', '\r\n')
    expect(runnerChange(patchOf([['conftest.py', HOOK, crlf(HOOK)]]))).toBeNull()
    const pyproject = '[tool.pytest.ini_options]\naddopts = "-q"\n'
    expect(runnerChange(patchOf([['pyproject.toml', pyproject, crlf(pyproject)]]))).toBeNull()
    const tox = '[pytest]\naddopts = -q\n'
    expect(runnerChange(patchOf([['tox.ini', crlf(tox), tox]]))).toBeNull()
    expect(runnerChange(patchOf([['conftest.py', HOOK, crlf(`${HOOK}x = 1\n`)]]))?.path).toBe(
      'conftest.py',
    )
    expect(runnerChange(patchOf([['tox.ini', tox, crlf(tox.replace('-q', '-x'))]]))?.path).toBe(
      'tox.ini',
    )
  })

  test('vitest’s configuration at any level, its workspace, and a setup file it names that the patch changed', () => {
    for (const path of [
      'vitest.config.ts',
      'packages/web/vite.config.mjs',
      'vitest.workspace.json',
      'Vitest.Config.CTS',
    ]) {
      expect([path, runnerChange(patchOf([[path, null, 'export default {}\n']]))?.why]).toEqual([
        path,
        'vitest’s configuration',
      ])
    }
    const config =
      'export default defineConfig({ test: { globalSetup: \'tests/global\', setupFiles: ["./setup.ts"] } })\n'
    const named = (changed: string) =>
      runnerChange(
        patchOf([changed], {
          files: ['packages/web/vitest.config.ts'],
          read: { 'packages/web/vitest.config.ts': config },
          testPath: 'packages/web/tests/export.test.ts',
          command: 'pnpm --filter web exec vitest run tests/export.test.ts',
        }),
      )
    expect(named('packages/web/setup.ts')).toEqual({
      path: 'packages/web/setup.ts',
      why: 'named by packages/web/vitest.config.ts',
    })
    // Named without its extension, and resolved from the configuration's folder or the root.
    expect(named('packages/web/tests/global.ts')?.path).toBe('packages/web/tests/global.ts')
    expect(named('tests/global.mjs')?.path).toBe('tests/global.mjs')
    expect(named('packages/web/src/export.ts')).toBeNull()
  })

  test('a file the proof’s command names, NODE_OPTIONS’ requires and imports included, changed', () => {
    const named = (command: string, changed: string) =>
      runnerChange(
        patchOf([changed, 'tests/export.test.mjs'], { command, testPath: 'tests/export.test.mjs' }),
      )
    const why = 'named by the proof’s command'
    expect(
      named(
        'node --test --import ./tests/register.mjs tests/export.test.mjs',
        'tests/register.mjs',
      ),
    ).toEqual({
      path: 'tests/register.mjs',
      why,
    })
    expect(
      named(
        "NODE_OPTIONS='--require ./tests/hooks' node --test tests/export.test.mjs",
        'tests/hooks.cjs',
      )?.path,
    ).toBe('tests/hooks.cjs')
    expect(
      named('node --test --require=tests\\hooks.js tests/export.test.mjs', 'tests/hooks.js')?.path,
    ).toBe('tests/hooks.js')
    expect(
      named('node --test --test-reporter=./reporter.mjs tests/export.test.mjs', 'reporter.mjs')
        ?.path,
    ).toBe('reporter.mjs')
    expect(
      named('vitest run --config vitest.ci.ts tests/export.test.mjs', 'vitest.ci.ts')?.path,
    ).toBe('vitest.ci.ts')
    expect(named('pytest -p tests.plugin tests/export.test.mjs', 'tests/plugin.py')?.path).toBe(
      'tests/plugin.py',
    )
    // The proof's own test file, which the command names, is the red's own change.
    expect(named('node --test tests/export.test.mjs', 'tests/export.test.mjs')).toBeNull()
    expect(named('node --test tests/export.test.mjs', 'tests/register.mjs')).toBeNull()
  })

  test('a pytest plugin named by an unchanged conftest.py or by its configuration, changed', () => {
    const named = (read: Readonly<Record<string, string>>, changed: string) =>
      runnerChange(patchOf([changed], { files: Object.keys(read), read }))
    expect(
      named(
        { 'tests/conftest.py': 'pytest_plugins = ["tests.helpers.hooks"]\n' },
        'tests/helpers/hooks.py',
      ),
    ).toEqual({
      path: 'tests/helpers/hooks.py',
      why: 'named by tests/conftest.py',
    })
    expect(
      named(
        { 'tests/conftest.py': "pytest_plugins = ['tests.plugins']\n" },
        'tests/plugins/__init__.py',
      )?.path,
    ).toBe('tests/plugins/__init__.py')
    expect(
      named(
        { 'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-p tests.plugin"\n' },
        'tests/plugin.py',
      )?.path,
    ).toBe('tests/plugin.py')
    // What the rest of pyproject.toml names is not the runner's.
    expect(named({ 'pyproject.toml': '[project]\nreadme = "README.md"\n' }, 'README.md')).toBeNull()
  })

  test('package.json: its scripts changed is a runner change, its dependencies are not; .npmrc whole', () => {
    const json = (
      scripts: Readonly<Record<string, string>>,
      dependencies: Readonly<Record<string, string>> = {},
    ) => JSON.stringify({ name: 'api', scripts, dependencies }, null, 2)
    const before = json({ test: 'vitest run' })
    expect(
      runnerChange(
        patchOf([['package.json', before, json({ test: 'vitest run' }, { acme: '1.0.0' })]]),
      ),
    ).toBeNull()
    expect(
      runnerChange(
        patchOf([['package.json', before, json({ test: 'vitest run --setupFiles x.ts' })]]),
      ),
    ).toEqual({
      path: 'package.json',
      why: 'its scripts',
    })
    expect(
      runnerChange(patchOf([['web/package.json', null, json({ test: 'vitest' })]]))?.path,
    ).toBe('web/package.json')
    expect(
      runnerChange(patchOf([['.npmrc', null, 'node-options=--require ./hooks.cjs\n']])),
    ).toEqual({
      path: '.npmrc',
      why: 'npm’s configuration',
    })
  })

  test('the runner files read are those on the test’s path and the files its command names, each where its links lead', () => {
    const tree = treeOf(
      [
        'conftest.py',
        'tests/conftest.py',
        'tests/unit/test_a.py',
        'other/conftest.py',
        'pyproject.toml',
        'web/vitest.config.ts',
        'vitest.ci.ts',
        'README.md',
      ],
      { 'tests/unit/Conftest.py': '../../shared/hooks.py' },
    )
    expect(
      runnerReads(tree, 'tests/unit/test_a.py', 'pytest -c vitest.ci.ts tests/unit/test_a.py'),
    ).toEqual([
      { path: 'conftest.py', real: 'conftest.py' },
      { path: 'tests/conftest.py', real: 'tests/conftest.py' },
      { path: 'pyproject.toml', real: 'pyproject.toml' },
      { path: 'tests/unit/Conftest.py', real: 'shared/hooks.py' },
      { path: 'vitest.ci.ts', real: 'vitest.ci.ts' },
    ])
  })
})
