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
  /**
   * The lines of the whole output that start with a known runner's failure mark, uncoloured, each
   * cut to a few KB.
   */
  readonly failingLines: ReadonlyArray<string>
  /**
   * The tests the failing lines name whose own text says an assertion failed, each as its runner
   * prints it: a failing line, a pytest section heading, a Rust failure's stdout heading, a mocha
   * failure's title in its list, never its tree's line.
   */
  readonly asserted: ReadonlyArray<Printed>
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
  /\b(ERR_ASSERTION|AssertionError|AssertionFailedError)\b|\bexpect\([^\n]{0,200}?\)\.|^E[ \t]+assert\b|^FAILED \S+::|^--- FAIL: |^=== FAIL: \S+ Test\S* \(\d+(?:\.\d+)?s\)\s*$|\bassertion\b[^\n]{0,200}?\bfailed\b|\bpanicked at\b|\btest did not panic as expected\b|\bFailed: DID NOT (?:RAISE|WARN)\b/m
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
/**
 * What a pytest section says, never the test's source it prints unnumbered above: its `E ` lines
 * and its `file:line: Name` trailer.
 */
const PYTEST_SAID = /^E(?:\s|$)|^\S+:\d+: [\w.]*\s*$/
/**
 * With `--tb=native`, a section prints no `E ` line: what it says is the exception of its last
 * traceback, at column 0 (its source and frames are indented), above what the test printed.
 */
const PYTEST_TRACEBACK = /^Traceback \(most recent call last\):\s*$/
const PYTEST_CAPTURED = /^-+ Captured .* -+\s*$/
/**
 * An exception group, in either mode, prints its traceback in a frame: each line after `| `, what
 * it says at the frame's column 0, its source and its files indented further.
 */
const PYTEST_GROUP = /^[ \t]*\+ Exception Group Traceback \(most recent call last\):\s*$/
const PYTEST_GROUP_SAID = /^[ \t]*\| (?<said>\S.*)$/
const EXCEPTION_GROUP = /^(?:[A-Za-z_]\w*\.)*(?:Base)?ExceptionGroup:/
/**
 * pytest's own `Failed: ` (`pytest.fail`, a plugin's timeout) is what the test raised, whatever the
 * lines of its message say; its `DID NOT RAISE` and `DID NOT WARN` are assertions.
 */
const PYTEST_FAILED = /^(?:E[ \t]+)?Failed: (?!DID NOT (?:RAISE|WARN)\b)/m
/** pytest's summary line, `FAILED file::test - message`. */
const PYTEST_SUMMARY = /^FAILED \S+::/
/** unittest's and Django's `FAIL: test_x (module.Class.test_x)`. */
const UNITTEST_HEADING = /^FAIL: (?<name>test\w*) \(\w+(?:\.\w+)+\)(?: .*)?$/
/** go test's `--- FAIL: TestX/sub (0.00s)`, its name the path before its duration. */
const GO_FAIL = /^\s*--- FAIL: /
const GO_PATH = /^\s*--- FAIL: (?<name>\S+)(?=\s+\(|\s*$)/
/** gotestsum's `=== FAIL: pkg TestX (0.00s)`, never one without its duration. */
const GOTESTSUM_FAIL = /^=== FAIL: \S+ (?<name>Test\S*) \(\d+(?:\.\d+)?s\)\s*$/
/** libtest's `test x ... FAILED` (`test x - should panic ... FAILED`). */
const LIBTEST_FAILED = /^test (?<name>\S+)(?: - should panic)? \.\.\. FAILED\s*$/
/** cargo-nextest's `FAIL [ 0.004s] (1/2) crate x`. */
const NEXTEST_FAIL = /^\s*FAIL \[\s*\d+(?:\.\d+)?s\] (?:\(\s*\d+\/\d+\) )?\S+ (?<name>\S+)\s*$/
/** libtest's heading of a failure's output, below its `failures:` line. */
const RUST_STDOUT = /^---- (?<name>\S+) stdout ----\s*$/
const RUST_FAILURES = /^failures:\s*$/
/** vitest's, jest's and node:test's marks `×`, `✕`, `✖` before a test's title. */
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
const TAP_NOT_OK = /^\s*not ok \d+(?: - (?<name>.*))?/
/** jest's and node:test's duration after a title, `(3 ms)`, `(0.97ms)`; vitest's, ` 3ms`. */
const PAREN_DURATION = /\s+\(\d+(?:\.\d+)?\s?m?s\)\s*$/
const BARE_DURATION = /\s\d+(?:\.\d+)?ms\s*$/
/** The separators vitest (` > `) and jest (` › `) print between a describe's title and a test's. */
const JS_SEPARATOR = / [>›] /g
/**
 * The first error a failure's text says was thrown: JavaScript's and Python's, its module before
 * it or not (`TypeError: …`, `E   app.errors.NotFoundError: …`, `AssertionError [ERR_ASSERTION]:
 * …`), jest's `thrown: ` for what is no error (its own timeout, `undefined`), or Go's `panic: `.
 * Testify's `Error:` followed by its column of spaces is an assertion's report, not a throw.
 */
const THROWN =
  /^[ \t]*(?:E[ \t]+)?(?:(?:[A-Za-z_]\w*\.)*(?<error>(?:[A-Z]\w*)?(?:Error|Exception))(?: \[\w+\])?:(?= \S|$)|thrown: |panic: )/m
/** A line of the code frame jest and vitest print under an error (`> 4 |   expect(x)…`). */
const CODE_FRAME = /^[ \t]*(?:>[ \t]*)?\d+[ \t]*\|.*$/gm
const ASSERTION_THROWN = /^Assertion(?:Failed)?Error$/
/** Signs of a test file the runner did not find. */
const NOT_FOUND =
  /Could not find '|No test files? found|no tests? (were )?found|ENOENT[^\n]*\.test\./i

/** A line without its ANSI colours and cursor moves. */
// oxlint-disable-next-line no-control-regex -- the escape character is what is matched
const uncoloured = (line: string): string => line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')

/**
 * Whether a failure's own text says an assertion failed: the first error it says was thrown when
 * there is one (an assertion's, or a `TypeError` whose code frame shows an `expect`), otherwise
 * the words of an assertion, never read in a code frame (the test's source, not what it said).
 */
const asserts = (output: string): boolean => {
  const text = output.replace(CODE_FRAME, '')
  const thrown = THROWN.exec(text)
  if (thrown !== null) return ASSERTION_THROWN.test(thrown.groups?.['error'] ?? '')
  return ASSERTION.test(text)
}

/** Whether what a pytest failure says is an assertion, its own `Failed: ` before anything else. */
const pytestAsserts = (said: string): boolean => {
  const failed = PYTEST_FAILED.exec(said)
  const thrown = THROWN.exec(said)
  if (failed !== null && (thrown === null || failed.index <= thrown.index)) return false
  return asserts(said)
}

/**
 * The runners whose failing lines name a test, each read by its own reader below, and the
 * reports (JUnit XML, TAP) whose test names are read as any of them print one.
 */
export type Runner = 'js' | 'mocha' | 'pytest' | 'unittest' | 'go' | 'rust' | 'report'

/**
 * A failing test as its runner prints it: its name whole (a Go or Rust path, a vitest title), and
 * the titles a declared name is matched whole against, cut on the runner's own separators.
 */
export interface Printed {
  readonly runner: Runner
  readonly name: string
  readonly titles: ReadonlyArray<string>
}

/**
 * A failing line a reader knows: the test it names, null when it names none (mocha's tree, a
 * `--- FAIL:` line with no path), and whether it is shown among the run's failing lines.
 */
interface Read {
  readonly printed: Printed | null
  readonly marked: boolean
}

const printed = (runner: Runner, name: string, titles: ReadonlyArray<string>): Printed => ({
  runner,
  name,
  titles,
})

/**
 * A vitest or jest title's tests: the title, then what follows each ` > ` or ` › ` in it, each
 * without the duration its runner prints after it (`(3 ms)`; vitest's bare ` 3ms` after its `×`
 * or a ` > `, the title kept whole beside it).
 */
const jsTitles = (title: string, mark: string | null): ReadonlyArray<string> => {
  const whole = title.trim().replace(PAREN_DURATION, '')
  const timed = mark === '×' || whole.includes(' > ')
  const forms = timed ? [whole, whole.replace(BARE_DURATION, '')] : [whole]
  const titles = forms.flatMap((form) =>
    [form].concat(Array.from(form.matchAll(JS_SEPARATOR), (found) => form.slice(found.index + 3))),
  )
  return [...new Set(titles)]
}

/** A pytest node id's or section heading's test function: its last `::` part, before its case. */
const pytestFunction = (id: string): string =>
  (id.split('::').at(-1) ?? '').replace(/^(?:\w+\.)*/, '').replace(/\[.*$/, '')

/** A Rust path's test: its last `::` part. */
const rustTest = (path: string): string => path.split('::').at(-1) ?? path

/** vitest, jest, node:test, and TAP printed without its report: a mark, a heading, a file line. */
const jsFailure = (line: string): Read | null => {
  const found =
    JS_MARK.exec(line) ??
    JEST_HEADING.exec(line) ??
    JS_FILE.exec(line) ??
    JEST_PROJECT_FILE.exec(line) ??
    TAP_NOT_OK.exec(line)
  if (found === null) return null
  const name = found.groups?.['name'] ?? ''
  return {
    printed: printed('js', name, jsTitles(name, found.groups?.['mark'] ?? null)),
    marked: true,
  }
}

/**
 * pytest: its summary line, `FAILED file::test[id] - message`, and its section's heading,
 * `____ Class.test[id] ____`, each named after the test function, a case id's content aside.
 */
const pytestFailure = (line: string): Read | null => {
  if (PYTEST_SUMMARY.test(line)) {
    const name = pytestFunction(nodeIdOf(line).slice('FAILED '.length))
    return { printed: printed('pytest', name, [name]), marked: true }
  }
  const section = PYTEST_SECTION.exec(nodeIdOf(line))?.groups?.['name']
  if (section === undefined) return null
  const name = pytestFunction(section)
  return { printed: printed('pytest', name, [name]), marked: false }
}

/** unittest and Django: `FAIL: test_x (module.Class.test_x)`. */
const unittestFailure = (line: string): Read | null => {
  const name = UNITTEST_HEADING.exec(line)?.groups?.['name']
  return name === undefined ? null : { printed: printed('unittest', name, [name]), marked: true }
}

/** go test's `--- FAIL:` and gotestsum's `=== FAIL:`, named by the test's whole path. */
const goFailure = (line: string): Read | null => {
  const name = (GO_PATH.exec(line) ?? GOTESTSUM_FAIL.exec(line))?.groups?.['name']
  if (name !== undefined) return { printed: printed('go', name, [name]), marked: true }
  return GO_FAIL.test(line) ? { printed: null, marked: true } : null
}

/**
 * libtest's `test x ... FAILED`, cargo-nextest's `FAIL [ 0.004s] crate x`, and libtest's `---- x
 * stdout ----` heading below its `failures:` line, each named by the test's path.
 */
const rustFailure = (line: string, afterFailures: boolean): Read | null => {
  const marked = (LIBTEST_FAILED.exec(line) ?? NEXTEST_FAIL.exec(line))?.groups?.['name']
  if (marked !== undefined)
    return { printed: printed('rust', marked, [rustTest(marked)]), marked: true }
  const heading = afterFailures ? RUST_STDOUT.exec(line)?.groups?.['name'] : undefined
  if (heading === undefined) return null
  return { printed: printed('rust', heading, [rustTest(heading)]), marked: false }
}

/** The failure a line starts, as the first reader that knows its shape reads it. */
const failureAt = (line: string, afterFailures: boolean): Read | null =>
  pytestFailure(line) ??
  unittestFailure(line) ??
  goFailure(line) ??
  rustFailure(line, afterFailures) ??
  jsFailure(line)

/**
 * The failing lines of an output, uncoloured and cut, and the tests they name whose own text says
 * an assertion failed. A failure's text is its line and those below it, up to the next failure's
 * line, read as its runner prints a failure: a pytest summary line's is its message, a pytest
 * section's what it says, never the source it prints. A numbered line is mocha's only when its
 * number is at most its `N failing`, and twice at most: its tree's, the last above that line, and
 * its list's, the first below at that line's indentation whose title reads as one. A numbered log
 * or diff line is not one, and cannot push a real failure past the cap. Its two lines take the
 * class of its list's text alone (its tree line's runs over the logs of the tests after it), and
 * its test is named by its title in the list alone (a log line can stand in for its tree line).
 */
const failingLinesOf = (output: string): Pick<ProofRunClass, 'failingLines' | 'asserted'> => {
  const lines = output.split(/\r?\n/).map((line) => uncoloured(line).slice(0, LINE_CAP))
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
  const list = new Map<number, { readonly at: number; readonly title: string }>()
  for (const [at, line] of lines.entries()) {
    const number = Number(MOCHA_FAILURE.exec(line)?.[1] ?? 0)
    if (number < 1 || number > failing) continue
    if (at < listAt) tree.set(number, at)
    else if (!list.has(number) && line.startsWith(`${listIndent}${String(number)}) `)) {
      const title = mochaTitle(lines, at, listIndent)
      if (title !== null) list.set(number, { at, title })
    }
  }
  const entries: Array<{
    readonly at: number
    readonly read: Read
    readonly number: number
  }> = []
  for (const [at, line] of lines.entries()) {
    const read = failureAt(line, rustAt >= 0 && at > rustAt)
    if (read !== null) {
      entries.push({ at, read, number: 0 })
      continue
    }
    const number = Number(MOCHA_FAILURE.exec(line)?.[1] ?? 0)
    const listed = list.get(number)
    if (tree.get(number) === at) entries.push({ at, read: { printed: null, marked: true }, number })
    else if (listed?.at === at) {
      const name = printed('mocha', listed.title, [listed.title])
      entries.push({ at, read: { printed: name, marked: true }, number })
    }
  }
  const read = entries.slice(0, FAILING_LINES).map((entry, index) => {
    const line = lines[entry.at] ?? ''
    const below = lines.slice(entry.at + 1, entries[index + 1]?.at ?? lines.length)
    const said = blockAsserts(line, below, entry.read.printed)
    return { at: entry.at, read: entry.read, number: entry.number, line, asserts: said }
  })
  const assertedNumbers = new Set(
    read
      .filter((entry) => entry.number > 0 && entry.at > listAt && entry.asserts)
      .map((entry) => entry.number),
  )
  return {
    failingLines: read.filter((entry) => entry.read.marked).map((entry) => entry.line),
    asserted: read
      .filter((entry) => (entry.number > 0 ? assertedNumbers.has(entry.number) : entry.asserts))
      .flatMap((entry) => (entry.read.printed === null ? [] : [entry.read.printed])),
  }
}

/**
 * Whether a failure's own text, its line and those below it, says an assertion failed, read as
 * its runner prints one: a pytest summary line by its message, a pytest section by what it says.
 */
const blockAsserts = (
  line: string,
  below: ReadonlyArray<string>,
  name: Printed | null,
): boolean => {
  if (name?.runner !== 'pytest') return asserts([line.trimStart(), ...below].join('\n'))
  if (PYTEST_SUMMARY.test(line)) {
    return pytestAsserts(`E   ${line.slice(nodeIdOf(line).length).replace(/^ - /, '')}`)
  }
  return pytestSectionAsserts(below)
}

/**
 * Whether a pytest section says an assertion failed, above what the test printed: an exception
 * group's exceptions, every one an assertion; its native traceback's exception; otherwise its `E `
 * lines and its trailer.
 */
const pytestSectionAsserts = (section: ReadonlyArray<string>): boolean => {
  const said = section.filter((line) => PYTEST_SAID.test(line))
  const captured = section.findIndex((line) => PYTEST_CAPTURED.test(line))
  const own = captured < 0 ? section : section.slice(0, captured)
  if (own.some((line) => PYTEST_GROUP.test(line))) {
    const thrown = own
      .flatMap((line) => PYTEST_GROUP_SAID.exec(line)?.groups?.['said'] ?? [])
      .filter((line) => !EXCEPTION_GROUP.test(line) && THROWN.test(line))
    return thrown.length > 0 && thrown.every((line) => pytestAsserts(line))
  }
  const last = own.findLastIndex((line) => PYTEST_TRACEBACK.test(line))
  if (last < 0) return pytestAsserts(said.join('\n'))
  return pytestAsserts(
    own
      .slice(last + 1)
      .filter((line) => /^\S/.test(line))
      .join('\n'),
  )
}

/**
 * A mocha failure's test in its list: the last line of its title, without the `:` it ends with,
 * below `1) exports` and each title between, each indented two more spaces than the one above (a
 * describe's title may end with `:` too, or start with a space). Null when its last line does not
 * end with `:`: a numbered line that is no failure's title.
 */
const mochaTitle = (lines: ReadonlyArray<string>, at: number, indent: string): string | null => {
  const title = [(lines[at] ?? '').replace(MOCHA_FAILURE, '')]
  for (const line of lines.slice(at + 1, at + 10)) {
    const depth = `${indent}   ${'  '.repeat(title.length)}`
    if (!line.startsWith(depth) || line.slice(depth.length).trim() === '') break
    title.push(line.slice(depth.length))
  }
  const last = (title.at(-1) ?? '').trimEnd()
  return last.endsWith(':') ? last.slice(0, -1) : null
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
  const lines = failingLinesOf(run.output)
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

/** A failed run without a report, from its words, each line cut as a failure's is. */
const wordsClass = (whole: string, testPath: string | null): ProofClass => {
  const output = whole
    .split('\n')
    .map((line) => line.slice(0, LINE_CAP))
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
 * A test's declared name as a pattern a title is matched against whole: each runner's reader has
 * already cut its titles on its own separators (a mark, ` > `, ` › `, `::`, `--- FAIL: `, `FAIL: `,
 * `test `, mocha's `1) `), never on a space inside a name. What `%s`, `$name` or `${…}` stand for
 * (`each`, a template literal) matches words within a title, never across its separators; a name
 * made of placeholders alone is none.
 */
const namePattern = (name: string): RegExp | null => {
  const parts = name.split(/(%[sdifjoOp#%]|\$\{[^}]*\}|\$\w+)/)
  if (parts.every((part, at) => at % 2 === 1 || part.trim() === '')) return null
  const body = parts
    .map((part, at) => (at % 2 === 1 ? '[^\\n>›]+?' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('')
  return new RegExp(`^${body}$`)
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

/**
 * A Rust cased test as libtest prints its cases: its function, then rstest's `::case_1` or
 * test_case's `::test_case_1_…` or none, never another test of a module named the same.
 */
const casedAnswers = (path: string, function_: string): boolean => {
  const parts = path.split('::')
  return parts.some(
    (part, at) =>
      part === function_ &&
      parts.slice(at + 1).every((after) => /^(?:test_)?case_\d+\w*$/.test(after)),
  )
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

/** Whether a failing test is one the proof adds, each kind of name matched as its runner prints it. */
const answers = (failure: Printed, test: TestName): boolean => {
  if (Predicate.isString(test)) {
    const pattern = namePattern(test)
    return pattern !== null && failure.titles.some((title) => pattern.test(title))
  }
  if (Predicate.hasProperty(test, 'function')) return casedAnswers(failure.name, test.function)
  const pattern = subtestPattern(test)
  return pattern !== null && pattern.test(failure.name)
}

const named = (failures: ReadonlyArray<Printed>, names: ReadonlyArray<TestName>): boolean =>
  names.some((name) => failures.some((failure) => answers(failure, name)))

/**
 * Whether a run is a valid red (CT-35): an assertion that failed in the scenario's own test. A
 * report that names the files tells it by its file and, when the proof's code names its tests, by
 * its name: another test of the same file failing is not the scenario's red. Without a file named
 * (no report, or JUnit's `classname` only), a test the proof adds must be named whole among the
 * failures that are assertions (a report's failing tests, or the tests the failing lines of the
 * whole output name whose own text says an assertion failed); failing that, the key line decides,
 * never the exit code alone. A proof whose code names no test, or a command with no test file, is
 * red by its exit code, the key line its guard. A Go subtest whose parent is unknown is a test the
 * proof adds without a name: alone, the key line decides when the proof has one, and the exit
 * code when it has none.
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
  const unnamed =
    testNames.length > 0 &&
    testNames.every((name) => Predicate.hasProperty(name, 'parent') && name.parent === null)
  const names = unnamed && keyLineMatched === null ? [] : testNames
  if (located.length > 0) {
    return located.some(
      (one) =>
        one.assertion &&
        posix(one.file ?? '').endsWith(posix(testPath)) &&
        (names.length === 0 ||
          named([reportPrinted(one.test)], names) ||
          (unnamed && keyLineMatched === true)),
    )
  }
  if (names.length === 0) return true
  const failing =
    run.failures.length > 0
      ? run.failures.filter((one) => one.assertion).map((one) => reportPrinted(one.test))
      : run.asserted
  return named(failing, names) || keyLineMatched === true
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
/** A `t.Run(` call's literal name, read where the call starts, across lines. */
const GO_SUBTEST_NAME = /\w+\.Run\(\s*(["`])(?<name>(?:(?!\1).)+)\1\s*,/y
/** A `t.Run(` call, its name a literal or not. */
const GO_RUN = /\b\w+\.Run\(/g
/** Go's strings, runes and comments, a raw string or a block comment across lines. */
const GO_LITERAL = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`[^`]*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g
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
