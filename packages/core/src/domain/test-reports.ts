/**
 * The report a proof's runner writes (#342, round 8): which runner runs the proof, and where it
 * writes a structured report (JUnit XML, or its JSON reporter's file). A failing test is named for
 * certain only by that report, read from the file the runner wrote, never from the console, which
 * the tests themselves can write to. Without a report that is read whole, a JavaScript or Python
 * red is left to its key line.
 *
 * The runner and its report are a Project setting, guessed by default from the proof's command
 * and the repository (`guessReporting`). Storing a custom value is not built here.
 */

import { Option, Schema } from 'effect'

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

/** The largest report read: a larger one is not read at all, and names nothing. */
export const REPORT_CAP = 32 * 1024 * 1024

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

/** The error names that are an assertion: chai's, node's, jest's. */
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

/** A JSON reporter's file (vitest's, jest's): each test of the test file, or null. */
const jsonTests = (text: string, testPath: string): ReadonlyArray<ReportedTest> | null =>
  Option.match(readJson(text), {
    onNone: () => null,
    onSome: (report) =>
      report.testResults
        .filter((file) => sameFile(file.name, testPath))
        .flatMap((file) => file.assertionResults)
        .map((one) => ({
          key: [...one.ancestorTitles, one.title].join(' > '),
          verdict: jsonVerdict(one.status, one.failureMessages ?? []),
        })),
  })

const jsonVerdict = (status: string, messages: ReadonlyArray<string>): ReportedTest['verdict'] => {
  if (status === 'passed') return 'passed'
  if (status !== 'failed') return 'skipped'
  const assertion =
    messages.length > 0 && messages.every((message) => ASSERTION_NAME.test(message.trimStart()))
  return assertion ? 'assertion' : 'error'
}

/**
 * One `<testcase>` of a JUnit report: the names of the `<testsuite>`s it is in, outermost first,
 * its attributes, and its failure, error or skip.
 */
interface JunitCase {
  readonly suites: ReadonlyArray<string>
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

/** The attributes of an element's opening tag, its text between `<name` and `>`. */
const attributesOf = (tag: string): ReadonlyMap<string, string> =>
  new Map(
    Array.from(tag.matchAll(/(?<![\w:.-])([\w:.-]+)\s*=\s*"([^"]*)"/g), (found) => [
      found[1] ?? '',
      unescaped(found[2] ?? ''),
    ]),
  )

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
 * case or a comment never closed, or a section the reader does not read (`CDATA`, a doctype).
 */
const junitCases = (text: string): ReadonlyArray<JunitCase> | null => {
  const whole = uncommented(text.trimEnd())
  if (whole === null) return null
  // The root is the first element: a report cut right after one of its suites is not whole.
  const root = /^(?:<\?xml[^>]*\?>\s*)?<(testsuites?)[\s>]/.exec(whole.trimStart())?.[1]
  if (root === undefined || !whole.endsWith(`</${root}>`)) return null
  if (/<!\[CDATA\[|<!DOCTYPE/i.test(whole)) return null
  const cases: JunitCase[] = []
  const suites: string[] = []
  const tags = new RegExp(JUNIT_TAG.source, 'g')
  for (let tag = tags.exec(whole); tag !== null; tag = tags.exec(whole)) {
    if (tag[0] === '</testsuite>') {
      suites.pop()
    } else if (tag[0].startsWith('<testsuite')) {
      const opening = tag[1] ?? ''
      if (!opening.endsWith('/')) suites.push(attributesOf(opening).get('name') ?? '')
    } else {
      const read = junitCase(whole, tag.index, suites)
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
  suites: ReadonlyArray<string>,
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
    suites: [...suites],
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
 * A JUnit report's tests of the test file, as vitest, pytest or node names them; null for another
 * runner. vitest names a test by its path in its file's suite, pytest by its module and classes,
 * node by the suites it is in and its own `file`.
 */
const junitTests = (
  text: string,
  runner: TestRunner,
  testPath: string,
): ReadonlyArray<ReportedTest> | null => {
  if (runner !== 'vitest' && runner !== 'pytest' && runner !== 'node') return null
  const cases = junitCases(text)
  if (cases === null) return null
  return cases.flatMap((one) => {
    const classname = one.attributes.get('classname') ?? ''
    const name = one.attributes.get('name') ?? ''
    const verdict = junitVerdict(one, runner)
    if (runner === 'vitest') return sameFile(classname, testPath) ? [{ key: name, verdict }] : []
    if (runner === 'node') {
      const file = one.attributes.get('file') ?? ''
      return sameFile(file, testPath) ? [{ key: [...one.suites, name].join(' > '), verdict }] : []
    }
    const scope = pytestScope(classname, testPath)
    return scope === null ? [] : [{ key: [...scope, name].join('::'), verdict }]
  })
}

/**
 * What a JUnit test case says: vitest names its error's class (`type`); pytest's failure is an
 * assertion when its traceback's last line raised `AssertionError` (or `pytest.raises` saw
 * nothing), and an `<error>` (a fixture's) is never one.
 */
const junitVerdict = (one: JunitCase, runner: TestRunner): ReportedTest['verdict'] => {
  if (one.ending === null) return 'passed'
  if (one.ending === 'skipped') return 'skipped'
  if (one.ending === 'error') return 'error'
  if (runner === 'vitest') {
    return ASSERTION_NAME.test(one.failure.attributes.get('type') ?? '') ? 'assertion' : 'error'
  }
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
 * be read whole, or is a format its runner is not read in (vitest's JUnit and JSON, jest's JSON,
 * pytest's and node's JUnit).
 */
export const reportedTests = (
  reporting: TestReporting,
  text: string,
  testPath: string,
): ReadonlyArray<ReportedTest> | null => {
  const format = reporting.report?.format
  if (format === 'json') {
    return reporting.runner === 'vitest' || reporting.runner === 'jest'
      ? jsonTests(text, testPath)
      : null
  }
  return format === 'junit' ? junitTests(text, reporting.runner, testPath) : null
}

/** The words of a command, quotes removed. */
const wordsOf = (command: string): ReadonlyArray<string> =>
  Array.from(
    command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g),
    (found) => found[1] ?? found[2] ?? found[3] ?? '',
  )

const PackageScripts = Schema.fromJsonString(
  Schema.Struct({ scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) }),
)
const readScripts = Schema.decodeUnknownOption(PackageScripts)

/** The script a package manager's command runs (`npm test`, `pnpm run check`), or null. */
const scriptOf = (
  words: ReadonlyArray<string>,
  read: (path: string) => string | null,
): string | null => {
  const [manager, first, second] = words
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(manager ?? '')) return null
  const name = first === 'run' || first === 'run-script' ? second : first
  if (name === undefined) return null
  const manifest = read('package.json')
  if (manifest === null) return null
  return Option.match(readScripts(manifest), {
    onNone: () => null,
    onSome: (found) => found.scripts?.[name] ?? null,
  })
}

/** The runner a command's words start, past a launcher (`npx`, `uv run`, `python -m`). */
const runnerOf = (words: ReadonlyArray<string>): TestRunner => {
  const at = (index: number) =>
    (words[index] ?? '').replace(/^.*[\\/]/, '').replace(/\.(?:exe|cmd)$/i, '')
  for (const [index] of words.entries()) {
    const word = at(index)
    if (word === 'vitest' || (word === 'vp' && at(index + 1) === 'test')) return 'vitest'
    if (word === 'jest') return 'jest'
    if (word === 'pytest' || word === 'py.test') return 'pytest'
    if (word === 'unittest' && at(index - 1) === '-m') return 'unittest'
    if (word === 'mocha') return 'mocha'
    if (word === 'node' && words.includes('--test')) return 'node'
    if (word === 'go' && at(index + 1) === 'test') return 'go'
    if (word === 'gotestsum') return 'go'
    if (word === 'cargo') return at(index + 1) === 'nextest' ? 'nextest' : 'cargo'
  }
  return 'unknown'
}

/** A flag's value, written `--flag=value` or `--flag value`. */
const flag = (words: ReadonlyArray<string>, names: ReadonlyArray<string>): string | null => {
  for (const [at, word] of words.entries()) {
    for (const name of names) {
      if (word.startsWith(`${name}=`)) return word.slice(name.length + 1)
      if (word === name) return words[at + 1] ?? null
    }
  }
  return null
}

/** The reporters a command names (`--reporter=junit`, `--reporter junit`). */
const reportersOf = (words: ReadonlyArray<string>): ReadonlyArray<string> =>
  values(words, '--reporter')

/** vitest's configuration keys, each read at its first place. */
const REPORTERS = /\breporters\s*:\s*\[/
const OUTPUT_FILE = /\boutputFile\s*:\s*(?:(['"])([^'"]*)\1|\{)/
const JSON_FILE = /\bjson\s*:\s*(['"])([^'"]*)\1/
const JUNIT_FILE = /\bjunit\s*:\s*(['"])([^'"]*)\1/

/** A configuration's text from a key's first place to the bracket that closes it, or nothing. */
const listAfter = (config: string, key: RegExp, close: string): string => {
  const found = key.exec(config)
  if (found === null) return ''
  const end = config.indexOf(close, found.index)
  return end < 0 ? '' : config.slice(found.index, end)
}

/** vitest's report from its flags, or from a configuration that writes one with literal values. */
const vitestReport = (
  words: ReadonlyArray<string>,
  read: (path: string) => string | null,
): TestReporting['report'] => {
  const reporters = reportersOf(words)
  for (const format of ['json', 'junit'] as const) {
    if (!reporters.includes(format)) continue
    const path = flag(words, [`--outputFile.${format}`]) ?? flag(words, ['--outputFile'])
    if (path !== null) return { format, path }
  }
  if (reporters.length > 0) return undefined
  for (const name of [
    'vitest.config.ts',
    'vitest.config.mts',
    'vitest.config.js',
    'vite.config.ts',
    'vite.config.js',
  ]) {
    const config = read(name)
    if (config === null) continue
    const listed = listAfter(config, REPORTERS, ']')
    const output = OUTPUT_FILE.exec(config)
    // `outputFile: { json: '…' }` names one file per reporter; `outputFile: '…'` one for all.
    const files =
      output === null || output[2] !== undefined
        ? ''
        : listAfter(config.slice(output.index), OUTPUT_FILE, '}')
    for (const format of ['json', 'junit'] as const) {
      if (!listed.includes(`'${format}'`) && !listed.includes(`"${format}"`)) continue
      const own = (format === 'json' ? JSON_FILE : JUNIT_FILE).exec(files)?.[2]
      const path = own ?? output?.[2]
      if (path !== undefined) return { format, path }
    }
    return undefined
  }
  return undefined
}

/** The values a repeated flag takes, in their order (`--flag=value` or `--flag value`). */
const values = (words: ReadonlyArray<string>, name: string): ReadonlyArray<string> =>
  words.flatMap((word, at) => {
    if (word.startsWith(`${name}=`)) return [word.slice(name.length + 1)]
    return word === name ? [words[at + 1] ?? ''] : []
  })

/** node --test's JUnit report: its `junit` reporter's destination, given in the same place. */
const nodeReport = (words: ReadonlyArray<string>): TestReporting['report'] => {
  const at = values(words, '--test-reporter').indexOf('junit')
  const path = at < 0 ? undefined : values(words, '--test-reporter-destination')[at]
  return path === undefined || path === 'stdout' || path === 'stderr'
    ? undefined
    : { format: 'junit', path }
}

/** pytest's JUnit report from its flags, or from `addopts` in its configuration. */
const pytestReport = (
  words: ReadonlyArray<string>,
  read: (path: string) => string | null,
): TestReporting['report'] => {
  const names = ['--junitxml', '--junit-xml']
  const path =
    flag(words, names) ??
    ['pytest.ini', 'pyproject.toml', 'tox.ini', 'setup.cfg']
      .map((name) => read(name) ?? '')
      .map((config) => /^[ \t]*addopts[ \t]*=[ \t]*(.*)$/m.exec(config)?.[1] ?? '')
      .map((addopts) => flag(wordsOf(addopts.replace(/^\[|\]$/g, '').replace(/,/g, ' ')), names))
      .find((found) => found !== null) ??
    null
  return path === null ? undefined : { format: 'junit', path }
}

/**
 * The runner and report a proof's command uses, guessed from the command (a package script it
 * runs, read from `package.json`) and from the runner's configuration in the folder it runs in
 * (`read`): vitest's `--reporter` with `--outputFile`, or a configuration that writes a report
 * with literal values; jest's `--json --outputFile`; pytest's `--junitxml`, from the command or
 * its configuration's `addopts`. Any other runner is named without a report.
 */
export const guessReporting = (proof: {
  readonly command: string
  readonly read: (path: string) => string | null
}): TestReporting => {
  const own = wordsOf(proof.command)
  const script = scriptOf(own, proof.read)
  const words = script === null ? own : wordsOf(script)
  const runner = runnerOf(words)
  const report = reportOf(runner, words, proof.read)
  return report === undefined ? { runner } : { runner, report }
}

/** The report a runner's words and configuration name, for the runners whose report is read. */
const reportOf = (
  runner: TestRunner,
  words: ReadonlyArray<string>,
  read: (path: string) => string | null,
): TestReporting['report'] => {
  if (runner === 'vitest') return vitestReport(words, read)
  if (runner === 'pytest') return pytestReport(words, read)
  if (runner === 'node') return nodeReport(words)
  const path = runner === 'jest' && words.includes('--json') ? flag(words, ['--outputFile']) : null
  return path === null ? undefined : { format: 'json', path }
}
