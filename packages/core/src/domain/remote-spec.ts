/**
 * A remote Spec (#98): the text Hemera writes into a ticket's description when the Project's Spec
 * mode is `remote`. It is the eight sections of the frozen Spec under their English names (the
 * product's terms), their content in the Spec language as the Planner wrote it, the requirements
 * with their delta and their `WHEN … THEN …` scenarios; and nothing else: no Proof block, no task,
 * no Memory, no status, no link, no id of Hemera's beyond the requirement and scenario labels.
 *
 * Three targets: Markdown for a GitHub issue, Atlassian Document Format for Jira Cloud and wiki
 * markup for Jira Data Center. Each is written so that #95's `readSections`, after #96's
 * converters, reads back the eight sections and every scenario: a heading the Planner wrote inside
 * a section is written as a bold line, never as a heading of its own, and a scenario is a nested
 * list (its label, then its `WHEN` and its `THEN`), which renders as such on both trackers.
 *
 * The ADF and the wiki markup carry the Planner's Markdown as text: its paragraphs, line breaks
 * and code blocks keep their shape, its inline marks show as they were typed. In wiki markup the
 * characters that open a macro, a link, a mention or an embed are escaped, and code is a
 * `{noformat}` block.
 */

import { Schema } from 'effect'

import { adfToMarkdown, wikiToMarkdown } from './jira.ts'
import { SECTION_TITLES, SPEC_SECTIONS, type SpecText } from './spec.ts'

/** Where a remote Spec is written: a GitHub issue, Jira Cloud, Jira Data Center. */
export const REMOTE_SPEC_TARGETS = ['markdown', 'adf', 'wiki'] as const
export const RemoteSpecTarget = Schema.Literals(REMOTE_SPEC_TARGETS)
export type RemoteSpecTarget = typeof RemoteSpecTarget.Type

/**
 * The longest description each tracker accepts, in characters: a GitHub issue body, a Jira
 * description (Cloud and Data Center).
 */
export const REMOTE_SPEC_LIMITS = { github: 65_536, jira: 32_767 } as const

/** Where the requirements sit among the sections: after the impact. */
const REQUIREMENTS_AFTER = 'impact'

/** The parts of a remote Spec, before a target writes them. */
type Block =
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'paragraph'; readonly lines: ReadonlyArray<string> }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'code'; readonly language: string; readonly lines: ReadonlyArray<string> }
  | {
      readonly kind: 'scenarios'
      readonly items: ReadonlyArray<{
        readonly label: string
        readonly when: string
        readonly then: string
      }>
    }

const ATX = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*$/
const UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** A run of text on one line: what a scenario's `WHEN` or `THEN` is written as. */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * The Planner's Markdown as blocks: paragraphs split on blank lines, fenced code kept whole (closed
 * when it was left open), a heading made a bold line, and a setext underline made a paragraph of
 * its own, so that nothing inside a section reads as a heading.
 */
const bodyBlocks = (body: string): ReadonlyArray<Block> => {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let code: { fence: string; language: string; lines: string[] } | null = null
  const flush = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', lines: paragraph })
    paragraph = []
  }
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (code !== null) {
      const closing = FENCE.exec(line)
      if (
        closing !== null &&
        (closing[1] ?? '')[0] === code.fence[0] &&
        (closing[1] ?? '').length >= code.fence.length &&
        (closing[2] ?? '').trim() === ''
      ) {
        blocks.push({ kind: 'code', language: code.language, lines: code.lines })
        code = null
      } else {
        code.lines.push(line)
      }
      continue
    }
    const opening = FENCE.exec(line)
    if (opening !== null) {
      flush()
      code = { fence: opening[1] ?? '```', language: (opening[2] ?? '').trim(), lines: [] }
      continue
    }
    if (line.trim() === '') {
      flush()
      continue
    }
    const heading = ATX.exec(line)
    if (heading !== null) {
      flush()
      const title = (heading[1] ?? '').replace(/(^|[ \t]+)#+$/, '').trim()
      if (title !== '') blocks.push({ kind: 'strong', text: title })
      continue
    }
    if (UNDERLINE.test(line)) {
      flush()
      blocks.push({ kind: 'paragraph', lines: [line.trim()] })
      continue
    }
    paragraph.push(line.replace(/[ \t]+$/, ''))
  }
  flush()
  if (code !== null) blocks.push({ kind: 'code', language: code.language, lines: code.lines })
  return blocks
}

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** The requirements: each its label, delta and domain in bold, its text, then its scenarios. */
const requirementBlocks = (
  spec: SpecText,
  mask: (text: string) => string,
): ReadonlyArray<Block> => {
  const blocks: Block[] = []
  for (const requirement of spec.requirements) {
    if (requirement.removed) continue
    blocks.push({
      kind: 'strong',
      text: [requirement.id, capitalised(requirement.delta), mask(requirement.domain)].join(' · '),
    })
    blocks.push(...bodyBlocks(mask(requirement.text)))
    if (requirement.scenarios.length === 0) continue
    blocks.push({
      kind: 'scenarios',
      items: requirement.scenarios.map((scenario) => ({
        label: scenario.id,
        when: oneLine(mask(scenario.when)),
        then: oneLine(mask(scenario.then)),
      })),
    })
  }
  return blocks
}

/** The remote Spec as blocks: the eight sections in order, each under its English name. */
const specBlocks = (spec: SpecText, mask: (text: string) => string): ReadonlyArray<Block> => {
  const blocks: Block[] = []
  for (const name of SPEC_SECTIONS) {
    const body = spec.sections.find((one) => one.name === name)?.body ?? ''
    blocks.push({ kind: 'heading', text: SECTION_TITLES[name] })
    blocks.push(...bodyBlocks(mask(body)))
    if (name !== REQUIREMENTS_AFTER) continue
    blocks.push({ kind: 'heading', text: 'Requirements' })
    blocks.push(...requirementBlocks(spec, mask))
  }
  return blocks
}

// --- Markdown -------------------------------------------------------------------------------------

/** A fence longer than any run of backticks inside the code. */
const fenceFor = (lines: ReadonlyArray<string>): string => {
  const runs = lines.flatMap((line) => (line.match(/`+/g) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(2, ...runs) + 1)
}

/**
 * The zero-width joiner written after a `@` or a `#` GitHub would read as a mention or an issue
 * reference (`@ada`, `#12`, `acme/shop#12`): it shows nothing, and a write of Hemera's never
 * notifies anyone nor links an issue to the ticket. `readSections` leaves it out of a scenario.
 */
const NEUTRALISER = '\u200d'

/**
 * Text outside code as GitHub reads it as text: mentions and issue references neutralised, `<` and
 * `>` as entities (no HTML, no comment hiding text), a quote's leading `>` kept.
 */
const githubText = (text: string): string =>
  text
    .replace(/@(?=[\p{L}\p{N}_-])/gu, `@${NEUTRALISER}`)
    .replace(/#(?=\d)/g, `#${NEUTRALISER}`)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

/** A line of the Planner's Markdown, its code spans as they are. */
const githubLine = (line: string): string => {
  const quote = /^ {0,3}(?:> ?)*/.exec(line)?.[0] ?? ''
  return `${quote}${line
    .slice(quote.length)
    .split(/(`[^`]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : githubText(part)))
    .join('')}`
}

/** Text Hemera sets in bold or after a bold keyword: its stars and underscores never close it. */
const plainMarkdown = (text: string): string => githubText(text.replace(/[\\*_]/g, '\\$&'))

const markdownOf = (block: Block): string => {
  switch (block.kind) {
    case 'heading':
      return `## ${block.text}`
    case 'paragraph':
      return block.lines.map(githubLine).join('\n')
    case 'strong':
      return `**${plainMarkdown(block.text)}**`
    case 'code': {
      const fence = fenceFor(block.lines)
      return [`${fence}${block.language}`, ...block.lines, fence].join('\n')
    }
    case 'scenarios':
      return block.items
        .map((item) =>
          [
            `- **${plainMarkdown(item.label)}**`,
            `  - **WHEN** ${plainMarkdown(item.when)}`,
            `  - **THEN** ${plainMarkdown(item.then)}`,
          ].join('\n'),
        )
        .join('\n')
  }
}

// --- Atlassian Document Format --------------------------------------------------------------------

const textNode = (text: string, strong = false): Schema.JsonObject =>
  strong ? { type: 'text', text, marks: [{ type: 'strong' }] } : { type: 'text', text }

/** A paragraph of nodes; an empty text is no node at all, as ADF wants. */
const paragraphOf = (content: ReadonlyArray<Schema.JsonObject>): Schema.JsonObject => ({
  type: 'paragraph',
  content: [...content],
})

const listOf = (items: ReadonlyArray<ReadonlyArray<Schema.JsonObject>>): Schema.JsonObject => ({
  type: 'bulletList',
  content: items.map((content) => ({ type: 'listItem', content: [...content] })),
})

const keyword = (word: string, text: string): ReadonlyArray<Schema.JsonObject> => [
  paragraphOf([textNode(word, true), ...(text === '' ? [] : [textNode(` ${text}`)])]),
]

const adfOf = (block: Block): Schema.JsonObject => {
  switch (block.kind) {
    case 'heading':
      return { type: 'heading', attrs: { level: 2 }, content: [textNode(block.text)] }
    case 'paragraph':
      return paragraphOf(
        block.lines.flatMap((line, index) => [
          ...(index === 0 ? [] : [{ type: 'hardBreak' }]),
          ...(line === '' ? [] : [textNode(line)]),
        ]),
      )
    case 'strong':
      return paragraphOf([textNode(block.text, true)])
    case 'code': {
      const text = block.lines.join('\n')
      const content = text === '' ? [] : [textNode(text)]
      return block.language === ''
        ? { type: 'codeBlock', content }
        : { type: 'codeBlock', attrs: { language: block.language }, content }
    }
    case 'scenarios':
      return listOf(
        block.items.map((item) => [
          paragraphOf([textNode(item.label, true)]),
          listOf([keyword('WHEN', item.when), keyword('THEN', item.then)]),
        ]),
      )
  }
}

// --- Wiki markup ----------------------------------------------------------------------------------

/** A line wiki markup would read as a heading or a quote: kept as text. */
const WIKI_MARKUP = /^\s*(h[1-6]\.\s|bq\.\s)/

/**
 * Text as wiki markup reads it as text: every `{` (a macro: `{code}`, `{quote}`), `[` (a link or a
 * mention: `[~user]`), `!` (an embed: `!http://…!`), `~` (a subscript, or a mention inside
 * brackets) and `|` (a table cell) escaped, so nothing the Planner wrote can open a block, mention
 * someone, embed an image or break the document.
 */
const wikiText = (text: string): string => text.replace(/[{[!~|]/g, '\\$&')

const wikiLine = (line: string): string => {
  const text = wikiText(line)
  return WIKI_MARKUP.test(text) ? `\\${text}` : text
}

/**
 * A line of code inside `{noformat}`, which ends at the first `{noformat}` anywhere: a zero-width
 * space after its brace keeps it from closing the block, and escapes do not apply in there.
 */
const noformatLine = (line: string): string => line.replace(/\{(?=noformat)/gi, '{\u200b')

const wikiOf = (block: Block): string => {
  switch (block.kind) {
    case 'heading':
      return `h2. ${block.text}`
    case 'paragraph':
      return block.lines.map(wikiLine).join('\n')
    case 'strong':
      return `*${wikiLine(block.text)}*`
    case 'code':
      // `{noformat}` rather than `{code}`: its text is never highlighted nor read as anything.
      return ['{noformat}', ...block.lines.map(noformatLine), '{noformat}'].join('\n')
    case 'scenarios':
      return block.items
        .map((item) =>
          [
            `* *${wikiText(item.label)}*`,
            `** *WHEN* ${wikiText(item.when)}`,
            `** *THEN* ${wikiText(item.then)}`,
          ].join('\n'),
        )
        .join('\n')
  }
}

/**
 * The remote Spec of a Spec, for a target: Markdown and wiki markup as text, ADF as its JSON. The
 * known secret values are masked by `mask` before anything is rendered.
 */
export function renderRemoteSpec(
  spec: SpecText,
  target: RemoteSpecTarget,
  mask: (text: string) => string = (text) => text,
): string {
  const blocks = specBlocks(spec, mask)
  switch (target) {
    case 'markdown':
      return `${blocks.map(markdownOf).join('\n\n')}\n`
    case 'adf':
      return JSON.stringify({ type: 'doc', version: 1, content: blocks.map(adfOf) })
    case 'wiki':
      return `${blocks.map(wikiOf).join('\n\n')}\n`
  }
}

const readAdf = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))

/**
 * A rendered remote Spec as the provider reads it back into a ticket's description: Markdown as
 * it is, ADF and wiki markup through #96's converters.
 */
export function remoteSpecReadBack(rendered: string, target: RemoteSpecTarget): string {
  switch (target) {
    case 'markdown':
      return rendered
    case 'adf':
      return adfToMarkdown(readAdf(rendered))
    case 'wiki':
      return wikiToMarkdown(rendered)
  }
}

/**
 * Whether a rendered remote Spec is longer than the tracker's limit, in characters, measured on
 * what is sent: ADF as its JSON, longer than the text it shows, so a Spec never reaches a limit
 * Jira would count otherwise.
 */
export const remoteSpecTooLong = (rendered: string, limit: number): boolean =>
  [...rendered].length > limit
