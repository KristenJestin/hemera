/**
 * Red first, then green (#144): the runs of a scenario's proof and what they make of it. Every
 * automated scenario's test is written by Hemera at the start of Building and must fail first,
 * for the reason the Spec gives; its tasks wait for that red; once they are done, the same proof
 * runs again and must pass. Pure rules: the engine runs, records and asks.
 *
 * - **CT-35, the classification.** A run is `assertion_failed` (the scenario's test ran and an
 *   assertion failed), `test_not_found`, `error_before_test` (compilation, import, missing
 *   dependency, setup), `environment` (a service unreachable, a timeout, a port taken, a process
 *   killed) or `passed`. A structured report the test runner prints (JUnit XML, TAP) is read
 *   first; otherwise the exit code and the words of the output.
 * - **A valid red** is `assertion_failed` in the scenario's own test.
 * - **The key line** observed in Planning is found again once both sides are normalised: ANSI
 *   colours removed, paths, durations, addresses and numbers masked.
 */

import { Predicate, Schema } from 'effect'

/** How a proof run ended, as Hemera classifies it (CT-35). */
export const PROOF_CLASSES = [
  'assertion_failed',
  'test_not_found',
  'error_before_test',
  'environment',
  'passed',
] as const
export const ProofClass = Schema.Literals(PROOF_CLASSES)
export type ProofClass = typeof ProofClass.Type

/**
 * Why a proof ran: its red at the start, its green once its tasks are done, a re-run when stale,
 * or for information only (a `proof_run` before its tasks are done), which judges nothing.
 */
export const PROOF_PHASES = ['red', 'green', 'rerun', 'info'] as const
export const ProofPhase = Schema.Literals(PROOF_PHASES)
export type ProofPhase = typeof ProofPhase.Type

/**
 * Where a scenario's proof stands in a Building. Automated: waiting for its red, its red recorded,
 * held by a need, not reproducible, green, or to re-run (its green is stale); not proven when the
 * user ended the Building without it. Verified by hand: to verify, validated, refused.
 */
export const SCENARIO_PROOF_STATES = [
  'waiting_red',
  'red_recorded',
  'held',
  'not_reproducible',
  'green',
  'to_rerun',
  'not_proven',
  'to_verify',
  'validated',
  'refused',
] as const
export const ScenarioProofState = Schema.Literals(SCENARIO_PROOF_STATES)
export type ScenarioProofState = typeof ScenarioProofState.Type

/** Whether a scenario got past its red: a task covering it may start. */
export const redPassed = (state: ScenarioProofState): boolean =>
  state === 'red_recorded' ||
  state === 'not_reproducible' ||
  state === 'green' ||
  state === 'to_rerun'

/** A proof run classified: why, and the failing test and assertion when the report names them. */
export interface ProofRunClass {
  readonly classification: ProofClass
  readonly failingTest: string | null
  /** The first line of the failing assertion's message. */
  readonly assertion: string | null
  /** The file the failing test is in, as the report names it. */
  readonly failingFile: string | null
  /** Every test the report says failed: its name, its file, and whether an assertion did it. */
  readonly failures: ReadonlyArray<{
    readonly test: string
    readonly file: string | null
    readonly assertion: boolean
  }>
  /** The lines of the whole output that start with a known runner's failure mark, uncoloured. */
  readonly failingLines: ReadonlyArray<string>
}

/** One failure a report names: its test, its file, and what it says. */
interface Failure {
  readonly test: string
  readonly file: string | null
  readonly text: string
}

/**
 * Signs of a world that did not let the test run: a service, a port, the runner's own timeout.
 * Words an assertion says ("the export timed out") are the test's, never the environment's.
 */
const ENVIRONMENT =
  /\b(ECONNREFUSED|ECONNRESET|EADDRINUSE|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN)\b|address already in use|testTimeoutFailure|\bTest timed out in \d+ ?ms|Exceeded timeout of \d+ ?ms|Timeout of \d+ ?ms exceeded/
/** Signs of a test that never ran: compilation, import, a missing dependency. */
const BEFORE_TEST =
  /\b(SyntaxError|ReferenceError|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_REQUIRE_ESM)\b|Cannot find (module|package)|error TS\d+|does not provide an export named/
/**
 * Signs of an assertion that failed: JavaScript's, pytest's (`E   assert …`, `FAILED file::test`),
 * Go's (`--- FAIL:`, gotestsum's `=== FAIL: pkg TestX (…)`) and Rust's (`assertion … failed`, a
 * test's panic, a `#[should_panic]` test that did not).
 */
const ASSERTION =
  /\b(ERR_ASSERTION|AssertionError|AssertionFailedError)\b|\bexpect\(.*\)\.|^E\s+assert\b|^FAILED \S+::|^--- FAIL: |^=== FAIL: \S+ Test\S* \(\d+(?:\.\d+)?s\)\s*$|\bassertion\b.*\bfailed\b|\bpanicked at\b|\btest did not panic as expected\b/m
/**
 * A line a known test runner starts with for a test that failed, never a mark in the middle of a
 * line: vitest, jest and node:test's `×`, `✕`, `✖`; jest's `●` heading (not its `● Console` nor
 * its `● Test suite failed to run`); vitest and jest's `FAIL <file>`, jest's with a project's
 * `displayName` before a test file; TAP's `not ok n`; pytest's `FAILED file::test`; unittest's
 * and Django's `FAIL: test_x (module.Class.test_x)`; Go's `--- FAIL: TestX`, gotestsum's
 * `=== FAIL: pkg TestX (0.00s)`; Rust's `test x ... FAILED` (`test x - should panic ... FAILED`),
 * cargo-nextest's `FAIL [ 0.004s] (1/2) crate x`. Mocha's `1) name` is read apart.
 */
const FAILING_LINE =
  /^\s*[×✕✖]\s|^\s*●\s(?!(?:Console|Test suite failed to run)\s*$)|^\s*FAIL\s+(?:\|[^|]*\|\s+)?\S+\.\w+(?:\s|$)|^\s*FAIL\s+\S.*?\s(?:\S+\.(?:test|spec)\.\w+|\S*__tests__\/\S+)(?:\s+\(\d+(?:\.\d+)? m?s\))?\s*$|^\s*not ok \d+|^FAILED \S+::|^FAIL: test\w* \(\w+(?:\.\w+)+\)(?: .*)?$|^\s*--- FAIL: |^=== FAIL: \S+ Test\S* \(\d+(?:\.\d+)?s\)\s*$|^test \S+(?: - should panic)? \.\.\. FAILED\s*$|^\s*FAIL \[\s*\d+(?:\.\d+)?s\] (?:\(\s*\d+\/\d+\) )?\S+ \S+\s*$/
/** Mocha's numbered failure, `1) name`, in its tree and again in its list after `N failing`. */
const MOCHA_FAILURE = /^\s*(\d+)\) /
const MOCHA_FAILING = /^\s*(\d+) failing\s*$/
/** At most this many failing lines are kept. */
const FAILING_LINES = 500
/** Signs of a test file the runner did not find. */
const NOT_FOUND =
  /Could not find '|No test files? found|no tests? (were )?found|ENOENT[^\n]*\.test\./i

/** A line without its ANSI colours and cursor moves. */
// oxlint-disable-next-line no-control-regex -- the escape character is what is matched
const uncoloured = (line: string): string => line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')

/**
 * The lines of an output that mark a failing test, uncoloured, up to the cap. A numbered line is
 * mocha's only below the `N failing` it ends with, and twice at most (its tree, its list): a
 * numbered log line is not one, and cannot push a real failure past the cap.
 */
const failingLinesOf = (output: string): ReadonlyArray<string> => {
  const lines = output.split(/\r?\n/).map(uncoloured)
  const failing = lines.reduce(
    (most, line) => Math.max(most, Number(MOCHA_FAILING.exec(line)?.[1] ?? 0)),
    0,
  )
  const numbered = new Map<number, number>()
  return lines
    .filter((line) => {
      if (FAILING_LINE.test(line)) return true
      const number = Number(MOCHA_FAILURE.exec(line)?.[1] ?? 0)
      if (number < 1 || number > failing) return false
      const seen = (numbered.get(number) ?? 0) + 1
      numbered.set(number, seen)
      return seen <= 2
    })
    .slice(0, FAILING_LINES)
}

const unescapeXml = (text: string): string =>
  text
    .replaceAll('&#10;', '\n')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

const attributeOf = (tag: string, name: string): string | null => {
  const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)
  return found === null ? null : unescapeXml(found[1] ?? '')
}

/** The failures of a JUnit XML report and its number of tests, or null when there is none. */
const junitOf = (output: string) => {
  if (!output.includes('<testsuites') && !output.includes('<testsuite')) return null
  const cases = [...output.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)]
  const counted = /<!--\s*tests\s+(\d+)\s*-->/.exec(output)
  const failures: Failure[] = []
  for (const one of cases) {
    const tag = one[1] ?? ''
    const body = one[3] ?? ''
    const failure = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>|<(failure|error)\b([^>]*)\/>/.exec(
      body,
    )
    if (failure === null) continue
    const attributes = failure[2] ?? failure[5] ?? ''
    failures.push({
      test: attributeOf(tag, 'name') ?? '',
      file: attributeOf(tag, 'file'),
      text: `${attributeOf(attributes, 'message') ?? ''}\n${unescapeXml(failure[3] ?? '')}`,
    })
  }
  return { tests: counted === null ? cases.length : Number(counted[1]), failures }
}

/** The failures of a TAP report and its number of tests, or null when there is none. */
const tapOf = (output: string) => {
  const lines = output.split('\n')
  const results = lines.filter((line) => /^\s*(not )?ok \d+/.test(line))
  if (!output.includes('TAP version') && results.length === 0) return null
  const counted = /^# tests (\d+)/m.exec(output)
  const failures: Failure[] = []
  for (const [at, line] of lines.entries()) {
    const failed = /^(\s*)not ok \d+ - (.*)$/.exec(line)
    if (failed === null) continue
    // Its YAML block, up to the `...` that closes it.
    const block: string[] = []
    for (const next of lines.slice(at + 1)) {
      if (/^\s*\.\.\.\s*$/.test(next)) break
      block.push(next)
    }
    const text = block.join('\n')
    failures.push({
      test: failed[2]?.trim() ?? '',
      file: /location: '([^']*?)(:\d+:\d+)?'/.exec(text)?.[1] ?? null,
      text,
    })
  }
  // A suite fails because a test inside it did: only the tests say why.
  const leaves = failures.filter((one) => !/\d+ subtests? failed/.test(one.text))
  return { tests: counted === null ? results.length : Number(counted[1]), failures: leaves }
}

/** The first line of a failure's message: the assertion's words. */
const assertionOf = (failure: Failure): string | null => {
  const tapError = /error: \|-\n\s*(.+)/.exec(failure.text) ?? /error: '(.+)'/.exec(failure.text)
  const said = tapError?.[1] ?? failure.text.trim().split('\n')[0] ?? ''
  const line = said.replace(/^.*?(AssertionError)( \[ERR_ASSERTION\])?: /, '').trim()
  return line === '' ? null : line
}

const classOfFailure = (failure: Failure): ProofClass => {
  if (ASSERTION.test(failure.text)) return 'assertion_failed'
  if (ENVIRONMENT.test(failure.text)) return 'environment'
  return 'error_before_test'
}

/**
 * Classifies a proof run (CT-35) from what it printed and its exit code, null when it never exited
 * on its own (killed, timed out, refused before it started). `testPath` is the scenario's test
 * file, null for a proof that is a command with no test file.
 */
export function classifyProofRun(run: {
  readonly output: string
  readonly exitCode: number | null
  readonly testPath: string | null
}): ProofRunClass {
  const failingLines = failingLinesOf(run.output)
  const none = { failingTest: null, assertion: null, failingFile: null, failures: [], failingLines }
  if (run.exitCode === null) return { classification: 'environment', ...none }
  const report = junitOf(run.output) ?? tapOf(run.output)
  // What the runner says before any test, beside the report, is read first.
  if (NOT_FOUND.test(run.output) && (report === null || report.tests === 0)) {
    return { classification: 'test_not_found', ...none }
  }
  if (report !== null) {
    if (report.tests === 0) return { classification: 'test_not_found', ...none }
    if (report.failures.length === 0) {
      return run.exitCode === 0
        ? { classification: 'passed', ...none }
        : { classification: wordsClass(run.output, run.testPath), ...none }
    }
    const classes = report.failures.map(classOfFailure)
    const classification: ProofClass = classes.includes('environment')
      ? 'environment'
      : classes.includes('error_before_test')
        ? 'error_before_test'
        : 'assertion_failed'
    const first =
      report.failures.find((one) => classOfFailure(one) === classification) ?? report.failures[0]
    return {
      classification,
      failingTest: first?.test ?? null,
      assertion:
        first === undefined || classification !== 'assertion_failed' ? null : assertionOf(first),
      failingFile: first?.file ?? null,
      failures: report.failures.map((one) => ({
        test: one.test,
        file: one.file,
        assertion: classOfFailure(one) === 'assertion_failed',
      })),
      failingLines,
    }
  }
  if (run.exitCode === 0) return { classification: 'passed', ...none }
  return { classification: wordsClass(run.output, run.testPath), ...none }
}

/** A failed run without a report, from its words. */
const wordsClass = (output: string, testPath: string | null): ProofClass => {
  if (ASSERTION.test(output)) return 'assertion_failed'
  if (ENVIRONMENT.test(output)) return 'environment'
  if (BEFORE_TEST.test(output)) return 'error_before_test'
  // A command's exit code is its expected result; a test that failed in no words never ran.
  return testPath === null ? 'assertion_failed' : 'error_before_test'
}

/** A Go subtest a proof adds: the test function it runs under, and its literal `t.Run` name. */
export interface GoSubtest {
  readonly parent: string
  readonly subtest: string
}
/**
 * A Rust test with cases (`#[rstest]`, `#[test_case(…)]`): its function's name, which libtest
 * prints alone or with each case under it (`tests::exports::case_1`).
 */
export interface RustCasedTest {
  readonly function: string
}
/** A test a proof adds: its declared name, a Go subtest under its parent, or a Rust cased test. */
export type TestName = string | GoSubtest | RustCasedTest

/** A path with forward slashes: a TAP report on Windows escapes its backslashes, doubled. */
const posix = (path: string): string => path.replace(/\\+/g, '/')

/**
 * A test's declared name as a pattern matched whole: from the start of a line or after a
 * separator (`>`, `›`, `::`, a space), up to the end of the line or what a runner prints after a
 * name (a duration, `(`, `[`, ` - `, ` ...`), or after pytest's `::` up to a case's `[id]`. A
 * `::` is a node id's before its first `[`: a case id holding `::test_x[` is not `test_x`. What
 * `%s`, `$name` or `${…}` stand for (`each`, a template literal) matches words within a name; a
 * name made of placeholders alone is none. A Rust cased test's name may go on with its cases,
 * shaped as rstest's `::case_1` or test_case's `::test_case_1_…`: never another test of a module
 * named the same.
 */
const namePattern = (name: string, cases = false): RegExp | null => {
  const parts = name.split(/(%[sdifjoOp#%]|\$\{[^}]*\}|\$\w+)/)
  if (parts.every((part, at) => at % 2 === 1 || part.trim() === '')) return null
  const body = parts
    .map((part, at) => (at % 2 === 1 ? '[^\\n>›]+?' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('')
  const named = cases ? `${body}(?:::(?:test_)?case_\\d+\\w*)*` : body
  return new RegExp(
    `(?:^|\\s)[^\\s[]*::${body}\\[|(?:^|[\\s>›]|(?:^|\\s)[^\\s[]*::)${named}(?=\\s*$|\\s+\\d+(?:\\.\\d+)?\\s?m?s\\b|\\s+\\(|\\s+\\[|\\s+-\\s|\\s+\\.\\.\\.)`,
  )
}

/**
 * A Go subtest as `go test` prints it: its parent function, any subtests between, then its name
 * with each space turned into `_` (`TestExport/as_markdown/with_header`), on a `--- FAIL:` line or
 * as a report's test name.
 */
const subtestPattern = (test: GoSubtest): RegExp => {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const subtest = escape(test.subtest.replace(/\s/g, '_'))
  return new RegExp(
    `^(?:\\s*--- FAIL: )?${escape(test.parent)}(?:/[^\\s/]+)*/${subtest}(?=\\s+\\(|\\s*$)`,
  )
}

const named = (texts: ReadonlyArray<string>, names: ReadonlyArray<TestName>): boolean =>
  names.some((name) => {
    const pattern = Predicate.isString(name)
      ? namePattern(name)
      : Predicate.hasProperty(name, 'function')
        ? namePattern(name.function, true)
        : subtestPattern(name)
    return pattern !== null && texts.some((text) => pattern.test(text))
  })

/**
 * Whether a run is a valid red (CT-35): an assertion that failed in the scenario's own test. A
 * report that names the files tells it by its file and, when the proof's code names its tests, by
 * its name: another test of the same file failing is not the scenario's red. Without a file named
 * (no report, or JUnit's `classname` only), a test the proof adds must be named whole among the
 * failures (a report's failing tests, or the lines the runner marks as failing in the whole
 * output); failing that, the key line decides, never the exit code alone. A proof whose code names
 * no test, or a command with no test file, is red by its exit code, the key line its guard.
 */
export const validRed = (
  run: ProofRunClass,
  testPath: string | null,
  testNames: ReadonlyArray<TestName> = [],
  keyLineMatched: boolean | null = null,
): boolean => {
  if (run.classification !== 'assertion_failed') return false
  if (testPath === null) return true
  const located = run.failures.filter((one) => one.file !== null)
  if (located.length > 0) {
    return located.some(
      (one) =>
        one.assertion &&
        posix(one.file ?? '').endsWith(posix(testPath)) &&
        (testNames.length === 0 || named([one.test], testNames)),
    )
  }
  if (testNames.length === 0) return true
  const failing =
    run.failures.length > 0
      ? run.failures.filter((one) => one.assertion).map((one) => one.test)
      : run.failingLines
  return named(failing, testNames) || keyLineMatched === true
}

/**
 * The name a test is declared with: as `test('…'` or `it("…"` declares it, a Python `def test_…(`
 * (its pytest cases, `test_…[id]`, are its own), a Go `func TestX(t *testing.T)` and the literal
 * names of its subtests (`t.Run("…",`), a Rust `fn x` under `#[test]` (or `#[tokio::test(…)]`),
 * and a Rust cased test under `#[rstest]` or `#[test_case(…)]`.
 */
const TEST_NAME = /\b(?:test|it)(?:\.(?!each\b)\w+)?\(\s*(['"`])(?<name>(?:(?!\1).)+)\1/g
/** The name a `test.each(…)('…')` or `it.each\`…\`('…')` declares. */
const EACH_NAME =
  /\b(?:test|it)(?:\.\w+)*\.each\s*(?:\([\s\S]*?\)|`[\s\S]*?`)\s*\(\s*(['"`])(?<name>(?:(?!\1).)+)\1/g

const PYTHON_NAME = /^[ \t]*(?:async[ \t]+)?def[ \t]+(?<name>test\w*)[ \t]*\(/gm
const GO_NAME = /^func[ \t]+(?<name>Test\w*)[ \t]*\([ \t]*\w+[ \t]+\*testing\.T[ \t]*\)/gm
const GO_SUBTEST_NAME = /\b\w+\.Run\(\s*(["`])(?<name>(?:(?!\1).)+)\1\s*,/
/** The function a line of Go declares, or a hunk header names after its `@@`. */
const GO_FUNCTION = /^(?:@@[^@]*@@\s*)?func\s/
const RUST_NAME =
  /#\[(?:\w+::)*test(?:\((?:[^[\]]|\[[^[\]]*\])*\))?\]\s*(?:#\[(?:[^[\]]|\[[^[\]]*\])*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(?<name>\w+)/g
const RUST_CASED_NAME =
  /#\[(?:\w+::)*(?:rstest|test_case)(?:\((?:[^[\]]|\[[^[\]]*\])*\))?\]\s*(?:#\[(?:[^[\]]|\[[^[\]]*\])*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(?<name>\w+)/g

/**
 * The tests a proof adds: every test its new file declares, or those the lines its patch adds
 * declare, a Go subtest with the function it runs under; none when the code names none.
 */
export const addedTests = (test: {
  readonly insertion: 'new_file' | 'addition'
  readonly code: string
  readonly patch: string | null
}): ReadonlyArray<TestName> => {
  const added =
    test.insertion === 'new_file'
      ? test.code
      : (test.patch ?? '')
          .split('\n')
          .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
          .map((line) => line.slice(1))
          .join('\n')
  const declared = [TEST_NAME, EACH_NAME, PYTHON_NAME, GO_NAME, RUST_NAME, RUST_CASED_NAME]
    .flatMap((pattern) =>
      Array.from(added.matchAll(pattern), (found) => ({
        at: found.index,
        name: found.groups?.['name'] ?? '',
        cased: pattern === RUST_CASED_NAME,
      })),
    )
    .filter((found) => found.name !== '')
    .toSorted((a, b) => a.at - b.at)
    .map((found): TestName => (found.cased ? { function: found.name } : found.name))
  return [...declared, ...subtestsOf(test)]
}

/**
 * The literal names of the Go subtests a proof adds (`t.Run("…",`), each with the test function
 * it runs under: the last `func` above it in the new file, or in a patch its hunk's lines and the
 * function its `@@ … @@ func TestX(` header names. A subtest under no test function is not named.
 */
const subtestsOf = (test: {
  readonly insertion: 'new_file' | 'addition'
  readonly code: string
  readonly patch: string | null
}): ReadonlyArray<GoSubtest> => {
  const lines =
    test.insertion === 'new_file'
      ? test.code.split('\n').map((line) => ({ text: line, added: true }))
      : (test.patch ?? '')
          .split('\n')
          .filter((line) => !line.startsWith('---') && !line.startsWith('+++'))
          .filter((line) => !line.startsWith('-'))
          .map((line) =>
            line.startsWith('@@')
              ? { text: line, added: false }
              : { text: line.slice(1), added: line.startsWith('+') },
          )
  const found: GoSubtest[] = []
  let parent: string | null = null
  for (const line of lines) {
    if (GO_FUNCTION.test(line.text)) {
      parent =
        new RegExp(GO_NAME.source).exec(line.text.replace(/^@@[^@]*@@\s*/, ''))?.groups?.['name'] ??
        null
      continue
    }
    if (line.text.startsWith('@@')) parent = null
    const subtest = GO_SUBTEST_NAME.exec(line.text)?.groups?.['name']
    if (line.added && parent !== null && subtest !== undefined) found.push({ parent, subtest })
  }
  return found
}

/** The literal names a proof's tests are declared with, as its code reads. */
export const addedTestNames = (test: {
  readonly insertion: 'new_file' | 'addition'
  readonly code: string
  readonly patch: string | null
}): ReadonlyArray<string> =>
  addedTests(test).map((name) =>
    Predicate.isString(name)
      ? name
      : Predicate.hasProperty(name, 'function')
        ? name.function
        : name.subtest,
  )

/** An output with what changes from one run to the next masked, line by line. */
export const normalisedOutput = (text: string): string =>
  text
    .split(/\r?\n/)
    .map((line) =>
      line
        // ANSI colours and cursor moves.
        // oxlint-disable-next-line no-control-regex -- the escape character is what is matched
        .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
        // Paths: a file URL, an absolute path, a Windows path.
        .replace(/file:\/\/\/?[^\s'"():]+/g, '<path>')
        .replace(/[A-Za-z]:\\[^\s'"():]+/g, '<path>')
        .replace(/(^|[\s'"(=])\/[^\s'"():]+/g, '$1<path>')
        .replace(/\b0x[0-9a-fA-F]+\b/g, '<address>')
        .replace(/\b\d+(\.\d+)?\s?(ms|s|sec|seconds?|m|min|minutes?)\b/g, '<duration>')
        .replace(/\d+(\.\d+)?/g, '<n>')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .join('\n')

/** Whether the key line observed in Planning is found again in an output, once both normalised. */
export const keyLineFound = (output: string, keyLine: string): boolean => {
  const key = normalisedOutput(keyLine)
  if (key === '') return false
  const normal = normalisedOutput(output)
  return normal.split('\n').some((line) => line.includes(key)) || normal.includes(key)
}
