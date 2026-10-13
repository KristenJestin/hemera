/**
 * Red first, then green (#144): how Hemera classifies a proof run (CT-35) from the report the
 * Project's test runner prints (JUnit XML, TAP) or from its exit code and its words, what makes a
 * red valid, and how a key line observed in Planning is found again once colours, paths,
 * durations, addresses and numbers are masked.
 */

import { readFileSync } from 'node:fs'

import { Predicate } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type ScenarioProofState,
  classifyProofRun,
  addedTestNames,
  addedTests,
  keyLineFound,
  normalisedOutput,
  redPassed,
  validRed,
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
    expect(validRed(run(TAP_ASSERTION, 1), 'tests/export.test.mjs')).toBe(true)
    expect(validRed(run(TAP_ASSERTION, 1), 'tests/import.test.mjs')).toBe(false)
    expect(validRed(run(TAP_IMPORT, 1), 'tests/export.test.mjs')).toBe(false)
    expect(validRed(run('exit 1', 1, null), null)).toBe(true)
  })

  test('an existing failing test in the same file is not taken as the scenario’s red', () => {
    const scenario = ['the invoices export as Markdown']
    expect(validRed(run(TAP_OTHER_FAILS, 1), 'tests/export.test.mjs', scenario)).toBe(false)
    expect(validRed(run(TAP_BOTH_FAIL, 1), 'tests/export.test.mjs', scenario)).toBe(true)
  })

  test('a TAP report written on Windows, its location’s backslashes escaped, names the scenario’s test file', () => {
    const windows = TAP_ASSERTION.replace(
      /location: '[^']*'/,
      "location: 'D:\\\\a\\\\_temp\\\\api\\\\tests\\\\export.test.mjs:5:1'",
    )
    expect(windows).toContain('D:\\\\a')
    expect(validRed(run(windows, 1), 'tests/export.test.mjs')).toBe(true)
  })

  test('a red from plain vitest output, with no report, is valid when the scenario’s test is named among its failures', () => {
    const output = [
      ' FAIL  tests/export.test.ts > exports > the invoices export as Markdown',
      'AssertionError: expected false to be true // Object.is equality',
      ' Test Files  1 failed (1)',
    ].join('\n')
    const names = ['the invoices export as Markdown']
    expect(validRed(run(output, 1, 'tests/export.test.ts'), 'tests/export.test.ts', names)).toBe(
      true,
    )
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
      validRed(run(output, 1), 'tests/export.test.ts', ['the invoices export as Markdown']),
    ).toBe(true)
  })

  test('a test named through describe.each or a template is found again among the failures', () => {
    const code = [
      "describe.each(['csv', 'md'])('exports %s', (kind) => {",
      '  it(`writes ${kind}`, () => {})',
      '})',
    ].join('\n')
    const names = addedTestNames({ insertion: 'new_file', code, patch: null })
    const output =
      ' FAIL  tests/export.test.ts > exports md > writes md\nAssertionError: expected 1 to be 2'
    expect(validRed(run(output, 1), 'tests/export.test.ts', names)).toBe(true)
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
    expect(validRed(run(output, 1), 'tests/export.test.ts', ['exports as CSV'])).toBe(true)
  })

  test('a name made of a placeholder alone matches nothing', () => {
    const output = ' × md 3ms\nAssertionError: expected 1 to be 2'
    expect(validRed(run(output, 1), 'tests/export.test.ts', ['${kind}'])).toBe(false)
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
      validRed(run(output, 1), 'tests/export.test.ts', ['the invoices export as Markdown']),
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
    expect(validRed(run(MOCHA_SCENARIO_FAILS, 1, path), path, SCENARIO)).toBe(true)
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
    expect(validRed(run(PYTEST_BOTH_FAIL, 1, path), path, names)).toBe(true)
  })

  test('a Go func TestX failing is a red, by name', () => {
    const path = 'export_test.go'
    const names = addedTestNames({
      insertion: 'new_file',
      code: 'package acme\n\nimport "testing"\n\nfunc TestExportMarkdown(t *testing.T) {\n\tif got := ToMarkdown(); got != "| total |" {\n\t\tt.Errorf("got %q", got)\n\t}\n}\n',
      patch: null,
    })
    expect(names).toEqual(['TestExportMarkdown'])
    expect(validRed(run(GO_SCENARIO_FAILS, 1, path), path, names)).toBe(true)
    expect(validRed(run(GO_SCENARIO_FAILS, 1, path), path, ['TestImportCsv'])).toBe(false)
  })

  test('a Rust #[test] fn x failing is a red, by name', () => {
    const path = 'src/lib.rs'
    const names = addedTestNames({
      insertion: 'addition',
      code: '',
      patch:
        '@@ -8,0 +9,5 @@\n+    #[test]\n+    fn exports_markdown() {\n+        assert_eq!(to_markdown(), "| total |");\n+    }\n',
    })
    expect(names).toEqual(['exports_markdown'])
    expect(validRed(run(CARGO_SCENARIO_FAILS, 101, path), path, names)).toBe(true)
    expect(validRed(run(CARGO_SCENARIO_FAILS, 101, path), path, ['one_is_one'])).toBe(false)
  })

  test('jest’s and node:test’s marks are read, by name', () => {
    const jest = 'tests/export.test.js'
    expect(validRed(run(JEST_SCENARIO_FAILS, 1, jest), jest, SCENARIO)).toBe(true)
    expect(validRed(run(JEST_SCENARIO_FAILS, 1, jest), jest, ['one is one'])).toBe(false)
    const node = 'tests/export.test.mjs'
    expect(validRed(run(NODE_SPEC_SCENARIO_FAILS, 1, node), node, SCENARIO)).toBe(true)
    expect(validRed(run(NODE_SPEC_SCENARIO_FAILS, 1, node), node, ['one is one'])).toBe(false)
  })

  test('a mark coloured by the runner is read once its colours are removed', () => {
    const output =
      '\u001b[31m FAIL \u001b[39m tests/export.test.ts > the invoices export as Markdown\nAssertionError: no'
    expect(validRed(run(output, 1), 'tests/export.test.ts', SCENARIO)).toBe(true)
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
      expect(validRed(run(output, 1, path), path, names)).toBe(false)
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
    expect(validRed(run(PYTEST_PARAMETRISED_FAILS, 1, path), path, names)).toBe(true)
    expect(validRed(run(PYTEST_PARAMETRISED_FAILS, 1, path), path, ['test_one_is_one'])).toBe(false)
  })

  test('a pytest case id with spaces, brackets or unicode is read as its declared test', () => {
    const path = 'tests/test_export.py'
    const lines = run(PYTEST_PARAMETRISED_FAILS, 1, path).failingLines
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(validRed(run(line, 1, path), path, ['test_exports'])).toBe(true)
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
    expect(validRed(run(PYTEST_PARAMETRISED_OTHER_FAILS, 1, path), path, ['test_one_is_one'])).toBe(
      true,
    )
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
    expect(validRed(run(GO_SUBTEST_FAILS, 1, path), path, ['TestExport'])).toBe(true)
    expect(validRed(run(GO_SUBTEST_FAILS, 1, path), path, ['TestImport'])).toBe(false)
  })

  test('a Go subtest the proof adds is read under the name Go prints, at any depth', () => {
    const path = 'export_test.go'
    const red = (subtest: string) =>
      validRed(run(GO_SUBTEST_FAILS, 1, path), path, [
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
    expect(validRed(run(GO_OTHER_SUBTEST_FAILS, 1, path), path, names)).toBe(false)
    const csv = [{ parent: 'TestExport', subtest: 'csv', nesting: [], whole: false }]
    expect(validRed(run(GO_OTHER_SUBTEST_FAILS, 1, path), path, csv)).toBe(true)
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
    expect(validRed(run(GO_OTHER_PARENT_FAILS, 1, path), path, names)).toBe(false)
    const imported = [{ parent: 'TestImport', subtest: 'empty', nesting: [], whole: false }]
    expect(validRed(run(GO_OTHER_PARENT_FAILS, 1, path), path, imported)).toBe(true)
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
      expect(validRed(run(unittest, 1, path), path, [name])).toBe(true)
    }
    for (const name of ['test_reads_back', 'test_exports_csv', 'test_one_is_one']) {
      expect(validRed(run(unittest, 1, path), path, [name])).toBe(false)
    }
    const django = captured('django')
    const tests = 'exports/tests.py'
    expect(validRed(run(django, 1, tests), tests, ['test_exports_markdown'])).toBe(true)
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

  test('a gotestsum === FAIL: line is a red, by name; its SKIP lines and a build failure are not', () => {
    const output = captured('gotestsum')
    const path = 'export_test.go'
    expect(run(output, 1, path).classification).toBe('assertion_failed')
    expect(validRed(run(output, 1, path), path, ['TestExportMarkdown'])).toBe(true)
    expect(validRed(run(output, 1, path), path, ['TestExportMarkdownSkipped'])).toBe(false)
    expect(validRed(run(output, 1, path), path, ['TestOneIsOne'])).toBe(false)
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
      { function: 'rejects_markdown' },
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
    const render = [{ function: 'render' }]
    for (const line of [
      'test render::tests::handles_empty ... FAILED',
      '        FAIL [   0.004s] acme render::tests::handles_empty',
      'test render::other ... FAILED',
    ]) {
      const output = [line, 'assertion `left == right` failed'].join('\n')
      expect(run(output, 101, path).failingLines).toEqual([line])
      expect(validRed(run(output, 101, path), path, render)).toBe(false)
    }
    for (const line of [
      'test tests::render::case_1 ... FAILED',
      'test tests::render::case_2_empty_rows ... FAILED',
      '        FAIL [   0.004s] acme tests::render::test_case_1_with_no_rows',
    ]) {
      const output = [line, 'assertion `left == right` failed'].join('\n')
      expect(validRed(run(output, 101, path), path, render)).toBe(true)
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
    expect(validRed(run(output, 1, path), path, SCENARIO)).toBe(true)
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
    expect(validRed(run(output, 1, path), path, SCENARIO)).toBe(true)
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
    expect(validRed(run(GO_OTHER_BRANCH_FAILS, 1, path), path, empty)).toBe(false)
    expect(validRed(run(GO_BRANCH_FAILS, 1, path), path, empty)).toBe(true)
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
      validRed(run(output, 1, path), path, names.slice(at, at + 1))
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
    expect(validRed(run(GO_PARENTLESS_FAILS, 1, path), path, names, true)).toBe(true)
    expect(validRed(run(GO_PARENTLESS_FAILS, 1, path), path, names, false)).toBe(false)
    expect(validRed(run(GO_PARENTLESS_FAILS, 1, path), path, names, null)).toBe(true)
    const helper = ['func check(t *testing.T) {', '\tt.Run("empty", nil)', '}'].join('\n')
    expect(addedTests({ insertion: 'new_file', code: helper, patch: null })).toEqual([
      { parent: null, subtest: 'empty', nesting: [], whole: true },
    ])
    // A report that names the file decides by the key line too; a named test keeps its own rule.
    const junit = run(JUNIT_ASSERTION, 1)
    expect(validRed(junit, 'tests/export.test.mjs', names, true)).toBe(true)
    expect(validRed(junit, 'tests/export.test.mjs', names, false)).toBe(false)
    expect(validRed(junit, 'tests/export.test.mjs', [...names, 'exports as TSV'], true)).toBe(false)
  })

  test('a testify suite method’s subtest is a red on its exit code when the proof has no key line, and not when its key line differs', () => {
    const path = 'export_test.go'
    const names = addedTests({ insertion: 'addition', code: '', patch: GO_SUITE_PATCH })
    expect(names).toEqual([{ parent: null, subtest: 'empty', nesting: [], whole: true }])
    expect(validRed(run(GO_SUITE_FAILS, 1, path), path, names, null)).toBe(true)
    expect(validRed(run(GO_SUITE_FAILS, 1, path), path, names, false)).toBe(false)
    expect(validRed(run(GO_SUITE_FAILS, 1, path), path, names, true)).toBe(true)
    expect(validRed(run(JUNIT_ASSERTION, 1), 'tests/export.test.mjs', names, null)).toBe(true)
  })

  test('a pytest id inside another test’s case id is not that test', () => {
    const path = 'tests/test_export.py'
    expect(run(PYTEST_ID_INSIDE_OTHER_FAILS, 1, path).failingLines).toHaveLength(2)
    expect(validRed(run(PYTEST_ID_INSIDE_OTHER_FAILS, 1, path), path, ['test_x'])).toBe(false)
    expect(validRed(run(PYTEST_ID_INSIDE_OTHER_FAILS, 1, path), path, ['test_other'])).toBe(true)
    expect(validRed(run(PYTEST_ID_INSIDE_FAILS, 1, path), path, ['test_x'])).toBe(true)
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

describe('A Go subtest’s nesting read at its own brace, and the pytest ids #291 left', () => {
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
    expect(validRed(run(GO_CSV_FAILS, 1, path), path, subtests)).toBe(false)
    expect(validRed(run(GO_BRANCH_FAILS, 1, path), path, subtests)).toBe(true)
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
      expect(validRed(run(GO_OTHER_EMPTY_FAILS, 1, path), path, empty)).toBe(false)
      expect(validRed(run(GO_BRANCH_FAILS, 1, path), path, empty)).toBe(true)
    }
  })

  test('a subtest in a hunk that starts inside its t.Run block is still read by its name, a differing key line left to the user', () => {
    const path = 'export_test.go'
    const names = addedTests({ insertion: 'addition', code: '', patch: GO_INSIDE_PATCH })
    expect(names).toEqual([{ parent: 'TestExport', subtest: 'empty', nesting: [], whole: false }])
    // A red whose key line differs is a red the user is asked about (red_mismatch), not refused.
    expect(validRed(run(GO_BRANCH_FAILS, 1, path), path, names, false)).toBe(true)
    expect(validRed(run(GO_BRANCH_FAILS, 1, path), path, names, true)).toBe(true)
    expect(validRed(run(GO_BRANCH_FAILS, 1, path), path, names, null)).toBe(true)
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
      expect(validRed(run(output, 1, path), path, ['reads a file'])).toBe(true)
      expect(validRed(run(output, 1, path), path, ['reads a dir'])).toBe(false)
    }
  })

  test('a failing line of 300 KB is read in well under a second', () => {
    const path = 'src/a.test.ts'
    const long = ` × src/a.test.ts > ${'[a] '.repeat(75_000)}> reads a file 3ms`
    const output = `${long}\nAssertionError: expected false to be true // Object.is equality`
    const started = performance.now()
    expect(validRed(run(output, 1, path), path, ['reads a dir'])).toBe(false)
    expect(performance.now() - started).toBeLessThan(500)
  })

  test('a pytest id after a space in a case id, or in a summary line’s message, is not that test', () => {
    const path = 'tests/test_export.py'
    expect(run(PYTEST_SPACED_OTHER_FAILS, 1, path).failingLines).toHaveLength(2)
    expect(validRed(run(PYTEST_SPACED_OTHER_FAILS, 1, path), path, ['test_x'])).toBe(false)
    expect(validRed(run(PYTEST_SPACED_OTHER_FAILS, 1, path), path, ['test_other'])).toBe(true)
    expect(validRed(run(PYTEST_SPACED_OTHER_FAILS, 1, path), path, ['test_y'])).toBe(true)
  })
})
