/**
 * Jira's text, read tolerantly (#96): Cloud's Atlassian Document Format (ADF) and Data Center's
 * wiki markup turned into Markdown, so that a Jira description goes through `readSections` exactly
 * as a GitHub one does; the JQL string a search text goes into; the document a Cloud fingerprint
 * is taken on; and Jira's dates read as instants.
 *
 * The converters never throw and keep every text: a node or a markup they do not know gives its
 * text as it is.
 */

import { Predicate } from 'effect'
import type { Schema } from 'effect'

// --- ADF ------------------------------------------------------------------------------------------

const isObject = (value: Schema.Json): value is Schema.JsonObject =>
  Predicate.isObject(value) && !Array.isArray(value)

const stringOf = (value: Schema.Json | undefined): string | null =>
  value !== undefined && Predicate.isString(value) ? value : null

const childrenOf = (node: Schema.JsonObject): ReadonlyArray<Schema.Json> => {
  const content = node['content']
  return content !== undefined && Array.isArray(content) ? content : []
}

const attrOf = (node: Schema.JsonObject, name: string): Schema.Json | undefined => {
  const attrs = node['attrs']
  return attrs !== undefined && attrs !== null && isObject(attrs) ? attrs[name] : undefined
}

/** A text node with its marks: code, strong, em, strike, link; any other mark leaves it as is. */
const markedText = (node: Schema.JsonObject): string => {
  const marks = node['marks']
  let value = stringOf(node['text']) ?? ''
  if (marks === undefined || !Array.isArray(marks)) return value
  for (const mark of marks) {
    if (mark === null || !isObject(mark)) continue
    const type = stringOf(mark['type'])
    if (type === 'code') value = `\`${value}\``
    else if (type === 'strong') value = `**${value}**`
    else if (type === 'em') value = `*${value}*`
    else if (type === 'strike') value = `~~${value}~~`
    else if (type === 'link') {
      const href = stringOf(attrOf(mark, 'href'))
      if (href !== null) value = `[${value}](${href})`
    }
  }
  return value
}

/** The inline content of a block: its text, marks, mentions, emoji, cards and dates. */
const inline = (nodes: ReadonlyArray<Schema.Json>): string =>
  nodes.map((node) => inlineNode(node)).join('')

const inlineNode = (node: Schema.Json): string => {
  if (Predicate.isString(node)) return node
  if (node === null || !isObject(node)) return ''
  switch (stringOf(node['type'])) {
    case 'text':
      return markedText(node)
    case 'hardBreak':
      return '\n'
    case 'mention': {
      const name = stringOf(attrOf(node, 'text')) ?? ''
      return `@${name.replace(/^@/, '')}`
    }
    case 'emoji':
      return stringOf(attrOf(node, 'text')) ?? stringOf(attrOf(node, 'shortName')) ?? ''
    case 'inlineCard':
    case 'blockCard':
      return stringOf(attrOf(node, 'url')) ?? ''
    case 'status':
      return stringOf(attrOf(node, 'text')) ?? ''
    case 'date': {
      const stamp = Number(stringOf(attrOf(node, 'timestamp')) ?? attrOf(node, 'timestamp'))
      const date = new Date(stamp)
      // A number past the dates JavaScript can hold is no date: said as nothing, never a throw.
      return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
    }
    default:
      // A node it does not know inline: its text, as it is.
      return stringOf(node['text']) ?? inline(childrenOf(node))
  }
}

/** Every line of a text with a prefix: what a quote and a list item's body are written with. */
const prefixed = (value: string, first: string, rest: string): string =>
  value
    .split('\n')
    .map((line, index) => (line === '' ? line : `${index === 0 ? first : rest}${line}`))
    .join('\n')

const listOf = (node: Schema.JsonObject, ordered: boolean): string => {
  const marker = ordered ? '1. ' : '- '
  const indent = ' '.repeat(marker.length)
  return childrenOf(node)
    .map((child) => {
      const body =
        child !== null && isObject(child) && stringOf(child['type']) === 'listItem'
          ? childrenOf(child)
              .map((part) => block(part))
              .filter((part) => part !== '')
              .join('\n')
          : block(child)
      return prefixed(body === '' ? ' ' : body, marker, indent).replace(/ +$/, '')
    })
    .join('\n')
}

/** Every text under a node, with no markup: what a code block holds. */
const plainText = (node: Schema.Json): string => {
  if (Predicate.isString(node)) return node
  if (node === null || !isObject(node)) return ''
  return (
    stringOf(node['text']) ??
    childrenOf(node)
      .map((child) => plainText(child))
      .join('')
  )
}

const typeOf = (node: Schema.Json): string | null =>
  node !== null && isObject(node) ? stringOf(node['type']) : null

/** A table cell: its blocks on one line, its pipes escaped; anything else in its place, its text. */
const cellOf = (node: Schema.Json): string => {
  const kind = typeOf(node)
  const parts =
    node !== null && isObject(node) && (kind === 'tableCell' || kind === 'tableHeader')
      ? childrenOf(node).map((part) => block(part))
      : [block(node)]
  return parts
    .join(' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/(?<!\\)\|/g, '\\|')
    .trim()
}

const tableOf = (node: Schema.JsonObject): string => {
  const rows = childrenOf(node).map((row) =>
    row !== null && isObject(row) && typeOf(row) === 'tableRow'
      ? childrenOf(row).map((one) => cellOf(one))
      : [cellOf(row)],
  )
  const width = Math.max(1, ...rows.map((row) => row.length))
  const line = (cells: ReadonlyArray<string>) =>
    `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`
  const [head = [], ...body] = rows
  return [line(head), line(Array.from({ length: width }, () => '---')), ...body.map(line)].join(
    '\n',
  )
}

const blocks = (nodes: ReadonlyArray<Schema.Json>): string =>
  nodes
    .map((node) => block(node))
    .filter((part) => part !== '')
    .join('\n\n')

const block = (node: Schema.Json): string => {
  if (Predicate.isString(node)) return node
  if (node === null || !isObject(node)) return ''
  const children = childrenOf(node)
  switch (stringOf(node['type'])) {
    case 'doc':
      return blocks(children)
    case 'paragraph':
      return inline(children)
    case 'heading': {
      const level = Number(attrOf(node, 'level'))
      const hashes = '#'.repeat(Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1)
      return `${hashes} ${inline(children).replace(/\n/g, ' ')}`
    }
    case 'bulletList':
      return listOf(node, false)
    case 'orderedList':
      return listOf(node, true)
    case 'codeBlock': {
      const language = stringOf(attrOf(node, 'language')) ?? ''
      return `\`\`\`${language}\n${children.map((child) => plainText(child)).join('')}\n\`\`\``
    }
    case 'blockquote':
    case 'panel':
      return prefixed(blocks(children), '> ', '> ')
    case 'rule':
      return '---'
    case 'table':
      return tableOf(node)
    case 'expand':
    case 'nestedExpand': {
      const title = stringOf(attrOf(node, 'title'))
      return blocks([...(title === null || title === '' ? [] : [`**${title}**`]), ...children])
    }
    case 'text':
    case 'mention':
    case 'emoji':
    case 'inlineCard':
    case 'hardBreak':
    case 'status':
    case 'date':
      return inlineNode(node)
    default: {
      // A node it does not know: its text, as it is, and its children's.
      const own = stringOf(node['text'])
      const inner = blocks(children)
      return [own ?? '', inner].filter((part) => part !== '').join('\n\n')
    }
  }
}

/** An ADF document as Markdown; an empty description, or none, is empty text. Never throws. */
export const adfToMarkdown = (document: Schema.Json): string => block(document).trim()

/** A JSON value with its keys sorted and every `localId` left out. */
const canonical = (value: Schema.Json): Schema.Json => {
  if (Array.isArray(value)) return value.map((one) => canonical(one))
  if (value === null || !isObject(value)) return value
  const sorted: Record<string, Schema.Json> = {}
  for (const key of Object.keys(value).toSorted()) {
    const one = value[key]
    if (key !== 'localId' && one !== undefined) sorted[key] = canonical(one)
  }
  return sorted
}

/**
 * The text a Cloud description's fingerprint is taken on: the document as Jira returned it,
 * serialised with its keys sorted and its `localId` attributes left out (#94, section 5).
 */
export const adfFingerprintText = (document: Schema.Json): string =>
  document === null ? '' : JSON.stringify(canonical(document))

// --- Wiki markup ----------------------------------------------------------------------------------

const WIKI_HEADING = /^\s*h([1-6])\.\s+(.*)$/
const WIKI_LIST = /^\s*([*#]+|-)\s+(.*)$/
const WIKI_BLOCK = /^\s*\{(code|noformat)(?::([^}]*))?\}\s*$/
/** A link, a mention or a bare link; never one whose bracket is escaped (`\[`), which is text. */
const WIKI_LINK =
  /(?<!\\)\[([^[\]|]*)\|([^[\]]+)\]|(?<!\\)\[~([^[\]]+)\]|(?<!\\)\[((?:https?|mailto):[^[\]|]+)\]/g

/** A `{code}` block's language: `{code:java}`, or `{code:title=A.java|language=java}`. */
const languageOf = (parameters: string | undefined): string => {
  if (parameters === undefined) return ''
  const named = /(?:^|\|)language=([^|]*)/.exec(parameters)
  if (named !== null) return (named[1] ?? '').trim()
  return parameters.includes('=') ? '' : parameters.trim()
}

const wikiLinks = (line: string): string =>
  line.replace(
    WIKI_LINK,
    (
      whole,
      label: string | undefined,
      target: string | undefined,
      user: string | undefined,
      bare: string | undefined,
    ) => {
      if (target !== undefined) return `[${label ?? ''}](${target})`
      if (user !== undefined) return `@${user}`
      if (bare !== undefined) return `<${bare}>`
      return whole
    },
  )

/**
 * Wiki markup as Markdown: headings `h1.` to `h6.`, lists (`*`, `#`, `-`, nested), `{code}` and
 * `{noformat}` blocks (kept verbatim) and links; everything else is kept as text. Never throws.
 */
export const wikiToMarkdown = (wiki: string): string => {
  const out: string[] = []
  let fence: string | null = null
  for (const line of wiki.split(/\r?\n/)) {
    const opening = WIKI_BLOCK.exec(line)
    if (fence !== null) {
      if (opening !== null && opening[1] === fence) {
        out.push('```')
        fence = null
      } else {
        out.push(line)
      }
      continue
    }
    if (opening !== null) {
      fence = opening[1] ?? 'code'
      out.push(`\`\`\`${languageOf(opening[2])}`)
      continue
    }
    const heading = WIKI_HEADING.exec(line)
    if (heading !== null) {
      out.push(`${'#'.repeat(Number(heading[1]))} ${wikiLinks(heading[2] ?? '')}`)
      continue
    }
    const list = WIKI_LIST.exec(line)
    if (list !== null) {
      const markers = list[1] ?? '-'
      // Each parent's marker sets how far its children are indented: `- ` two, `1. ` three.
      const indent = [...markers.slice(0, -1)].map((one) => (one === '#' ? '   ' : '  ')).join('')
      out.push(`${indent}${markers.endsWith('#') ? '1.' : '-'} ${wikiLinks(list[2] ?? '')}`)
      continue
    }
    out.push(wikiLinks(line))
  }
  if (fence !== null) out.push('```')
  return out.join('\n')
}

// --- JQL and dates --------------------------------------------------------------------------------

/**
 * A text as one JQL string: in double quotes, its quotes and backslashes escaped, its line breaks
 * and control characters made spaces. No input breaks out of it.
 */
export const jqlString = (text: string): string =>
  `"${withoutControls(text).replace(/["\\]/g, '\\$&')}"`

/** A text with its line breaks and control characters (below U+0020, and U+007F) made spaces. */
const withoutControls = (text: string): string =>
  [...text]
    .map((char) => ((char.codePointAt(0) ?? 0) < 32 || char === '\u007f' ? ' ' : char))
    .join('')

/**
 * A Jira date as an instant in UTC (`2026-10-01T08:00:00.000Z`), whatever zone the user's Jira
 * writes it in (`2026-10-01T10:00:00.000+0200`); a date it cannot read is kept as written.
 */
export const jiraInstant = (date: string): string => {
  const parsed = Date.parse(date.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isNaN(parsed) ? date : new Date(parsed).toISOString()
}
