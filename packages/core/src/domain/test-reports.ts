/**
 * The report a proof's runner writes (#342, round 9): which runner runs the proof, and the
 * structured report (JUnit XML, or vitest's JSON) Hemera asks it for. For a known runner the
 * command invokes itself, Hemera adds the reporter flags (`withReporting`), writing the report to a
 * folder of the run's own, outside the repository, along with a listing of every test on the
 * console. A failing test is named for certain only by that report, read from the file the runner
 * wrote, and only when the runner's own listing agrees with it. Without one, a JavaScript or
 * Python red is left to its key line.
 */

import { Option, Schema } from 'effect'

import { wordsOf } from './commands.ts'

/** The runners Hemera knows a proof's command by. */
export const TEST_RUNNERS = [
  'vitest',
  'jest',
  'node',
  'mocha',
  'pytest',
  'unittest',
  'go',
  'cargo',
  'nextest',
  'unknown',
] as const
export const TestRunner = Schema.Literals(TEST_RUNNERS)
export type TestRunner = typeof TestRunner.Type

/** The structured reports Hemera reads. */
export const REPORT_FORMATS = ['junit', 'json'] as const
export const ReportFormat = Schema.Literals(REPORT_FORMATS)
export type ReportFormat = typeof ReportFormat.Type

/**
 * How a proof's runner reports: the runner, and its structured report when it writes one (its
 * format, and its path from the folder the proof runs in).
 */
export const TestReporting = Schema.Struct({
  runner: TestRunner,
  report: Schema.optionalKey(Schema.Struct({ format: ReportFormat, path: Schema.String })),
})
export type TestReporting = typeof TestReporting.Type

/**
 * The largest report read: a larger one is not read at all, and names nothing, so the key line
 * decides. A report is read and parsed on the engine's thread: at 8 MiB, the slowest report, some
 * 220,000 empty JUnit test cases, takes about a second. 8 MiB holds about 20,000 passed tests in
 * vitest's JSON (Hemera's own core suite, 1,799 tests, writes 0.7 MB) or a few thousand failures
 * with their tracebacks.
 */
export const REPORT_CAP = 8 * 1024 * 1024

/**
 * The longest name a report is read with, a suite's or a test's: a longer one could never be
 * listed, the console's lines being read to their last 4,096 characters, and a report holding one
 * is not read.
 */
export const NAME_CAP = 4_096

/**
 * The most characters the paths of a report's tests of the file add up to: a report whose suites
 * repeat a long name for many tests is not read, so its paths never take more memory than a report
 * at its cap.
 */
export const KEYS_CAP = REPORT_CAP

/** A report as the engine found it once the run ended: its text, or why it was not read. */
export type ReportFound =
  | { readonly kind: 'read'; readonly text: string }
  | { readonly kind: 'unreadable'; readonly reason: string }

/** A report file as the file system describes it, before it is read. */
export interface ReportFile {
  readonly size: number
  readonly modifiedMs: number
}

/**
 * The report a run wrote, checked before it is read: missing, larger than `REPORT_CAP`, or last
 * written before the run started (`startedMs`), it is not read.
 */
export const foundReport = (
  file: ReportFile | null,
  startedMs: number,
  read: () => string,
): ReportFound => {
  if (file === null) return { kind: 'unreadable', reason: 'missing' }
  if (file.size > REPORT_CAP) return { kind: 'unreadable', reason: 'over its size cap' }
  if (file.modifiedMs < startedMs) return { kind: 'unreadable', reason: 'older than the run' }
  return { kind: 'read', text: read() }
}

/** What a report says of one test of the file: its path, and how it ended. */
export interface ReportedTest {
  /** Its describes' titles and its own joined by ` > `, or its classes and function by `::`. */
  readonly key: string
  readonly verdict: 'assertion' | 'error' | 'passed' | 'skipped'
}

/** The error names that are an assertion: chai's, node's. */
const ASSERTION_NAME =
  /^(?:AssertionError|AssertionFailedError|JestAssertionError)\b|^Error: expect\(/
/** pytest's last traceback line: the file, the line and the exception that ended the test. */
const PYTEST_RAISED = /^\S.*:\d+: (?<name>\w+(?:\.\w+)*)\s*$/
/** node's test failure caused by an assertion, at its property's indentation. */
const NODE_ASSERTION = /^ {2}cause: AssertionError\b/
/** pytest's `pytest.raises` and `pytest.warns` that saw nothing: an assertion. */
const DID_NOT = /\bDID NOT (?:RAISE|WARN)\b/

const JsonReport = Schema.fromJsonString(
  Schema.Struct({
    testResults: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        assertionResults: Schema.Array(
          Schema.Struct({
            ancestorTitles: Schema.Array(Schema.String),
            title: Schema.String,
            status: Schema.String,
            failureMessages: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
          }),
        ),
      }),
    ),
  }),
)
const readJson = Schema.decodeUnknownOption(JsonReport)

/** A path with forward slashes and no leading `./`. */
const plainPath = (path: string): string => path.replace(/\\+/g, '/').replace(/^\.\//, '')

/** Whether a path a report gives (absolute, or from the root) is the test's file. */
const sameFile = (shown: string, testPath: string): boolean => {
  const one = plainPath(shown)
  const other = plainPath(testPath)
  return one === other || one.endsWith(`/${other}`) || other.endsWith(`/${one}`)
}

/** Whether a name is longer than a report is read with. */
const overCap = (name: string): boolean => name.length > NAME_CAP

/** vitest's JSON reporter's file: each test of the test file, or null. */
const jsonTests = (text: string, testPath: string): ReadonlyArray<ReportedTest> | null =>
  Option.match(readJson(text), {
    onNone: () => null,
    onSome: (report) => {
      const results = report.testResults.flatMap((file) => file.assertionResults)
      if (results.some((one) => overCap(one.title) || one.ancestorTitles.some(overCap))) {
        return null
      }
      return report.testResults
        .filter((file) => sameFile(file.name, testPath))
        .flatMap((file) => file.assertionResults)
        .map((one) => ({
          key: [...one.ancestorTitles, one.title].join(' > '),
          verdict: jsonVerdict(one.status, one.failureMessages ?? []),
        }))
    },
  })

const jsonVerdict = (status: string, messages: ReadonlyArray<string>): ReportedTest['verdict'] => {
  if (status === 'passed') return 'passed'
  if (status !== 'failed') return 'skipped'
  const assertion =
    messages.length > 0 && messages.every((message) => ASSERTION_NAME.test(message.trimStart()))
  return assertion ? 'assertion' : 'error'
}

/**
 * A `<testsuite>` a test case is in, as the path of its names from the outermost, joined by ` > `:
 * built once as the suite opens, so a case never walks its suites.
 */
interface JunitSuite {
  readonly path: string
}

/** The deepest a report's suites are read: a report nested deeper is not read at all. */
const SUITE_DEPTH = 64

/**
 * One `<testcase>` of a JUnit report: the innermost `<testsuite>` it is in, its attributes, and
 * its failure, error or skip.
 */
interface JunitCase {
  readonly suite: JunitSuite | null
  readonly attributes: ReadonlyMap<string, string>
  readonly ending: 'failure' | 'error' | 'skipped' | null
  /** The failure's or the error's attributes and text. */
  readonly failure: { readonly attributes: ReadonlyMap<string, string>; readonly text: string }
}

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
])

/** XML's five entities and its character references. */
const unescaped = (text: string): string =>
  text.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(lt|gt|amp|quot|apos));/g, (_, decimal, hex, name) => {
    if (decimal !== undefined) return String.fromCodePoint(Number(decimal))
    if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16))
    return ENTITIES.get(String(name)) ?? ''
  })

/** An attribute of an opening tag: its name, not the end of another word, and its quoted value. */
const ATTRIBUTE = /(?<![\w:.-])([\w:.-]+)\s*=\s*"([^"]*)"/g

/** The attributes of an element's opening tag, its text between `<name` and `>`. */
const attributesOf = (tag: string): ReadonlyMap<string, string> => {
  const attributes = new Map<string, string>()
  if (!tag.includes('=')) return attributes
  const each = new RegExp(ATTRIBUTE.source, 'g')
  for (let found = each.exec(tag); found !== null; found = each.exec(tag)) {
    const value = found[2] ?? ''
    attributes.set(found[1] ?? '', value.includes('&') ? unescaped(value) : value)
  }
  return attributes
}

/** How a JUnit test case ended, from its body: a failure first, then an error, then a skip. */
const endingOf = (body: string): JunitCase['ending'] => {
  if (/<failure[\s>/]/.test(body)) return 'failure'
  if (/<error[\s>/]/.test(body)) return 'error'
  if (/<skipped[\s>/]/.test(body)) return 'skipped'
  return null
}

/** A JUnit report's tags a reader walks: a suite opening or closing, a test case opening. */
const JUNIT_TAG = /<testsuite\b([^>]*)>|<\/testsuite>|<testcase\b/g

/** A text without its XML comments, or null when one is never closed. */
const uncommented = (text: string): string | null => {
  const parts: string[] = []
  let at = 0
  for (let open = text.indexOf('<!--'); open >= 0; open = text.indexOf('<!--', at)) {
    const close = text.indexOf('-->', open + 4)
    if (close < 0) return null
    parts.push(text.slice(at, open))
    at = close + 3
  }
  parts.push(text.slice(at))
  return parts.join('')
}

/**
 * The test cases of a JUnit report, read once left to right; null when it is not one read whole: its
 * root element, `<testsuites>` or `<testsuite>`, not closed at its end (a report cut short), a test
 * case or a comment never closed, a section the reader does not read (`CDATA`, a doctype), a
 * suite named by more than `NAME_CAP` characters, or suites nested deeper than `SUITE_DEPTH`. Each case keeps only its innermost suite, which keeps
 * its parents: the memory it takes grows with the report, never with its cases times its depth.
 */
const junitCases = (text: string): ReadonlyArray<JunitCase> | null => {
  const whole = uncommented(text.trimEnd())
  if (whole === null) return null
  // The root is the first element: a report cut right after one of its suites is not whole.
  const root = /^(?:<\?xml[^>]*\?>\s*)?<(testsuites?)[\s>]/.exec(whole.trimStart())?.[1]
  if (root === undefined || !whole.endsWith(`</${root}>`)) return null
  if (/<!\[CDATA\[|<!DOCTYPE/i.test(whole)) return null
  const cases: JunitCase[] = []
  // The suites open where the reader is, innermost last.
  const open: JunitSuite[] = []
  const tags = new RegExp(JUNIT_TAG.source, 'g')
  for (let tag = tags.exec(whole); tag !== null; tag = tags.exec(whole)) {
    if (tag[0] === '</testsuite>') {
      open.pop()
    } else if (tag[0].startsWith('<testsuite')) {
      const opening = tag[1] ?? ''
      if (opening.endsWith('/')) continue
      if (open.length >= SUITE_DEPTH) return null
      const name = attributesOf(opening).get('name') ?? ''
      if (overCap(name)) return null
      const parent = open.at(-1)
      open.push({ path: parent === undefined ? name : `${parent.path} > ${name}` })
    } else {
      const read = junitCase(whole, tag.index, open.at(-1) ?? null)
      if (read === null) return null
      cases.push(read.one)
      tags.lastIndex = read.end
    }
  }
  return cases
}

/** The test case whose `<testcase` starts at `at`, and where it ends; null when never closed. */
const junitCase = (
  whole: string,
  at: number,
  suite: JunitSuite | null,
): { readonly one: JunitCase; readonly end: number } | null => {
  const close = whole.indexOf('>', at)
  if (close < 0) return null
  const tag = whole.slice(at + '<testcase'.length, close)
  const empty = tag.endsWith('/')
  const end = empty ? close + 1 : whole.indexOf('</testcase>', close)
  if (end < 0) return null
  const body = empty ? '' : whole.slice(close + 1, end)
  const ending = endingOf(body)
  const element = ending === 'failure' || ending === 'error' ? ending : null
  const opened = element === null ? -1 : body.indexOf(`<${element}`)
  const opening = opened < 0 ? -1 : body.indexOf('>', opened)
  const closing = opening < 0 ? -1 : body.indexOf(`</${element}>`, opening)
  const failureTag = opening < 0 ? '' : body.slice(opened + (element ?? '').length + 1, opening)
  const one: JunitCase = {
    suite,
    attributes: attributesOf(empty ? tag.slice(0, -1) : tag),
    ending,
    failure: {
      attributes: attributesOf(failureTag),
      text:
        opening < 0 || failureTag.endsWith('/')
          ? ''
          : unescaped(body.slice(opening + 1, closing < 0 ? body.length : closing)),
    },
  }
  return { one, end: empty ? close + 1 : end + '</testcase>'.length }
}

/**
 * The module a pytest test file is (`tests/test_export.py`: `tests.test_export`), and how many of
 * its last parts a JUnit `classname` starts with, pytest naming it from its root folder: the
 * classes after them are the test's.
 */
const pytestScope = (classname: string, testPath: string): ReadonlyArray<string> | null => {
  const module = plainPath(testPath).replace(/\.py$/, '').split('/')
  const parts = classname.split('.')
  for (let length = 1; length <= Math.min(module.length, parts.length); length += 1) {
    const tail = module.slice(module.length - length)
    if (tail.every((part, at) => parts[at] === part)) return parts.slice(length)
  }
  return null
}

/**
 * A JUnit report's tests of the test file, as pytest or node names them; null for another runner.
 * pytest names a test by its module and classes, node by the suites it is in and its own `file`.
 */
const junitTests = (
  text: string,
  runner: TestRunner,
  testPath: string,
): ReadonlyArray<ReportedTest> | null => {
  if (runner !== 'pytest' && runner !== 'node') return null
  const cases = junitCases(text)
  if (cases === null) return null
  const names = (one: JunitCase) => [one.attributes.get('name'), one.attributes.get('classname')]
  if (cases.some((one) => names(one).some((name) => overCap(name ?? '')))) return null
  return cases.flatMap((one) => {
    const classname = one.attributes.get('classname') ?? ''
    const name = one.attributes.get('name') ?? ''
    const verdict = junitVerdict(one, runner)
    if (runner === 'node') {
      const file = one.attributes.get('file') ?? ''
      return sameFile(file, testPath)
        ? [{ key: one.suite === null ? name : `${one.suite.path} > ${name}`, verdict }]
        : []
    }
    const scope = pytestScope(classname, testPath)
    return scope === null ? [] : [{ key: [...scope, name].join('::'), verdict }]
  })
}

/**
 * What a JUnit test case says: node's failure is an assertion when every cause it prints is one;
 * pytest's failure is an assertion when its traceback's last line raised `AssertionError` (or `pytest.raises` saw
 * nothing), and an `<error>` (a fixture's) is never one.
 */
const junitVerdict = (one: JunitCase, runner: TestRunner): ReportedTest['verdict'] => {
  if (one.ending === null) return 'passed'
  if (one.ending === 'skipped') return 'skipped'
  if (one.ending === 'error') return 'error'
  if (runner === 'node') {
    // What the test threw is its `cause`; a message can print a line like it, never remove it.
    const causes = one.failure.text.split('\n').filter((line) => line.startsWith('  cause: '))
    const asserted = causes.every((line) => NODE_ASSERTION.test(line))
    return causes.length > 0 && asserted ? 'assertion' : 'error'
  }
  const last = one.failure.text.trimEnd().split('\n').at(-1) ?? ''
  const raised = PYTEST_RAISED.exec(last)?.groups?.['name'] ?? ''
  if (raised === 'AssertionError') return 'assertion'
  return raised.endsWith('Failed') && DID_NOT.test(one.failure.text) ? 'assertion' : 'error'
}

/**
 * The tests of the test file a report names, each with how it ended; null when the report cannot
 * be read whole, holds a name over `NAME_CAP`, names tests whose paths add up to more than
 * `KEYS_CAP`, or is a format its runner is not read in (vitest's JSON, pytest's and node's JUnit
 * are).
 */
export const reportedTests = (
  reporting: TestReporting,
  text: string,
  testPath: string,
): ReadonlyArray<ReportedTest> | null => {
  const format = reporting.report?.format
  const tests =
    format === 'json' && reporting.runner === 'vitest'
      ? jsonTests(text, testPath)
      : format === 'junit'
        ? junitTests(text, reporting.runner, testPath)
        : null
  // A key's length is read without joining its parts into one string.
  const length = (tests ?? []).reduce((sum, one) => sum + one.key.length, 0)
  return length > KEYS_CAP ? null : tests
}

/** A command's word as a program's name: its file name, without `.exe` or `.cmd`. */
const program = (word: string): string =>
  word.replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd)$/i, '')

/**
 * The launchers a runner may follow: each runs the program it names, never a package script of
 * that name (`pnpm vitest` or `yarn vitest` would run a script first).
 */
const LAUNCHERS: ReadonlyArray<ReadonlyArray<string>> = [
  [],
  ['npx'],
  ['bunx'],
  ['pnpm', 'exec'],
  ['yarn', 'exec'],
  ['npm', 'exec'],
  ['uv', 'run'],
  ['poetry', 'run'],
  ['pipenv', 'run'],
]

/** The runner a command's words start with, right after one launcher at most. */
const runnerOf = (words: ReadonlyArray<string>): 'vitest' | 'pytest' | 'node' | null => {
  for (const launcher of LAUNCHERS) {
    if (!launcher.every((one, at) => program(words[at] ?? '') === one)) continue
    const at = (index: number) => program(words[launcher.length + index] ?? '')
    if (at(0) === 'vitest' || (at(0) === 'vp' && at(1) === 'test')) return 'vitest'
    if (at(0) === 'pytest' || at(0) === 'py.test') return 'pytest'
    if (/^(?:python3?|py)$/.test(at(0)) && at(1) === '-m' && at(2) === 'pytest') return 'pytest'
    if (at(0) === 'node' && words.includes('--test')) return 'node'
  }
  return null
}

/** How many words are a flag, given `--flag=value` or `--flag value`. */
const flagged = (words: ReadonlyArray<string>, name: string): number =>
  words.filter((word) => word === name || word.startsWith(`${name}=`)).length

/** A reporter's destination, given as one word whatever it holds. */
const quoted = (path: string): string => `'${path}'`

/**
 * The line Hemera runs for a proof's command, with the flags it adds for the runner to write its
 * report at `path` and list every test on the console: vitest's verbose and JSON reporters (which
 * replace the reporters its configuration names), pytest's `-rA` summary and JUnit report, node
 * --test's spec and JUnit reporters, each reporter the command names given its own destination.
 * Null when Hemera cannot add them: another runner, a runner a script runs, a command that already
 * writes a report of its own, or a path a single quote would cut.
 */
export const withReporting = (command: string, path: string) => {
  if (path.includes("'")) return null
  const words = wordsOf(command)
  const runner = runnerOf(words)
  if (runner === null) return null
  const reporting = (format: ReportFormat) => ({ runner, report: { format, path } })
  if (runner === 'vitest') {
    if (words.some((word) => word.startsWith('--outputFile'))) return null
    const added = `--reporter=verbose --reporter=json --outputFile.json=${quoted(path)}`
    return { line: `${command} ${added}`, added, reporting: reporting('json') }
  }
  if (runner === 'pytest') {
    if (flagged(words, '--junitxml') + flagged(words, '--junit-xml') > 0) return null
    const added = `-rA --junitxml=${quoted(path)}`
    return { line: `${command} ${added}`, added, reporting: reporting('junit') }
  }
  // node pairs each reporter with the destination in the same place: the command's own reporters
  // are given stdout when it names no destination, and it is left alone when its pairs are uneven.
  const reporters = flagged(words, '--test-reporter')
  const destinations = flagged(words, '--test-reporter-destination')
  if (destinations > 0 && destinations !== reporters) return null
  const test = /(?<=\s)--test(?=\s|$)/.exec(command)
  if (test === null) return null
  const added = [
    '--test-reporter=spec --test-reporter-destination=stdout',
    `--test-reporter=junit --test-reporter-destination=${quoted(path)}`,
    ...(destinations === 0
      ? Array.from({ length: reporters }, () => '--test-reporter-destination=stdout')
      : []),
  ].join(' ')
  const end = test.index + '--test'.length
  return {
    line: `${command.slice(0, end)} ${added}${command.slice(end)}`,
    added,
    reporting: reporting('junit'),
  }
}
