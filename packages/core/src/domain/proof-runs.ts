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

import { Option, Predicate, Result, Schema } from 'effect'
import { parse as parseToml } from 'smol-toml'

import {
  type ReportFound,
  type ReportedTest,
  type TestReporting,
  reportedTests,
} from './test-reports.ts'
import { jsTests, pythonTests } from './test-sources.ts'

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
  /**
   * The lines of the whole output that start with a known runner's failure mark, uncoloured, each
   * cut to a few KB.
   */
  readonly failingLines: ReadonlyArray<string>
  /**
   * The tests the failing lines name, each as its runner prints it and with what its failure
   * says: a failing line, a pytest section heading, a Rust failure's stdout heading, a mocha
   * failure's title in its list, never its tree's line.
   */
  readonly printedFailures: ReadonlyArray<PrintedFailure>
  /**
   * The test file's tests as the runner's report names them, each with how it ended and whether
   * the runner's own listing on the console shows it so: read whole, the same tests, path for path,
   * as the file declares when it ran, and no test the listing shows ending otherwise; null
   * otherwise (no report, one not read, or one that does not agree with the file or the listing).
   */
  readonly reported?: ReadonlyArray<ListedTest> | null
}

/** A test a report names, and whether the runner's listing shows it ending the same way. */
export interface ListedTest extends ReportedTest {
  readonly listed: boolean
}

/** One failure a report names: its test, its file, and what it says. */
interface Failure {
  readonly test: string
  readonly file: string | null
  readonly text: string
}

/**
 * Signs of a world that did not let the test run: a service (Node's codes, Go's words), a port,
 * the runner's own timeout.
 * Words an assertion says ("the export timed out") are the test's, never the environment's.
 */
const ENVIRONMENT =
  /\b(ECONNREFUSED|ECONNRESET|EADDRINUSE|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN)\b|address already in use|testTimeoutFailure|\bTest timed out in \d+ ?ms|Exceeded timeout of \d+ ?ms|Timeout of \d+ ?ms exceeded|\bconnection refused\b|\bno such host\b/
/** Signs of a test that never ran: compilation, import, a missing dependency. */
const BEFORE_TEST =
  /\b(SyntaxError|ReferenceError|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_REQUIRE_ESM)\b|Cannot find (module|package)|error TS\d+|does not provide an export named/
/**
 * Signs of an assertion that failed: JavaScript's (jest's `expect.assertions(1)` too), pytest's (`E   assert …`, `FAILED file::test`),
 * Go's (`--- FAIL:`, gotestsum's `=== FAIL: pkg TestX (…)`) and Rust's (`assertion … failed`, a
 * test's panic, a `#[should_panic]` test that did not).
 */
const ASSERTION =
  /\b(ERR_ASSERTION|AssertionError|AssertionFailedError)\b|\bexpect\([^\n]{0,200}?\)\.|\bexpect\.(?:assertions|hasAssertions)\(|^E[ \t]+assert\b|^FAILED \S+::|^--- FAIL: |^=== FAIL: \S+ Test\S* \(\d+(?:\.\d+)?s\)\s*$|\bassertion\b[^\n]{0,200}?\bfailed\b|\bpanicked at\b|\btest did not panic as expected\b|\bFailed: DID NOT (?:RAISE|WARN)\b/m
/** Mocha's numbered failure, `1) name`, in its tree and again in its list after `N failing`. */
const MOCHA_FAILURE = /^\s*(\d+)\) /
const MOCHA_FAILING = /^\s*(\d+) failing\s*$/
/** At most this many failing lines are kept. */
const FAILING_LINES = 500
/** Each line is read up to this many characters: a name is never that long. */
const LINE_CAP = 4_096
/**
 * pytest's heading of a test's section in its FAILURES (`____ test_x[md] ____`), padded with a
 * single `_` when its name is long, never the `_ _ _ _` separator between a traceback's frames.
 */
const PYTEST_SECTION = /^(?!(?:_ )+_?\s*$)_+ (?<name>\S.*?) _+\s*$/
/** A pytest `E ` line: what the section says, never the test's source it prints above. */
const PYTEST_E = /^E(?:\s|$)/
/**
 * A Python traceback's start: with `--tb=native` and in unittest, what a failure says is the
 * exception of its last traceback, at column 0 (its source and frames are indented).
 */
const PYTHON_TRACEBACK = /^Traceback \(most recent call last\):\s*$/
/** Python's line between two chained exceptions, the last of which ended the test. */
const PYTHON_CHAINED =
  /^(?:During handling of the above exception, another exception occurred:|The above exception was the direct cause of the following exception:)\s*$/
/** pytest's header above what a test printed, never what it says. */
const PYTEST_CAPTURED = /^-+ Captured .* -+\s*$/
/**
 * An exception group, in either mode, prints its traceback in a frame: each line after `| `, what
 * it says at the frame's column 0, its source and its files indented further.
 */
const PYTEST_GROUP = /^[ \t]*\+ Exception Group Traceback \(most recent call last\):\s*$/
const PYTEST_GROUP_SAID = /^[ \t]*\| (?<said>\S.*)$/
const EXCEPTION_GROUP = /^(?:[A-Za-z_]\w*\.)*(?:Base)?ExceptionGroup\b/
/**
 * What a Python failure says on its first line: pytest's `assert …`, its `Failed: DID NOT RAISE`
 * or `DID NOT WARN`, or an exception's name, its module before it or not (`AssertionError: …`,
 * `app.errors.NotFound: …`, `AssertionError('…')`, a bare `ValueError`). pytest's own `Failed: `
 * (`pytest.fail`, a plugin's timeout) is an exception like any other.
 */
const PYTHON_ASSERT = /^(?:E[ \t]+)?(?:assert\b|Failed: DID NOT (?:RAISE|WARN)\b)/
const PYTHON_EXCEPTION = /^(?:E[ \t]+)?(?:[A-Za-z_]\w*\.)*(?<name>[A-Za-z_]\w*)(?=:|\(|\s*$)/
/** pytest's summary line, `FAILED file::test - message`. */
const PYTEST_SUMMARY = /^FAILED \S+::/
/**
 * unittest's and Django's `FAIL: test_x (module.Class.test_x)` and `ERROR: …`, Python before 3.11
 * printing `(module.Class)`.
 */
const UNITTEST_HEADING = /^(?<kind>FAIL|ERROR): (?<name>test\w*) \((?<id>\w+(?:\.\w+)+)\)(?: .*)?$/
/** go test's `--- FAIL: TestX/sub (0.00s)`, its name the path before its duration. */
const GO_FAIL = /^\s*--- FAIL: /
const GO_PATH = /^\s*--- FAIL: (?<name>\S+)(?=\s+\(|\s*$)/
/** gotestsum's `=== FAIL: pkg TestX (0.00s)`, never one without its duration. */
const GOTESTSUM_FAIL = /^=== FAIL: (?<package>\S+) (?<name>Test\S*) \(\d+(?:\.\d+)?s\)\s*$/
/** go test's result line of a package, below its tests: `ok  \tpkg\t0.01s`, `FAIL\tpkg\t…`, `?   \tpkg\t…`. */
const GO_PACKAGE = /^(?:ok {2}|FAIL|\? {3})\t(?<package>\S+)(?:\t|\s\[|\s*$)/
/** go test -v's `=== RUN   TestX/sub`, above what that test logs. */
const GO_RUN_LINE = /^=== (?:RUN|CONT|NAME)\s+(?<name>\S+)\s*$/
/**
 * Where what a Go test logs ends: another test's result or run, its package's result, gotestsum's
 * end.
 */
const GO_END = /^\s*--- (?:PASS|SKIP|FAIL): |^=== |^(?:FAIL|ok|PASS)(?:\s|$)|^DONE /
/** A Go test that did not end by itself: a panic, or a world that did not let it run. */
const GO_ERROR = /^\s*panic: /m
/** libtest's `test x ... FAILED` (`test x - should panic ... FAILED`). */
const LIBTEST_FAILED = /^test (?<name>\S+)(?: - should panic)? \.\.\. FAILED\s*$/
/** cargo-nextest's `FAIL [ 0.004s] (1/2) crate x`. */
const NEXTEST_FAIL =
  /^\s*FAIL \[\s*\d+(?:\.\d+)?s\] (?:\(\s*\d+\/\d+\) )?(?<binary>\S+) (?<name>\S+)\s*$/
/** A cargo-nextest status line (`PASS`, `FAIL`, `SIGSEGV`…): its binary's id. */
const NEXTEST_STATUS =
  /^\s*[A-Z]+(?:-[A-Z]+)? \[\s*\d+(?:\.\d+)?s\] (?:\(\s*\d+\/\d+\) )?(?<binary>\S+) \S+\s*$/
/** cargo-nextest's count of the test binaries it runs. */
const NEXTEST_STARTING = /^\s*Starting \d+ tests? across (?<binaries>\d+) binar(?:y|ies)\b/
/** cargo's line naming the test binary it runs next, by its source: `unittests src/lib.rs`, `tests/c.rs`. */
const CARGO_RUNNING = /^\s+Running (?<source>(?:unittests )?\S+) \((?<binary>[^)]*)\)/
/** cargo's rerun hint naming a package: it ran the tests of more than one package of a workspace. */
const CARGO_PACKAGE_HINT = /^error: .*\bto rerun pass `-p |^\s+`-p \S/
/** libtest's heading of a failure's output, below its `failures:` line. */
const RUST_STDOUT = /^---- (?<name>\S+) stdout ----\s*$/
const RUST_FAILURES = /^failures:\s*$/
/** libtest's list of failing tests below its last `failures:` line, each path on its own line. */
const RUST_LISTED = /^ {4}(?<name>[A-Za-z_][\w:]*)\s*$/
/**
 * A Rust test's panic, named by its thread, which libtest names after the test: its message on
 * the next line, or, before Rust 1.73, quoted after `panicked at`.
 */
const RUST_PANIC = /^\s*thread '(?<thread>[^']*)'(?: \(\d+\))? panicked at (?:'(?<said>.*)|.*:\s*$)/
/** Where a Rust panic was raised: the file its line ends with, before its line and column. */
const RUST_PANIC_FILE = /\bpanicked at (?:'.*', )?(?<file>[^\s']+?):\d+:\d+:?\s*$/
/** A panic's message that an assertion prints: `assert!`, `assert_eq!`, pretty_assertions'. */
const RUST_PANIC_ASSERTION = /^assertion\b/
/** A panic's message that an error prints: `todo!()`, `unimplemented!()`, an `unwrap()`, an index. */
const RUST_PANIC_ERROR =
  /^(?:not yet implemented|not implemented|internal error: entered unreachable code|called `(?:Option|Result)::\w+\(\)`|index out of bounds|attempt to [\w ]+ with overflow|attempt to (?:divide|calculate the remainder) (?:by|with a divisor of) zero)/
/**
 * What a Rust test's own output says beside its panic: a `-> Result` test that returned `Err`
 * prints `Error: …`; a `#[should_panic]` test that did not panic, or not as expected, a note.
 */
const RUST_RETURNED_ERROR = /^\s*Error: /
const RUST_SHOULD_PANIC =
  /\b(?:test did not panic as expected|panic did not contain expected string)\b/
/**
 * vitest's, jest's and node:test's marks `×`, `✕`, `✖` before a test's title, in their trees and
 * in node:test's list of failing tests.
 */
const JS_MARK = /^\s*(?<mark>[×✕✖])\s(?<name>.*)$/
/** jest's `●` heading of a failure, never its `● Console` nor its `● Test suite failed to run`. */
const JEST_HEADING = /^\s*●\s(?!(?:Console|Test suite failed to run)\s*$)(?<name>.*)$/
/**
 * vitest's and jest's `FAIL <file>`, the test's title after it in vitest's (`> exports > name`),
 * and jest's with a project's `displayName` before its test file, as a badge or in words.
 */
const JS_FILE = /^\s*FAIL\s+(?:\|[^|]*\|\s+)?(?<name>\S+\.\w+(?:\s.*)?)$/
const JEST_PROJECT_FILE =
  /^\s*FAIL\s+(?<name>\S.*?\s(?:\S+\.(?:test|spec)\.\w+|\S*__tests__\/\S+))(?:\s+\(\d+(?:\.\d+)? m?s\))?\s*$/
/** TAP's `not ok 3 - name`, printed without its report's version line. */
/** jest's `PASS file` and `FAIL file` line, a project's displayName before its file or not. */
const JEST_FILE_LINE =
  /^\s*(?:PASS|FAIL)\s+(?:\|[^|]*\|\s+)?(?:\S.*?\s)?(?<file>\S+\.[A-Za-z]\w*)(?:\s+\(\d+(?:\.\d+)?\s?m?s\))?\s*$/
/** node:test's line above a failing test it lists at the end of its spec output: its file. */
const NODE_TEST_AT = /^\s*test at (?<file>.+?):\d+:\d+\s*$/
const TAP_NOT_OK = /^\s*not ok \d+(?: - (?<name>.*))?/
/**
 * A duration as each runner prints one after a title, and only there: vitest's ` 3ms` on its `×`
 * line, jest's ` (3 ms)` on its `✕` line, node:test's ` (0.97ms)` on its `✖` line.
 */
const BARE_DURATION = /\s\d+(?:\.\d+)?ms\s*$/
const PAREN_DURATION = /\s+\(\d+(?:\.\d+)?\s?m?s\)\s*$/
/** The separators vitest (` > `) and jest (` › `) print between a describe's title and a test's. */
const JS_SEPARATOR = / [>›] /g
/** vitest's rule between its failures, `⎯⎯⎯[1/2]⎯`, and around its sections. */
const VITEST_RULE = /^\s*⎯{3}/
/** An error line as JavaScript prints one: `Name: …`, `Unknown Error: …`, jest's `thrown: …`. */
const JS_ERROR = /^\s*(?:[A-Za-z_$][\w$.]*(?: [A-Z][\w$]*)*(?: \[\w+\])?:\s+\S|thrown: )/
/**
 * The first error a failure's text says was thrown: JavaScript's and Python's, its module before
 * it or not (`TypeError: …`, `E   app.errors.NotFoundError: …`, `AssertionError [ERR_ASSERTION]:
 * …`), jest's `thrown: ` for what is no error (its own timeout, `undefined`), or Go's `panic: `.
 * Testify's `Error:` followed by its column of spaces is an assertion's report, not a throw.
 */
const THROWN =
  /^[ \t]*(?:E[ \t]+)?(?:(?:[A-Za-z_]\w*\.)*(?<error>(?:[A-Z]\w*)?(?:Error|Exception))(?: \[\w+\])?:(?= \S|$)|thrown: |panic: )/m
/**
 * vitest's line for a thrown value that is no error (a string, a number): another error, whatever
 * the value reads like (`Unknown Error: AssertionError: …`).
 */
const UNKNOWN_ERROR = /^\s*Unknown Error: /
/** A line of the code frame jest and vitest print under an error (`> 4 |   expect(x)…`). */
const CODE_FRAME = /^[ \t]*(?:>[ \t]*)?\d+[ \t]*\|.*$/gm
const CODE_LINE = /^[ \t]*(?:>[ \t]*)?\d+[ \t]*\|/
const ASSERTION_THROWN = /^Assertion(?:Failed)?Error$/
/** Signs of a test file the runner did not find. */
const NOT_FOUND =
  /Could not find '|No test files? found|no tests? (were )?found|ENOENT[^\n]*\.test\./i

/** A line without its ANSI colours and cursor moves. */
// oxlint-disable-next-line no-control-regex -- the escape character is what is matched
const uncoloured = (line: string): string => line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')

/** What a failure's own text says: an assertion failed, another error ended it, or nothing. */
export type Verdict = 'assertion' | 'error' | 'silent'

/**
 * A test's failures together: an assertion when one of them says so and none says another error
 * ended it (any other error vetoes it), nothing when none says anything.
 */
const combined = (verdicts: ReadonlyArray<Verdict>): Verdict =>
  verdicts.includes('error') ? 'error' : verdicts.includes('assertion') ? 'assertion' : 'silent'

/**
 * What a failure's text says: the first error it says was thrown when there is one (an
 * assertion's, or another, a `TypeError` whose code frame shows an `expect` among them), otherwise
 * the words of an assertion, never read in a code frame (the test's source, not what it said),
 * then a world that did not let the test run or a test that never ran.
 */
const verdictOf = (output: string): Verdict => {
  const text = output.replace(CODE_FRAME, '')
  const thrown = THROWN.exec(text)
  if (thrown !== null) {
    return ASSERTION_THROWN.test(thrown.groups?.['error'] ?? '') ? 'assertion' : 'error'
  }
  if (ASSERTION.test(text)) return 'assertion'
  if (ENVIRONMENT.test(text) || BEFORE_TEST.test(text)) return 'error'
  return 'silent'
}

/**
 * What vitest, jest and node:test say under a failure: its first line shaped as an error, past a
 * tree's lines and code frames, up to vitest's rule that ends the failure. An assertion's line is
 * an assertion; any other error's (`Unknown Error: …`, `NotImplemented: …`) is another error,
 * whatever a later line (`Caused by: AssertionError`) says.
 */
const jsVerdict = (below: ReadonlyArray<string>): Verdict => {
  for (const line of below) {
    if (VITEST_RULE.test(line)) return 'silent'
    if (CODE_LINE.test(line)) continue
    if (UNKNOWN_ERROR.test(line)) return 'error'
    const said = verdictOf(line)
    if (said !== 'silent') return said
    if (JS_ERROR.test(line)) return 'error'
  }
  return 'silent'
}

/**
 * What the first line of a Python failure's exception says: an assertion (pytest's `assert …`, an
 * `AssertionError`, `DID NOT RAISE`), another error (any other exception, pytest's own `Failed:`
 * included), or nothing.
 */
const pythonVerdict = (line: string | undefined): Verdict => {
  if (line === undefined || line.trim() === '' || line.trim() === 'E') return 'silent'
  if (PYTHON_ASSERT.test(line)) return 'assertion'
  const name = PYTHON_EXCEPTION.exec(line)?.groups?.['name']
  if (name === undefined) return 'silent'
  return ASSERTION_THROWN.test(name) ? 'assertion' : 'error'
}

/**
 * What a Python traceback says: the first line at column 0 after its last `Traceback (most
 * recent call last):`, the exception that ended the test once its chain is followed.
 */
const tracebackVerdict = (lines: ReadonlyArray<string>): Verdict | null => {
  const last = lines.findLastIndex((line) => PYTHON_TRACEBACK.test(line))
  if (last < 0) return null
  return pythonVerdict(lines.slice(last + 1).find((line) => /^\S/.test(line)))
}

/**
 * What a pytest section says, above what the test printed: an exception group's exceptions, an
 * assertion only when every one is; its native traceback's last exception; otherwise the first
 * `E ` line after its last chained exception's heading.
 */
const pytestSectionVerdict = (section: ReadonlyArray<string>): Verdict => {
  const captured = section.findIndex((line) => PYTEST_CAPTURED.test(line))
  const own = captured < 0 ? section : section.slice(0, captured)
  if (own.some((line) => PYTEST_GROUP.test(line))) {
    const thrown = own
      .flatMap((line) => PYTEST_GROUP_SAID.exec(line)?.groups?.['said'] ?? [])
      .filter((line) => !EXCEPTION_GROUP.test(line) && THROWN.test(line))
      .map((line) => pythonVerdict(line))
    return thrown.length === 0
      ? 'silent'
      : thrown.every((one) => one === 'assertion')
        ? 'assertion'
        : 'error'
  }
  const native = tracebackVerdict(own)
  if (native !== null) return native
  const chained = own.findLastIndex((line) => PYTHON_CHAINED.test(line))
  return pythonVerdict(own.slice(chained + 1).find((line) => PYTEST_E.test(line)))
}

/**
 * The runners whose failing lines name a test, each read by its own reader below, and the
 * reports (JUnit XML, TAP) whose test names are read as any of them print one.
 */
export type Runner = 'js' | 'mocha' | 'pytest' | 'unittest' | 'go' | 'rust' | 'report'

/**
 * A failing test as its runner prints it: its name whole (a Go or Rust path, a vitest title), the
 * titles a declared name is matched whole against, cut on the runner's own separators, and its
 * path when the line prints it whole: the describes' or classes' titles, then the test's, each
 * form the line may be read as (vitest's title with its duration and without).
 */
export interface Printed {
  readonly runner: Runner
  readonly name: string
  readonly titles: ReadonlyArray<string>
  readonly paths: ReadonlyArray<ReadonlyArray<string>>
  /** The test's file, when the runner prints it (vitest's title, jest's file line, a node id). */
  readonly file: string | null
  /**
   * Where a Go or Rust test ran, as the output says for certain: its Go package (its import path,
   * or gotestsum's path from the module's root, `.` or `./pkg/b`), or its Rust test binary
   * (`lib`, `bin` for `src/main.rs`, `bin:x`, `test:x`); null when the output does not say for
   * certain.
   */
  readonly unit: string | null
}

/** The files a JavaScript runner prints apart from a failing test's line: jest's, node:test's. */
interface JsFiles {
  readonly jest: string | null
  readonly node: string | null
}

/** A failing test as its runner prints it, and what one of its failures says. */
export interface PrintedFailure extends Printed {
  readonly verdict: Verdict
  /** The files a Rust test's panics were raised in, as their lines print them. */
  readonly panickedIn: ReadonlyArray<string>
}

/**
 * A failing line a reader knows: the test it names, null when it names none (mocha's tree, a
 * `--- FAIL:` line with no path), whether it is shown among the run's failing lines, and what
 * its failure says, read from the lines below it as its runner prints them.
 */
interface Read {
  readonly printed: Printed | null
  readonly marked: boolean
  readonly verdict: (below: ReadonlyArray<string>) => Verdict
}

const printed = (
  runner: Runner,
  name: string,
  titles: ReadonlyArray<string>,
  paths: ReadonlyArray<ReadonlyArray<string>> = [],
  file: string | null = null,
  unit: string | null = null,
): Printed => ({ runner, name, titles, paths, file, unit })

/**
 * A vitest or jest title's tests: the title, then what follows each ` > ` or ` › ` in it, each
 * without the duration its runner prints after it on that line, and only there: vitest's bare
 * ` 3ms` after its `×` (the title kept whole beside it), jest's `(3 ms)` after its `✕` and
 * node:test's `(0.97ms)` after its `✖`.
 */
const jsTitles = (title: string, mark: string | null): ReadonlyArray<string> => {
  const whole = title.trim()
  const forms =
    mark === '×'
      ? [whole, whole.replace(BARE_DURATION, '')]
      : mark === '✕' || mark === '✖'
        ? [whole.replace(PAREN_DURATION, '')]
        : [whole]
  const titles = forms.flatMap((form) =>
    [form].concat(Array.from(form.matchAll(JS_SEPARATOR), (found) => form.slice(found.index + 3))),
  )
  return [...new Set(titles)]
}

/**
 * A pytest node id's or section heading's path: its classes and its test function, before its
 * case, the file aside (`file.py::Class::test_x[1]`, `Class.test_x[1]`); the file is read apart.
 */
const pytestPath = (id: string): ReadonlyArray<string> => {
  const parts = id.replace(/\[.*$/, '').split('::')
  return parts.length > 1 ? parts.slice(1) : (parts[0] ?? '').split('.')
}

/** A vitest title's file, and its paths after it. */
interface VitestTitle {
  readonly file: string | null
  readonly paths: ReadonlyArray<ReadonlyArray<string>>
}

/**
 * The file a vitest title starts with (`file.test.ts > export > saves`), and the path it prints
 * whole after it, each form its title may be read as; none when the line does not start with its
 * file.
 */
const vitestPaths = (titles: ReadonlyArray<string>, whole: string): VitestTitle => {
  const [file] = whole.split(' > ')
  if (file === undefined || file === whole || !/^\S+\.\w+$/.test(file)) {
    return { file: null, paths: [] }
  }
  const paths = titles
    .filter((title) => title.startsWith(`${file} > `))
    .map((title) => title.slice(file.length + 3).split(' > '))
  return { file, paths }
}

/** A Rust path's test: its last `::` part. */
const rustTest = (path: string): string => path.split('::').at(-1) ?? path

/**
 * vitest, jest, node:test, and TAP printed without its report: a mark, a heading, a file line;
 * its path when it prints it whole, vitest after its file, jest's `●` heading; its file, vitest's
 * before its title, jest's file line above its marks and headings, and node:test's `test at` line
 * right above the `✖` it lists.
 */
const jsFailure = (line: string, files: JsFiles): Read | null => {
  const heading = JEST_HEADING.exec(line)
  const mark = JS_MARK.exec(line)
  const found =
    mark ?? TAP_NOT_OK.exec(line) ?? heading ?? JS_FILE.exec(line) ?? JEST_PROJECT_FILE.exec(line)
  if (found === null) return null
  const name = found.groups?.['name'] ?? ''
  const titles = jsTitles(name, found.groups?.['mark'] ?? null)
  const vitest = vitestPaths(titles, name.trim())
  const jest = heading === found || mark?.groups?.['mark'] === '✕'
  const paths = heading === found ? [name.trim().split(' › ')] : vitest.paths
  const node = mark?.groups?.['mark'] === '✖'
  const file = jest ? files.jest : node ? files.node : vitest.file
  return { printed: printed('js', name, titles, paths, file), marked: true, verdict: jsVerdict }
}

/**
 * pytest: its summary line, `FAILED file::test[id] - message`, read by its message, and its
 * section's heading, `____ Class.test[id] ____`, read by what the section says; each named after
 * the test function, a case id's content aside.
 */
const pytestFailure = (line: string): Read | null => {
  if (PYTEST_SUMMARY.test(line)) {
    const id = nodeIdOf(line)
    const path = pytestPath(id.slice('FAILED '.length))
    const name = path.at(-1) ?? ''
    const message = line.slice(id.length).replace(/^ - /, '')
    const file = id.slice('FAILED '.length).split('::')[0] ?? null
    return {
      printed: printed('pytest', name, [name], [path], file),
      marked: true,
      verdict: () => pythonVerdict(message),
    }
  }
  const section = PYTEST_SECTION.exec(nodeIdOf(line))?.groups?.['name']
  if (section === undefined) return null
  const path = pytestPath(section)
  const name = path.at(-1) ?? ''
  return {
    printed: printed('pytest', name, [name], [path]),
    marked: false,
    verdict: pytestSectionVerdict,
  }
}

/**
 * unittest and Django: `FAIL: test_x (module.Class.test_x)`, which they print only for a test
 * whose last exception is an assertion, and `ERROR: …` for any other, each named by its class and
 * its test, its module the file's.
 */
const unittestFailure = (line: string): Read | null => {
  const found = UNITTEST_HEADING.exec(line)?.groups
  const name = found?.['name']
  if (found === undefined || name === undefined) return null
  const id = (found['id'] ?? '').split('.')
  const module = id.slice(0, id.at(-1) === name ? -2 : -1)
  const owner = id.at(-1) === name ? id.at(-2) : id.at(-1)
  const verdict: Verdict = found['kind'] === 'FAIL' ? 'assertion' : 'error'
  const file = module.length === 0 ? null : `${module.join('/')}.py`
  return {
    printed: printed('unittest', name, [name], [[owner ?? '', name]], file),
    marked: true,
    verdict: () => verdict,
  }
}

/**
 * What a Go test logged: another error when it panicked or its world did not let it run, an
 * assertion when it logged anything else (`t.Errorf`, testify), nothing otherwise.
 */
const goVerdict = (lines: ReadonlyArray<string>): Verdict => {
  const end = lines.findIndex((line) => GO_END.test(line))
  const own = end < 0 ? lines : lines.slice(0, end)
  const text = own.join('\n')
  if (GO_ERROR.test(text) || ENVIRONMENT.test(text) || BEFORE_TEST.test(text)) return 'error'
  return own.some((line) => line.trim() !== '') ? 'assertion' : 'silent'
}

/**
 * go test's `--- FAIL:` and gotestsum's `=== FAIL:`, named by the test's whole path and read by
 * what it logged below; a parent takes its subtests' verdicts too (see `goVerdicts`).
 */
const goFailure = (line: string): Read | null => {
  const found = (GO_PATH.exec(line) ?? GOTESTSUM_FAIL.exec(line))?.groups
  const name = found?.['name']
  if (name !== undefined) {
    // gotestsum names the package from the module's root; go test's line, by the line below it.
    const from = found?.['package']
    const unit = from === undefined ? null : from === '.' ? '.' : `./${from}`
    return {
      printed: printed('go', name, [name], [], null, unit),
      marked: true,
      verdict: goVerdict,
    }
  }
  return GO_FAIL.test(line) ? { printed: null, marked: true, verdict: () => 'silent' } : null
}

/**
 * What a Rust test's own output says, its panics aside (see `rustVerdicts`): an `Err` it returned,
 * or a `#[should_panic]` test's note.
 */
const rustVerdict = (below: ReadonlyArray<string>): Verdict =>
  combined(
    below.map((line) =>
      RUST_RETURNED_ERROR.test(line)
        ? 'error'
        : RUST_SHOULD_PANIC.test(line)
          ? 'assertion'
          : 'silent',
    ),
  )

/**
 * libtest's `test x ... FAILED`, cargo-nextest's `FAIL [ 0.004s] crate x`, and, below a
 * `failures:` line, libtest's `---- x stdout ----` heading and its list's `    x`, each named by
 * the test's path. Only a heading and nextest's line hold the test's own output below them: with
 * `--nocapture`, libtest's result line has other tests' output below it.
 */
const rustFailure = (line: string, afterFailures: boolean, listed: boolean): Read | null => {
  const result = LIBTEST_FAILED.exec(line)?.groups?.['name']
  if (result !== undefined) {
    return {
      printed: printed('rust', result, [rustTest(result)]),
      marked: true,
      verdict: () => 'silent',
    }
  }
  const nextestFound = NEXTEST_FAIL.exec(line)?.groups
  const nextest = nextestFound?.['name']
  if (nextest !== undefined) {
    // Its binary's id, read as the binary once the whole output says it is certain.
    const binary = nextestFound?.['binary'] ?? null
    return {
      printed: printed('rust', nextest, [rustTest(nextest)], [], null, binary),
      marked: true,
      verdict: rustVerdict,
    }
  }
  const heading = afterFailures ? RUST_STDOUT.exec(line)?.groups?.['name'] : undefined
  if (heading !== undefined) {
    return {
      printed: printed('rust', heading, [rustTest(heading)]),
      marked: false,
      verdict: rustVerdict,
    }
  }
  const entry = listed ? RUST_LISTED.exec(line)?.groups?.['name'] : undefined
  if (entry === undefined) return null
  return {
    printed: printed('rust', entry, [rustTest(entry)]),
    marked: false,
    verdict: () => 'silent',
  }
}

/** The failure a line starts, as the first reader that knows its shape reads it. */
const failureAt = (
  line: string,
  afterFailures: boolean,
  listed: boolean,
  files: JsFiles,
): Read | null =>
  pytestFailure(line) ??
  unittestFailure(line) ??
  goFailure(line) ??
  rustFailure(line, afterFailures, listed) ??
  jsFailure(line, files)

/**
 * The failing lines of an output, uncoloured and cut, and the tests they name, each with what its
 * failure says. A failure's text is the lines below its line, up to the next failure's line, read
 * as its runner prints a failure. A numbered line is mocha's only when its number is at most its
 * `N failing`, and twice at most: its tree's, the last above that line, shown but naming no test,
 * and its list's, the first below at that line's indentation whose title reads as one, naming its
 * test and read by its own text. A numbered log or diff line is not one, and cannot push a real
 * failure past the cap.
 */
const failingLinesOf = (
  output: string,
): Pick<ProofRunClass, 'failingLines' | 'printedFailures'> => {
  const lines = output.split(/\r?\n/).map((line) => uncoloured(line).slice(0, LINE_CAP))
  const places = placesOf(lines)
  let failing = 0
  let listAt = -1
  for (const [at, line] of lines.entries()) {
    const count = Number(MOCHA_FAILING.exec(line)?.[1] ?? 0)
    if (count > 0) listAt = at
    failing = Math.max(failing, count)
  }
  const listIndent = /^\s*/.exec(lines[listAt] ?? '')?.[0] ?? ''
  const rustAt = lines.findIndex((line) => RUST_FAILURES.test(line))
  // Mocha's tree line of a number, the last above its `N failing`, and its list's, the first below.
  const tree = new Map<number, number>()
  const list = new Map<number, { readonly at: number; readonly title: ReadonlyArray<string> }>()
  for (const [at, line] of lines.entries()) {
    const number = Number(MOCHA_FAILURE.exec(line)?.[1] ?? 0)
    if (number < 1 || number > failing) continue
    if (at < listAt) tree.set(number, at)
    else if (!list.has(number) && line.startsWith(`${listIndent}${String(number)}) `)) {
      const title = mochaTitle(lines, at, listIndent)
      if (title !== null) list.set(number, { at, title })
    }
  }
  const mochaVerdict = (below: ReadonlyArray<string>) => verdictOf(below.join('\n'))
  const entries: Array<{ readonly at: number; readonly read: Read }> = []
  let inList = false
  let jestFile: string | null = null
  for (const [at, line] of lines.entries()) {
    // libtest's list of failing tests, right below a `failures:` line.
    inList = RUST_FAILURES.test(line) || (inList && RUST_LISTED.test(line))
    // jest's file line, above its tests' marks and headings.
    if (!line.includes(' > ')) jestFile = JEST_FILE_LINE.exec(line)?.groups?.['file'] ?? jestFile
    const rustListed = inList && !RUST_FAILURES.test(line)
    const node = NODE_TEST_AT.exec(lines[at - 1] ?? '')?.groups?.['file'] ?? null
    const read = failureAt(line, rustAt >= 0 && at > rustAt, rustListed, { jest: jestFile, node })
    if (read !== null) {
      entries.push({ at, read })
      continue
    }
    const number = Number(MOCHA_FAILURE.exec(line)?.[1] ?? 0)
    const listed = list.get(number)
    if (tree.get(number) === at) {
      entries.push({ at, read: { printed: null, marked: true, verdict: () => 'silent' } })
    } else if (listed?.at === at) {
      const title = listed.title.at(-1) ?? ''
      const name = printed('mocha', title, [title], [listed.title])
      entries.push({ at, read: { printed: name, marked: true, verdict: mochaVerdict } })
    }
  }
  const kept = entries.slice(0, FAILING_LINES)
  // A go test failure's package is its block's; a Rust failure's binary, the one above it.
  const unitOf = (name: Printed, at: number): string | null => {
    if (name.runner === 'go') return name.unit ?? places.goBelow[at] ?? null
    if (name.runner === 'rust') return places.rustUnit(name.unit, at)
    return name.unit
  }
  const read = kept.flatMap((entry, index) => {
    const below = lines.slice(entry.at + 1, kept[index + 1]?.at ?? lines.length)
    const name = entry.read.printed
    if (name === null) return []
    const failure: PrintedFailure = {
      runner: name.runner,
      name: name.name,
      titles: name.titles,
      paths: name.paths,
      file: name.file,
      unit: unitOf(name, entry.at),
      verdict: entry.read.verdict(below),
      panickedIn: [],
    }
    return [{ at: entry.at, failure }]
  })
  return {
    failingLines: kept.filter((entry) => entry.read.marked).map((entry) => lines[entry.at] ?? ''),
    printedFailures: [
      ...read
        .map((one) => one.failure)
        .filter((one) => one.runner !== 'go' && one.runner !== 'rust'),
      ...goVerdicts(read, lines, places.goBelow),
      ...rustVerdicts(read, lines, places.rustAt),
    ],
  }
}

/**
 * Where the lines of an output are, for Go and Rust. Go: the package of the first result line of
 * go test at or below each line, which closes the block its tests print in, and every package a
 * result line names. Rust: the test binary cargo or cargo-nextest last named at or above each line
 * (cargo's `Running` line, nextest's status line), and that binary as a failure's unit when the
 * whole output tells it apart for certain: for cargo, a run of one package (no rerun hint naming
 * one with `-p`, which cargo prints when it runs several, and no source run as two binaries, which
 * two runs of cargo on two packages print); for nextest, binaries of one crate,
 * every binary it counted shown.
 */
const placesOf = (lines: ReadonlyArray<string>) => {
  const goBelow: Array<string | null> = []
  let below: string | null = null
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const found = GO_PACKAGE.exec(lines[at] ?? '')?.groups?.['package']
    if (found !== undefined) below = found
    goBelow.push(below)
  }
  goBelow.reverse()
  const rustAt: Array<string | null> = []
  const binaries = new Set<string>()
  // The binaries cargo ran from each source: two of one source are two packages' (their deps names).
  const built = new Map<string, Set<string>>()
  let counted: number | null = null
  let packages = false
  let current: string | null = null
  for (const line of lines) {
    const running = CARGO_RUNNING.exec(line)?.groups
    const source = running?.['source']
    const binary = NEXTEST_STATUS.exec(line)?.groups?.['binary']
    if (source !== undefined) {
      current = `cargo ${posix(source)}`
      const deps = built.get(current) ?? new Set<string>()
      deps.add(posix(running?.['binary'] ?? ''))
      built.set(current, deps)
      if (deps.size > 1) packages = true
    } else if (binary !== undefined) {
      current = `nextest ${binary}`
      binaries.add(binary)
    }
    if (CARGO_PACKAGE_HINT.test(line)) packages = true
    const starting = NEXTEST_STARTING.exec(line)?.groups?.['binaries']
    if (starting !== undefined) counted = Number(starting)
    rustAt.push(current)
  }
  const crates = new Set(Array.from(binaries, (binary) => binary.split('::')[0]))
  const nextestCertain = counted === binaries.size && crates.size === 1
  /** A Rust failure's binary: nextest's id its line names, otherwise cargo's binary above it. */
  const rustUnit = (nextest: string | null, at: number): string | null => {
    if (nextest !== null) return nextestCertain ? nextestUnit(nextest) : null
    const key = rustAt[at] ?? null
    if (key === null || !key.startsWith('cargo ') || packages) return null
    return cargoUnit(key.slice('cargo '.length))
  }
  return { goBelow, rustAt, rustUnit }
}

/** cargo's test binary as a unit, from its source: `lib`, `bin` (`src/main.rs`), `bin:x`, `test:x`. */
const cargoUnit = (source: string): string | null => {
  const unit =
    /^unittests src\/(?:(?<root>lib|main)\.rs|bin\/(?<bin>[\w-]+)(?:\.rs|\/main\.rs))$/.exec(
      source,
    )?.groups
  if (unit !== undefined) {
    if (unit['root'] === undefined) return `bin:${unit['bin'] ?? ''}`
    return RUST_BIN_ROOT.test(unit['root']) ? 'bin' : 'lib'
  }
  const test = /^tests\/(?<test>[\w-]+)(?:\.rs|\/main\.rs)$/.exec(source)?.groups?.['test']
  return test === undefined ? null : `test:${test}`
}

/** cargo-nextest's binary id as a unit: `acme` its lib, `acme::bin/x`, `acme::c` a tests/c.rs. */
const nextestUnit = (id: string): string | null => {
  const [crate, target, ...more] = id.split('::')
  if (crate === undefined || more.length > 0) return null
  if (target === undefined) return 'lib'
  const bin = /^bin\/(?<bin>[\w-]+)$/.exec(target)?.groups?.['bin']
  if (bin !== undefined) return bin === crate ? 'bin' : `bin:${bin}`
  return /^[\w-]+$/.test(target) ? `test:${target}` : null
}

/**
 * Go's failing tests, each with what it and its failing subtests logged, below its result line
 * or under go test -v's `=== RUN` line: a parent fails because its subtests did, so a subtest that
 * panicked vetoes it. A test that logged nothing failed on `t.Fail`: an assertion.
 */
const goVerdicts = (
  read: ReadonlyArray<{ readonly at: number; readonly failure: PrintedFailure }>,
  lines: ReadonlyArray<string>,
  goBelow: ReadonlyArray<string | null>,
): ReadonlyArray<PrintedFailure> => {
  const go = read.map((one) => one.failure).filter((one) => one.runner === 'go')
  // What each test logged under its `=== RUN` line, by its package's block and its path.
  const logged = new Map<string, Array<string>>()
  let current: string | null = null
  for (const [at, line] of lines.entries()) {
    const run = GO_RUN_LINE.exec(line)?.groups?.['name']
    if (run !== undefined) current = `${goBelow[at] ?? ''}\n${run}`
    else if (GO_END.test(line)) current = null
    else if (current !== null) {
      const log = logged.get(current) ?? []
      log.push(line)
      logged.set(current, log)
    }
  }
  return go.map((one) => {
    // Its subtests are those of its own package only: another package's test of that name is not.
    const within = (other: PrintedFailure) =>
      other.unit === one.unit && (other.name === one.name || other.name.startsWith(`${one.name}/`))
    const verdict = combined([
      ...go.filter(within).map((other) => other.verdict),
      ...[...new Set(go.filter(within).map((other) => other.name))].map((path) =>
        goVerdict(logged.get(`${one.unit ?? ''}\n${path}`) ?? []),
      ),
    ])
    const failure: PrintedFailure = {
      runner: one.runner,
      name: one.name,
      titles: one.titles,
      paths: one.paths,
      file: one.file,
      unit: one.unit,
      verdict: verdict === 'silent' ? 'assertion' : verdict,
      panickedIn: one.panickedIn,
    }
    return failure
  })
}

/**
 * Rust's failing tests, each with what its panics say, wherever they are printed: a panic is its
 * thread's, which libtest names after the test, so one printed with `--nocapture` among other
 * tests' lines is still its own. A panic is an assertion when its message says one, another error
 * for a known runtime error (`todo!()`, an `unwrap()`), and says nothing otherwise (`panic!`, or
 * `assert!(c, "message")`, which prints only its message).
 */
const rustVerdicts = (
  read: ReadonlyArray<{ readonly at: number; readonly failure: PrintedFailure }>,
  lines: ReadonlyArray<string>,
  rustAt: ReadonlyArray<string | null>,
): ReadonlyArray<PrintedFailure> => {
  // A panic is its binary's: another binary's test of the same path is another thread.
  const panics = lines.flatMap((line, at) => {
    const found = RUST_PANIC.exec(line)?.groups
    if (found === undefined) return []
    const said = (found['said'] ?? lines[at + 1] ?? '').trim()
    const verdict: Verdict = RUST_PANIC_ASSERTION.test(said)
      ? 'assertion'
      : RUST_PANIC_ERROR.test(said)
        ? 'error'
        : 'silent'
    const file = posix(RUST_PANIC_FILE.exec(line)?.groups?.['file'] ?? '')
    return [{ thread: `${rustAt[at] ?? ''}\n${found['thread'] ?? ''}`, verdict, file }]
  })
  const byThread = new Map<string, Array<Verdict>>()
  const files = new Map<string, Array<string>>()
  for (const panic of panics) {
    const verdicts = byThread.get(panic.thread) ?? []
    verdicts.push(panic.verdict)
    byThread.set(panic.thread, verdicts)
    const raised = files.get(panic.thread) ?? []
    raised.push(panic.file)
    files.set(panic.thread, raised)
  }
  return read
    .filter((one) => one.failure.runner === 'rust')
    .map(({ at, failure: one }) => {
      const failure: PrintedFailure = {
        runner: one.runner,
        name: one.name,
        titles: one.titles,
        paths: one.paths,
        file: one.file,
        unit: one.unit,
        verdict: combined([
          one.verdict,
          ...(byThread.get(`${rustAt[at] ?? ''}\n${one.name}`) ?? []),
        ]),
        panickedIn: files.get(`${rustAt[at] ?? ''}\n${one.name}`) ?? [],
      }
      return failure
    })
}

/**
 * A mocha failure's path in its list: its describes' titles and its test's, the last without the
 * `:` it ends with, from `1) exports` down, each indented two more spaces than the one above (a
 * describe's title may end with `:` too, or start with a space). Null when its last line does not
 * end with `:`: a numbered line that is no failure's title.
 */
const mochaTitle = (
  lines: ReadonlyArray<string>,
  at: number,
  indent: string,
): ReadonlyArray<string> | null => {
  const title = [(lines[at] ?? '').replace(MOCHA_FAILURE, '')]
  for (const line of lines.slice(at + 1, at + 10)) {
    const depth = `${indent}   ${'  '.repeat(title.length)}`
    if (!line.startsWith(depth) || line.slice(depth.length).trim() === '') break
    title.push(line.slice(depth.length))
  }
  const last = (title.at(-1) ?? '').trimEnd()
  return last.endsWith(':') ? [...title.slice(0, -1), last.slice(0, -1)] : null
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

/**
 * A pytest failure in a report (JUnit's body is its section) is read as its section is, never by
 * the source it prints; any other by the words of its text.
 */
const classOfFailure = (failure: Failure): ProofClass => {
  if (/^E(?:\s|$)/m.test(failure.text)) {
    const said = pytestSectionVerdict(failure.text.split(/\r?\n/))
    if (said === 'assertion') return 'assertion_failed'
    if (said === 'error')
      return ENVIRONMENT.test(failure.text) ? 'environment' : 'error_before_test'
  }
  if (ASSERTION.test(failure.text)) return 'assertion_failed'
  if (ENVIRONMENT.test(failure.text)) return 'environment'
  return 'error_before_test'
}

/** A JavaScript or Python test file: its red is named only by a report the runner wrote. */
const SCRIPTED = /\.(?:[cm]?[jt]sx?|py)$/
/** How a test ended, as a runner's listing shows it. */
type Listed = 'passed' | 'failed' | 'skipped'

/** The marks vitest lists a test with (`√` where a console cannot print `✓`). */
const VITEST_MARKS: ReadonlyMap<string, Listed> = new Map([
  ['✓', 'passed'],
  ['√', 'passed'],
  ['×', 'failed'],
  ['↓', 'skipped'],
])
/** The marks node's spec reporter lists a test with. */
const NODE_MARKS: ReadonlyMap<string, Listed> = new Map([
  ['✔', 'passed'],
  ['✖', 'failed'],
  ['﹣', 'skipped'],
])
/** The words pytest's `-rA` summary lists a test with: an error is a failure, an xfail a skip. */
const PYTEST_WORDS: ReadonlyMap<string, Listed> = new Map([
  ['PASSED', 'passed'],
  ['FAILED', 'failed'],
  ['ERROR', 'failed'],
  ['XFAIL', 'skipped'],
  ['XPASS', 'passed'],
])
/** The duration vitest prints after a test it ran. */
const VITEST_DURATION = / \d+(?:\.\d+)?m?s$/
/** What node prints after a test's title: its duration, then a skip or a todo. */
const NODE_TAIL = /^ \(\d+(?:\.\d+)?ms\)(?: # (?:SKIP|TODO)\b.*)?$/
/** A test pytest's summary lists: its word, and its node id. */
const PYTEST_LISTED = /(?:^|\s)(PASSED|FAILED|ERROR|XFAIL|XPASS)\s+(\S+)/g

/** Where the last of some marks is in a line, followed by a space; -1 when none is. */
const lastMark = (line: string, marks: ReadonlyMap<string, Listed>): number =>
  Math.max(...Array.from(marks.keys(), (mark) => line.lastIndexOf(`${mark} `)))

/**
 * One line of a runner's listing: the test it shows (its path, or its title for node) and how it
 * ended; null for another line. The listing is read from the last mark of a line, since whatever
 * a test prints with no newline comes before the runner's own line, never after it.
 */
const listedLine = (
  line: string,
  runner: TestReporting['runner'],
  testPath: string,
): { readonly key: string; readonly listed: Listed } | null => {
  if (runner === 'pytest') {
    const found = Array.from(line.matchAll(PYTEST_LISTED)).at(-1)
    const listed = PYTEST_WORDS.get(found?.[1] ?? '')
    const id = found?.[2] ?? ''
    const split = id.indexOf('::')
    if (listed === undefined || split < 0 || !sameFile(id.slice(0, split), testPath)) return null
    return { key: id.slice(split + 2), listed }
  }
  const marks = runner === 'node' ? NODE_MARKS : VITEST_MARKS
  const at = lastMark(line, marks)
  if (at < 0 || (runner !== 'node' && runner !== 'vitest')) return null
  const listed = marks.get(line.slice(at, at + 1)) ?? null
  const text = line.slice(at + 2).trimEnd()
  if (listed === null) return null
  if (runner === 'node') {
    const tail = text.lastIndexOf(' (')
    if (tail < 0 || !NODE_TAIL.test(text.slice(tail))) return null
    return { key: text.slice(0, tail), listed: text.includes(' # SKIP', tail) ? 'skipped' : listed }
  }
  const split = text.indexOf(' > ')
  if (split < 0 || !sameFile(text.slice(0, split), testPath)) return null
  const path = text.slice(split + 3)
  return { key: listed === 'skipped' ? path : path.replace(VITEST_DURATION, ''), listed }
}

/**
 * How the runner's own listing on the console shows each test of the file ended, by its path
 * (its title for node): every way it is shown, a test printing a line like the runner's only
 * adding one. Each line is read from its end, cut to a few KB.
 */
const consoleListing = (
  output: string,
  runner: TestReporting['runner'],
  testPath: string,
): ReadonlyMap<string, ReadonlySet<Listed>> => {
  const shown = new Map<string, Set<Listed>>()
  for (const whole of output.split('\n')) {
    const one = listedLine(uncoloured(whole).slice(-LINE_CAP), runner, testPath)
    if (one === null) continue
    const set = shown.get(one.key) ?? new Set<Listed>()
    shown.set(one.key, set.add(one.listed))
  }
  return shown
}

/** How a test a report names ended, as a listing would show it. */
const listedAs = (verdict: ReportedTest['verdict']): Listed =>
  verdict === 'passed' || verdict === 'skipped' ? verdict : 'failed'

/**
 * The path a declared test's runner reports it by: its describes and title joined by ` > `
 * (JavaScript), its classes and function by `::` (Python); null when it is not literal whole.
 */
const reportKey = (
  scope: ReadonlyArray<string | TemplateTest>,
  title: string | TemplateTest,
  python: boolean,
): string | null => {
  const path = [...scope, title]
  if (!path.every((one) => Predicate.isString(one) && !SEPARATOR.test(one))) return null
  return path.join(python ? '::' : ' > ')
}

/** How many times each key is in a list. */
const tally = (keys: ReadonlyArray<string>): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)
  return counts
}

/**
 * The test file's tests a run's report names, kept only when they are the tests its source
 * declares, path for path and as many of each: a test declared by other code (a helper, a setup
 * file, a hook renaming one), one the file declares that did not run, or a file not read whole,
 * and no test of the report is kept.
 */
const reportOf = (
  run: Parameters<typeof classifyProofRun>[0],
): ReadonlyArray<ListedTest> | null => {
  const report = run.report
  const testPath = run.testPath
  if (report === undefined || report === null || testPath === null || report.source === null) {
    return null
  }
  if (report.found.kind !== 'read' || !SCRIPTED.test(testPath)) return null
  const tests = reportedTests(report.reporting, report.found.text, testPath)
  if (tests === null) return null
  const python = testPath.endsWith('.py')
  const read = python ? pythonTests(report.source) : jsTests(report.source)
  const keys = read.tests.map((one) => reportKey(one.scope, one.title, python))
  if (!read.certain || keys.some((key) => key === null)) return null
  const declared = tally(keys.flatMap((key) => (key === null ? [] : [key])))
  const counted = tally(tests.map((one) => one.key))
  const agree =
    declared.size === counted.size &&
    Array.from(declared).every(([key, count]) => counted.get(key) === count)
  if (!agree) return null
  // node's spec lists a test by its title alone: tests sharing one must all end as it shows.
  const node = report.reporting.runner === 'node'
  const titleOf = (key: string) => (node ? (key.split(' > ').at(-1) ?? key) : key)
  const listing = consoleListing(run.output, report.reporting.runner, testPath)
  const shownOf = (one: ReportedTest) => listing.get(titleOf(one.key))
  // A test the listing shows ending otherwise than the report says is a report of another run.
  const contradicted = tests.some((one) => {
    const shown = shownOf(one)
    return shown !== undefined && (shown.size !== 1 || !shown.has(listedAs(one.verdict)))
  })
  if (contradicted) return null
  return tests.map((one): ListedTest => ({
    key: one.key,
    verdict: one.verdict,
    listed: shownOf(one) !== undefined,
  }))
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
  /** The runner's report, as found once the run ended, and the test file as it ran. */
  readonly report?: {
    readonly reporting: TestReporting
    readonly found: ReportFound
    readonly source: string | null
  } | null
}): ProofRunClass {
  const lines = {
    ...failingLinesOf(run.output),
    reported: reportOf(run),
  }
  const none = { failingTest: null, assertion: null, failingFile: null, failures: [], ...lines }
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
      ...lines,
    }
  }
  if (run.exitCode === 0) return { classification: 'passed', ...none }
  return { classification: wordsClass(run.output, run.testPath), ...none }
}

/** A failed run without a report, from its words, each line uncoloured and cut as a failure's is. */
const wordsClass = (whole: string, testPath: string | null): ProofClass => {
  const output = whole
    .split('\n')
    .map((line) => uncoloured(line).slice(0, LINE_CAP))
    .join('\n')
  if (ASSERTION.test(output)) return 'assertion_failed'
  if (ENVIRONMENT.test(output)) return 'environment'
  if (BEFORE_TEST.test(output)) return 'error_before_test'
  // A command's exit code is its expected result; a test that failed in no words never ran.
  return testPath === null ? 'assertion_failed' : 'error_before_test'
}

/**
 * A Go subtest a proof adds: the test function it runs under (null when the code does not say),
 * its literal `t.Run` name, and the `t.Run` names it is nested in, outermost first (null for a
 * name that is not a literal), as far as the code shows them: from the function's own body when
 * `whole`, otherwise from a hunk that starts inside it.
 */
export interface GoSubtest {
  readonly parent: string | null
  readonly subtest: string
  readonly nesting: ReadonlyArray<string | null>
  readonly whole: boolean
}
/**
 * A Rust test (`#[test]`, `#[tokio::test]`): its function's name, and the inline modules of its
 * file it is declared in, outermost first (null when the file was not read for certain).
 */
export interface RustTest {
  readonly rust: string
  readonly modules: ReadonlyArray<string> | null
}
/**
 * A Rust test with cases (`#[rstest]`, `#[test_case(…)]`): its function's name, which libtest
 * prints alone or with each case under it (`tests::exports::case_1`), and its inline modules.
 */
export interface RustCasedTest {
  readonly function: string
  readonly modules: ReadonlyArray<string> | null
}
/**
 * A test whose name a template makes: a `test.each` format (`%s`, `$name`), or a template literal
 * (`${kind}`), each placeholder standing for words of the title.
 */
export interface TemplateTest {
  readonly template: string
}
/**
 * A test as its file declares it: its title, the titles of the describes or classes it is
 * declared in, outermost first (null when they were not read with certainty: the test then names
 * nothing), whether another test of the file has the same title (`twin`), and whether one has the
 * same path too (`clash`), which no output can tell apart.
 */
export interface DeclaredTest {
  readonly title: string | TemplateTest
  readonly scope: ReadonlyArray<string | TemplateTest> | null
  readonly twin: boolean
  readonly clash: boolean
}
/**
 * A test a proof adds: its declared name, matched as written, a name a template makes, a test
 * with its path in its file, a Go subtest under its parent, or a Rust cased test.
 */
export type TestName = string | TemplateTest | DeclaredTest | GoSubtest | RustTest | RustCasedTest

/** A path with forward slashes: a TAP report on Windows escapes its backslashes, doubled. */
const posix = (path: string): string => path.replace(/\\+/g, '/')

/** The formats `each` replaces after a `%`. */
const FORMATS = 'sdifjoOp#%$'
/** A `$name` placeholder of `each`, with its member path, read where it starts. */
const NAMED_PLACEHOLDER = /\$[A-Za-z_]\w*(?:\.\w+)*/y
/** What a placeholder stands for: words within a title, never across its runner's separators. */
const WORDS = /^[^\n>›]*$/
/** What a placeholder may produce: anything, a separator included. */
const ANYTHING = /^[\s\S]*$/
/** A runner's path separator inside a title: vitest's ` > `, jest's ` › `. */
const SEPARATOR = / [>›] /

/** A template as the matcher reads it: whether whole, and its literal pieces. */
interface ReadTemplate {
  readonly readable: boolean
  readonly pieces: ReadonlyArray<string>
}

/**
 * A template read once, left to right: its placeholders are `each`'s `%s`, `%$` and `$name` and a
 * template literal's `${…}`. It is read whole when each `%` is a format it knows and each `${…}`
 * ends at its first `}` with no brace, quote or template literal inside (`${f({ a })}`,
 * `${a ?? '}'}`); a template it does not read whole may produce any title. Linear: a `${` with no
 * `}` after it ends the reading, since none after it closes either.
 */
const readTemplate = (template: string): ReadTemplate => {
  const pieces: Array<string> = []
  let piece = 0
  let at = 0
  const cut = (start: number, end: number) => {
    pieces.push(template.slice(piece, start))
    piece = end
    at = end
  }
  while (at < template.length) {
    const char = template[at]
    if (char === '%') {
      if (!FORMATS.includes(template[at + 1] ?? '')) return { readable: false, pieces: [] }
      cut(at, at + 2)
    } else if (char === '$' && template[at + 1] === '{') {
      const close = template.indexOf('}', at + 2)
      if (close < 0 || /[{`'"]/.test(template.slice(at + 2, close))) {
        return { readable: false, pieces: [] }
      }
      cut(at, close + 1)
    } else if (char === '$') {
      NAMED_PLACEHOLDER.lastIndex = at
      const named = NAMED_PLACEHOLDER.exec(template)
      if (named === null) at += 1
      else cut(at, at + named[0].length)
    } else at += 1
  }
  pieces.push(template.slice(piece))
  return { readable: true, pieces }
}

/**
 * Whether a title is one a template makes: the title starts and ends with the template's literal
 * pieces, holds the others in their order, and each placeholder stands for what `within` allows,
 * empty included. Linear: each piece is looked for once, at its leftmost place, which leaves every
 * placeholder before it the fewest characters.
 */
const templateMakes = (pieces: ReadonlyArray<string>, title: string, within: RegExp): boolean => {
  if (pieces.length === 1) return title === pieces[0]
  const first = pieces[0] ?? ''
  const last = pieces.at(-1) ?? ''
  const end = title.length - last.length
  if (end < first.length || !title.startsWith(first) || !title.endsWith(last)) return false
  let at = first.length
  for (const piece of pieces.slice(1, -1)) {
    const found = title.indexOf(piece, at)
    if (found < 0 || found + piece.length > end || !within.test(title.slice(at, found))) {
      return false
    }
    at = found + piece.length
  }
  return within.test(title.slice(at, end))
}

/**
 * Whether a printed title is a declared template's: a template read whole, not made of
 * placeholders alone, each placeholder words within the title, never a separator.
 */
const templateAnswers = (template: string, title: string): boolean => {
  const { readable, pieces } = readTemplate(template)
  return (
    readable && !pieces.every((piece) => piece.trim() === '') && templateMakes(pieces, title, WORDS)
  )
}

/** How many tests under a template a file's tests are compared with: past it, none names its test. */
const MAX_TEMPLATES = 64

/**
 * Whether two titles a file declares could be the same title a runner prints, each template read
 * once (`read`): a template could produce a title when each placeholder may stand for anything,
 * and one the matcher does not read whole produces any. Two templates could produce the same title
 * unless the start of one is no start of the other's, or the end of one no end of the other's.
 */
const mayEqual = (
  one: string | TemplateTest,
  other: string | TemplateTest,
  read: (template: string) => ReadTemplate,
): boolean => {
  const produces = (template: ReadTemplate, title: string) =>
    !template.readable || templateMakes(template.pieces, title, ANYTHING)
  if (Predicate.isString(one)) {
    return Predicate.isString(other) ? one === other : produces(read(other.template), one)
  }
  if (Predicate.isString(other)) return produces(read(one.template), other)
  const [first, second] = [read(one.template), read(other.template)]
  if (!first.readable || !second.readable) return true
  const [start, otherStart] = [first.pieces[0] ?? '', second.pieces[0] ?? '']
  const [end, otherEnd] = [first.pieces.at(-1) ?? '', second.pieces.at(-1) ?? '']
  return (
    (start.startsWith(otherStart) || otherStart.startsWith(start)) &&
    (end.endsWith(otherEnd) || otherEnd.endsWith(end))
  )
}

/**
 * A Go subtest as `go test` prints its path: its parent function, the subtests it is nested in,
 * then its name, each space turned into `_` (`TestExport/as_markdown/with_header`), and Go's `#01`
 * when the name repeats. Any subtests may come before the nesting the code does not show whole. A
 * subtest whose parent is unknown is none.
 */
const subtestPattern = (test: GoSubtest): RegExp | null => {
  if (test.parent === null) return null
  const escape = (text: string) => text.replace(/\s/g, '_').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const path = [...test.nesting, test.subtest]
    .map((name) => `/${name === null ? '[^\\s/]+' : escape(name)}`)
    .join('')
  return new RegExp(
    `^${escape(test.parent)}${test.whole ? '' : '(?:/[^\\s/]+)*'}${path}(?:#\\d+)?$`,
  )
}

/** A case of a Rust cased test, as libtest prints it: rstest's `case_1`, test_case's `test_case_1_…`. */
const RUST_CASE = /^(?:test_)?case_\d+\w*$/

/**
 * A Rust cased test as libtest prints its cases: its function, then rstest's `::case_1` or
 * test_case's `::test_case_1_…` or none, never another test of a module named the same.
 */
const casedAnswers = (path: string, function_: string): boolean => {
  const parts = path.split('::')
  return parts.some(
    (part, at) => part === function_ && parts.slice(at + 1).every((after) => RUST_CASE.test(after)),
  )
}

/** go.mod's `module` directive, what follows it. */
const GO_MODULE_LINE = /^module(?:[ \t]+(.*))?$/
/** A module path, bare or quoted (`"…"`, `` `…` ``), never one with an escape or a space. */
const GO_MODULE_PATH = /^(?<q>["`]?)(?<path>[\w.~+-]+(?:\/[\w.~+-]+)*)\k<q>$/

/**
 * A Go module as the `go.mod` nearest above a test file names it: its module path, and the folder
 * of that `go.mod` within the repository (`''` at its root).
 */
export interface GoModule {
  readonly path: string
  readonly folder: string
}

/** The module path a `go.mod` names on its one `module` line; null when it names none for certain. */
export const goModulePath = (text: string): string | null => {
  const found: Array<string | null> = []
  for (const line of text.split(/\r?\n/)) {
    // go.mod's only comments run from `//` to the line's end.
    const bare = line.replace(/(?:^|[ \t])\/\/.*$/, '').trim()
    const module = GO_MODULE_LINE.exec(bare)
    if (module !== null) found.push(GO_MODULE_PATH.exec(module[1] ?? '')?.groups?.['path'] ?? null)
  }
  const [path] = found
  return found.length === 1 && path !== undefined ? path : null
}

/** A path with forward slashes and without a leading `./`, cut into its folders and file. */
const pathParts = (path: string): ReadonlyArray<string> =>
  posix(path).replace(/^\.\//, '').split('/')

/**
 * Whether a Go or Rust failure is the test's (`own`), another package's or binary's (`other`), or
 * either, for all the output says (`unknown`).
 */
type Placed = 'own' | 'other' | 'unknown'

/**
 * Where a Go failure ran against the test file's package: the package its `go.mod` makes of the
 * file's folder, which only that import path names (`own`); any other import path is another
 * package's. Without the module, a path from gotestsum (`.`, `./pkg/b`, from whichever module it
 * ran in) or no package at all, it is `unknown`.
 */
const goPlaced = (unit: string | null, testPath: string, module: GoModule | null): Placed => {
  if (unit === null || unit.startsWith('.') || module === null) return 'unknown'
  const own = goPackageOf(testPath, module)
  if (own === null) return 'unknown'
  return unit === own ? 'own' : 'other'
}

/**
 * A Go test file's import path: its module's path, then the file's folders below the module's
 * folder; null for a file that is not under that folder.
 */
const goPackageOf = (testPath: string, module: GoModule): string | null => {
  const folders = pathParts(testPath).slice(0, -1)
  const root = pathParts(module.folder).filter((part) => part !== '')
  if (root.some((part, at) => folders[at] !== part)) return null
  return [module.path, ...folders.slice(root.length)].join('/')
}

/** The crate's own binary's root file, `src/main.rs`, without its extension. */
const RUST_BIN_ROOT = /^main$/
/** The crate's library's root file, `src/lib.rs`, without its extension. */
const RUST_LIB_ROOT = /^lib$/

/** A Rust module's name as a path part, `mod.rs` aside. */
const RUST_MODULE = /^[A-Za-z_]\w*$/

/**
 * Where a Rust test file's tests run, as its path says when its crate is at the repository's root
 * (one `src` or `tests` folder, first): the test binaries that may hold it, and the modules its
 * file is (`src/a/b.rs` is `a::b`, `src/a/mod.rs` is `a`). Null for another file: a crate in a
 * folder, which no output tells apart from another crate, a benchmark, an example.
 */
const rustPlace = (
  testPath: string,
): { readonly units: ReadonlyArray<string>; readonly modules: ReadonlyArray<string> } | null => {
  const parts = pathParts(testPath)
  const [top, ...rest] = parts
  const roots = parts.slice(0, -1).filter((part) => part === 'src' || part === 'tests')
  const file = rest.at(-1) ?? ''
  if (roots.length !== 1 || (top !== 'src' && top !== 'tests') || !file.endsWith('.rs')) {
    return null
  }
  const path = [...rest.slice(0, -1), file.slice(0, -3)]
  const modulesOf = (inner: ReadonlyArray<string>) => {
    const named = inner.at(-1) === 'mod' ? inner.slice(0, -1) : inner
    const modules = inner.length === 1 && RUST_BIN_ROOT.test(inner[0] ?? '') ? [] : named
    return modules.every((module) => RUST_MODULE.test(module)) ? modules : null
  }
  const [first = '', second = ''] = path
  const binary =
    top === 'tests'
      ? { units: [`test:${first}`], inner: path.slice(1) }
      : first === 'bin'
        ? { units: [`bin:${second}`], inner: path.slice(2) }
        : path.length === 1 && RUST_LIB_ROOT.test(first)
          ? { units: ['lib'], inner: [] }
          : path.length === 1 && RUST_BIN_ROOT.test(first)
            ? { units: ['bin'], inner: [] }
            : { units: ['lib', 'bin'], inner: path }
  const modules = modulesOf(binary.inner)
  return modules === null ? null : { units: binary.units, modules }
}

/**
 * Whether a Rust failure is the declared test's own: printed in a binary that may hold its file,
 * under the path its file and its inline modules make, its function last, or its cases after it.
 * Unknown when its binary, its file's place or its modules were not read for certain, or when one
 * of its panics was raised in another file than the test's.
 */
const rustPlaced = (
  failure: PrintedFailure,
  test: TestName,
  place: ReturnType<typeof rustPlace>,
  testPath: string,
): Placed => {
  if (place === null || failure.unit === null) return 'unknown'
  if (!place.units.includes(failure.unit)) return 'other'
  // A panic raised in another file may be another crate's test of the same path, or a helper's.
  const file = pathParts(testPath).join('/')
  if (failure.panickedIn.some((one) => one.replace(/^\.\//, '') !== file)) return 'unknown'
  if (!Predicate.hasProperty(test, 'modules') || test.modules === null) return 'unknown'
  const prefix = [...place.modules, ...test.modules]
  const parts = failure.name.split('::')
  const own = parts.slice(prefix.length)
  const named = Predicate.hasProperty(test, 'rust')
    ? own.length === 1 && own[0] === test.rust
    : own[0] === test.function && own.slice(1).every((after) => RUST_CASE.test(after))
  return prefix.every((module, at) => parts[at] === module) && named ? 'own' : 'other'
}

/**
 * A pytest summary line's node id, without the message after its first ` - ` outside a case id's
 * brackets (`FAILED a.py::test_y - AssertionError: a.py::test_x[1] failed`), and with what its
 * case ids hold blanked (`test_other[a b::test_x[1]]`), as in a pytest section's heading; any
 * other line whole.
 */
const nodeIdOf = (text: string): string => {
  const summary = PYTEST_SUMMARY.test(text)
  if (!summary && !PYTEST_SECTION.test(text)) return text
  let brackets = 0
  let id = ''
  for (const [at, char] of text.split('').entries()) {
    if (summary && brackets <= 0 && text.startsWith(' - ', at)) return id
    if (char === ']') brackets -= 1
    id += brackets > 0 ? ' ' : char
    if (char === '[') brackets += 1
  }
  return id
}

/**
 * A report's test name, read as any runner prints one: a vitest or jest title, a Rust or pytest
 * path's last part, a pytest case's test.
 */
const reportPrinted = (name: string): Printed =>
  printed('report', name, [...jsTitles(name, null), rustTest(name), name.replace(/\[.*$/, '')])

/** Whether a title a runner prints is a declared one: equal to it, or one its template makes. */
const titleAnswers = (declared: string | TemplateTest, title: string): boolean =>
  Predicate.isString(declared) ? title === declared : templateAnswers(declared.template, title)

/**
 * Whether a failing test is a declared test of the file: by its path when its line prints it
 * whole, otherwise by its title when no other test of the file has that title. A test whose path
 * was not read for certain, or that shares its path with another, is never told apart.
 */
const declaredAnswers = (failure: Printed, test: DeclaredTest): boolean => {
  const scope = test.scope
  if (test.clash || scope === null) return false
  if (failure.paths.length > 0) {
    return failure.paths.some(
      (path) =>
        path.length === scope.length + 1 &&
        [...scope, test.title].every((title, at) => titleAnswers(title, path[at] ?? '')),
    )
  }
  return !test.twin && failure.titles.some((title) => titleAnswers(test.title, title))
}

/**
 * Whether a failing test is one the proof adds: a declared name equal to one of its titles, cut on
 * its runner's separators; a template's; a declared test's path; a Go subtest's path; a Rust
 * test's or cased test's (its modules read apart, see `rustPlaced`).
 */
const answers = (failure: Printed, test: TestName): boolean => {
  if (Predicate.isString(test)) return failure.titles.includes(test)
  if (Predicate.hasProperty(test, 'rust')) return failure.titles.includes(test.rust)
  if (Predicate.hasProperty(test, 'template')) {
    return failure.titles.some((title) => templateAnswers(test.template, title))
  }
  if (Predicate.hasProperty(test, 'scope')) return declaredAnswers(failure, test)
  if (Predicate.hasProperty(test, 'function')) return casedAnswers(failure.name, test.function)
  const pattern = subtestPattern(test)
  return pattern !== null && pattern.test(failure.name)
}

/** Whether a file a runner prints is the test's file, either path ending the other. */
const sameFile = (shown: string, testPath: string): boolean => {
  const one = posix(shown).replace(/^\.\//, '')
  const other = posix(testPath).replace(/^\.\//, '')
  return one === other || one.endsWith(`/${other}`) || other.endsWith(`/${one}`)
}

/**
 * What the failures of the tests the proof adds say: an assertion when one test's own failures
 * say one and none says another error; another error when a test's say one; nothing when no
 * failure is theirs, or theirs say nothing. A failure whose runner prints another file is never the
 * test's. One printed with no file (a tree's line, a pytest section, mocha's list) may be another
 * file's test of the same path: it is never a declared test's, and another name's only when no
 * failure it answers is printed in another file.
 */
const named = (
  failures: ReadonlyArray<PrintedFailure>,
  names: ReadonlyArray<TestName>,
  testPath: string,
  goModule: GoModule | null,
): Verdict => {
  // A Go or Rust failure is the test's only within its package or binary, read for certain; one
  // that may be another's is never its red, and may still refuse it.
  const place = rustPlace(testPath)
  const placed = (failure: PrintedFailure, name: TestName): Placed => {
    if (failure.runner === 'go') return goPlaced(failure.unit, testPath, goModule)
    if (failure.runner === 'rust') return rustPlaced(failure, name, place, testPath)
    return 'own'
  }
  const verdicts = names.map((name) => {
    const matched = failures.filter((failure) => {
      if (!answers(failure, name)) return false
      const where = placed(failure, name)
      return where === 'own' || (where === 'unknown' && failure.verdict === 'error')
    })
    const elsewhere = matched.some(
      (failure) => failure.file !== null && !sameFile(failure.file, testPath),
    )
    const own = matched.filter((failure) =>
      failure.file === null
        ? !elsewhere && !Predicate.hasProperty(name, 'scope')
        : sameFile(failure.file, testPath),
    )
    return combined(own.map((failure) => failure.verdict))
  })
  return verdicts.includes('assertion')
    ? 'assertion'
    : verdicts.includes('error')
      ? 'error'
      : 'silent'
}

/** A report's failure as its runner would print it, with what it says. */
const reportFailure = (failure: ProofRunClass['failures'][number]): PrintedFailure => ({
  ...reportPrinted(failure.test),
  file: failure.file,
  verdict: failure.assertion ? 'assertion' : 'error',
  panickedIn: [],
})

/**
 * What the runner's report says of the tests a proof adds to a JavaScript or Python file: an
 * assertion when one of them failed on an assertion and none on another error, another error when
 * one did, passed when all passed; null when the report does not name them for certain (no report
 * kept, a test not literal whole, one the report does not hold once or skipped, or an assertion
 * the runner's listing does not show). A test whose path another declared test shares is held
 * twice by any report kept, so it is never named.
 */
const reportedVerdict = (
  run: ProofRunClass,
  testPath: string,
  names: ReadonlyArray<TestName>,
): 'assertion' | 'error' | 'passed' | null => {
  const tests = run.reported
  if (tests === null || tests === undefined || names.length === 0) return null
  const python = testPath.endsWith('.py')
  const verdicts = names.map((name) => {
    if (!Predicate.hasProperty(name, 'scope') || name.scope === null) return null
    const key = reportKey(name.scope, name.title, python)
    if (key === null) return null
    const own = tests.filter((one) => one.key === key)
    const [one] = own
    if (own.length !== 1 || one === undefined || one.verdict === 'skipped') return null
    // A file can be written over the report as the run ends; the runner's own line cannot be
    // taken back: an assertion counts only when the listing shows the test failing.
    return one.verdict === 'assertion' && !one.listed ? null : one.verdict
  })
  if (verdicts.includes(null)) return null
  if (verdicts.includes('error')) return 'error'
  return verdicts.includes('assertion') ? 'assertion' : 'passed'
}

/**
 * Whether a run is a valid red for a JavaScript or Python test file. The output is never trusted
 * to name the tests the proof adds, since a test can print anything: it can only refuse (a failure
 * of theirs it shows as another error), and does first. Then the runner's report decides when it
 * names them for certain (an assertion of theirs is a red, another error or a pass is not).
 * Otherwise the key line decides, on a run where an assertion failed.
 */
const scriptedRed = (
  run: ProofRunClass,
  testPath: string,
  names: ReadonlyArray<TestName>,
  keyLineMatched: boolean | null,
): boolean => {
  const located = run.failures.filter((one) => one.file !== null)
  const own =
    located.length > 0 ? located.filter((one) => sameFile(one.file ?? '', testPath)) : run.failures
  const shown = run.failures.length > 0 ? own.map(reportFailure) : run.printedFailures
  if (names.length > 0 && named(shown, names, testPath, null) === 'error') return false
  const report = reportedVerdict(run, testPath, names)
  if (report !== null) return report === 'assertion'
  const asserted =
    run.failures.length > 0
      ? own.some((one) => one.assertion)
      : run.classification === 'assertion_failed'
  return keyLineMatched === true && asserted
}

/**
 * Whether a run is a valid red (CT-35): an assertion that failed in the scenario's own test. A
 * report that names the files tells it by its file. When the proof's code names its tests, a test
 * it adds must be named among the failures (of its file, when the report names files; otherwise a
 * report's failing tests, or the tests the failing lines of the whole output name) and its own
 * failures decide, whatever the run's other tests did: one says an assertion failed and none says
 * another error. When none is its own, or its own say nothing, the key line decides, on a run
 * where an assertion failed (in its file, for a report), never the exit code alone. A proof whose
 * code names no test, or a command with no test file, is red by its exit code, the key line its
 * guard. A Go subtest whose parent is unknown is a test the proof adds without a name: alone, the
 * key line decides when the proof has one, and the exit code when it has none. A Go failure is
 * the test's only in the package `goModule` (the nearest `go.mod` above the file) makes of its
 * folder; without it, every Go failure is uncertain and the key line decides.
 */
export const validRed = (
  run: ProofRunClass,
  testPath: string | null,
  testNames: ReadonlyArray<TestName> = [],
  keyLineMatched: boolean | null = null,
  goModule: GoModule | null = null,
): boolean => {
  const asserted = run.classification === 'assertion_failed'
  if (testPath === null) return asserted
  if (SCRIPTED.test(testPath)) return scriptedRed(run, testPath, testNames, keyLineMatched)
  const located = run.failures.filter((one) => one.file !== null)
  const own =
    located.length > 0
      ? located.filter((one) => posix(one.file ?? '').endsWith(posix(testPath)))
      : run.failures
  const unnamed =
    testNames.length > 0 &&
    testNames.every((name) => Predicate.hasProperty(name, 'parent') && name.parent === null)
  const names = unnamed && keyLineMatched === null ? [] : testNames
  if (names.length === 0 || (unnamed && keyLineMatched === true)) {
    return asserted && (located.length === 0 || own.some((one) => one.assertion))
  }
  const reported = run.failures.length > 0
  const said = named(
    reported ? own.map(reportFailure) : run.printedFailures,
    names,
    testPath,
    goModule,
  )
  if (said !== 'silent') return said === 'assertion'
  return keyLineMatched === true && (reported ? own.some((one) => one.assertion) : asserted)
}

/**
 * The name a Go `func TestX(t *testing.T)` declares, and the literal names of its subtests
 * (`t.Run("…",`); a Rust `fn x` under `#[test]` (or `#[tokio::test(…)]`), and a Rust cased test
 * under `#[rstest]` or `#[test_case(…)]`. JavaScript and Python tests are read by their tokenizers
 * (`test-sources.ts`).
 */
const GO_NAME = /^func[ \t]+(?<name>Test\w*)[ \t]*\([ \t]*\w+[ \t]+\*testing\.T[ \t]*\)/gm
/** A `t.Run(` call's literal name, read where the call starts, across lines. */
const GO_SUBTEST_NAME = /\w+\.Run\(\s*(["`])(?<name>(?:(?!\1).)+)\1\s*,/y
/** A `t.Run(` call, its name a literal or not. */
const GO_RUN = /\b\w+\.Run\(/g
/**
 * Go's strings, runes and comments, a raw string or a block comment across lines; a block comment
 * never closed runs to the end, matched once.
 */
const GO_LITERAL =
  /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|`[^`]*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g
/** The function a line of Go declares, or a hunk header names after its `@@`. */
const GO_FUNCTION = /^(?:@@[^@]*@@\s*)?func\s/
const RUST_NAME =
  /#\[(?:\w+::)*test(?:\((?:[^[\]]|\[[^[\]]*\])*\))?\]\s*(?:#\[(?:[^[\]]|\[[^[\]]*\])*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(?<name>\w+)/g
const RUST_CASED_NAME =
  /#\[(?:\w+::)*(?:rstest|test_case)(?:\((?:[^[\]]|\[[^[\]]*\])*\))?\]\s*(?:#\[(?:[^[\]]|\[[^[\]]*\])*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(?<name>\w+)/g

/**
 * The lines a patch adds, numbered in the file's code (from 1), as its hunks' headers place them;
 * null when a hunk's line is not the code's at its place (a patch that does not make this code).
 */
const addedLinesOf = (patch: string, lines: ReadonlyArray<string>): ReadonlySet<number> | null => {
  const added = new Set<number>()
  let next: number | null = null
  for (const line of patch.split(/\r?\n/)) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (header !== null) {
      next = Number(header[1])
      // A hunk that adds nothing at the top of the file is numbered from 0.
      if (next === 0) next = 1
      continue
    }
    if (next === null) continue
    if (line.startsWith('+')) {
      if ((lines[next - 1] ?? '').replace(/\r$/, '') !== line.slice(1)) return null
      added.add(next)
      next += 1
    } else if (line.startsWith(' ') || line === '') {
      next += 1
    }
  }
  return next === null ? null : added
}

/**
 * The tests a proof adds: every test its new file declares, or those the lines its patch adds
 * declare, a Go subtest with the function it runs under; none when the code names none. A
 * JavaScript or Python test is read by its tokenizer in the file's whole code, with the describes
 * or classes it is declared in and the file's other tests of the same title. A name decides only
 * when read with certainty: a test read from a patch that does not place in the code, from a file
 * its tokenizer is not certain of, or a Rust test whose name the file declares twice, names
 * nothing, and the key line decides. A title a template of the file could produce is a twin of the
 * template's tests, and a path one could produce a clash.
 */
export const addedTests = (test: {
  readonly insertion: 'new_file' | 'addition'
  readonly code: string
  readonly patch: string | null
}): ReadonlyArray<TestName> => {
  try {
    return readAdded(test)
  } catch {
    // A reader that fails has read nothing for certain: no name, the key line decides.
    return []
  }
}

const readAdded = (test: {
  readonly insertion: 'new_file' | 'addition'
  readonly code: string
  readonly patch: string | null
}): ReadonlyArray<TestName> => {
  const lines = test.code.split('\n')
  const placed = test.insertion === 'new_file' ? null : addedLinesOf(test.patch ?? '', lines)
  const whole = test.insertion === 'new_file' || placed !== null
  const added = whole
    ? test.code
    : (test.patch ?? '')
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .map((line) => line.slice(1))
        .join('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length + 1
  }
  // The line a place is on: the last line starting at it or before, found by halving.
  const lineAt = (at: number) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if ((starts[middle] ?? 0) <= at) low = middle
      else high = middle - 1
    }
    return low
  }
  const key = (title: string | TemplateTest) =>
    Predicate.isString(title) ? `"${title}` : `\`${title.template}`
  // How many of the file's tests have each key.
  const count = (keys: ReadonlyArray<string>) => {
    const counted = new Map<string, number>()
    for (const one of keys) counted.set(one, (counted.get(one) ?? 0) + 1)
    return counted
  }
  const sources = [jsTests(added), pythonTests(added)].flatMap((read) =>
    read.tests.map((one) => ({ ...one, certain: whole && read.certain })),
  )
  // A test under a template (its title's or a describe's) is told apart from another only where no
  // title its template produces could be the other's: a title either could have makes them twins, a
  // path either could have a clash.
  const templated = sources.flatMap((one, at) =>
    [one.title, ...one.scope].some((title) => !Predicate.isString(title)) ? [at] : [],
  )
  const isTemplated = new Set(templated)
  // A path, its titles joined as vitest prints them: a template's placeholders may hold a separator.
  const joined = sources.map((one) =>
    [...one.scope, one.title].map((title) => (Predicate.isString(title) ? title : title.template)),
  )
  const printedPaths = joined.map((path) => path.join(' > '))
  const reads = new Map<string, ReadTemplate>()
  const read = (template: string) => {
    const known = reads.get(template)
    if (known !== undefined) return known
    const fresh = readTemplate(template)
    reads.set(template, fresh)
    return fresh
  }
  const twins = new Set<number>()
  const clashes = new Set<number>(templated.length > MAX_TEMPLATES ? sources.keys() : [])
  for (const at of clashes.size > 0 ? [] : templated) {
    const one = sources[at]
    const path = { template: printedPaths[at] ?? '' }
    for (const [other, two] of sources.entries()) {
      if (one === undefined || other === at) continue
      if (mayEqual(one.title, two.title, read)) twins.add(at).add(other)
      const otherPath = printedPaths[other] ?? ''
      if (mayEqual(path, isTemplated.has(other) ? { template: otherPath } : otherPath, read)) {
        clashes.add(at).add(other)
      }
    }
  }
  // A title holding a runner's separator reads as a path: no path of the file is certain.
  const separated = joined.some((path) => path.some((title) => SEPARATOR.test(title)))
  const titles = count(sources.map((one) => key(one.title)))
  const paths = count(sources.map((one) => [...one.scope, one.title].map(key).join('\n')))
  const declared: ReadonlyArray<{ readonly at: number; readonly name: TestName }> = sources.map(
    (one, at) => ({
      at: one.at,
      name: {
        title: one.title,
        scope: one.certain && !separated ? one.scope : null,
        twin: twins.has(at) || (titles.get(key(one.title)) ?? 0) > 1,
        clash:
          clashes.has(at) || (paths.get([...one.scope, one.title].map(key).join('\n')) ?? 0) > 1,
      },
    }),
  )
  const rust = Array.from(added.matchAll(RUST_NAME), (found) => ({
    at: found.index,
    title: found.groups?.['name'] ?? '',
  }))
  const functions = count(rust.map((one) => one.title))
  const cased = Array.from(added.matchAll(RUST_CASED_NAME), (found) => ({
    at: found.index,
    function: found.groups?.['name'] ?? '',
  }))
  // The inline modules each Rust test is declared in, read only in the whole file.
  const modules = whole
    ? rustModulesAt(
        added,
        [...rust, ...cased].map((one) => one.at),
      )
    : []
  const others: ReadonlyArray<{ readonly at: number; readonly name: TestName }> = [
    ...Array.from(added.matchAll(GO_NAME), (found) => ({
      at: found.index,
      name: found.groups?.['name'] ?? '',
    })),
    // A Rust test the file declares twice, in two modules, is told apart by no name.
    ...rust.map((one, index) => ({
      at: one.at,
      name:
        whole && (functions.get(one.title) ?? 0) > 1
          ? { title: one.title, scope: null, twin: true, clash: false }
          : { rust: one.title, modules: modules[index] ?? null },
    })),
    ...cased.map((one, index) => ({
      at: one.at,
      name: { function: one.function, modules: modules[rust.length + index] ?? null },
    })),
  ]
  const inOrder = [...declared, ...others]
    .filter((one) => placed === null || placed.has(lineAt(one.at) + 1))
    .toSorted((a, b) => a.at - b.at)
    .map((one) => one.name)
  return [...inOrder, ...subtestsOf(test)]
}

/** A Rust `mod name` right before a brace, as a block's header ends. */
const RUST_MOD_HEADER = /(?:^|[^\w])mod\s+(?:r#)?(?<name>[A-Za-z_]\w*)\s*$/
/** A Rust raw string's start, its prefix read as a word: `r"`, `r#"`, `br##"`, `cr"`. */
const RUST_RAW = /[bc]?r(?<hashes>#*)"/y
/** A Rust word: an identifier, a keyword, a number, a literal's prefix. */
const RUST_WORD = /\w+/y

/**
 * The inline modules each place of a Rust file is in, outermost first, read once left to right,
 * its comments (nested ones too), strings, raw strings, chars and lifetimes aside. A place inside
 * another block (a function, an `impl`, a macro) or inside a comment or a string is in none for
 * certain (null); every place is, in a file not read whole: a comment or a string never closed, a
 * brace never matched.
 */
const rustModulesAt = (
  code: string,
  places: ReadonlyArray<number>,
): ReadonlyArray<ReadonlyArray<string> | null> => {
  const none = places.map(() => null)
  const order = places.map((at, index) => ({ at, index })).toSorted((a, b) => a.at - b.at)
  const found: Array<ReadonlyArray<string> | null> = places.map(() => null)
  // The blocks open, a module by its name, any other block null; and the code since the last
  // `;`, `{` or `}`, its comments and literals blanked: the header of the next block.
  const open: Array<string | null> = []
  let header = ''
  let next = 0
  let at = 0
  while (at < code.length) {
    // A place passed over was inside a comment or a literal.
    while ((order[next]?.at ?? Infinity) < at) next += 1
    while (order[next]?.at === at) {
      const modules = open.flatMap((name) => (name === null ? [] : [name]))
      found[order[next]?.index ?? 0] = modules.length === open.length ? modules : null
      next += 1
    }
    const char = code[at] ?? ''
    if (code.startsWith('//', at)) {
      const end = code.indexOf('\n', at)
      at = end < 0 ? code.length : end
      header += ' '
    } else if (code.startsWith('/*', at)) {
      let depth = 1
      let end = at + 2
      let opening = code.indexOf('/*', end)
      let closing = code.indexOf('*/', end)
      while (depth > 0) {
        if (closing < 0) return none
        if (opening >= 0 && opening < closing) {
          depth += 1
          end = opening + 2
          opening = code.indexOf('/*', end)
        } else {
          depth -= 1
          end = closing + 2
          closing = code.indexOf('*/', end)
          if (opening >= 0 && opening < end) opening = code.indexOf('/*', end)
        }
      }
      at = end
      header += ' '
    } else if (char === '"') {
      let end = at + 1
      while (end < code.length && code[end] !== '"') end += code[end] === '\\' ? 2 : 1
      if (end >= code.length) return none
      at = end + 1
      header += ' '
    } else if (char === "'") {
      // A char (`'{'`, `'\''`, `'\u{7d}'`), or else a lifetime or a label (`'a`).
      const point = code.codePointAt(at + 1) ?? 0
      const width = point > 0xffff ? 2 : 1
      if (code[at + 1] === '\\') {
        const end = code.indexOf("'", at + 3)
        if (end < 0 || end > at + 12) return none
        at = end + 1
        header += ' '
      } else if (code[at + 1 + width] === "'") {
        at += 2 + width
        header += ' '
      } else {
        at += 1
        header += char
      }
    } else if (/\w/.test(char) && !/\w/.test(code[at - 1] ?? '')) {
      RUST_RAW.lastIndex = at
      const raw = RUST_RAW.exec(code)
      if (raw !== null) {
        const close = `"${raw.groups?.['hashes'] ?? ''}`
        const end = code.indexOf(close, at + raw[0].length)
        if (end < 0) return none
        at = end + close.length
        header += ' '
      } else {
        RUST_WORD.lastIndex = at
        const word = RUST_WORD.exec(code)?.[0] ?? char
        at += word.length
        header += word
      }
    } else if (char === '{') {
      open.push(RUST_MOD_HEADER.exec(header.slice(-256))?.groups?.['name'] ?? null)
      header = ''
      at += 1
    } else if (char === '}') {
      if (open.length === 0) return none
      open.pop()
      header = ''
      at += 1
    } else {
      header = char === ';' ? '' : header + char
      at += 1
    }
  }
  return open.length === 0 ? found : none
}

/**
 * The literal names of the Go subtests a proof adds (`t.Run("…",`), each with the test function
 * it runs under: the last `func` above it in the new file, or in a patch its hunk's lines and the
 * function its `@@ … @@ func TestX(` header names, null when it is under no test function. Its
 * nesting is read from the braces above it in their order, strings, runes and comments aside: a
 * `t.Run` opens a level at its function's own brace, the first one inside its call (a closure
 * that a wrapper call takes, `withDB(func(t *testing.T) {`, as well).
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
  const code = goCode(lines.map((line) => line.text))
  const raw = lines.map((line) => line.text).join('\n')
  const found: GoSubtest[] = []
  let parent: string | null = null
  let whole = true
  // The `t.Run` blocks open above, each with the depth of braces inside it, and the calls still
  // waiting for their function's brace, each with the depth of parentheses inside it.
  let open: Array<{ readonly name: string | null; readonly depth: number }> = []
  let calls: Array<{ readonly name: string | null; readonly parens: number }> = []
  let depth = 0
  let parens = 0
  let offset = 0
  for (const [at, line] of lines.entries()) {
    const start = offset
    offset += line.text.length + 1
    const isHeader = line.text.startsWith('@@')
    if (GO_FUNCTION.test(line.text) || isHeader) {
      parent = GO_FUNCTION.test(line.text)
        ? (new RegExp(GO_NAME.source).exec(line.text.replace(/^@@[^@]*@@\s*/, ''))?.groups?.[
            'name'
          ] ?? null)
        : null
      whole = !isHeader
      open = []
      calls = []
      depth = 0
      parens = 0
      if (isHeader) continue
    }
    const text = code[at] ?? ''
    const runs = new Set(Array.from(text.matchAll(GO_RUN), (run) => run.index))
    for (const [column, char] of text.split('').entries()) {
      if (runs.has(column)) {
        GO_SUBTEST_NAME.lastIndex = start + column
        const subtest = GO_SUBTEST_NAME.exec(raw)?.groups?.['name']
        const nesting = open.map((block) => block.name)
        if (line.added && subtest !== undefined) found.push({ parent, subtest, nesting, whole })
        calls.push({ name: subtest ?? null, parens: parens + 1 })
      }
      if (char === '(') parens += 1
      if (char === ')') {
        parens -= 1
        calls = calls.filter((call) => call.parens <= parens)
      }
      if (char === '{') {
        depth += 1
        const call = calls.findLast((one) => one.parens <= parens)
        if (call !== undefined) open.push({ name: call.name, depth })
        calls = calls.filter((one) => one !== call)
      }
      if (char === '}') {
        depth -= 1
        open = open.filter((block) => block.depth <= depth)
      }
    }
  }
  return found
}

/**
 * Lines of Go with their strings, runes and comments blanked, each hunk of a patch read apart (a
 * header's words are not code).
 */
const goCode = (lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const blanked = (hunk: ReadonlyArray<string>) =>
    hunk.length === 0
      ? []
      : hunk
          .join('\n')
          .replace(GO_LITERAL, (literal) => literal.replace(/[^\n]/g, ' '))
          .split('\n')
  const code: string[] = []
  let hunk: string[] = []
  for (const line of lines) {
    if (!line.startsWith('@@')) {
      hunk.push(line)
      continue
    }
    code.push(...blanked(hunk), line)
    hunk = []
  }
  return [...code, ...blanked(hunk)]
}

/** The literal names a proof's tests are declared with, as its code reads. */
export const addedTestNames = (test: {
  readonly insertion: 'new_file' | 'addition'
  readonly code: string
  readonly patch: string | null
}): ReadonlyArray<string> =>
  addedTests(test).map((name) => {
    if (Predicate.isString(name)) return name
    if (Predicate.hasProperty(name, 'template')) return name.template
    if (Predicate.hasProperty(name, 'scope')) {
      return Predicate.isString(name.title) ? name.title : name.title.template
    }
    if (Predicate.hasProperty(name, 'rust')) return name.rust
    return Predicate.hasProperty(name, 'function') ? name.function : name.subtest
  })

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

// ---- The runner's own files (#479).

/**
 * A file of a red's repository that can change the runner's own verdict, by its name, in any case
 * (Windows finds `Conftest.py` as `conftest.py`): a red whose patch changed one is refused, since
 * the runner itself could then list and report the added test as failed. Each is read as its
 * runner reads it (`runnerPart`).
 */
export type RunnerFile =
  | 'conftest'
  | 'pytest'
  | 'pyproject'
  | 'setup.cfg'
  | 'tox.ini'
  | 'vitest'
  | 'package.json'
  | 'npmrc'

const RUNNER_NAMES: ReadonlyMap<string, RunnerFile> = new Map([
  ['conftest.py', 'conftest'],
  ['pytest.ini', 'pytest'],
  ['.pytest.ini', 'pytest'],
  ['pytest.toml', 'pytest'],
  ['.pytest.toml', 'pytest'],
  ['pyproject.toml', 'pyproject'],
  ['setup.cfg', 'setup.cfg'],
  ['tox.ini', 'tox.ini'],
  ['package.json', 'package.json'],
  ['.npmrc', 'npmrc'],
])

const VITEST_CONFIG =
  /^(?:vitest|vite)\.config\.[cm]?[jt]s$|^vitest\.workspace\.(?:[cm]?[jt]s|json)$/

/** What a runner file is, said to the Builder. */
const RUNNER_SAID: Readonly<Record<RunnerFile, string>> = {
  conftest: 'a conftest.py',
  pytest: 'pytest’s configuration',
  pyproject: 'its [tool.pytest] table',
  'setup.cfg': 'its [tool:pytest] section',
  'tox.ini': 'its [pytest] section',
  vitest: 'vitest’s configuration',
  'package.json': 'its scripts',
  npmrc: 'npm’s configuration',
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const folderOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf('/'), 0))

/** What a file is to the runner, by its name: null for any other file. */
export const runnerFileOf = (path: string): RunnerFile | null => {
  const name = baseName(posix(path)).toLowerCase()
  return RUNNER_NAMES.get(name) ?? (VITEST_CONFIG.test(name) ? 'vitest' : null)
}

const whole = (text: string): string => text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')

/** An ini file's section as iniconfig reads it: from its header at the start of a line to the next. */
const iniSection = (text: string, name: string): string | null => {
  const lines = whole(text).split('\n')
  const header = (line: string) => /^\[(?<name>[^\]]*)\]/.exec(line)?.groups?.name?.trim() ?? null
  const start = lines.findIndex((line) => header(line) === name)
  if (start < 0) return null
  const end = lines.findIndex((line, at) => at > start && header(line) !== null)
  return lines.slice(start, end < 0 ? undefined : end).join('\n')
}

const PyprojectPytest = Schema.Struct({
  tool: Schema.Struct({ pytest: Schema.Unknown }),
})
const PackageScripts = Schema.fromJsonString(
  Schema.Struct({ scripts: Schema.optional(Schema.Unknown) }),
)

/**
 * The part of a runner file its runner reads, line endings and a byte-order mark aside: a
 * pyproject's `tool.pytest` table read as TOML, an ini file's pytest section, a package.json's
 * scripts, any other whole; null when there is no such file or part. A file that does not read
 * is judged whole.
 */
export const runnerPart = (kind: RunnerFile, text: string | null): string | null => {
  if (text === null) return null
  switch (kind) {
    case 'pyproject': {
      const table = Result.try(() => parseToml(whole(text)))
      if (Result.isFailure(table)) return `text:${whole(text)}`
      const found = Schema.decodeUnknownOption(PyprojectPytest)(table.success)
      return Option.isNone(found) ? null : `toml:${JSON.stringify(found.value.tool.pytest)}`
    }
    case 'setup.cfg':
      return iniSection(text, 'tool:pytest')
    case 'tox.ini':
      return iniSection(text, 'pytest')
    case 'package.json': {
      const found = Schema.decodeUnknownOption(PackageScripts)(whole(text))
      if (Option.isNone(found)) return `text:${whole(text)}`
      return found.value.scripts === undefined
        ? null
        : `json:${JSON.stringify(found.value.scripts)}`
    }
    default:
      return whole(text)
  }
}

/** A tree of a red's repository: its files, and the target of each of its links. */
export interface RunnerTree {
  readonly files: ReadonlyArray<string>
  readonly links: ReadonlyMap<string, string>
}

/** A path made plain: `/` between its parts, no `.`, each `..` taken back; null past the root. */
const plain = (path: string): string | null => {
  const parts: Array<string> = []
  for (const part of posix(path).split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.pop() === undefined) return null
  }
  return parts.join('/')
}

/** Where a path of the tree leads once each link on its way is followed; null out of the tree. */
const resolved = (path: string, links: ReadonlyMap<string, string>): string | null => {
  let at: string | null = plain(path)
  for (let hops = 0; at !== null && hops < 40; hops += 1) {
    const parts: ReadonlyArray<string> = at.split('/')
    const through = parts.findIndex((_, index) => links.has(parts.slice(0, index + 1).join('/')))
    if (through < 0) return at
    const link = parts.slice(0, through + 1).join('/')
    const target = links.get(link) ?? ''
    if (target.startsWith('/') || /^[A-Za-z]:/.test(target)) return null
    at = plain([folderOf(link), target, ...parts.slice(through + 1)].join('/'))
  }
  return null
}

/** The extensions a name may leave out, a setup file or a module named without its own. */
const LEFT_OUT = ['', '.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs', '.jsx', '.py']

/**
 * The files a text may name, as paths of the tree: each word that holds a `/` or a `.`, from the
 * text's folder and from the root, with each extension it may leave out, and a dotted Python
 * module's file or package.
 */
const namedIn = (text: string, folder: string): ReadonlyArray<string> => {
  const found = new Set<string>()
  for (const word of text.match(/[^\s"'`=,;:()[\]{}<>|&]+/g) ?? []) {
    if (word.startsWith('-') || !/[./\\]/.test(word) || word.length > 512) continue
    const paths = [word, `${folder}/${word}`]
    if (/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(word)) {
      const module = word.replaceAll('.', '/')
      paths.push(`${module}.py`, `${module}/__init__.py`)
    }
    for (const path of paths) {
      for (const extension of LEFT_OUT) {
        const one = plain(`${path}${extension}`)
        if (one !== null && one !== '') found.add(one)
      }
    }
  }
  return [...found]
}

const within = (folder: string, path: string): boolean =>
  folder === '' || path.toLowerCase().startsWith(`${folder.toLowerCase()}/`)

/**
 * The files the rule reads whole in the tree a red ran on, each where its links lead: the runner
 * files in the test's folder and each folder above it, then the files its command names.
 */
export const runnerReads = (
  tree: RunnerTree,
  testPath: string,
  command: string,
): ReadonlyArray<{ readonly path: string; readonly real: string }> => {
  const test = plain(testPath) ?? ''
  const files = new Set(tree.files.map((one) => one.toLowerCase()))
  const reads = new Map<string, string>()
  const add = (path: string) => {
    const real = resolved(path, tree.links)
    if (real !== null && !reads.has(path)) reads.set(path, real)
  }
  for (const path of tree.files) {
    if (runnerFileOf(path) !== null && within(folderOf(path), test)) add(path)
  }
  for (const path of namedIn(command, '')) {
    if (path.toLowerCase() !== test.toLowerCase() && files.has(path.toLowerCase())) add(path)
  }
  return [...reads].map(([path, real]) => ({ path, real }))
}

/** A file a red's patch changed, and the text of each side of a runner file (null otherwise). */
export interface PatchSide {
  readonly path: string
  readonly before: string | null
  readonly after: string | null
}

/**
 * A red's patch, against its Building's base, in the proof's repository: the tree it ran on, the
 * files changed (a rename as its old path removed and its new one added), the texts of the files
 * `runnerReads` names (by the path it names), the test file and the line run.
 */
export interface RunnerPatch {
  readonly tree: RunnerTree
  readonly changed: ReadonlyArray<PatchSide>
  readonly read: ReadonlyMap<string, string>
  readonly testPath: string
  readonly command: string
}

/** The file of a red's patch that changes how the runner judges, and why it does. */
export interface RunnerChange {
  readonly path: string
  readonly why: string
}

/**
 * The first file of a red's patch that changes how its runner judges (#479), or null: a runner
 * file whose part changed, a file a runner file on the test's path leads to through a link, or a
 * file named by one of them or by the command (a setup file, a plugin, a `--require`), the test
 * file the proof adds aside. A file named by a named file is not followed.
 */
export const runnerChange = (patch: RunnerPatch): RunnerChange | null => {
  for (const side of patch.changed) {
    const kind = runnerFileOf(side.path)
    if (kind !== null && runnerPart(kind, side.before) !== runnerPart(kind, side.after)) {
      return { path: side.path, why: RUNNER_SAID[kind] }
    }
  }
  const test = (plain(patch.testPath) ?? '').toLowerCase()
  const changed = new Map(patch.changed.map((side) => [side.path.toLowerCase(), side.path]))
  const changedOf = (path: string | null) =>
    path === null || path.toLowerCase() === test ? undefined : changed.get(path.toLowerCase())
  const reads = runnerReads(patch.tree, patch.testPath, patch.command)
  for (const read of reads) {
    const through = read.real === read.path ? undefined : changedOf(read.real)
    if (through !== undefined) return { path: through, why: `through the link ${read.path}` }
  }
  const namedBy = (text: string, folder: string, by: string) => {
    for (const path of namedIn(text, folder)) {
      const found = changedOf(resolved(path, patch.tree.links))
      if (found !== undefined) return { path: found, why: `named by ${by}` }
    }
    return null
  }
  for (const read of reads) {
    const kind = runnerFileOf(read.path)
    const part = kind === null ? null : runnerPart(kind, patch.read.get(read.path) ?? null)
    const found = part === null ? null : namedBy(part, folderOf(read.path), read.path)
    if (found !== null) return found
  }
  return namedBy(patch.command, '', 'the proof’s command')
}
