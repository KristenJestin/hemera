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
    String.raw`\bAKIA[0-9A-Z]{16}`,
    String.raw`\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`,
  ].join('|'),
  'g',
)

/** The password in a URL's user information; the scheme, the user and the host stay. */
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi

/**
 * A credential given a value in text, by name: `password=…`, `token: …`, `api_key=…`, and the
 * names built on them (`DB_PASSWORD`, `AWS_SECRET_ACCESS_KEY`, `SECRET_KEY`). A plural
 * (`max_tokens`) is not one.
 */
const LABELLED_CREDENTIAL = new RegExp(
  String.raw`\b([A-Za-z0-9_-]*?(?:api[_-]?key|password|passwd|secret|token|credential)(?:[_-][A-Za-z0-9_-]*)?)(["']?\s*[:=]\s*)(?:${QUOTED_OR_BARE}|[^\s"']+)`,
  'gi',
)

/** Credentials recognised by their shape, masked without knowing their value. */
export function maskShapes(text: string): string {
  return text
    .replace(PRIVATE_KEY, MASK)
    .replace(
      CREDENTIAL_HEADER,
      (_, name: string, separator: string) => `${name}${separator}${MASK}`,
    )
    .replace(BEARER, (_, scheme: string) => `${scheme} ${MASK}`)
    .replace(BASIC, (_, scheme: string) => `${scheme} ${MASK}`)
    .replace(PREFIXED_TOKEN, MASK)
    .replace(URL_PASSWORD, (_, before: string) => `${before}${MASK}@`)
    .replace(
      LABELLED_CREDENTIAL,
      (_, label: string, separator: string) => `${label}${separator}${MASK}`,
    )
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
const maskKnown = (text: string, known: ReadonlyArray<string>): string => {
  const spans: Array<readonly [number, number]> = []
  for (const value of known) {
    for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + 1)) {
      spans.push([at, at + value.length])
    }
  }
  if (spans.length === 0) return text
  spans.sort((a, b) => a[0] - b[0])
  let masked = ''
  let from = 0
  let end = -1
  for (const [start, stop] of spans) {
    if (start > end) {
      if (end !== -1) masked += MASK
      masked += text.slice(from, start)
    }
    end = Math.max(end, stop)
    from = end
  }
  return `${masked}${MASK}${text.slice(from)}`
}

const maskedString = Brand.nominal<Masked<string>>()
const maskedRecord = Brand.nominal<Masked<Schema.JsonObject>>()

/** Text with its known values masked, then the shapes of credentials. */
export function maskText(text: string, values: ReadonlyArray<string>): Masked<string> {
  return maskedString(maskShapes(maskKnown(text, longestFirst(values))))
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
