/**
 * The tester mode (#45): while it is on, every role's agent also tests Hemera, and records what
 * goes wrong on Hemera's side as findings the maintainer reads later. Nothing is sent anywhere.
 *
 * A finding is a Markdown file of its own, a small front matter over a body: the front matter is
 * what a finding is recognised and listed by, the body is what a reader reads, and each report of
 * the same problem appends one occurrence to it. Everything here is text in and text out; the
 * folder, the writes and the masking are the engine's.
 *
 * The agent says the human part (the title, what it tried, what happened, what it expected, the
 * steps, the severity) and Hemera says what it knows itself: its version and system, the agent,
 * the mission (or the Project), the role, the stage, and the call the finding is about.
 */

import { Schema } from 'effect'

/** What a finding is about, in the order the index lists them. */
export const FINDING_KINDS = [
  'hemera_bug',
  'missing_capability',
  'tool_error',
  'permission_decision',
  'mcp',
  'interface',
  'other',
] as const
export type FindingKind = (typeof FINDING_KINDS)[number]

/** How much it gets in the way, worst first. */
export const FINDING_SEVERITIES = ['blocks', 'hurts', 'cosmetic'] as const
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number]

/** What a reader calls each kind. */
export const FINDING_KIND_TITLES: Readonly<Record<FindingKind, string>> = {
  hemera_bug: 'Hemera bug',
  missing_capability: 'Missing capability',
  tool_error: 'Tool error',
  permission_decision: 'Permission decision',
  mcp: 'MCP',
  interface: 'Interface',
  other: 'Other',
}

/** What a reader calls each severity. */
export const FINDING_SEVERITY_TITLES: Readonly<Record<FindingSeverity, string>> = {
  blocks: 'Blocks',
  hurts: 'Hurts',
  cosmetic: 'Cosmetic',
}

/** How many findings one page of `hemera_reports` lists. */
export const FINDINGS_PAGE = 20

/**
 * The paragraph the base layer's tester-mode slot holds while the mode is on, for every role.
 */
export const TESTER_PARAGRAPH = [
  '## Tester mode',
  'You also test Hemera, the application you work inside. When you notice a problem with Hemera',
  "itself, not with the Project's code, report it with `hemera_report`: a Hemera tool that fails or",
  'answers badly, a capability you need and do not have, a delivery that is malformed, a state that',
  'looks wrong, a permission decision that looks wrong, something you expected to receive and did',
  'not. Read `hemera_reports` first: the same problem reported again adds an occurrence to it. Say',
  'what you were trying to do, what happened, what you expected and the steps to reproduce it, and',
  'give the id of the call it is about; Hemera adds the mission, your role, the stage and the call',
  'itself. Give file paths, never file contents. Never mention `hemera_report` or your reports to',
  'the user unless the problem blocks your work.',
].join('\n')

const Text = (description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4000)).annotate({ description })
const Short = (description: string) =>
  Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)).annotate({ description })

/** What the agent says of a problem: the human part of a finding. */
export const ReportedFinding = Schema.Struct({
  title: Short('The problem in one line.'),
  kind: Schema.Literals(FINDING_KINDS).annotate({ description: 'What kind of problem it is.' }),
  place: Short('Where: the tool, the screen or the feature (`fs_edit`, `memory_read`).'),
  severity: Schema.Literals(FINDING_SEVERITIES).annotate({
    description: 'How much it gets in the way: `blocks`, `hurts` or `cosmetic`.',
  }),
  trying: Text('What you were trying to do.'),
  happened: Text('What happened.'),
  expected: Text('What you expected.'),
  steps: Text('The steps to reproduce it, as you understand them.'),
  files: Schema.Array(Short('A path relative to your place: never a file’s content.')).annotate({
    description: 'The files concerned, by their paths only.',
  }),
  callId: Schema.optionalKey(Short('The id of the call it is about, as you know it.')),
  error: Schema.optionalKey(Text('The error text, if one was given.')),
  code: Schema.optionalKey(Short('An exit code or an HTTP status.')),
})
export type ReportedFinding = typeof ReportedFinding.Type

/** A call of the session a finding is about, as the gate recorded it and its thread holds it. */
export interface FindingCall {
  readonly id: string
  readonly tool: string
  /** How it ended: `done`, `refused`, `failed`. */
  readonly outcome: string
  readonly durationMs: number
  /** Its place among the session's calls, from one. */
  readonly position: number
  /** Its line in the session's thread, or the reason it was refused, masked; null when neither. */
  readonly line: string | null
  readonly at: string
}

/** What Hemera knows of one occurrence by itself. */
export interface FindingContext {
  /** When, in ISO with its time zone. */
  readonly at: string
  readonly hemera: {
    readonly version: string
    readonly channel: string
    readonly commit: string | null
    readonly os: string
  }
  readonly agent: {
    readonly name: string
    readonly version: string | null
    readonly model: string | null
    readonly effort: string | null
  }
  /** The mission's key, or the Project's name for a Project's own session. */
  readonly where: string
  readonly role: string
  /** The mission's stage, or null for a Project's own session. */
  readonly stage: string | null
  readonly sessionId: string
  /** The call the finding is about, as the thread holds it; null when it named none. */
  readonly call: FindingCall | null
}

/**
 * The front matter of a finding: what it is recognised and listed by, where it was seen, and the
 * environment of its latest occurrence. Every occurrence keeps its own in the body.
 */
export interface FindingHead {
  readonly number: number
  readonly title: string
  readonly kind: FindingKind
  readonly place: string
  /** The worst it was reported with. */
  readonly severity: FindingSeverity
  readonly occurrences: number
  readonly firstSeen: string
  readonly lastSeen: string
  /** The missions (or Projects) it was seen in, first seen first. */
  readonly missions: ReadonlyArray<string>
  /** The roles it was seen by, first seen first. */
  readonly roles: ReadonlyArray<string>
  readonly version: string
  readonly channel: string
  readonly commit: string | null
  readonly os: string
  readonly agent: string
  readonly agentVersion: string | null
  readonly model: string | null
  readonly effort: string | null
}

/** A finding: its front matter and its body. */
export interface Finding {
  readonly head: FindingHead
  readonly body: string
}

/** Words a title is not recognised by. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'the',
  'an',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'and',
  'or',
  'is',
  'are',
  'it',
  'its',
  'at',
  'by',
  'from',
  'when',
  'as',
  'be',
])

/** The words of a title, as two titles are compared by. */
const wordsOf = (title: string): Set<string> =>
  new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
      // A plural is its singular: "calls" and "call" are one word.
      .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)),
  )

/** How alike two titles are, from 0 to 1: the words they share over the words either has. */
export function titleSimilarity(one: string, other: string): number {
  const left = wordsOf(one)
  const right = wordsOf(other)
  const union = new Set([...left, ...right])
  if (union.size === 0) return 0
  const shared = [...left].filter((word) => right.has(word)).length
  return shared / union.size
}

/** How alike two titles must be for two reports of one kind and one place to be one finding. */
export const SIMILAR_TITLE = 0.5

/** A place as it is compared: its case, its quotes and its spacing do not count. */
const placeOf = (place: string): string =>
  place.toLowerCase().replace(/[`'"]/g, '').replace(/\s+/g, ' ').trim()

/**
 * The finding a report is one more occurrence of, or null for a new one: the same kind, the same
 * place, and the most similar title at `SIMILAR_TITLE` or above, the oldest on a tie.
 */
export function matchingFinding<
  T extends {
    readonly number: number
    readonly kind: FindingKind
    readonly place: string
    readonly title: string
  },
>(
  existing: ReadonlyArray<T>,
  reported: Pick<ReportedFinding, 'kind' | 'place' | 'title'>,
): T | null {
  let best: { finding: T; similarity: number } | null = null
  for (const finding of existing) {
    if (finding.kind !== reported.kind) continue
    if (placeOf(finding.place) !== placeOf(reported.place)) continue
    const similarity = titleSimilarity(finding.title, reported.title)
    if (similarity < SIMILAR_TITLE) continue
    if (
      best === null ||
      similarity > best.similarity ||
      (similarity === best.similarity && finding.number < best.finding.number)
    ) {
      best = { finding, similarity }
    }
  }
  return best?.finding ?? null
}

/** The file a finding is written in: its number, and its title as a slug. */
export function findingFileName(number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return `${String(number).padStart(4, '0')}-${slug === '' ? 'finding' : slug}.md`
}

/** The front matter's keys, in the order they are written, and the head field each holds. */
export const FINDING_HEAD_KEYS = [
  ['number', 'number'],
  ['title', 'title'],
  ['kind', 'kind'],
  ['place', 'place'],
  ['severity', 'severity'],
  ['occurrences', 'occurrences'],
  ['first_seen', 'firstSeen'],
  ['last_seen', 'lastSeen'],
  ['missions', 'missions'],
  ['roles', 'roles'],
  ['version', 'version'],
  ['channel', 'channel'],
  ['commit', 'commit'],
  ['os', 'os'],
  ['agent', 'agent'],
  ['agent_version', 'agentVersion'],
  ['model', 'model'],
  ['effort', 'effort'],
] as const satisfies ReadonlyArray<readonly [string, keyof FindingHead]>

/**
 * A finding as its file: the front matter, one key a line, each value written as JSON (which a
 * YAML reader reads as well), then the body.
 */
export function writeFindingFile(head: FindingHead, body: string): string {
  const lines = FINDING_HEAD_KEYS.map(([key, field]) => `${key}: ${JSON.stringify(head[field])}`)
  return `---\n${lines.join('\n')}\n---\n${body}`
}

/** A text as one fenced block, whatever fences it holds itself. */
const fenced = (text: string): string => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}text\n${text}\n${fence}`
}

/** A text in inline code, whatever backticks it holds. */
const code = (text: string): string => {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length))
  const ticks = '`'.repeat(longest + 1)
  return longest === 0 ? `${ticks}${text}${ticks}` : `${ticks} ${text} ${ticks}`
}

/** The parts of a list that are known, joined as one line reads them. */
const joined = (parts: ReadonlyArray<string | null>): string =>
  parts.filter((part): part is string => part !== null && part !== '').join(' · ')

/** The head of a finding as the environment of one occurrence says it. */
const environmentOf = (context: FindingContext) => ({
  version: context.hemera.version,
  channel: context.hemera.channel,
  commit: context.hemera.commit,
  os: context.hemera.os,
  agent: context.agent.name,
  agentVersion: context.agent.version,
  model: context.agent.model,
  effort: context.agent.effort,
})

/** The human part of a report, as the sections of the top of a finding say it. */
const HUMAN_PARTS = [
  ['trying', 'Trying to'],
  ['happened', 'What happened'],
  ['expected', 'Expected'],
  ['steps', 'Steps to reproduce'],
] as const

/** One occurrence as its section says it: every fact Hemera knows, then what differs. */
const occurrenceSection = (
  number: number,
  reported: ReportedFinding,
  context: FindingContext,
  first: ReportedFinding | null,
): string => {
  const { hemera, agent, call } = context
  const lines = [
    `### Occurrence ${String(number)} · ${context.at}`,
    '',
    `- Severity: ${FINDING_SEVERITY_TITLES[reported.severity]}`,
    `- Hemera: ${joined([hemera.version, hemera.channel, hemera.commit === null ? null : `commit ${hemera.commit}`, hemera.os])}`,
    `- Agent: ${joined([agent.version === null ? agent.name : `${agent.name} ${agent.version}`, agent.model === null ? null : `model ${agent.model}`, agent.effort === null ? null : `effort ${agent.effort}`])}`,
    `- Where: ${joined([context.where, `role ${context.role}`, context.stage === null ? null : `stage ${context.stage}`])}`,
    `- Session: ${code(context.sessionId)}`,
  ]
  if (reported.files.length > 0) lines.push(`- Files: ${reported.files.map(code).join(', ')}`)
  if (call !== null) {
    lines.push(
      `- Call: ${joined([`${code(call.tool)} ${code(call.id)}`, call.outcome, `${String(call.durationMs)} ms`, `call ${String(call.position)} of the session`, call.at])}`,
    )
    if (call.line !== null) lines.push(`  - ${call.line}`)
  } else if (reported.callId !== undefined) {
    lines.push(`- Call: ${code(reported.callId)}, not found among the session's calls`)
  }
  if (reported.code !== undefined) lines.push(`- Code: ${reported.code}`)
  // The first occurrence's story is the top of the file; a later one says only what differs.
  if (first !== null) {
    for (const [field, title] of HUMAN_PARTS) {
      if (reported[field] !== first[field]) lines.push('', `${title}:`, '', reported[field])
    }
  }
  if (reported.error !== undefined) lines.push('', 'Error:', '', fenced(reported.error))
  return `${lines.join('\n')}\n`
}

/** The worse of two severities. */
const worse = (one: FindingSeverity, other: FindingSeverity): FindingSeverity =>
  FINDING_SEVERITIES.indexOf(one) <= FINDING_SEVERITIES.indexOf(other) ? one : other

/** A list with one more item at its end, unless it holds it already. */
const withOne = (list: ReadonlyArray<string>, item: string): ReadonlyArray<string> =>
  list.includes(item) ? list : [...list, item]

/** The first report of a problem, as a finding. */
export function newFinding(
  number: number,
  reported: ReportedFinding,
  context: FindingContext,
): Finding {
  const top = [
    `# #${String(number)} ${reported.title}`,
    '',
    `${FINDING_KIND_TITLES[reported.kind]} · ${FINDING_SEVERITY_TITLES[reported.severity]} · ${code(reported.place)}`,
    ...HUMAN_PARTS.flatMap(([field, title]) => ['', `## ${title}`, '', reported[field]]),
    '',
    '## Occurrences',
    '',
  ].join('\n')
  return {
    head: {
      number,
      title: reported.title,
      kind: reported.kind,
      place: reported.place,
      severity: reported.severity,
      occurrences: 1,
      firstSeen: context.at,
      lastSeen: context.at,
      missions: [context.where],
      roles: [context.role],
      ...environmentOf(context),
    },
    body: `${top}\n${occurrenceSection(1, reported, context, null)}`,
  }
}

/** The first report's human part, read back from the top of a finding's body. */
const firstReportOf = (finding: Finding): ReportedFinding => {
  const sections = new Map<string, string>()
  const body = finding.body.split('\n## Occurrences\n')[0] ?? ''
  for (const [field, title] of HUMAN_PARTS) {
    const start = body.indexOf(`\n## ${title}\n\n`)
    if (start < 0) continue
    const from = start + `\n## ${title}\n\n`.length
    const next = body.indexOf('\n\n## ', from)
    sections.set(field, body.slice(from, next < 0 ? undefined : next).replace(/\n+$/, ''))
  }
  return {
    title: finding.head.title,
    kind: finding.head.kind,
    place: finding.head.place,
    severity: finding.head.severity,
    trying: sections.get('trying') ?? '',
    happened: sections.get('happened') ?? '',
    expected: sections.get('expected') ?? '',
    steps: sections.get('steps') ?? '',
    files: [],
  }
}

/**
 * One more occurrence of a finding: a section appended to its body, the count, the last seen,
 * the mission and the role if new ones, the worst severity, and this occurrence's environment.
 */
export function recordOccurrence(
  finding: Finding,
  reported: ReportedFinding,
  context: FindingContext,
): Finding {
  const { head } = finding
  const occurrences = head.occurrences + 1
  const section = occurrenceSection(occurrences, reported, context, firstReportOf(finding))
  return {
    head: {
      ...head,
      severity: worse(head.severity, reported.severity),
      occurrences,
      lastSeen: context.at,
      missions: withOne(head.missions, context.where),
      roles: withOne(head.roles, context.role),
      ...environmentOf(context),
    },
    body: `${finding.body.replace(/\n*$/, '\n')}\n${section}`,
  }
}

/** A text as one cell of a Markdown table. */
const cell = (text: string): string => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')

/**
 * The index of the findings, `README.md` of the folder: a count, then one section per kind and one
 * table per severity under it, the latest seen first, each finding linking its file.
 */
export function findingsIndex(
  findings: ReadonlyArray<{ readonly head: FindingHead; readonly file: string }>,
): string {
  const occurrences = findings.reduce((sum, one) => sum + one.head.occurrences, 0)
  const lines = ['# Hemera tester findings', '']
  if (findings.length === 0) return `${[...lines, 'No finding yet.'].join('\n')}\n`
  lines.push(
    `${String(findings.length)} ${findings.length === 1 ? 'finding' : 'findings'} · ${String(occurrences)} ${occurrences === 1 ? 'occurrence' : 'occurrences'}`,
  )
  for (const kind of FINDING_KINDS) {
    const ofKind = findings.filter((one) => one.head.kind === kind)
    if (ofKind.length === 0) continue
    lines.push('', `## ${FINDING_KIND_TITLES[kind]}`)
    for (const severity of FINDING_SEVERITIES) {
      const rows = ofKind
        .filter((one) => one.head.severity === severity)
        .toSorted((one, other) => (one.head.lastSeen < other.head.lastSeen ? 1 : -1))
      if (rows.length === 0) continue
      lines.push(
        '',
        `### ${FINDING_SEVERITY_TITLES[severity]}`,
        '',
        '| # | Title | Where | Seen | Last seen |',
        '| --- | --- | --- | --- | --- |',
        ...rows.map(
          ({ head, file }) =>
            `| [#${String(head.number)}](findings/${file}) | ${cell(head.title)} | ${cell(code(head.place))} | ${String(head.occurrences)} | ${cell(head.lastSeen)} |`,
        ),
      )
    }
  }
  return `${lines.join('\n')}\n`
}
