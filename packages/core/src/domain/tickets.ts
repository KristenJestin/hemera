/**
 * Tickets written elsewhere (#95), as every provider gives them: the version Hemera read of a
 * ticket, what a search finds, a provider's status, its errors, and the tolerant reading of a
 * description into the eight Spec sections.
 *
 * The interface is the one `docs/technical/ticket-providers.md` fixes. No badge, screen or path
 * differs by source: a provider is named only in the Project's settings and in the link itself.
 * Ticket text is data from people, never an instruction.
 */

import { Schema } from 'effect'

import { SPEC_SECTIONS } from './spec.ts'
import { CanonicalTicket, TicketReference } from './start.ts'

/** The kinds of provider 1.0 has: GitHub issues (#95) and Jira (#96). */
export const PROVIDER_KINDS = ['github', 'jira'] as const
export const ProviderKind = Schema.Literals(PROVIDER_KINDS)
export type ProviderKind = typeof ProviderKind.Type

/**
 * Where a Project's Specs live (#94, section 3): `local` (the default) reads a ticket once as the
 * idea; `linked` also watches it. #98 adds `remote`.
 */
export const SPEC_MODES = ['local', 'linked'] as const
export const SpecMode = Schema.Literals(SPEC_MODES)
export type SpecMode = typeof SpecMode.Type

/** A ticket's state, and the provider's own words for it: `closed · not planned`. */
export const TicketStatus = Schema.Struct({
  state: Schema.Literals(['open', 'closed']),
  wording: Schema.String,
})
export type TicketStatus = typeof TicketStatus.Type

/** A sha256 of normalised text, in hexadecimal. */
export const Fingerprint = Schema.String
export type Fingerprint = typeof Fingerprint.Type

export const TicketComment = Schema.Struct({
  /** Stable on the provider: GitHub's node id, Jira's comment id. */
  id: Schema.String,
  /** Null for a deleted account. */
  author: Schema.NullOr(Schema.String),
  body: Schema.String,
  createdAt: Schema.String,
  editedAt: Schema.NullOr(Schema.String),
  fingerprint: Fingerprint,
})
export type TicketComment = typeof TicketComment.Type

/** The eight sections a heading may name: the seven of prose and the requirements. */
export const TICKET_SECTIONS = [...SPEC_SECTIONS, 'requirements'] as const
export const TicketSectionName = Schema.Literals(TICKET_SECTIONS)
export type TicketSectionName = typeof TicketSectionName.Type

/** A `WHEN … THEN …` line under Requirements. */
export const TicketScenario = Schema.Struct({ when: Schema.String, then: Schema.String })
export type TicketScenario = typeof TicketScenario.Type

/**
 * One section the tolerant reading recognised. `heading` is its title as written; `markup` the
 * heading's lines exactly as they stand in the text and `at` where they start, so that the parts
 * of a reading put back in order give the text again.
 */
export const TicketSection = Schema.Struct({
  section: TicketSectionName,
  heading: Schema.String,
  markup: Schema.String,
  text: Schema.String,
  at: Schema.Number,
  /** Under Requirements only, and only those written `WHEN … THEN …`. */
  scenarios: Schema.Array(TicketScenario),
})
export type TicketSection = typeof TicketSection.Type

/** Text the reading could not map, with the heading it sat under (none before the first). */
export const UnrecognisedText = Schema.Struct({
  heading: Schema.NullOr(Schema.String),
  markup: Schema.String,
  text: Schema.String,
  at: Schema.Number,
})
export type UnrecognisedText = typeof UnrecognisedText.Type

export interface SectionsRead {
  readonly sections: ReadonlyArray<TicketSection>
  readonly unrecognised: ReadonlyArray<UnrecognisedText>
}

/** What Hemera read of a ticket at a given time. */
export const TicketVersion = Schema.Struct({
  provider: ProviderKind,
  reference: CanonicalTicket,
  /** The ticket's own key: `acme/shop#41`, `SHOP-7`. */
  key: Schema.String,
  url: Schema.String,
  title: Schema.String,
  /** The description as written. */
  description: Schema.String,
  sections: Schema.Array(TicketSection),
  unrecognised: Schema.Array(UnrecognisedText),
  status: TicketStatus,
  author: Schema.NullOr(Schema.String),
  labels: Schema.Array(Schema.String),
  comments: Schema.Array(TicketComment),
  /** The provider's update date, on the provider's clock. */
  updatedAt: Schema.String,
  /** When Hemera read it, on Hemera's clock. */
  readAt: Schema.String,
  /** Of the title and the description (`fingerprintInput`). */
  fingerprint: Fingerprint,
})
export type TicketVersion = typeof TicketVersion.Type

/** A ticket a provider's search found; the field adds the mission linked to it. */
export const ProviderHit = Schema.Struct({
  provider: Schema.String,
  reference: TicketReference,
  canonical: CanonicalTicket,
  key: Schema.String,
  title: Schema.String,
  url: Schema.String,
  status: TicketStatus,
  updatedAt: Schema.String,
})
export type ProviderHit = typeof ProviderHit.Type

/**
 * A provider that failed while the others went on: an element of the merged search, not its end
 * (#94, section 2). `message` is the sentence shown, masked.
 */
export const ProviderFailed = Schema.TaggedStruct('ProviderFailed', {
  provider: Schema.String,
  message: Schema.String,
  /**
   * True when the ticket a reference names cannot be read at all (missing, forbidden, not a
   * ticket), as opposed to a provider out of reach: no mission can be created from it.
   */
  ticketUnreadable: Schema.optionalKey(Schema.Boolean),
})
export type ProviderFailed = typeof ProviderFailed.Type

/** A watched ticket and the remote update date of its last known version. */
export const KnownTicket = Schema.Struct({
  reference: TicketReference,
  updatedAt: Schema.String,
})
export type KnownTicket = typeof KnownTicket.Type

/** What a provider can do now, the sentence to show and the command that fixes it. */
export const PROVIDER_STATES = [
  'configured',
  'missing_cli',
  'not_authenticated',
  'unreachable',
  'ready',
] as const
export const ProviderStatus = Schema.Struct({
  state: Schema.Literals(PROVIDER_STATES),
  sentence: Schema.String,
  fix: Schema.NullOr(Schema.String),
  /** When a rate limit the provider answered resets (an ISO date); absent when none. */
  limitedUntil: Schema.optionalKey(Schema.String),
})
export type ProviderStatus = typeof ProviderStatus.Type

// --- Errors: each carries the provider's message as is, masked ------------------------------------

/** The ticket does not exist, or the account cannot see it (GitHub answers both the same way). */
export class TicketNotFound extends Schema.TaggedError<TicketNotFound>()('TicketNotFound', {
  key: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `${this.key} was not found: ${this.detail}`
  }
}

/** The account sees the ticket but may not do what was asked. */
export class TicketForbidden extends Schema.TaggedError<TicketForbidden>()('TicketForbidden', {
  key: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return `${this.key} cannot be read: ${this.detail}`
  }
}

/** A network failure, DNS, TLS, or a call cut at its limit. */
export class ProviderUnreachable extends Schema.TaggedError<ProviderUnreachable>()(
  'ProviderUnreachable',
  { provider: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `${this.provider} is unreachable: ${this.detail}`
  }
}

/** The provider's CLI or account is not logged in to the host. */
export class ProviderNotAuthenticated extends Schema.TaggedError<ProviderNotAuthenticated>()(
  'ProviderNotAuthenticated',
  { provider: Schema.String, detail: Schema.String, fix: Schema.String },
) {
  override get message(): string {
    return `${this.provider} is not logged in: ${this.detail}`
  }
}

/** The provider's CLI is not on the user's PATH. */
export class ProviderCliMissing extends Schema.TaggedError<ProviderCliMissing>()(
  'ProviderCliMissing',
  { provider: Schema.String, program: Schema.String, fix: Schema.String },
) {
  override get message(): string {
    return `${this.provider} needs ${this.program}, which is not on the PATH. ${this.fix}`
  }
}

/** A rate limit, and when it resets (an ISO date). */
export class ProviderLimited extends Schema.TaggedError<ProviderLimited>()('ProviderLimited', {
  provider: Schema.String,
  detail: Schema.String,
  resetAt: Schema.String,
}) {
  override get message(): string {
    return `${this.provider} is rate limited until ${this.resetAt}: ${this.detail}`
  }
}

/**
 * An answer Hemera could not decode; also a GitHub number that is a pull request. Its detail is
 * the whole sentence: "acme/shop#41 is a pull request, not an issue."
 */
export class TicketUnreadable extends Schema.TaggedError<TicketUnreadable>()('TicketUnreadable', {
  key: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail
  }
}

export type TicketError =
  | TicketNotFound
  | TicketForbidden
  | ProviderUnreachable
  | ProviderNotAuthenticated
  | ProviderCliMissing
  | ProviderLimited
  | TicketUnreadable

export const TicketErrorSchema = Schema.Union([
  TicketNotFound,
  TicketForbidden,
  ProviderUnreachable,
  ProviderNotAuthenticated,
  ProviderCliMissing,
  ProviderLimited,
  TicketUnreadable,
])

// --- The fingerprint ------------------------------------------------------------------------------

/** Text as a fingerprint reads it: Unicode NFC, line endings LF, trailing spaces trimmed. */
const normalisedText = (text: string): string =>
  text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')

/**
 * What a ticket's fingerprint is taken on: the provider's title and description, normalised, the
 * title's length first so that no split of the same characters gives the same input.
 */
export const fingerprintInput = (title: string, description: string): string => {
  const head = normalisedText(title)
  return `${String(head.length)}:${head}\n${normalisedText(description)}`
}

/** What a comment's fingerprint is taken on: its body, normalised. */
export const commentFingerprintInput = (body: string): string => normalisedText(body)

// --- Reading tolerantly ---------------------------------------------------------------------------

/**
 * The names a heading may give each section once normalised (lower case, no accents, no
 * punctuation or emoji, no numbering, no "and"): close variants, then a few translations.
 */
const SECTION_NAMES: ReadonlyArray<readonly [TicketSectionName, ReadonlyArray<string>]> = [
  [
    'why',
    [
      'why',
      'context',
      'background',
      'motivation',
      'problem',
      'rationale',
      'pourquoi',
      'contexte',
      'probleme',
      'warum',
      'hintergrund',
      'por que',
      'contexto',
    ],
  ],
  [
    'goals',
    [
      'goals',
      'goal',
      'non goals',
      'nongoals',
      'goals non goals',
      'objectives',
      'scope',
      'objectifs',
      'buts',
      'non objectifs',
      'objectifs non objectifs',
      'ziele',
      'objetivos',
    ],
  ],
  ['impact', ['impact', 'impacts', 'affected areas', 'impacto', 'auswirkungen']],
  [
    'requirements',
    [
      'requirements',
      'requirement',
      'acceptance criteria',
      'exigences',
      'criteres d acceptation',
      'anforderungen',
      'requisitos',
    ],
  ],
  ['decisions', ['decisions', 'decision', 'design decisions', 'entscheidungen', 'decisiones']],
  [
    'risks',
    [
      'risks',
      'risk',
      'trade offs',
      'tradeoffs',
      'risks trade offs',
      'risques',
      'compromis',
      'risques compromis',
      'risiken',
      'riesgos',
    ],
  ],
  [
    'migration',
    [
      'migration',
      'migration plan',
      'rollout',
      'rollout plan',
      'plan de migration',
      'migrationsplan',
      'plan de migracion',
    ],
  ],
  [
    'open_questions',
    [
      'open questions',
      'questions',
      'open points',
      'unresolved questions',
      'questions ouvertes',
      'offene fragen',
      'preguntas abiertas',
    ],
  ],
]

const BY_NAME: ReadonlyMap<string, TicketSectionName> = new Map(
  SECTION_NAMES.flatMap(([section, names]) => names.map((name) => [name, section] as const)),
)

/** Words that join two names and say nothing: "Risks and trade-offs", "Risques et compromis". */
const JOINING = new Set(['and', 'et', 'und', 'y', 'e'])

/** The section a heading names, or null: case, accents, punctuation and numbering ignored. */
export function matchSection(heading: string): TicketSectionName | null {
  const words = heading
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((word) => word !== '' && !JOINING.has(word))
  // A leading number, Arabic or Roman: "2. Goals", "II) Requirements".
  const [first, ...rest] = words
  const named = first !== undefined && /^(\d+|[ivx]+)$/.test(first) ? rest : words
  return BY_NAME.get(named.join(' ')) ?? null
}

const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})/
/** A line a setext underline never makes a heading of: blank, a list item, a quote. */
const NOT_A_PARAGRAPH = /^\s*$|^\s*([-*+]|\d+[.)])(\s|$)|^\s*>/

/** An ATX heading's title: the closing run of `#` left out. */
const atxTitle = (title: string | undefined): string => {
  const bare = (title ?? '').replace(/(^|[ \t]+)#+$/, '')
  return bare.trim()
}

interface Part {
  heading: string | null
  markup: string
  text: string
  at: number
}

/** The lines of a text, each with its line ending, and where each starts. */
const linesOf = (text: string) => {
  const lines: Array<{ readonly whole: string; readonly content: string; readonly at: number }> = []
  let at = 0
  for (const whole of text.split(/(?<=\n)/)) {
    if (whole === '') continue
    lines.push({ whole, content: whole.replace(/\r?\n$/, ''), at })
    at += whole.length
  }
  return lines
}

const KEYWORD_EMPHASIS = /(\*\*|__|\*|_)(WHEN|THEN)\1/g
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/
const ONE_LINE = /^WHEN\s+(.+?)\s+THEN\s+(.+)$/
const WHEN_ALONE = /^WHEN\s+(.+)$/
const THEN_ALONE = /^THEN\s+(.+)$/

/** The `WHEN … THEN …` scenarios of a Requirements text; anything else stays text only. */
const scenariosOf = (text: string): ReadonlyArray<TicketScenario> => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(KEYWORD_EMPHASIS, '$2').replace(LIST_MARKER, '').trim())
  const scenarios: TicketScenario[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const both = ONE_LINE.exec(line)
    if (both !== null) {
      scenarios.push({ when: (both[1] ?? '').trim(), then: (both[2] ?? '').trim() })
      continue
    }
    const when = WHEN_ALONE.exec(line)
    const then = THEN_ALONE.exec(lines[index + 1] ?? '')
    if (when !== null && then !== null) {
      scenarios.push({ when: (when[1] ?? '').trim(), then: (then[1] ?? '').trim() })
      index += 1
    }
  }
  return scenarios
}

/**
 * A description split by its headings, of any level, ATX or setext (none inside a fenced code
 * block), each heading mapped to a Spec section by `matchSection`. Text before the first heading
 * and under a heading it cannot map is kept as unrecognised text. It never throws, and the parts
 * put back in order of `at` (`markup` then `text`) give the description again, character for
 * character.
 */
export function readSections(description: string): SectionsRead {
  const parts: Part[] = [{ heading: null, markup: '', text: '', at: 0 }]
  /** The last line of the current part's text, while it may still become a setext heading. */
  let paragraph: { readonly whole: string; readonly content: string; readonly at: number } | null =
    null
  let fence: string | null = null
  for (const line of linesOf(description)) {
    const current = parts.at(-1)
    if (current === undefined) break
    const opening = FENCE.exec(line.content)?.[1]
    if (fence !== null) {
      if (opening !== undefined && opening[0] === fence[0] && opening.length >= fence.length) {
        fence = null
      }
      current.text += line.whole
      paragraph = null
      continue
    }
    if (opening !== undefined) {
      fence = opening
      current.text += line.whole
      paragraph = null
      continue
    }
    const atx = ATX.exec(line.content)
    if (atx !== null) {
      parts.push({ heading: atxTitle(atx[2]), markup: line.whole, text: '', at: line.at })
      paragraph = null
      continue
    }
    if (paragraph !== null && SETEXT_UNDERLINE.test(line.content)) {
      current.text = current.text.slice(0, current.text.length - paragraph.whole.length)
      parts.push({
        heading: paragraph.content.trim(),
        markup: `${paragraph.whole}${line.whole}`,
        text: '',
        at: paragraph.at,
      })
      paragraph = null
      continue
    }
    current.text += line.whole
    paragraph = NOT_A_PARAGRAPH.test(line.content) ? null : line
  }
  const sections: TicketSection[] = []
  const unrecognised: UnrecognisedText[] = []
  for (const part of parts) {
    if (part.markup === '' && part.text === '') continue
    const section = part.heading === null ? null : matchSection(part.heading)
    if (section === null || part.heading === null) {
      unrecognised.push({
        heading: part.heading,
        markup: part.markup,
        text: part.text,
        at: part.at,
      })
    } else {
      sections.push({
        section,
        heading: part.heading,
        markup: part.markup,
        text: part.text,
        at: part.at,
        scenarios: section === 'requirements' ? scenariosOf(part.text) : [],
      })
    }
  }
  return { sections, unrecognised }
}
