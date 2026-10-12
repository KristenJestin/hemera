/**
 * Red first, then green (#144): how Hemera classifies a proof run (CT-35) from the report the
 * Project's test runner prints (JUnit XML, TAP) or from its exit code and its words, what makes a
 * red valid, and how a key line observed in Planning is found again once colours, paths,
 * durations, addresses and numbers are masked.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type ScenarioProofState,
  classifyProofRun,
  addedTestNames,
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

  test('a red from plain vitest output, with no report, is valid when the scenario’s test is named in it', () => {
    const output = [
      ' FAIL  tests/export.test.ts > exports > the invoices export as Markdown',
      'AssertionError: expected false to be true // Object.is equality',
      ' Test Files  1 failed (1)',
    ].join('\n')
    const names = ['the invoices export as Markdown']
    expect(
      validRed(run(output, 1), 'tests/export.test.ts', names, { output, keyLineMatched: null }),
    ).toBe(true)
    const other = output.replace('the invoices export as Markdown', 'one is one')
    expect(
      validRed(run(other, 1), 'tests/export.test.ts', names, {
        output: other,
        keyLineMatched: null,
      }),
    ).toBe(false)
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
      validRed(run(output, 1), 'tests/export.test.ts', ['the invoices export as Markdown'], {
        output,
        keyLineMatched: null,
      }),
    ).toBe(true)
  })

  test('a test named through describe.each or a template is found again in the output', () => {
    const code = [
      "describe.each(['csv', 'md'])('exports %s', (kind) => {",
      '  it(`writes ${kind}`, () => {})',
      '})',
    ].join('\n')
    const names = addedTestNames({ insertion: 'new_file', code, patch: null })
    const output =
      ' FAIL  tests/export.test.ts > exports md > writes md\nAssertionError: expected 1 to be 2'
    expect(
      validRed(run(output, 1), 'tests/export.test.ts', names, { output, keyLineMatched: null }),
    ).toBe(true)
  })

  test('with no file named, the key line decides when no test name is found', () => {
    const output = 'AssertionError: the CSV uses commas'
    const path = 'tests/export.test.mjs'
    expect(
      validRed(run(output, 1), path, ['exports as CSV'], { output, keyLineMatched: true }),
    ).toBe(true)
    expect(
      validRed(run(output, 1), path, ['exports as CSV'], { output, keyLineMatched: null }),
    ).toBe(false)
    // Nothing to tell it by: the exit code decides.
    expect(validRed(run(output, 1), path, [], { output, keyLineMatched: null })).toBe(true)
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
