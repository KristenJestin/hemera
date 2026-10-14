/**
 * The tests a test file declares, read from its source (#342): each test's title and the titles
 * of the describes or classes it is declared in. A name decides a red only when it is read with
 * certainty, so each reader goes over the source once, knows its strings, comments and (for
 * JavaScript) template and regex literals, and says when it is not certain of what it read: a
 * slash it cannot tell a division from a regex by, a bracket closed by another kind or never
 * closed, a string or a comment never closed, an indentation that opens or closes no block. The
 * file then gives no path, and the key line decides.
 */

/** A title a template makes: a `test.each` format (`%s`, `$name`), or a template literal's. */
export interface SourceTemplate {
  readonly template: string
}
export type SourceTitle = string | SourceTemplate

/** A test as its file declares it: where it starts, its title, and the titles it is under. */
export interface SourceTest {
  readonly at: number
  readonly title: SourceTitle
  readonly scope: ReadonlyArray<SourceTitle>
}

/** The tests a reader found, and whether it read the whole file for certain. */
export interface SourceTests {
  readonly certain: boolean
  readonly tests: ReadonlyArray<SourceTest>
}

/** A JavaScript token: a name, a punctuator, a string or template literal, a number or a regex. */
interface Token {
  readonly kind: 'name' | 'punct' | 'string' | 'value'
  readonly at: number
  readonly text: string
  readonly quote: string
  /** A template literal's text, set when it closes, and whether it holds a `${…}`. */
  body: string
  templated: boolean
  /** The index of the token after a template literal, past the tokens of its `${…}`. */
  next: number
}

/** Names after which a `/` starts a regex: what comes next is an expression. */
const EXPRESSION_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
])
/** Names whose parenthesised condition a `/` after the `)` follows as a regex. */
const CONDITION_KEYWORDS = new Set(['if', 'while', 'for', 'with'])
/** The calls that declare a describe or a test, and their members that declare neither. */
const DESCRIBE_HEADS = new Set(['describe', 'suite', 'context'])
const TEST_HEADS = new Set(['test', 'it'])
const NOT_DECLARATIONS = new Set([
  'step',
  'use',
  'extend',
  'info',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'setTimeout',
  'configure',
  'expect',
])
/** How deep describes nest in a file read for certain: deeper, its tests' paths are unknown. */
const MAX_DEPTH = 64
/** The bracket each closing one closes. */
const OPENS = new Map([
  [')', '('],
  [']', '['],
  ['}', '{'],
])
const NAME_START = /[A-Za-z_$\u0080-￿]/
const NAME_PART = /[\w$\u0080-￿]/
const DIGIT = /[0-9]/
const SPACE = /\s/

const token = (kind: Token['kind'], at: number, text: string, quote = ''): Token => ({
  kind,
  at,
  text,
  quote,
  body: '',
  templated: false,
  next: -1,
})

/**
 * The tokens of a JavaScript or TypeScript source, read once: strings, comments, template
 * literals (their `${…}` read as code) and regex literals skipped as such, and each parenthesis
 * matched with its closing one. Not certain when a slash follows `}`, `.` or `++` (a division or a
 * regex), or when a string, a comment, a template, a regex or a bracket is never closed, or is
 * closed by another kind.
 */
const jsTokens = (code: string) => {
  const tokens: Token[] = []
  const brackets: Array<{
    readonly char: string
    readonly at: number
    readonly template: Token | null
  }> = []
  const closer = new Map<number, number>()
  const opener = new Map<number, number>()
  let certain = true
  let template: Token | null = null
  let at = 0
  // Whether a `/` here starts a regex, by the token before it; null when that cannot be told.
  const regexHere = (): boolean | null => {
    const last = tokens.at(-1)
    if (last === undefined) return true
    if (last.kind === 'string' || last.kind === 'value') return false
    if (last.kind === 'name') return EXPRESSION_KEYWORDS.has(last.text)
    if (last.text === ']') return false
    if (last.text === '}' || last.text === '.') return null
    if (last.text === ')') {
      const before = tokens[(opener.get(tokens.length - 1) ?? 0) - 1]
      return before?.kind === 'name' && CONDITION_KEYWORDS.has(before.text)
    }
    const prior = tokens.at(-2)
    if (
      (last.text === '+' || last.text === '-') &&
      prior?.text === last.text &&
      prior.at === last.at - 1
    ) {
      return null
    }
    return true
  }
  while (at < code.length) {
    const char = code[at] ?? ''
    if (template !== null) {
      if (char === '\\') at += 2
      else if (char === '`') {
        template.body = code.slice(template.at + 1, at)
        template.next = tokens.length
        template = null
        at += 1
      } else if (char === '$' && code[at + 1] === '{') {
        template.templated = true
        brackets.push({ char: '${', at: tokens.length, template })
        tokens.push(token('punct', at, '${'))
        template = null
        at += 2
      } else at += 1
      continue
    }
    if (SPACE.test(char)) {
      at += 1
      continue
    }
    if (char === '/' && code[at + 1] === '/') {
      const end = code.indexOf('\n', at)
      at = end < 0 ? code.length : end
      continue
    }
    if (char === '/' && code[at + 1] === '*') {
      const end = code.indexOf('*/', at + 2)
      if (end < 0) certain = false
      at = end < 0 ? code.length : end + 2
      continue
    }
    if (char === '/') {
      const regex = regexHere()
      if (regex === null) certain = false
      if (regex !== true) {
        tokens.push(token('punct', at, '/'))
        at += 1
        continue
      }
      let end = at + 1
      let inClass = false
      for (; end < code.length; end += 1) {
        const inside = code[end]
        if (inside === '\n') break
        if (inside === '\\') end += 1
        else if (inside === '[') inClass = true
        else if (inside === ']') inClass = false
        else if (inside === '/' && !inClass) break
      }
      if (code[end] !== '/') certain = false
      end += 1
      while (/[A-Za-z]/.test(code[end] ?? '')) end += 1
      tokens.push(token('value', at, code.slice(at, end)))
      at = end
      continue
    }
    if (char === "'" || char === '"') {
      let end = at + 1
      for (; end < code.length; end += 1) {
        const inside = code[end]
        if (inside === '\\') end += 1
        else if (inside === char || inside === '\n') break
      }
      if (code[end] !== char) certain = false
      tokens.push(token('string', at, code.slice(at + 1, end), char))
      at = end + 1
      continue
    }
    if (char === '`') {
      template = token('string', at, '', '`')
      tokens.push(template)
      at += 1
      continue
    }
    if (char === '(' || char === '[' || char === '{') {
      brackets.push({ char, at: tokens.length, template: null })
      tokens.push(token('punct', at, char))
      at += 1
      continue
    }
    if (char === ')' || char === ']' || char === '}') {
      const open = brackets.pop()
      if (char === '}' && open?.char === '${') {
        template = open.template
        at += 1
        continue
      }
      const expected = OPENS.get(char)
      if (open === undefined || open.char !== expected) certain = false
      else if (char === ')') {
        closer.set(open.at, tokens.length)
        opener.set(tokens.length, open.at)
      }
      tokens.push(token('punct', at, char))
      at += 1
      continue
    }
    if (NAME_START.test(char)) {
      let end = at + 1
      while (NAME_PART.test(code[end] ?? '')) end += 1
      tokens.push(token('name', at, code.slice(at, end)))
      at = end
      continue
    }
    if (DIGIT.test(char) || (char === '.' && DIGIT.test(code[at + 1] ?? ''))) {
      let end = at + 1
      while (/[\w.]/.test(code[end] ?? '')) end += 1
      tokens.push(token('value', at, code.slice(at, end)))
      at = end
      continue
    }
    tokens.push(token('punct', at, char))
    at += 1
  }
  if (template !== null || brackets.length > 0) certain = false
  return { tokens, closer, certain }
}

/** A literal title, the first argument of a call whose `(` is at `open`; null when it is not one. */
const literalTitle = (
  tokens: ReadonlyArray<Token>,
  open: number,
  each: boolean,
): SourceTitle | null => {
  const title = tokens[open + 1]
  const after = tokens[title?.quote === '`' ? title.next : open + 2]
  if (title?.kind !== 'string' || (after?.text !== ',' && after?.text !== ')')) return null
  const text = title.quote === '`' ? title.body : title.text
  return each || title.templated ? { template: text } : text
}

/**
 * The tests a JavaScript or TypeScript file declares (`test(`, `it(`, `test.skip(`,
 * `test.each(…)(`), each under the describes (`describe(`, `describe.each(…)(`, `suite(`,
 * `context(`, `test.describe(`) whose call holds it. A call is read at the start of an expression
 * only (`x.test(…)` is a method, `{ test() {…} }` a method it declares); a describe whose title is
 * not a literal makes its tests' paths unknown, and a test whose title is not one (a variable, a
 * call) makes the whole file uncertain, since it may have any test's name.
 */
export const jsTests = (code: string): SourceTests => {
  const { tokens, closer, certain } = jsTokens(code)
  let generated = false
  const describes = new Map<number, SourceTitle | null>()
  const declared: Array<{
    readonly head: number
    readonly at: number
    readonly title: SourceTitle
  }> = []
  for (const [head, start] of tokens.entries()) {
    const isDescribe = DESCRIBE_HEADS.has(start.text)
    if (start.kind !== 'name' || (!isDescribe && !TEST_HEADS.has(start.text))) continue
    if (tokens[head - 1]?.text === '.') continue
    const members: string[] = []
    let last = head
    while (tokens[last + 1]?.text === '.' && tokens[last + 2]?.kind === 'name') {
      members.push(tokens[last + 2]?.text ?? '')
      last += 2
    }
    if (members.some((member) => NOT_DECLARATIONS.has(member))) continue
    const each = members.includes('each')
    let open = last + 1
    if (each) {
      const table = tokens[open]
      if (table?.text === '(') open = (closer.get(open) ?? tokens.length) + 1
      else if (table?.quote === '`') open = table.next
      else continue
    }
    if (tokens[open]?.text !== '(') continue
    // A method an object literal or a class declares (`{ test('x') { … } }`, `test(): T {`), or a
    // function named test, is no call.
    const after = tokens[(closer.get(open) ?? tokens.length) + 1]?.text
    if (after === '{' || after === ':') continue
    const title = literalTitle(tokens, open, each)
    if (isDescribe || members.includes('describe')) describes.set(open, title)
    else if (title !== null) declared.push({ head, at: start.at, title })
    // A title from a variable, a call or a loop may be any test's.
    else generated = true
  }
  // The describes open at each token, pushed at their call's `(` and popped past its `)`, each
  // with the scope its tests are under, built once when it opens; null when a title is not
  // literal, or the describes nest past what any real file does.
  const open: Array<{ readonly close: number; readonly scope: ReadonlyArray<SourceTitle> | null }> =
    []
  const scopes = new Map<number, ReadonlyArray<SourceTitle> | null>()
  const heads = new Set(declared.map((one) => one.head))
  for (let index = 0; index < tokens.length; index += 1) {
    while ((open.at(-1)?.close ?? tokens.length) < index) open.pop()
    const inner = open.length === 0 ? [] : (open.at(-1)?.scope ?? null)
    if (heads.has(index)) scopes.set(index, inner)
    if (describes.has(index)) {
      const title = describes.get(index) ?? null
      const scope =
        inner === null || title === null || open.length >= MAX_DEPTH ? null : [...inner, title]
      open.push({ close: closer.get(index) ?? tokens.length, scope })
    }
  }
  let known = certain && !generated
  const tests = declared.map((one) => {
    const scope = scopes.get(one.head) ?? null
    if (scope === null) known = false
    return { at: one.at, title: one.title, scope: scope ?? [] }
  })
  return { certain: known, tests }
}

/** What a Python logical line declares: a class, a function, or neither, and its name. */
interface PythonLine {
  readonly kind: 'class' | 'def' | 'other'
  readonly name: string
}
/** A block a logical line opened, at its body's indentation. */
interface PythonBlock extends PythonLine {
  readonly indent: string
}

const PYTHON_DEF = /(?:async[ \t]+)?def[ \t]+(?<name>\w+)[ \t]*\(/y
const PYTHON_CLASS = /class[ \t]+(?<name>\w+)/y

/**
 * The tests a Python file declares (`def test_…(`, `async def`), each under the classes it is
 * declared in, read once: strings (single, double or triple-quoted, any prefix) and comments
 * skipped as such, lines joined inside brackets and after a `\`, then each logical line's
 * indentation read as Python reads it. A def inside a function is no test. Not certain when a
 * string or a bracket is never closed, a bracket closes none, a line is indented with no `:`
 * above it, or a line dedents to no block's indentation.
 */
export const pythonTests = (code: string): SourceTests => {
  const tests: SourceTest[] = []
  const blocks: Array<PythonBlock> = [{ indent: '', kind: 'other', name: '' }]
  let certain = true
  let depth = 0
  let lineStart = true
  let colon = false
  let current: PythonLine = { kind: 'other', name: '' }
  let previous = { colon: false, ...current }
  let at = 0
  while (at < code.length) {
    if (lineStart && depth === 0) {
      let end = at
      while (code[end] === ' ' || code[end] === '\t' || code[end] === '\f') end += 1
      const first = code[end]
      if (first === undefined || first === '\n' || first === '\r' || first === '#') {
        const next = code.indexOf('\n', end)
        at = next < 0 ? code.length : next + 1
        continue
      }
      const indent = code.slice(at, end)
      const top = blocks.at(-1) ?? { indent: '', kind: 'other', name: '' }
      if (indent.length > top.indent.length) {
        if (!previous.colon || !indent.startsWith(top.indent)) certain = false
        blocks.push({ indent, kind: previous.kind, name: previous.name })
      } else {
        while (blocks.length > 1 && (blocks.at(-1)?.indent.length ?? 0) > indent.length)
          blocks.pop()
        if (blocks.at(-1)?.indent !== indent) certain = false
      }
      PYTHON_DEF.lastIndex = end
      PYTHON_CLASS.lastIndex = end
      const def = PYTHON_DEF.exec(code)?.groups?.['name']
      const klass = PYTHON_CLASS.exec(code)?.groups?.['name']
      current =
        def !== undefined
          ? { kind: 'def', name: def }
          : klass !== undefined
            ? { kind: 'class', name: klass }
            : { kind: 'other', name: '' }
      const enclosing = blocks.slice(1)
      if (def?.startsWith('test') === true && enclosing.every((block) => block.kind !== 'def')) {
        const scope = enclosing.flatMap((block) => (block.kind === 'class' ? [block.name] : []))
        tests.push({ at: end, title: def, scope })
      }
      colon = false
      lineStart = false
      at = end
      continue
    }
    const char = code[at] ?? ''
    if (char === '#') {
      const next = code.indexOf('\n', at)
      at = next < 0 ? code.length : next
      continue
    }
    if (char === '\\' && (code[at + 1] === '\n' || code.startsWith('\r\n', at + 1))) {
      at += code[at + 1] === '\n' ? 2 : 3
      continue
    }
    if (char === '\n') {
      if (depth === 0) {
        previous = { colon, ...current }
        lineStart = true
      }
      at += 1
      continue
    }
    if (char === "'" || char === '"') {
      const triple = code.startsWith(char.repeat(3), at)
      const quote = triple ? char.repeat(3) : char
      let end = at + quote.length
      for (; end < code.length; end += 1) {
        const inside = code[end]
        if (inside === '\\') end += 1
        else if (code.startsWith(quote, end)) break
        else if (!triple && inside === '\n') break
      }
      if (!code.startsWith(quote, end)) certain = false
      colon = false
      at = end + quote.length
      continue
    }
    if (char === '(' || char === '[' || char === '{') depth += 1
    if (char === ')' || char === ']' || char === '}') {
      depth -= 1
      if (depth < 0) {
        certain = false
        depth = 0
      }
    }
    if (!SPACE.test(char)) colon = char === ':'
    at += 1
  }
  if (depth !== 0) certain = false
  return { certain, tests }
}
