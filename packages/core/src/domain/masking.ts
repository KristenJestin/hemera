/**
 * Masking: what replaces a secret before anything is written, shown or sent to Jev.
 *
 * Two things are masked. The known values of secrets (a Project's variables, the Jev key, a token
 * read from a keyring), which only the engine holds and hands in here; and the shapes of
 * credentials recognised without their value (a private key block, a GitHub or Slack token, an
 * `Authorization` header, the password in a URL…). Every mask is `•••`. Masking keeps everything
 * else as it was: a URL keeps its host, a header its name, a command line its words.
 *
 * What has been through masking is `Masked`: a column or a field that must never hold an unmasked
 * string takes that type, so a string that skipped masking does not type-check.
 */

import { Brand, Effect, Predicate, Schema } from 'effect'

/** What a secret becomes. */
export const MASK = '•••'

/** A value every string of which went through masking. */
export type Masked<A> = A & Brand.Brand<'Masked'>

/** Text that went through masking, as it crosses a link or is stored. */
export const MaskedText = Schema.String.pipe(Schema.brand('Masked'))

/** A field whose name says it holds a credential: masked whole, whatever it holds. */
const CREDENTIAL_FIELD = /api[_-]?key|password|passwd|secret|token|credential|authorization/i

/** A field that says where an action goes: never sent with a part of it masked away. */
const DESTINATION_FIELD = /^(?:path|target|cwd|command|program|line|url|host)$/i

/** A private key block, to its end, or to the end of the text when it is cut. */
const PRIVATE_KEY =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g

/**
 * A value as it follows a name: between double quotes (escapes included), between single quotes,
 * or bare to the next space.
 */
const QUOTED_OR_BARE = String.raw`"(?:[^"\\]|\\.)*"|'[^']*'`

/**
 * A header whose whole value is a credential, its scheme with its token: as a header line writes
 * it (to the end of the line or of the quotes around it), or as JSON writes it.
 */
const CREDENTIAL_HEADER = new RegExp(
  String.raw`\b(authorization|proxy-authorization|cookie|set-cookie)(["']?\s*[:=]\s*)(?:${QUOTED_OR_BARE}|[^"'\r\n]+)`,
  'gi',
)

/** A bare `Bearer` credential, and a `Basic` one written as the header writes it. */
const BEARER = /\b(bearer)\s+[A-Za-z0-9._~+/=-]+/gi
const BASIC = /\b(Basic)\s+[A-Za-z0-9+/]{8,}={0,2}/g

/** Tokens recognised by their prefix alone, wherever they stand. */
const PREFIXED_TOKEN = new RegExp(
  [
    String.raw`\bsk-[A-Za-z0-9_-]{8,}`,
    String.raw`\bgh[pousr]_[A-Za-z0-9]{16,}`,
    String.raw`\bgithub_pat_[A-Za-z0-9_]{16,}`,
    String.raw`\bxox[abprs]-[A-Za-z0-9-]{8,}`,
    String.raw`\bglpat-[A-Za-z0-9_-]{16,}`,
    // Bitbucket app passwords, Atlassian API tokens, Bitbucket Data Center HTTP access tokens.
    String.raw`\bATBB[A-Za-z0-9]{16,}`,
    String.raw`\bATATT[A-Za-z0-9_=-]{16,}`,
    String.raw`\bBBDC-[A-Za-z0-9+/_=-]{16,}`,
    String.raw`\bAKIA[0-9A-Z]{16}`,
  ].join('|'),
  'g',
)

/*
 * The shapes below begin only where a run of the characters they cross begins (a lookbehind):
 * begun at each word of a run instead, each would cross the rest of the run again, and a run of
 * `a-a-a-…` took time in the square of its length. What a later start in the run would find, the
 * one at its beginning finds too, so nothing is masked less.
 */

/**
 * A JSON Web Token: three runs of base64url joined by dots, the first two opening on `eyJ`. Its
 * first run may hold more before it, after a `-`: the first `eyJ` that opens a word is taken, at
 * once (a lookahead read back), since if a token does not follow it, none follows a later one.
 */
const WEB_TOKEN =
  /(?<![A-Za-z0-9_-])(?=((?:[A-Za-z0-9_-]*?-)??)eyJ)\1eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

/** The password in a URL's user information; the scheme, the user and the host stay. */
const URL_PASSWORD = /((?<![a-z0-9+.-])[a-z0-9+.-]+:\/\/[^\s:/@]+:)[^\s@/]+@/gi

/**
 * A credential given a value in text, by name: `password=…`, `token: …`, `api_key=…`, and the
 * names built on them (`DB_PASSWORD`, `AWS_SECRET_ACCESS_KEY`, `SECRET_KEY`). A plural
 * (`max_tokens`) is not one. The name is the whole run of name characters before the separator,
 * none of which can stand in a name: a lookahead finds the word in it, then the run is taken at
 * once (a lookahead read back), never given back a character at a time.
 */
const LABELLED_CREDENTIAL = new RegExp(
  String.raw`(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*?(?:api[_-]?key|password|passwd|secret|token|credential)(?:[_-]|(?![A-Za-z0-9_-])))(?=([A-Za-z0-9_-]+))\1(["']?\s*[:=]\s*)(?:${QUOTED_OR_BARE}|[^\s"']+)`,
  'gi',
)

/** A stretch of text, from its first character to the one after its last. */
type Span = readonly [start: number, end: number]

/** A stretch of text and what replaces it. */
interface Edit {
  readonly start: number
  readonly end: number
  readonly by: string
}

/**
 * Work done in steps. Each `yield` is a point where it may give way to other work: a long output
 * is masked in slices (`paced`), and the engine answers between two.
 */
type Steps<A> = Generator<void, A, void>

/** Steps run to their end at once. */
const done = <A>(steps: Steps<A>): A => {
  for (;;) {
    const step = steps.next()
    if (step.done === true) return step.value
  }
}

/** How many units of work (a match, a piece, a line, a value) make a step. */
const WORK_A_STEP = 256

/** Units of work done since the last step, whatever masking did them. */
let work = 0

/** Whether a unit of work ends a step: a step at each unit would cost more than the work. */
const due = (): boolean => {
  work += 1
  if (work < WORK_A_STEP) return false
  work = 0
  return true
}

/** How long steps run before they give way, in milliseconds. */
const SLICE = 10

/**
 * Steps run in slices of `slice` milliseconds, other fibers and the event loop running between
 * two. A slice of 0 gives way after every step.
 */
const paced = (steps: () => Steps<string>, slice: number): Effect.Effect<string> =>
  Effect.suspend(() => {
    const running = steps()
    const next = (): Effect.Effect<string> => {
      const until = performance.now() + slice
      for (;;) {
        const step = running.next()
        if (step.done === true) return Effect.succeed(step.value)
        if (performance.now() >= until) return Effect.flatMap(Effect.yieldNow, next)
      }
    }
    return next()
  })

/** Text with its edits made; they are in order and do not overlap. */
function* applied(text: string, edits: ReadonlyArray<Edit>): Steps<string> {
  let out = ''
  let from = 0
  for (const edit of edits) {
    out += text.slice(from, edit.start) + edit.by
    from = edit.end
    if (due()) yield
  }
  return out + text.slice(from)
}

/** A shape of credential, and what a match becomes given its groups: what names it, then `•••`. */
type Shape = readonly [pattern: RegExp, by: (groups: ReadonlyArray<string>) => string]

/** The shapes, in the order they are masked. */
const SHAPES: ReadonlyArray<Shape> = [
  [PRIVATE_KEY, () => MASK],
  [CREDENTIAL_HEADER, ([name = '', separator = '']) => `${name}${separator}${MASK}`],
  [BEARER, ([scheme = '']) => `${scheme} ${MASK}`],
  [BASIC, ([scheme = '']) => `${scheme} ${MASK}`],
  // A web token before the prefixed ones: one of them can start inside it, and masked first it
  // would leave the token's header and payload readable.
  [WEB_TOKEN, ([before = '']) => `${before}${MASK}`],
  [PREFIXED_TOKEN, () => MASK],
  [URL_PASSWORD, ([before = '']) => `${before}${MASK}@`],
  [LABELLED_CREDENTIAL, ([label = '', separator = '']) => `${label}${separator}${MASK}`],
]

/**
 * The first match of a shape's pattern in the text from `from`. The pattern is one object every
 * masking shares, and a paced masking gives way between two steps while another runs: where a
 * search starts is set just before it, and read back at once, never left in the pattern across a
 * step. (`exec` on the shared pattern rather than `matchAll`, which copies the pattern at each
 * call, and this runs for every string of a JSON answer.)
 */
const matchFrom = (pattern: RegExp, text: string, from: number): RegExpExecArray | null => {
  pattern.lastIndex = from
  return pattern.exec(text)
}

/** What one shape replaces in a text. */
function* shapeEdits(text: string, [pattern, by]: Shape): Steps<ReadonlyArray<Edit>> {
  const edits: Edit[] = []
  let from = 0
  for (;;) {
    const match = matchFrom(pattern, text, from)
    if (match === null) break
    // No shape matches nothing: the next search starts past this match.
    from = match.index + match[0].length
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      by: by(match.slice(1).map((group) => group ?? '')),
    })
    if (due()) yield
  }
  // A step at the end: the pattern may have crossed the whole text without a match.
  yield
  return edits
}

/** Credentials recognised by their shape, masked without knowing their value. */
export function maskShapes(text: string): string {
  return done(shapesMasked(text))
}

function* shapesMasked(text: string): Steps<string> {
  if (yield* untouched(text, [])) return text
  let masked = text
  for (const shape of SHAPES) masked = yield* applied(masked, yield* shapeEdits(masked, shape))
  return masked
}

/**
 * The known values, longest first, so a value that contains another is masked whole rather than
 * around the shorter one. An empty value is never a secret.
 */
const longestFirst = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)].filter((value) => value !== '').toSorted((a, b) => b.length - a.length)

/**
 * Every occurrence of every known value masked over its whole span: where two values overlap
 * without one containing the other, the stretch they cover together goes as one mask.
 */
function* knownSpans(text: string, known: ReadonlyArray<string>): Steps<ReadonlyArray<Span>> {
  const spans: Span[] = []
  for (const value of known) {
    for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + 1)) {
      spans.push([at, at + value.length])
      if (due()) yield
    }
  }
  return yield* merged(spans)
}

/** Spans in order, those that overlap or touch made one. */
function* merged(spans: ReadonlyArray<Span>): Steps<ReadonlyArray<Span>> {
  return yield* union(
    spans.toSorted((a, b) => a[0] - b[0]),
    [],
  )
}

/**
 * Two lists of spans, each in order, as one in order, those that overlap or touch made one: in
 * one pass, where sorting them together would not be.
 */
function* union(
  first: ReadonlyArray<Span>,
  second: ReadonlyArray<Span>,
): Steps<ReadonlyArray<Span>> {
  const out: Span[] = []
  let inFirst = 0
  let inSecond = 0
  for (;;) {
    const fromFirst = first[inFirst]
    const fromSecond = second[inSecond]
    const takeFirst =
      fromFirst !== undefined && (fromSecond === undefined || fromFirst[0] <= fromSecond[0])
    const span = takeFirst ? fromFirst : fromSecond
    if (span === undefined) return out
    if (takeFirst) inFirst += 1
    else inSecond += 1
    const last = out.at(-1)
    if (last !== undefined && span[0] <= last[1]) {
      out[out.length - 1] = [last[0], Math.max(last[1], span[1])]
    } else out.push(span)
    if (due()) yield
  }
}

function* knownMasked(text: string, known: ReadonlyArray<string>): Steps<string> {
  const spans = yield* knownSpans(text, known)
  return yield* applied(
    text,
    spans.map(([start, end]) => ({ start, end, by: MASK })),
  )
}

const maskKnown = (text: string, known: ReadonlyArray<string>): string =>
  done(knownMasked(text, known))

/** Text with its known values masked, then the shapes of credentials. */
function* textMasked(text: string, known: ReadonlyArray<string>): Steps<string> {
  if (yield* untouched(text, known)) return text
  return yield* shapesMasked(yield* knownMasked(text, known))
}

/**
 * Whether masking leaves a text as it is: no known value in it, and no shape. Most strings of a
 * JSON answer hold nothing to mask, and this answers for them without the steps' cost.
 */
function* untouched(text: string, known: ReadonlyArray<string>): Steps<boolean> {
  if (known.some((value) => text.includes(value))) return false
  for (const [pattern] of SHAPES) {
    if (matchFrom(pattern, text, 0) !== null) return false
    // A step after each pattern on a long text: each crosses all of it.
    if (text.length > CHARACTERS_A_STEP) yield
  }
  return true
}

const maskedString = Brand.nominal<Masked<string>>()
const maskedRecord = Brand.nominal<Masked<Schema.JsonObject>>()

/** Text with its known values masked, then the shapes of credentials. */
export function maskText(text: string, values: ReadonlyArray<string>): Masked<string> {
  return maskedString(done(textMasked(text, longestFirst(values))))
}

/**
 * As `maskText`, in slices of time: other fibers run while a long text is masked. `slice` is how
 * long a slice runs, in milliseconds.
 */
export const maskTextPaced = (
  text: string,
  values: ReadonlyArray<string>,
  slice = SLICE,
): Effect.Effect<Masked<string>> =>
  Effect.map(
    paced(() => textMasked(text, longestFirst(values)), slice),
    maskedString,
  )

/**
 * A stretch of the text being masked, and the stretch of the text first given that it stands
 * for: itself when it was copied, all that a mask replaced otherwise.
 */
interface Piece {
  readonly length: number
  readonly from: number
  readonly to: number
  readonly copied: boolean
}

/** The pieces once the edits are made: each edit stands for all that the pieces it took stood for. */
function* edited(
  pieces: ReadonlyArray<Piece>,
  edits: ReadonlyArray<Edit>,
): Steps<ReadonlyArray<Piece>> {
  const next: Piece[] = []
  let at = 0
  let index = 0
  let taken: Span | null = null
  for (const piece of pieces) {
    // A mask narrowed to nothing (its match ended in an earlier mask) still stands for what it
    // hid: kept as it is, or taken into the edit it stands in.
    if (piece.length === 0) {
      if (taken === null) next.push(piece)
      else taken = [Math.min(taken[0], piece.from), Math.max(taken[1], piece.to)]
      continue
    }
    let offset = 0
    while (offset < piece.length) {
      const edit = edits[index]
      const here = at + offset
      if (edit !== undefined && here >= edit.start) {
        const take = Math.min(piece.length - offset, edit.end - here)
        const from = piece.copied ? piece.from + offset : piece.from
        const to = piece.copied ? piece.from + offset + take : piece.to
        taken = taken === null ? [from, to] : [Math.min(taken[0], from), Math.max(taken[1], to)]
        offset += take
        if (here + take === edit.end) {
          next.push({ length: edit.by.length, from: taken[0], to: taken[1], copied: false })
          taken = null
          index += 1
        }
      } else {
        const stop = edit === undefined ? piece.length : Math.min(piece.length, edit.start - at)
        next.push(
          piece.copied
            ? {
                length: stop - offset,
                from: piece.from + offset,
                to: piece.from + stop,
                copied: true,
              }
            : { ...piece, length: stop - offset },
        )
        offset = stop
      }
      if (due()) yield
    }
    at += piece.length
  }
  return next
}

/** An edit narrowed to what it changes: what its match and its replacement share at either end stays. */
const narrowed = (text: string, edit: Edit): Edit => {
  const match = text.slice(edit.start, edit.end)
  let head = 0
  while (head < match.length && head < edit.by.length && match[head] === edit.by[head]) head += 1
  let tail = 0
  while (
    tail < match.length - head &&
    tail < edit.by.length - head &&
    match[match.length - 1 - tail] === edit.by[edit.by.length - 1 - tail]
  ) {
    tail += 1
  }
  return {
    start: edit.start + head,
    end: edit.end - tail,
    by: edit.by.slice(head, edit.by.length - tail),
  }
}

/** The stretches of a text that masking it whole (`maskText`) hides, in that text. */
function* hiddenSpans(text: string, known: ReadonlyArray<string>): Steps<ReadonlyArray<Span>> {
  let current = text
  let pieces: ReadonlyArray<Piece> = [
    { length: text.length, from: 0, to: text.length, copied: true },
  ]
  function* make(edits: ReadonlyArray<Edit>): Steps<void> {
    pieces = yield* edited(pieces, edits)
    current = yield* applied(current, edits)
  }
  const spans = yield* knownSpans(text, known)
  yield* make(spans.map(([start, end]) => ({ start, end, by: MASK })))
  for (const shape of SHAPES) {
    const edits: Edit[] = []
    for (const edit of yield* shapeEdits(current, shape)) {
      const narrow = narrowed(current, edit)
      if (narrow.end > narrow.start) edits.push(narrow)
      if (due()) yield
    }
    yield* make(edits)
  }
  const hid: Span[] = []
  for (const piece of pieces) {
    if (!piece.copied) hid.push([piece.from, piece.to])
    if (due()) yield
  }
  return yield* union(hid, [])
}

/** What a JSON string escapes, by the letter after its backslash. */
const ESCAPED = new Map([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
])

/** What JSON takes for space between its tokens. */
const JSON_SPACE = ' \t\n\r'

/** Where the JSON string at `at` ends, after its closing quote, or -1 when it is not one. */
const jsonStringEnd = (text: string, at: number): number => {
  if (text.charAt(at) !== '"') return -1
  let next = at + 1
  for (;;) {
    const code = text.charCodeAt(next)
    if (Number.isNaN(code) || code < 0x20) return -1
    if (code === 0x22) return next + 1
    if (code !== 0x5c) next += 1
    else if (text.charAt(next + 1) === 'u') {
      if (!/^[\dA-Fa-f]{4}$/.test(text.slice(next + 2, next + 6))) return -1
      next += 6
    } else if (ESCAPED.has(text.charAt(next + 1))) next += 2
    else return -1
  }
}

/** Where the run of digits at `at` ends. */
const digitsEnd = (text: string, at: number): number => {
  let next = at
  while (text.charAt(next) >= '0' && text.charAt(next) <= '9') next += 1
  return next
}

/** Where the JSON number at `at` ends, or -1 when it is not one. */
const jsonNumberEnd = (text: string, at: number): number => {
  let next = text.charAt(at) === '-' ? at + 1 : at
  const whole = digitsEnd(text, next)
  if (whole === next || (text.charAt(next) === '0' && whole > next + 1)) return -1
  next = whole
  if (text.charAt(next) === '.') {
    next = digitsEnd(text, next + 1)
    if (next === whole + 1) return -1
  }
  if (text.charAt(next) === 'e' || text.charAt(next) === 'E') {
    const sign = '+-'.includes(text.charAt(next + 1)) ? next + 2 : next + 1
    next = digitsEnd(text, sign)
    if (next === sign) return -1
  }
  return next
}

/** Where the JSON string, number or literal at `at` ends, or -1 when there is none. */
const jsonScalarEnd = (text: string, at: number): number => {
  const first = text.charAt(at)
  if (first === '"') return jsonStringEnd(text, at)
  for (const literal of ['true', 'false', 'null']) {
    if (text.startsWith(literal, at)) return at + literal.length
  }
  return first === '-' || (first >= '0' && first <= '9') ? jsonNumberEnd(text, at) : -1
}

/**
 * Whether a text is JSON, in one pass and without throwing: most lines of a text are not JSON,
 * and `JSON.parse` builds an error for each. The containers open are kept on a stack, not in
 * calls, so no depth of nesting runs out of stack.
 */
export const isJson = (text: string): boolean => done(jsonRead(text))

/** `isJson`, in steps. */
function* jsonRead(text: string): Steps<boolean> {
  const space = (at: number): number => {
    let next = at
    while (next < text.length && JSON_SPACE.includes(text.charAt(next))) next += 1
    return next
  }
  /** Where the value of the next field of an object begins, past its name and colon, or -1. */
  const field = (at: number): number => {
    const name = jsonStringEnd(text, at)
    if (name === -1) return -1
    const colon = space(name)
    return text.charAt(colon) === ':' ? space(colon + 1) : -1
  }
  const closers: string[] = []
  let at = space(0)
  for (;;) {
    if (due()) yield
    const first = text.charAt(at)
    if (first === '{' || first === '[') {
      const closing = first === '{' ? '}' : ']'
      at = space(at + 1)
      if (text.charAt(at) === closing) at += 1
      else {
        closers.push(closing)
        if (closing === '}') at = field(at)
        if (at === -1) return false
        continue
      }
    } else {
      at = jsonScalarEnd(text, at)
      if (at === -1) return false
    }
    // A value read: close what it ends, until a comma opens the next value.
    for (;;) {
      at = space(at)
      const closing = closers.at(-1)
      if (closing === undefined) return at === text.length
      if (text.charAt(at) === ',') {
        at = space(at + 1)
        if (closing === '}') at = field(at)
        if (at === -1) return false
        break
      }
      if (text.charAt(at) !== closing) return false
      closers.pop()
      at += 1
    }
  }
}

/** The spans, in order and apart, that touch this stretch. */
const touchingSpans = (
  spans: ReadonlyArray<Span>,
  start: number,
  end: number,
): ReadonlyArray<Span> => {
  let low = 0
  let high = spans.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((spans[middle]?.[1] ?? 0) <= start) low = middle + 1
    else high = middle
  }
  const found: Span[] = []
  for (let index = low; index < spans.length; index += 1) {
    const span = spans[index]
    if (span === undefined || span[0] >= end) break
    found.push(span)
  }
  return found
}

/**
 * The lines of a text that are JSON, each where it stands. Among lines that are not, a line a
 * hidden stretch covers whole is text: it is hidden whole, as masking the text would hide it.
 */
function* jsonLines(text: string, hidden: ReadonlyArray<Span>): Steps<ReadonlyArray<Span>> {
  const lines: Span[] = []
  let mixed = false
  for (let start = 0; start <= text.length;) {
    const ending = text.indexOf('\n', start)
    const end = ending === -1 ? text.length : ending
    const line = text.slice(start, end)
    if (line.trim() !== '') {
      if (yield* jsonRead(line)) lines.push([start, end])
      else mixed = true
    }
    start = end + 1
    if (due()) yield
  }
  const coveredWhole = ([from, to]: Span) =>
    touchingSpans(hidden, from, to).some(([spanFrom, spanTo]) => spanFrom <= from && spanTo >= to)
  return mixed ? lines.filter((line) => !coveredWhole(line)) : lines
}

/** The parts of the spans outside the units. Both are in order, and the units do not overlap. */
function* outside(
  spans: ReadonlyArray<Span>,
  units: ReadonlyArray<Span>,
): Steps<ReadonlyArray<Span>> {
  const parts: Span[] = []
  let first = 0
  for (const [start, end] of spans) {
    while ((units[first]?.[1] ?? Number.POSITIVE_INFINITY) <= start) first += 1
    let from = start
    for (let index = first; index < units.length; index += 1) {
      const unit = units[index]
      if (unit === undefined || unit[0] >= end) break
      if (unit[0] > from) parts.push([from, unit[0]])
      from = Math.max(from, unit[1])
    }
    if (from < end) parts.push([from, end])
    if (due()) yield
  }
  return parts
}

/**
 * A JSON string read: what it says, and where each of its characters is written in the text. JSON
 * writes each character of a string as one, or as one escape: character `i` is written from
 * `from[i]` to `from[i + 1]`.
 */
interface Read {
  readonly read: string
  readonly from: Int32Array
}

/** A JSON string of the text, read, each character with where it is written. */
function* readString(text: string, start: number, end: number): Steps<Read> {
  const parts: string[] = []
  const from = new Int32Array(end - start)
  let count = 0
  let at = start + 1
  // A run of characters written as themselves is taken whole, at the next escape or the end.
  let run = at
  while (at < end - 1) {
    from[count] = at
    count += 1
    if (text.charAt(at) !== '\\') at += 1
    else {
      parts.push(text.slice(run, at))
      if (text.charAt(at + 1) === 'u') {
        parts.push(String.fromCharCode(Number.parseInt(text.slice(at + 2, at + 6), 16)))
        at += 6
      } else {
        parts.push(ESCAPED.get(text.charAt(at + 1)) ?? '')
        at += 2
      }
      run = at
    }
    if (count % CHARACTERS_A_STEP === 0) yield
  }
  parts.push(text.slice(run, at))
  from[count] = at
  return { read: parts.join(''), from: from.subarray(0, count + 1) }
}

/** How many characters of a string are read in one step. */
const CHARACTERS_A_STEP = 4096

const QUOTED_MASK = JSON.stringify(MASK)

/** A JSON container open while its values are read. */
interface Open {
  readonly closing: string
  /** The field the container stands in, which its items stand in too when it is a list. */
  readonly field: string
  /** Whether what it holds is left as it is: it is masked whole, or stands in what is. */
  readonly quiet: boolean
  /** Where it begins when it is masked whole, once closed; -1 when it is not. */
  readonly whole: number
}

/**
 * What a CLI printed, masked so that it hides at least all that masking the whole text hides,
 * and stays JSON where it was: the whole text, or each of its lines.
 *
 * The stretches the whole-text masking hides are found in the text as printed. Outside JSON, each
 * is masked as that masking does. In JSON, a number or literal one touches is masked whole
 * (`"•••"`), and so is a string one runs out of; in a string, the characters one writes are
 * masked once the string is read. Between values stand only brackets, commas, colons and spaces,
 * which hold nothing. On top, the rules of a structured value: a field whose name says it is a
 * credential masked whole, and every string, keys included, masked as text once read (where a
 * known value written with escapes is found). Nothing else is written again: a number beyond what
 * a double holds, the spacing and the escapes come out as printed.
 */
export function maskPrinted(text: string, values: ReadonlyArray<string>): Masked<string> {
  return maskedString(done(printedMasked(text, longestFirst(values))))
}

/**
 * As `maskPrinted`, in slices of time: other fibers run while a long output is masked, and the
 * engine answers meanwhile. `slice` is how long a slice runs, in milliseconds.
 */
export const maskPrintedPaced = (
  text: string,
  values: ReadonlyArray<string>,
  slice = SLICE,
): Effect.Effect<Masked<string>> =>
  Effect.map(
    paced(() => printedMasked(text, longestFirst(values)), slice),
    maskedString,
  )

function* printedMasked(text: string, known: ReadonlyArray<string>): Steps<string> {
  const hidden = yield* hiddenSpans(text, known)
  const touching = (start: number, end: number) => touchingSpans(hidden, start, end)
  const edits: Edit[] = []
  const space = (at: number): number => {
    let next = at
    while (next < text.length && JSON_SPACE.includes(text.charAt(next))) next += 1
    return next
  }
  const stringEnd = (at: number): number => {
    let next = at + 1
    while (text.charAt(next) !== '"') next += text.charAt(next) === '\\' ? 2 : 1
    return next + 1
  }
  const tokenEnd = (at: number): number => {
    let next = at
    while (next < text.length && !`,]}:${JSON_SPACE}`.includes(text.charAt(next))) next += 1
    return next
  }
  /**
   * A string masked: whole where a hidden stretch runs past its quotes or covers all it holds;
   * otherwise read, the characters the hidden stretches write masked, then masked as text.
   */
  function* maskString(start: number, end: number): Steps<void> {
    const spans = touching(start, end)
    if (
      spans.some(([from, to]) => from <= start || to >= end || (from <= start + 1 && to >= end - 1))
    ) {
      edits.push({ start, end, by: QUOTED_MASK })
      return
    }
    if (spans.length === 0) {
      // Nothing of the whole text's masking here: the string masked as text once read.
      const plain = text.slice(start + 1, end - 1)
      const read = plain.includes('\\') ? (yield* readString(text, start, end)).read : plain
      const masked = yield* textMasked(read, known)
      if (masked !== read) edits.push({ start, end, by: JSON.stringify(masked) })
      return
    }
    const { read, from } = yield* readString(text, start, end)
    // The characters the spans write, as spans of what the string reads, those that touch made one.
    const marked: Span[] = []
    let markFrom = -1
    // The spans are in order and apart, as the characters: one index moves forward through them.
    let next = 0
    for (let at = 0; at < read.length; at += 1) {
      const written = from[at] ?? 0
      while ((spans[next]?.[1] ?? Number.POSITIVE_INFINITY) <= written) next += 1
      const hiddenHere = (spans[next]?.[0] ?? Number.POSITIVE_INFINITY) < (from[at + 1] ?? 0)
      if (hiddenHere && markFrom === -1) markFrom = at
      if (!hiddenHere && markFrom !== -1) {
        marked.push([markFrom, at])
        markFrom = -1
      }
      if (at % CHARACTERS_A_STEP === 0) yield
    }
    if (markFrom !== -1) marked.push([markFrom, read.length])
    const spansOfRead = yield* union(marked, yield* hiddenSpans(read, known))
    const masked = yield* applied(
      read,
      spansOfRead.map(([first, after]) => ({ start: first, end: after, by: MASK })),
    )
    if (masked !== read) edits.push({ start, end, by: JSON.stringify(masked) })
  }
  /** The name of the field whose key is at `at`, the key masked unless quiet. */
  function* key(at: number, quiet: boolean): Steps<string> {
    const end = stringEnd(at)
    if (!quiet) yield* maskString(at, end)
    const plain = text.slice(at + 1, end - 1)
    return plain.includes('\\') ? (yield* readString(text, at, end)).read : plain
  }
  /**
   * Masks the JSON value at `at` and all it holds. The containers open are kept on a stack, not
   * in calls, so no depth of nesting runs out of stack.
   */
  function* value(at: number): Steps<void> {
    const open: Open[] = []
    let next = at
    let field = ''
    let quiet = false
    for (;;) {
      if (due()) yield
      const start = space(next)
      // Typed: the loop reads them back through `quiet`, and inference would go round in a circle.
      const whole: number = !quiet && CREDENTIAL_FIELD.test(field) ? start : -1
      const inner: boolean = quiet || whole !== -1
      const first = text.charAt(start)
      let end = start
      if (first === '{' || first === '[') {
        const closing = first === '{' ? '}' : ']'
        next = space(start + 1)
        if (text.charAt(next) !== closing) {
          open.push({ closing, field, quiet: inner, whole })
          quiet = inner
          if (closing === '}') {
            field = yield* key(next, quiet)
            next = space(stringEnd(next)) + 1
          }
          continue
        }
        end = next + 1
      } else if (first === '"') {
        end = stringEnd(start)
        if (!inner) yield* maskString(start, end)
      } else {
        end = tokenEnd(start)
        if (!inner && touching(start, end).length > 0) {
          edits.push({ start, end, by: QUOTED_MASK })
        }
      }
      if (whole !== -1) edits.push({ start: whole, end, by: QUOTED_MASK })
      // The value read: the containers it ends are closed, up to the comma before the next one.
      for (;;) {
        const container = open.at(-1)
        if (container === undefined) return
        next = space(end)
        if (text.charAt(next) === ',') {
          quiet = container.quiet
          field = container.field
          next = space(next + 1)
          if (container.closing === '}') {
            field = yield* key(next, quiet)
            next = space(stringEnd(next)) + 1
          }
          break
        }
        open.pop()
        end = next + 1
        if (container.whole !== -1) edits.push({ start: container.whole, end, by: QUOTED_MASK })
      }
    }
  }
  const units: ReadonlyArray<Span> = (yield* jsonRead(text))
    ? [[0, text.length]]
    : yield* jsonLines(text, hidden)
  for (const [start] of units) yield* value(start)
  for (const [start, end] of yield* outside(hidden, units)) {
    if (text.slice(start, end).trim() !== '') edits.push({ start, end, by: MASK })
  }
  return yield* applied(
    text,
    edits.toSorted((a, b) => a.start - b.start),
  )
}

/** `Array.isArray` does not narrow a read-only array out of a union: this does. */
const isList = (value: Schema.Json): value is Schema.JsonArray => Array.isArray(value)

/** A masked record as the text a column keeps: its JSON, which holds only masked strings. */
export const maskedJson = (record: Masked<Schema.JsonObject>): Masked<string> =>
  maskedString(JSON.stringify(record))

/** One string masked, knowing the name of the field it stands in. */
type MaskString = (text: string, field: string) => string

/**
 * A value with every string in it masked by `string`, and a field whose name says it is a
 * credential masked whole.
 */
const visit = (value: Schema.Json, field: string, string: MaskString): Schema.Json => {
  if (CREDENTIAL_FIELD.test(field)) return MASK
  if (Predicate.isString(value)) return string(value, field)
  if (isList(value)) return value.map((item) => visit(item, field, string))
  if (value === null || Predicate.isNumber(value) || Predicate.isBoolean(value)) return value
  return visitFields(value, string)
}

/** The tag of a tagged value names its shape, never a secret: it is kept as it is. */
const TAG = '_tag'

const visitFields = (record: Schema.JsonObject, string: MaskString): Schema.JsonObject =>
  Object.fromEntries(
    Object.entries(record).map(([name, item]) => [
      name,
      name === TAG ? item : visit(item, name, string),
    ]),
  )

/**
 * A structured value with every string in it masked, and a field whose name says it is a
 * credential (`password`, `token`, `secret`, `api_key`, `credential`, `authorization`) masked
 * whole.
 */
export function maskRecord(
  record: Schema.JsonObject,
  values: ReadonlyArray<string>,
): Masked<Schema.JsonObject> {
  const known = longestFirst(values)
  return maskedRecord(visitFields(record, (text) => done(textMasked(text, known))))
}

/**
 * What is sent to Jev: as `maskRecord`, but nothing at all when masking took a known value out of
 * a field that says where the action goes (`path`, `target`, `cwd`, `command`, `program`, `line`,
 * `url`, `host`). A credential recognised by its shape leaves a destination readable (the URL of
 * a `curl` stays), so it does not stop the action; a known value inside a destination may be the
 * destination itself, and a partial action is never sent.
 */
export function maskAction(
  action: Schema.JsonObject,
  values: ReadonlyArray<string>,
): Masked<Schema.JsonObject> | null {
  const known = longestFirst(values)
  let lostDestination = false
  const masked = visitFields(action, (text, field) => {
    const withoutKnown = maskKnown(text, known)
    if (DESTINATION_FIELD.test(field) && withoutKnown !== text) lostDestination = true
    return maskShapes(withoutKnown)
  })
  return lostDestination ? null : maskedRecord(masked)
}
