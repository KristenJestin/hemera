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

/*
 * Each shape below hides all it matches but its group `keep`, which begins the match: what names
 * the credential (a header's name, a scheme, a label) stays readable.
 */

/**
 * A header whose whole value is a credential, its scheme with its token: as a header line writes
 * it (to the end of the line or of the quotes around it), or as JSON writes it. An escaped quote
 * (`\"`) closes no quotes around it, so the value runs on through it: a backslash takes the
 * character after it.
 */
const CREDENTIAL_HEADER = new RegExp(
  String.raw`\b(?<keep>(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:${QUOTED_OR_BARE}|(?=[^"'\r\n])[^"'\\\r\n]*(?:\\[^\r\n]?[^"'\\\r\n]*)*)`,
  'gi',
)

/** A bare `Bearer` credential, and a `Basic` one written as the header writes it. */
const BEARER = /\b(?<keep>bearer\s+)[A-Za-z0-9._~+/=-]+/gi
const BASIC = /\b(?<keep>Basic\s+)[A-Za-z0-9+/]{8,}={0,2}/g

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
  /(?<![A-Za-z0-9_-])(?=((?:[A-Za-z0-9_-]*?-)??)eyJ)(?<keep>\1)eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g

/** The password in a URL's user information; the scheme, the user and the host stay. */
const URL_PASSWORD = /(?<keep>(?<![a-z0-9+.-])[a-z0-9+.-]+:\/\/[^\s:/@]+:)[^\s@/]+(?=@)/gi

/**
 * A credential given a value in text, by name: `password=…`, `token: …`, `api_key=…`, and the
 * names built on them (`DB_PASSWORD`, `AWS_SECRET_ACCESS_KEY`, `SECRET_KEY`). A plural
 * (`max_tokens`) is not one. The name is the whole run of name characters before the separator,
 * none of which can stand in a name: a lookahead finds the word in it, then the run is taken at
 * once (a lookahead read back), never given back a character at a time.
 */
const LABELLED_CREDENTIAL = new RegExp(
  String.raw`(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*?(?:api[_-]?key|password|passwd|secret|token|credential)(?:[_-]|(?![A-Za-z0-9_-])))(?=([A-Za-z0-9_-]+))(?<keep>\1["']?\s*[:=]\s*)(?:${QUOTED_OR_BARE}|[^\s"']+)`,
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
 * A mask run to its end at once; `•••` when it throws. A mask that fails (a pattern out of stack
 * on a quoted value of megabytes, or anything else) never gives back the text it was given, and
 * never fails what asked for it.
 */
const doneOrMask = (steps: () => Steps<string>): string => {
  try {
    return done(steps())
  } catch {
    return MASK
  }
}

/**
 * A mask run in slices of `slice` milliseconds, other fibers and the event loop running between
 * two; a slice of 0 gives way after every step. `•••` when it throws, as `doneOrMask`.
 */
const paced = (steps: () => Steps<string>, slice: number): Effect.Effect<string> =>
  Effect.suspend(() => {
    let running: Steps<string>
    try {
      running = steps()
    } catch {
      return Effect.succeed(MASK)
    }
    const next = (): Effect.Effect<string> => {
      const until = performance.now() + slice
      for (;;) {
        let step: IteratorResult<void, string>
        try {
          step = running.next()
        } catch {
          return Effect.succeed(MASK)
        }
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

/**
 * The shapes, each matched on the text as it was given: none ever sees what another masked, so a
 * shape that takes the first word of another cannot hide the rest of it, whatever their order.
 */
const SHAPES: ReadonlyArray<RegExp> = [
  PRIVATE_KEY,
  CREDENTIAL_HEADER,
  BEARER,
  BASIC,
  WEB_TOKEN,
  PREFIXED_TOKEN,
  URL_PASSWORD,
  LABELLED_CREDENTIAL,
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

/** What stands between a name and its value: quotes, spaces, `:` and `=`. */
const BETWEEN = /["'\s:=]/

/** A character of a name. */
const NAME = /[\w-]/

/**
 * Where a shape's search goes on after a match. A match of the same shape that starts inside this
 * one and runs past its end has its name, and what stands before its value, at the end of this one
 * (`password=a.token="b c"`, the first value stopped by the quote): the search goes on from the
 * last name of the match. Only that word is crossed again, so the search stays linear.
 */
const resumeAt = (text: string, start: number, hiddenFrom: number, end: number): number => {
  let at = end
  while (at > hiddenFrom && BETWEEN.test(text.charAt(at - 1))) at -= 1
  while (at > hiddenFrom && NAME.test(text.charAt(at - 1))) at -= 1
  return at > start ? at : end
}

/** The stretches one shape hides in a text, in order. */
function* shapeSpans(text: string, pattern: RegExp): Steps<ReadonlyArray<Span>> {
  const spans: Span[] = []
  let from = 0
  for (;;) {
    const match = matchFrom(pattern, text, from)
    if (match === null) break
    const end = match.index + match[0].length
    const hiddenFrom = match.index + (match.groups?.['keep']?.length ?? 0)
    spans.push([hiddenFrom, end])
    from = resumeAt(text, match.index, hiddenFrom, end)
    if (due()) yield
  }
  // A step at the end: the pattern may have crossed the whole text without a match.
  yield
  return spans
}

/**
 * The stretches of a text that masking hides: every occurrence of a known value, and every
 * stretch a shape hides, those that overlap or touch made one. They are the union of three readings:
 *
 * - each shape on the text as it was given: no shape sees what another hid, so a shape that takes
 *   the first word of another cannot hide the rest of it (`Bearer password=https://u:x@h`);
 * - the shapes in turn, as masking used to read them: each on the text where the known values and
 *   all the shapes before it found are written over. A value that stops at a space, a quote or a
 *   line end then runs on through what an earlier shape hid, and hides what is glued after it
 *   (`password=<private key>x`);
 * - each shape once more, on the text where the known values, and every stretch the two readings
 *   found that holds a space or a quote up to its last one, are written over. A value hidden by
 *   itself, quoted or spaced, no longer stops the value it stands in (`password=token="a b"x`,
 *   `https://u:token="a b"x@h`), whichever shape found it. What holds neither is left as it is: it
 *   stops no value that stops at a space or a quote, and the names in it stay readable (`Bearer
 *   password=…`, `password=<private key>token: "a"x`).
 *
 * The union hides at least what any reading hides, and its cost is three scans of each shape. On
 * top, every known value as a JSON string writes it (`se\"same`): in its own reading, since
 * written over in the others it would hide what the shapes read around it.
 */
function* hiddenSpans(text: string, known: ReadonlyArray<string>): Steps<ReadonlyArray<Span>> {
  const escapedHidden = yield* knownSpans(text, escapedForms(known))
  const knownHidden = yield* knownSpans(text, known)
  let spans = knownHidden
  let inTurn = knownHidden
  let closed = knownHidden
  // Written over only once something is hidden: until then, the shapes in turn read the text.
  let view = text
  let written = false
  if (knownHidden.length > 0) {
    view = yield* writtenOver(text, knownHidden)
    written = true
  }
  for (const pattern of SHAPES) {
    const found = yield* shapeSpans(text, pattern)
    spans = yield* union(spans, found)
    closed = yield* union(closed, yield* closedSpans(text, found))
    const foundInTurn = written ? yield* shapeSpans(view, pattern) : found
    if (foundInTurn.length > 0) {
      inTurn = yield* union(inTurn, foundInTurn)
      if (foundInTurn !== found)
        closed = yield* union(closed, yield* closedSpans(text, foundInTurn))
      view = yield* writtenOver(view, foundInTurn)
      written = true
    }
  }
  spans = yield* union(yield* union(spans, inTurn), escapedHidden)
  // Nothing closed: the third reading would read the text as the first did.
  if (closed.length === 0) return spans
  const opened = yield* writtenOver(text, closed)
  for (const pattern of SHAPES) spans = yield* union(spans, yield* shapeSpans(opened, pattern))
  return spans
}

/** What stops a value read to the next space or quote. */
const STOPS = /[\s"']/g

/** One character that stops such a value. */
const STOP = /[\s"']/

/**
 * Of each stretch, in order of their starts, that holds a space or a quote: the part up to its
 * last one. What follows that, up to the stretch's end, stops no value, and may be the name of a
 * shape glued after it (`password=<private key>token: "a"`), which must stay readable. Where the
 * next space or quote stands is searched once from each start past the last one found; the last
 * one is found walking back from the end over what holds none, which no other stretch of the same
 * shape crosses but a word: the text is crossed a fixed number of times.
 */
function* closedSpans(text: string, spans: ReadonlyArray<Span>): Steps<ReadonlyArray<Span>> {
  const closed: Span[] = []
  let stop = -1
  for (const [start, end] of spans) {
    if (stop < start) stop = matchFrom(STOPS, text, start)?.index ?? Number.POSITIVE_INFINITY
    if (stop < end) {
      let last = end
      while (!STOP.test(text.charAt(last - 1))) last -= 1
      closed.push([start, last])
    }
    if (due()) yield
  }
  return closed
}

/** What a hidden stretch is written over by, one for each of its characters. */
const BLANK = MASK.charAt(0)

/**
 * A text with each of the stretches, in order, written over by as many `•`: every pattern matches
 * there as it matched around `•••`, and every stretch it finds is where it is in the text.
 */
function* writtenOver(text: string, spans: ReadonlyArray<Span>): Steps<string> {
  // Joined a step at a time, then once: a string added to piece by piece is a rope of millions
  // of pieces, and the next pattern flattens it in one go, the engine held meanwhile.
  const joined: string[] = []
  let pieces: string[] = []
  let from = 0
  for (const [start, end] of spans) {
    if (end <= from) continue
    const begin = Math.max(start, from)
    pieces.push(text.slice(from, begin), BLANK.repeat(end - begin))
    from = end
    if (due()) {
      joined.push(pieces.join(''))
      pieces = []
      yield
    }
  }
  pieces.push(text.slice(from))
  joined.push(pieces.join(''))
  return joined.join('')
}

/** Text with each of the stretches, in order and apart, masked. */
function* maskedOver(text: string, spans: ReadonlyArray<Span>): Steps<string> {
  let out = ''
  let from = 0
  for (const [start, end] of spans) {
    out += text.slice(from, start) + MASK
    from = end
    if (due()) yield
  }
  return out + text.slice(from)
}

/** Credentials recognised by their shape, masked without knowing their value. */
export function maskShapes(text: string): string {
  return doneOrMask(() => textMasked(text, []))
}

/**
 * The known values, longest first, so a value that contains another is masked whole rather than
 * around the shorter one. An empty value is never a secret.
 */
const longestFirst = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)].filter((value) => value !== '').toSorted((a, b) => b.length - a.length)

/** Each list of known values with its escaped forms, worked out once for all its strings. */
const ESCAPED_FORMS = new WeakMap<ReadonlyArray<string>, ReadonlyArray<string>>()

/** The known values a JSON string writes otherwise than as they are (`se\"same`), as it writes them. */
const escapedForms = (known: ReadonlyArray<string>): ReadonlyArray<string> => {
  const kept = ESCAPED_FORMS.get(known)
  if (kept !== undefined) return kept
  const forms = known
    .map((value) => JSON.stringify(value).slice(1, -1))
    .filter((form) => !known.includes(form))
  ESCAPED_FORMS.set(known, forms)
  return forms
}

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

/** Text with its known values and the shapes of credentials masked. */
function* textMasked(text: string, known: ReadonlyArray<string>): Steps<string> {
  if (yield* untouched(text, known)) return text
  return yield* maskedOver(text, yield* hiddenSpans(text, known))
}

/**
 * Whether masking leaves a text as it is: no known value in it, and no shape. Most strings of a
 * JSON answer hold nothing to mask, and this answers for them without the steps' cost.
 */
function* untouched(text: string, known: ReadonlyArray<string>): Steps<boolean> {
  const has = (value: string) => text.includes(value)
  if (known.some(has) || escapedForms(known).some(has)) return false
  for (const pattern of SHAPES) {
    if (matchFrom(pattern, text, 0) !== null) return false
    // A step after each pattern on a long text: each crosses all of it.
    if (text.length > CHARACTERS_A_STEP) yield
  }
  return true
}

const maskedString = Brand.nominal<Masked<string>>()
const maskedRecord = Brand.nominal<Masked<Schema.JsonObject>>()

/** Text with its known values and the shapes of credentials masked. */
export function maskText(text: string, values: ReadonlyArray<string>): Masked<string> {
  return maskedString(doneOrMask(() => textMasked(text, longestFirst(values))))
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

/** Four hexadecimal digits, as a `\u` escape writes them. */
const HEX = /^[\dA-Fa-f]{4}$/

/** Where reading a JSON string stopped, and whether it was closed there. */
interface Stopped {
  /** After its closing quote; else the first character it cannot hold. */
  readonly stop: number
  readonly closed: boolean
}

/**
 * Where reading the JSON string whose quote is at `at` stops: after its closing quote, or at the
 * first character a JSON string cannot hold (a line end or another control character, an escape
 * JSON has not, the end of the text).
 */
const stringStop = (text: string, at: number): Stopped => {
  let next = at + 1
  for (;;) {
    const code = text.charCodeAt(next)
    if (Number.isNaN(code) || code < 0x20) return { stop: next, closed: false }
    if (code === 0x22) return { stop: next + 1, closed: true }
    if (code !== 0x5c) next += 1
    else if (text.charAt(next + 1) === 'u') {
      if (!HEX.test(text.slice(next + 2, next + 6))) return { stop: next, closed: false }
      next += 6
    } else if (ESCAPED.has(text.charAt(next + 1))) next += 2
    else return { stop: next, closed: false }
  }
}

/** Where the JSON string at `at` ends, after its closing quote, or -1 when it is not one. */
const jsonStringEnd = (text: string, at: number): number => {
  if (text.charAt(at) !== '"') return -1
  const { stop, closed } = stringStop(text, at)
  return closed ? stop : -1
}

/** Where the JSON space from `at` ends. */
const jsonSpace = (text: string, at: number): number => {
  let next = at
  while (next < text.length && JSON_SPACE.includes(text.charAt(next))) next += 1
  return next
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

/** The lines of a text that are JSON by themselves, and whether some line that is not blank is not. */
interface Lines {
  readonly lines: ReadonlyArray<Span>
  readonly mixed: boolean
}

/** The lines of a text that are JSON by themselves, each where it stands. */
function* jsonLines(text: string): Steps<Lines> {
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
  return { lines, mixed }
}

/**
 * The next match of a pattern from a position, the positions asked in order: a search starts only
 * past the match found last, so the text is crossed once however often it is asked. The text's
 * length when there is none.
 */
const nextOf = (text: string, pattern: RegExp): ((at: number) => number) => {
  let found = -1
  return (at) => {
    if (found < at) found = matchFrom(pattern, text, at)?.index ?? text.length
    return found
  }
}

/** Where a JSON container opens. */
const OPENERS = /[[{]/g

/** A quote. */
const QUOTES = /"/g

/** A backslash. */
const BACKSLASHES = /\\/g

/** What ends what a JSON string may hold: a quote, or a line end. */
const DELIMITERS = /["\r\n]/g

/** Whether the quote at `at` is escaped: an odd run of backslashes before it, back to `floor`. */
const escapedAt = (text: string, floor: number, at: number): boolean => {
  let before = at
  while (before > floor && text.charAt(before - 1) === '\\') before -= 1
  return (at - before) % 2 === 1
}

/**
 * The JSON values written in a text that is not JSON whole, in order and apart:
 *
 * - every container read whole from where it opens, wherever it stands: after a sentence, a lone
 *   quote, another bracket (`containersIn`). One that breaks (cut, or a string in it broken by a
 *   line end) keeps as values those it held whole;
 * - every line that is JSON by itself. Of two of these, the one inside the other gives way: a
 *   string line that holds braces stays one string, a pretty container one container. Where two
 *   overlap, the first stays;
 * - a value a broken container held whole, where it touches none of those;
 * - between all those, every string opened by a quote no backslash escapes and closed before the
 *   next of them.
 */
function* writtenJson(text: string, lines: ReadonlyArray<Span>): Steps<ReadonlyArray<Span>> {
  const { complete, held } = yield* containersIn(text)
  const outer: Span[] = []
  for (const value of yield* inOrder(yield* byStart(complete), lines, ([start]) => start)) {
    if (value[0] >= (outer.at(-1)?.[1] ?? 0)) outer.push(value)
    if (due()) yield
  }
  const kept: Span[] = []
  for (const value of yield* byStart(held)) {
    const apart = touchingSpans(outer, value[0], value[1]).length === 0
    if (apart && value[0] >= (kept.at(-1)?.[1] ?? 0)) kept.push(value)
    if (due()) yield
  }
  const values = yield* inOrder(outer, kept, ([start]) => start)
  const strings: Span[] = []
  const nextQuote = nextOf(text, QUOTES)
  let gapStart = 0
  for (let index = 0; index <= values.length; index += 1) {
    const gapEnd = values[index]?.[0] ?? text.length
    for (let at = gapStart, quote = nextQuote(at); quote < gapEnd; quote = nextQuote(at)) {
      at = quote + 1
      if (escapedAt(text, gapStart, quote)) continue
      const { stop, closed } = stringStop(text, quote)
      if (closed && stop <= gapEnd) strings.push([quote, stop])
      // Nothing between the quote and where it stopped is a quote that opens a string.
      at = Math.min(Math.max(stop, at), gapEnd)
      if (due()) yield
    }
    gapStart = values[index]?.[1] ?? text.length
    if (due()) yield
  }
  return yield* inOrder(values, strings, ([start]) => start)
}

/**
 * Spans in order of their starts, in steps. They come from two readers at most, each in order, so
 * they are made of a few runs in order: the runs are merged two by two.
 */
function* byStart(spans: ReadonlyArray<Span>): Steps<ReadonlyArray<Span>> {
  let runs: Array<ReadonlyArray<Span>> = []
  let run: Span[] = []
  for (const span of spans) {
    if (span[0] < (run.at(-1)?.[0] ?? -1)) {
      runs.push(run)
      run = []
    }
    run.push(span)
    if (due()) yield
  }
  runs.push(run)
  while (runs.length > 1) {
    const paired: Array<ReadonlyArray<Span>> = []
    for (let index = 0; index < runs.length; index += 2) {
      paired.push(yield* inOrder(runs[index] ?? [], runs[index + 1] ?? [], ([start]) => start))
    }
    runs = paired
  }
  return runs[0] ?? []
}

/** What a reader of a container reads next, outside its strings. */
type Expected = 'value' | 'key' | 'colon' | 'after'

/** A container open while a reader reads it, and the values it holds whole so far. */
interface Opened {
  readonly closing: string
  readonly start: number
  readonly held: Span[]
}

/** A reader of the container that opens at `start`, its containers open kept on a stack. */
interface Reader {
  readonly start: number
  readonly levels: Opened[]
  expected: Expected
  /** Where it reads on; in a string, once the string ends there. */
  at: number
}

/** The values the containers hold whole, in steps: a reader may break with millions open. */
function* heldIn(broken: ReadonlyArray<ReadonlyArray<Opened>>): Steps<ReadonlyArray<Span>> {
  const held: Span[] = []
  for (const levels of broken) {
    for (const level of levels) {
      for (const value of level.held) held.push(value)
      if (due()) yield
    }
  }
  return held
}

/** The two readers at most that read a text at once. */
interface Readers {
  /** The one that reads between strings. */
  between: Reader | null
  /** The one in a string. */
  inString: Reader | null
}

/** The containers a text holds whole, and the values held whole by those that break. */
interface Containers {
  readonly complete: ReadonlyArray<Span>
  readonly held: ReadonlyArray<Span>
}

/**
 * Every container read whole from where it opens, in one pass. A reader starts at each opener
 * where no reader reads outside a string; one that meets an opener goes into it. On a line, the
 * quotes no backslash escapes open and close strings in turn, so a reader that would start where
 * another reads outside its strings reads as that one does, inside one of its containers: it ends
 * where that container ends, or breaks where the other breaks, and is not needed. Any other reads
 * strings where the other reads between them. So two readers at most run at once, one between
 * strings and one in a string, and they swap at each quote: each character is read once by each,
 * and the text is crossed twice at most.
 */
function* containersIn(text: string): Steps<Containers> {
  const complete: Span[] = []
  const nextOpener = nextOf(text, OPENERS)
  const readers: Readers = { between: null, inString: null }
  /** Where no reader has read outside a string yet. */
  let frontier = 0
  /** The containers open in each reader that broke: what they hold whole is kept at the end. */
  const broken: Array<ReadonlyArray<Opened>> = []
  const broke = (reader: Reader) => {
    broken.push(reader.levels)
  }
  /** The reader outside a string stops at `at`: broken, ended, or gone into a string. */
  const stops = (at: number) => {
    readers.between = null
    frontier = at
  }
  /** A value read whole, from `start` (-1 for a scalar, which no one holds) to `end`. */
  const read = (reader: Reader, start: number, end: number) => {
    const level = reader.levels.at(-1)
    if (level === undefined) {
      complete.push([reader.start, end])
      stops(end)
      return
    }
    if (start !== -1) level.held.push([start, end])
    reader.expected = 'after'
    reader.at = end
  }
  for (;;) {
    if (due()) yield
    const reader = readers.between
    if (reader === null) {
      const opener = nextOpener(frontier)
      if (readers.inString !== null && readers.inString.at <= opener) {
        // Its string ended before any opener: it reads on outside it.
        readers.between = readers.inString
        readers.inString = null
      } else if (opener < text.length) {
        readers.between = { start: opener, levels: [], expected: 'value', at: opener }
      } else return { complete, held: yield* heldIn(broken) }
      continue
    }
    const at = jsonSpace(text, reader.at)
    const first = text.charAt(at)
    const level = reader.levels.at(-1)
    if ((first === '{' || first === '[') && reader.expected === 'value') {
      const closing = first === '{' ? '}' : ']'
      const inside = jsonSpace(text, at + 1)
      if (text.charAt(inside) === closing) read(reader, at, inside + 1)
      else {
        reader.levels.push({ closing, start: at, held: [] })
        reader.expected = closing === '}' ? 'key' : 'value'
        reader.at = at + 1
      }
    } else if (level !== undefined && first === level.closing && reader.expected === 'after') {
      reader.levels.pop()
      read(reader, level.start, at + 1)
    } else if (level !== undefined && first === ',' && reader.expected === 'after') {
      reader.expected = level.closing === '}' ? 'key' : 'value'
      reader.at = at + 1
    } else if (first === ':' && reader.expected === 'colon') {
      reader.expected = 'value'
      reader.at = at + 1
    } else if (first === '"') {
      // The quote ends the string the other reader is in, when one is.
      const other = readers.inString
      readers.inString = null
      const { stop, closed } = stringStop(text, at)
      if (closed && (reader.expected === 'value' || reader.expected === 'key')) {
        level?.held.push([at, stop])
        reader.expected = reader.expected === 'key' ? 'colon' : 'after'
        reader.at = stop
        readers.inString = reader
      } else broke(reader)
      stops(at + 1)
      if (other?.at === at + 1) readers.between = other
      else if (other !== null) broke(other)
    } else if (reader.expected === 'value' && jsonScalarEnd(text, at) !== -1) {
      read(reader, -1, jsonScalarEnd(text, at))
    } else {
      broke(reader)
      stops(at)
    }
  }
}

/**
 * What the shapes and the known values hide in the text outside the JSON values written in it,
 * read as JSON strings: each stretch between two quotes no backslash escapes, or a line end, that
 * holds a backslash is read as a string holds it, and what masking that string hides is hidden
 * where it is written. A string's content is always one such stretch, whatever quote before it
 * was taken to open another: a lone quote in a sentence never makes a string read as text. A
 * string opened and never closed is read up to its line end. This only ever adds.
 */
function* readAsStrings(
  text: string,
  written: ReadonlyArray<Span>,
  known: ReadonlyArray<string>,
): Steps<ReadonlyArray<Span>> {
  const spans: Span[] = []
  const nextBackslash = nextOf(text, BACKSLASHES)
  const nextDelimiter = nextOf(text, DELIMITERS)
  const unescaped = (floor: number, at: number) =>
    text.charAt(at) !== '"' || !escapedAt(text, floor, at)
  let gapStart = 0
  for (let unit = 0; unit <= written.length; unit += 1) {
    const gapEnd = written[unit]?.[0] ?? text.length
    let at = gapStart
    for (let backslash = nextBackslash(at); backslash < gapEnd; backslash = nextBackslash(at)) {
      // The stretch that holds it: from the last delimiter before it, to the next one after it.
      let first = at
      for (let stop = nextDelimiter(at); stop < backslash; stop = nextDelimiter(stop + 1)) {
        if (unescaped(first, stop)) first = stop + 1
      }
      let last = nextDelimiter(backslash)
      while (last < gapEnd && !unescaped(first, last)) last = nextDelimiter(last + 1)
      last = Math.min(last, gapEnd)
      const { read, from } = yield* readBody(text, first, last)
      // With no escape JSON has, it reads as printed: the whole text's masking found all of it.
      const escaped = read.length !== last - first
      if (escaped && !(yield* untouched(read, known))) {
        for (const [start, end] of yield* hiddenSpans(read, known)) {
          spans.push([from[start] ?? first, from[end] ?? last])
        }
      }
      at = last
      if (due()) yield
    }
    gapStart = written[unit]?.[1] ?? text.length
    if (due()) yield
  }
  return yield* merged(spans)
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
  return yield* readBody(text, start + 1, end - 1)
}

/**
 * The text from `first` to `last` read as what a JSON string holds, each character with where it
 * is written: an escape JSON has is read as what it writes, and a backslash that begins none as
 * itself.
 */
function* readBody(text: string, first: number, last: number): Steps<Read> {
  const parts: string[] = []
  const from = new Int32Array(last - first + 1)
  let count = 0
  let at = first
  // A run of characters written as themselves is taken whole, at the next escape or the end.
  let run = at
  while (at < last) {
    from[count] = at
    count += 1
    const letter = text.charAt(at) === '\\' && at + 2 <= last ? text.charAt(at + 1) : ''
    const unicode = letter === 'u' && at + 6 <= last && HEX.test(text.slice(at + 2, at + 6))
    const writes = ESCAPED.get(letter)
    if (unicode) {
      parts.push(
        text.slice(run, at),
        String.fromCharCode(Number.parseInt(text.slice(at + 2, at + 6), 16)),
      )
      at += 6
      run = at
    } else if (writes === undefined) at += 1
    else {
      parts.push(text.slice(run, at), writes)
      at += 2
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
  return maskedString(doneOrMask(() => printedMasked(text, longestFirst(values))))
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
  const allJson = yield* jsonRead(text)
  const { lines, mixed } = allJson ? { lines: [], mixed: false } : yield* jsonLines(text)
  const values: ReadonlyArray<Span> = allJson ? [[0, text.length]] : yield* writtenJson(text, lines)
  const shapes = yield* hiddenSpans(text, known)
  const hidden = allJson ? shapes : yield* union(shapes, yield* readAsStrings(text, values, known))
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
      // Nothing of the whole text's masking here: the string masked as text once read. Written
      // with no escape, it reads as printed, and masking it finds nothing the whole text's
      // masking did not find in it: a shape that would stop at its quotes stops there in the text
      // too, and one that runs past them touches it.
      const plain = text.slice(start + 1, end - 1)
      if (!plain.includes('\\')) return
      const { read } = yield* readString(text, start, end)
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
  // Among lines that are not JSON, a value a hidden stretch covers whole is text: it is hidden
  // whole, as masking the text would hide it.
  const coveredWhole = ([from, to]: Span) =>
    touchingSpans(hidden, from, to).some(([spanFrom, spanTo]) => spanFrom <= from && spanTo >= to)
  const units: Span[] = []
  for (const unit of values) {
    if (!mixed || !coveredWhole(unit)) units.push(unit)
    if (due()) yield
  }
  const nextBackslash = nextOf(text, BACKSLASHES)
  for (const [start, end] of units) {
    // A string that nothing hidden touches and that holds no escape is left as printed: what
    // `maskString` does, without its cost on a text of many small strings.
    const plain = text.charAt(start) === '"' && nextBackslash(start) >= end
    if (!plain || touching(start, end).length > 0) yield* value(start)
    else if (due()) yield
  }
  const outsideJson: Edit[] = []
  for (const [start, end] of yield* outside(hidden, units)) {
    if (text.slice(start, end).trim() !== '') outsideJson.push({ start, end, by: MASK })
    if (due()) yield
  }
  return yield* applied(text, yield* inOrder(edits, outsideJson, (edit) => edit.start))
}

/**
 * Two lists, each in order of where its items start, as one in order: in one pass and in steps,
 * where sorting them together would hold the engine on an output with millions of masks.
 */
function* inOrder<Item>(
  first: ReadonlyArray<Item>,
  second: ReadonlyArray<Item>,
  startOf: (item: Item) => number,
): Steps<ReadonlyArray<Item>> {
  const out: Item[] = []
  let inFirst = 0
  let inSecond = 0
  for (;;) {
    const fromFirst = first[inFirst]
    const fromSecond = second[inSecond]
    const takeFirst =
      fromFirst !== undefined &&
      (fromSecond === undefined || startOf(fromFirst) <= startOf(fromSecond))
    const edit = takeFirst ? fromFirst : fromSecond
    if (edit === undefined) return out
    if (takeFirst) inFirst += 1
    else inSecond += 1
    out.push(edit)
    if (due()) yield
  }
}

/** `Array.isArray` does not narrow a read-only array out of a union: this does. */
const isList = (value: Schema.Json): value is Schema.JsonArray => Array.isArray(value)

/** A masked record as the text a column keeps: its JSON, which holds only masked strings. */
export const maskedJson = (record: Masked<Schema.JsonObject>): Masked<string> =>
  maskedString(JSON.stringify(record))

/** One string masked, knowing the name of the field it stands in. */
type MaskString = (text: string, field: string) => string

/**
 * How many containers one in another a structured value may have, the record itself the first.
 * What lies deeper is masked whole where it begins: no call's arguments nest that far, and a value
 * that is kept must be written and read back by code that recurses, which a stack carries to a few
 * thousand levels only.
 */
export const NESTING_LIMIT = 256

/** The tag of a tagged value names its shape, never a secret: it is kept as it is. */
const TAG = '_tag'

/** A container being masked: what it holds still to visit, and what is masked already. */
interface Level {
  /** The name it stands under in its parent; its items stand in it too when it is a list. */
  readonly into: string
  /** The names of the fields of a record; null for a list. */
  readonly names: ReadonlyArray<string> | null
  readonly items: ReadonlyArray<Schema.Json>
  /** The items done, in order: the next one to visit is at this length. */
  readonly masked: Array<readonly [name: string, item: Schema.Json]>
}

const openLevel = (container: Schema.JsonObject | Schema.JsonArray, into: string): Level => {
  if (isList(container)) return { into, names: null, items: container, masked: [] }
  const entries = Object.entries(container)
  return {
    into,
    names: entries.map(([name]) => name),
    items: entries.map(([, item]) => item),
    masked: [],
  }
}

const closedLevel = (level: Level): Schema.Json =>
  level.names === null ? level.masked.map(([, item]) => item) : Object.fromEntries(level.masked)

/** A value masked, and whether any of it lay beyond `NESTING_LIMIT` and was masked whole. */
interface Walked {
  readonly masked: Schema.JsonObject
  readonly cut: boolean
}

/**
 * A structured value with every string in it masked by `string`, and a field whose name says it is
 * a credential masked whole. The containers open are kept on a stack, not in calls, so no depth of
 * nesting runs out of stack; what lies beyond `NESTING_LIMIT` is masked whole, and `cut` says so.
 */
const walk = (record: Schema.JsonObject, string: MaskString): Walked => {
  let cut = false
  const open: Level[] = [openLevel(record, '')]
  for (;;) {
    const level = open.at(-1)
    if (level === undefined) return { masked: {}, cut: true }
    const at = level.masked.length
    if (at === level.items.length) {
      open.pop()
      const parent = open.at(-1)
      if (parent === undefined) return { masked: Object.fromEntries(level.masked), cut }
      parent.masked.push([level.into, closedLevel(level)])
      continue
    }
    const item = level.items[at] ?? null
    const name = level.names?.[at] ?? level.into
    if (level.names !== null && name === TAG && Predicate.isString(item)) {
      level.masked.push([name, item])
    } else if (CREDENTIAL_FIELD.test(name)) {
      level.masked.push([name, MASK])
    } else if (Predicate.isString(item)) {
      level.masked.push([name, string(item, name)])
    } else if (item === null || Predicate.isNumber(item) || Predicate.isBoolean(item)) {
      level.masked.push([name, item])
    } else if (open.length >= NESTING_LIMIT) {
      cut = true
      level.masked.push([name, MASK])
    } else {
      open.push(openLevel(item, name))
    }
  }
}

/** Every field of a record masked whole: what is kept of a record that could not be read. */
const maskedWhole = (record: Schema.JsonObject): Schema.JsonObject =>
  Object.fromEntries(Object.keys(record).map((name) => [name, MASK]))

/**
 * A structured value with every string in it masked, and a field whose name says it is a
 * credential (`password`, `token`, `secret`, `api_key`, `credential`, `authorization`) masked
 * whole. What lies beyond `NESTING_LIMIT` containers, or whatever cannot be read, is `•••`, and
 * the call it serves never fails.
 */
export function maskRecord(
  record: Schema.JsonObject,
  values: ReadonlyArray<string>,
): Masked<Schema.JsonObject> {
  try {
    const known = longestFirst(values)
    return maskedRecord(walk(record, (text) => doneOrMask(() => textMasked(text, known))).masked)
  } catch {
    return maskedRecord(maskedWhole(record))
  }
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
  try {
    const known = longestFirst(values)
    let lostDestination = false
    const { masked, cut } = walk(action, (text, field) => {
      const destination = DESTINATION_FIELD.test(field)
      if (destination && known.some((value) => text.includes(value))) lostDestination = true
      try {
        return done(textMasked(text, known))
      } catch {
        // A destination that could not be masked is gone whole: the action would be sent in part.
        if (destination) lostDestination = true
        return MASK
      }
    })
    // An action cut where it nests too deep, or that could not be read, is not sent in part.
    return lostDestination || cut ? null : maskedRecord(masked)
  } catch {
    return null
  }
}
