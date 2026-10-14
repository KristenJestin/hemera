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

import { Brand, Predicate, Schema } from 'effect'

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

/** Text with its edits made; they are in order and do not overlap. */
const applied = (text: string, edits: ReadonlyArray<Edit>): string => {
  let out = ''
  let from = 0
  for (const edit of edits) {
    out += text.slice(from, edit.start) + edit.by
    from = edit.end
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

/** What one shape replaces in a text. */
const shapeEdits = (text: string, [pattern, by]: Shape): ReadonlyArray<Edit> => {
  // `exec` on the shape's own pattern: `matchAll` copies the pattern at each call, and this runs
  // for every string of a JSON answer.
  const edits: Edit[] = []
  pattern.lastIndex = 0
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      by: by(match.slice(1).map((group) => group ?? '')),
    })
  }
  return edits
}

/** Credentials recognised by their shape, masked without knowing their value. */
export function maskShapes(text: string): string {
  return SHAPES.reduce((masked, shape) => applied(masked, shapeEdits(masked, shape)), text)
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
const knownSpans = (text: string, known: ReadonlyArray<string>): ReadonlyArray<Span> => {
  const spans: Span[] = []
  for (const value of known) {
    for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + 1)) {
      spans.push([at, at + value.length])
    }
  }
  return merged(spans)
}

/** Spans in order, those that overlap or touch made one. */
const merged = (spans: ReadonlyArray<Span>): ReadonlyArray<Span> => {
  const out: Span[] = []
  for (const [start, end] of spans.toSorted((a, b) => a[0] - b[0])) {
    const last = out.at(-1)
    if (last !== undefined && start <= last[1])
      out[out.length - 1] = [last[0], Math.max(last[1], end)]
    else out.push([start, end])
  }
  return out
}

const maskKnown = (text: string, known: ReadonlyArray<string>): string =>
  applied(
    text,
    knownSpans(text, known).map(([start, end]) => ({ start, end, by: MASK })),
  )

const maskedString = Brand.nominal<Masked<string>>()
const maskedRecord = Brand.nominal<Masked<Schema.JsonObject>>()

/** Text with its known values masked, then the shapes of credentials. */
export function maskText(text: string, values: ReadonlyArray<string>): Masked<string> {
  return maskedString(maskShapes(maskKnown(text, longestFirst(values))))
}

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
const edited = (pieces: ReadonlyArray<Piece>, edits: ReadonlyArray<Edit>): ReadonlyArray<Piece> => {
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
const hiddenSpans = (text: string, known: ReadonlyArray<string>): ReadonlyArray<Span> => {
  let current = text
  let pieces: ReadonlyArray<Piece> = [
    { length: text.length, from: 0, to: text.length, copied: true },
  ]
  const make = (edits: ReadonlyArray<Edit>) => {
    pieces = edited(pieces, edits)
    current = applied(current, edits)
  }
  make(knownSpans(text, known).map(([start, end]) => ({ start, end, by: MASK })))
  for (const shape of SHAPES) {
    make(
      shapeEdits(current, shape)
        .map((edit) => narrowed(current, edit))
        .filter((edit) => edit.end > edit.start),
    )
  }
  return merged(pieces.filter((piece) => !piece.copied).map((piece) => [piece.from, piece.to]))
}

/**
 * Whether a text is JSON. Only whether: a decoder would build a report of each failure, and most
 * lines of a text are not JSON.
 */
const isJson = (text: string): boolean => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** How a line that is JSON begins: a line that does not is not read as JSON at all. */
const JSON_FIRST = /^\s*[[{"\-\d]|^\s*(?:true|false|null)\b/

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
const jsonLines = (text: string, hidden: ReadonlyArray<Span>): ReadonlyArray<Span> => {
  const lines: Span[] = []
  let mixed = false
  let start = 0
  for (const line of text.split('\n')) {
    if (line.trim() !== '') {
      if (JSON_FIRST.test(line) && isJson(line)) {
        lines.push([start, start + line.length])
      } else mixed = true
    }
    start += line.length + 1
  }
  const coveredWhole = ([from, to]: Span) =>
    touchingSpans(hidden, from, to).some(([spanFrom, spanTo]) => spanFrom <= from && spanTo >= to)
  return mixed ? lines.filter((line) => !coveredWhole(line)) : lines
}

/** The parts of the spans outside the units. Both are in order, and the units do not overlap. */
const outside = (spans: ReadonlyArray<Span>, units: ReadonlyArray<Span>): ReadonlyArray<Span> => {
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
  }
  return parts
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

/** A JSON string of the text, character by character, each with the stretch that writes it. */
const readString = (
  text: string,
  start: number,
  end: number,
): ReadonlyArray<readonly [character: string, from: number, to: number]> => {
  const characters: Array<readonly [string, number, number]> = []
  let at = start + 1
  while (at < end - 1) {
    if (text.charAt(at) !== '\\') {
      characters.push([text.charAt(at), at, at + 1])
      at += 1
    } else if (text.charAt(at + 1) === 'u') {
      const code = Number.parseInt(text.slice(at + 2, at + 6), 16)
      characters.push([String.fromCharCode(code), at, at + 6])
      at += 6
    } else {
      characters.push([ESCAPED.get(text.charAt(at + 1)) ?? '', at, at + 2])
      at += 2
    }
  }
  return characters
}

/** What the characters of a JSON string read. */
const textOf = (characters: ReadonlyArray<readonly [string, number, number]>): string =>
  characters.map(([character]) => character).join('')

const QUOTED_MASK = JSON.stringify(MASK)
const JSON_SPACE = ' \t\n\r'

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
  const known = longestFirst(values)
  const hidden = hiddenSpans(text, known)
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
   * A string masked: whole where a hidden stretch runs past its quotes; otherwise read, the
   * characters the hidden stretches write masked, then masked as text.
   */
  const maskString = (start: number, end: number) => {
    const spans = touching(start, end)
    if (spans.some(([from, to]) => from <= start || to >= end)) {
      edits.push({ start, end, by: QUOTED_MASK })
      return
    }
    if (spans.length === 0) {
      // Nothing of the whole text's masking here: the string masked as text once read.
      const plain = text.slice(start + 1, end - 1)
      const read = plain.includes('\\') ? textOf(readString(text, start, end)) : plain
      const masked = maskShapes(maskKnown(read, known))
      if (masked !== read) edits.push({ start, end, by: JSON.stringify(masked) })
      return
    }
    const characters = readString(text, start, end)
    const read = textOf(characters)
    const marked: Span[] = []
    let at = 0
    // The spans are in order and apart, as the characters: one index moves forward through them.
    let next = 0
    for (const [character, from, to] of characters) {
      while ((spans[next]?.[1] ?? Number.POSITIVE_INFINITY) <= from) next += 1
      if ((spans[next]?.[0] ?? Number.POSITIVE_INFINITY) < to) {
        marked.push([at, at + character.length])
      }
      at += character.length
    }
    const masked = applied(
      read,
      merged([...marked, ...hiddenSpans(read, known)]).map(([from, to]) => ({
        start: from,
        end: to,
        by: MASK,
      })),
    )
    if (masked !== read) edits.push({ start, end, by: JSON.stringify(masked) })
  }
  /** Masks the JSON value at `at`, standing in `field`, unless quiet; says where it ends. */
  const value = (at: number, field: string, quiet: boolean): number => {
    const start = space(at)
    const first = text.charAt(start)
    if (!quiet && CREDENTIAL_FIELD.test(field)) {
      const end = value(start, '', true)
      edits.push({ start, end, by: QUOTED_MASK })
      return end
    }
    if (first === '{' || first === '[') {
      const closing = first === '{' ? '}' : ']'
      let next = space(start + 1)
      if (text.charAt(next) === closing) return next + 1
      for (;;) {
        let name = field
        if (first === '{') {
          const keyEnd = stringEnd(next)
          if (!quiet) maskString(next, keyEnd)
          name = textOf(readString(text, next, keyEnd))
          next = space(keyEnd) + 1
        }
        next = space(value(next, name, quiet))
        if (text.charAt(next) !== ',') return next + 1
        next = space(next + 1)
      }
    }
    if (first === '"') {
      const end = stringEnd(start)
      if (!quiet) maskString(start, end)
      return end
    }
    const end = tokenEnd(start)
    if (!quiet && touching(start, end).length > 0) edits.push({ start, end, by: QUOTED_MASK })
    return end
  }
  const units: ReadonlyArray<Span> = isJson(text) ? [[0, text.length]] : jsonLines(text, hidden)
  for (const [start] of units) value(start, '', false)
  for (const [start, end] of outside(hidden, units)) {
    if (text.slice(start, end).trim() !== '') edits.push({ start, end, by: MASK })
  }
  return maskedString(
    applied(
      text,
      edits.toSorted((a, b) => a.start - b.start),
    ),
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
  return maskedRecord(visitFields(record, (text) => maskShapes(maskKnown(text, known))))
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
