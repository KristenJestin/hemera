/**
 * Reading Jira text tolerantly (#96): Cloud's Atlassian Document Format and Data Center's wiki
 * markup turned into Markdown, so that #95's `readSections` reads a Jira description exactly as it
 * reads a GitHub one; the JQL string a search text goes into; the document a Cloud fingerprint is
 * taken on; and Jira's dates read as instants. The converters never throw and keep every text.
 */

import * as fc from 'fast-check'
import { Predicate, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  adfFingerprintText,
  adfToMarkdown,
  jiraInstant,
  jqlString,
  readSections,
  wikiToMarkdown,
} from '../src/domain/index.ts'

const text = (value: string, marks: ReadonlyArray<Schema.JsonObject> = []): Schema.JsonObject =>
  marks.length === 0
    ? { type: 'text', text: value }
    : { type: 'text', text: value, marks: [...marks] }
const paragraph = (...content: ReadonlyArray<Schema.JsonObject>): Schema.JsonObject => ({
  type: 'paragraph',
  content: [...content],
})
const doc = (...content: ReadonlyArray<Schema.JsonObject>): Schema.JsonObject => ({
  type: 'doc',
  version: 1,
  content: [...content],
})
const item = (...content: ReadonlyArray<Schema.JsonObject>): Schema.JsonObject => ({
  type: 'listItem',
  content: [...content],
})
const cell = (kind: 'tableHeader' | 'tableCell', value: string): Schema.JsonObject => ({
  type: kind,
  content: [paragraph(text(value))],
})

describe('Cloud: Atlassian Document Format becomes Markdown', () => {
  test('an empty description is empty text', () => {
    expect(adfToMarkdown(null)).toBe('')
    expect(adfToMarkdown(doc())).toBe('')
  })

  test('headings, paragraphs, marks and links', () => {
    const markdown = adfToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Why')] },
        paragraph(
          text('Exports are '),
          text('slow', [{ type: 'strong' }]),
          text(' since '),
          text('v2', [{ type: 'code' }]),
          text(', see '),
          text('the notes', [{ type: 'link', attrs: { href: 'https://acme.test/notes' } }]),
          text('.'),
        ),
      ),
    )
    expect(markdown).toBe(
      '## Why\n\nExports are **slow** since `v2`, see [the notes](https://acme.test/notes).',
    )
  })

  test('nested lists, ordered and not', () => {
    const markdown = adfToMarkdown(
      doc({
        type: 'bulletList',
        content: [
          item(paragraph(text('Export')), {
            type: 'orderedList',
            content: [item(paragraph(text('as Markdown'))), item(paragraph(text('as HTML')))],
          }),
          item(paragraph(text('Import'))),
        ],
      }),
    )
    expect(markdown).toBe('- Export\n  1. as Markdown\n  1. as HTML\n- Import')
  })

  test('code blocks, quotes, panels and a mention', () => {
    const markdown = adfToMarkdown(
      doc(
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [text('const a = 1\nconst b = 2')],
        },
        { type: 'blockquote', content: [paragraph(text('Quoted'))] },
        { type: 'panel', attrs: { panelType: 'info' }, content: [paragraph(text('Careful'))] },
        paragraph(
          text('Asked by '),
          { type: 'mention', attrs: { id: 'account-1', text: '@Ada' } },
          text(' and '),
          { type: 'mention', attrs: { id: 'account-2', text: 'Grace' } },
        ),
      ),
    )
    expect(markdown).toBe(
      '```ts\nconst a = 1\nconst b = 2\n```\n\n> Quoted\n\n> Careful\n\nAsked by @Ada and @Grace',
    )
  })

  test('a description that is only a table gives a Markdown table', () => {
    const markdown = adfToMarkdown(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [cell('tableHeader', 'Format'), cell('tableHeader', 'Size')],
          },
          {
            type: 'tableRow',
            content: [cell('tableCell', 'Markdown'), cell('tableCell', 'a | b')],
          },
        ],
      }),
    )
    expect(markdown).toBe('| Format | Size |\n| --- | --- |\n| Markdown | a \\| b |')
  })

  test('an unknown node gives its text and never throws', () => {
    const markdown = adfToMarkdown(
      doc(
        paragraph(text('Before')),
        { type: 'somethingNew', content: [paragraph(text('Inside')), { type: 'odd', text: 'x' }] },
        { type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'file-1' } }] },
      ),
    )
    expect(markdown).toContain('Before')
    expect(markdown).toContain('Inside')
  })

  test('section titles written in ADF reach readSections as Markdown headings', () => {
    const read = readSections(
      adfToMarkdown(
        doc(
          { type: 'heading', attrs: { level: 1 }, content: [text('Context')] },
          paragraph(text('Exports are slow.')),
          { type: 'heading', attrs: { level: 3 }, content: [text('Acceptance criteria')] },
          {
            type: 'bulletList',
            content: [item(paragraph(text('WHEN a note holds an accent THEN the file keeps it')))],
          },
        ),
      ),
    )
    expect(read.sections.map((section) => section.section)).toEqual(['why', 'requirements'])
    expect(read.sections[1]?.scenarios).toEqual([
      { when: 'a note holds an accent', then: 'the file keeps it' },
    ])
  })
})

describe('Data Center: wiki markup becomes Markdown', () => {
  test('an empty description is empty text', () => {
    expect(wikiToMarkdown('')).toBe('')
  })

  test('headings h1. to h6.', () => {
    expect(wikiToMarkdown('h1. Why\nSlow.\nh6. Open questions')).toBe(
      '# Why\nSlow.\n###### Open questions',
    )
  })

  test('nested lists, ordered and not', () => {
    expect(wikiToMarkdown('* Export\n*# as Markdown\n*# as HTML\n* Import\n- Other')).toBe(
      '- Export\n  1. as Markdown\n  1. as HTML\n- Import\n- Other',
    )
  })

  test('code blocks are kept verbatim, their language said', () => {
    expect(wikiToMarkdown('{code:java}\nh1. not a heading\n* not a list\n{code}\nafter')).toBe(
      '```java\nh1. not a heading\n* not a list\n```\nafter',
    )
    expect(wikiToMarkdown('{noformat}\n[a|b]\n{noformat}')).toBe('```\n[a|b]\n```')
  })

  test('links and a mention', () => {
    expect(
      wikiToMarkdown('See [the notes|https://acme.test/notes], [https://acme.test] and [~ada].'),
    ).toBe('See [the notes](https://acme.test/notes), <https://acme.test> and @ada.')
  })

  test('everything else is kept as text', () => {
    const kept = '*bold* _em_ {color:red}red{color} ||a||b||\n|1|2|\nbq. quoted'
    expect(wikiToMarkdown(kept)).toBe(kept)
  })
})

// --- Property tests -------------------------------------------------------------------------------

/** Text as it is compared: escaped pipes read back, every run of space one space. */
const flat = (value: string) => value.replaceAll('\\|', '|').replace(/\s+/g, ' ').trim()

const word = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 .,'|*_-]{0,12}$/)

/** ADF documents of known and unknown nodes, their text leaves anywhere. */
const adfTree = fc.letrec<{ node: Schema.JsonObject }>((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    word.map((value) => text(value)),
    fc
      .tuple(word, fc.constantFrom('strong', 'em', 'code', 'strike', 'link'))
      .map(([value, mark]) =>
        text(value, [
          mark === 'link' ? { type: mark, attrs: { href: 'https://acme.test' } } : { type: mark },
        ]),
      ),
    fc
      .tuple(
        fc.constantFrom(
          'doc',
          'paragraph',
          'heading',
          'bulletList',
          'orderedList',
          'listItem',
          'codeBlock',
          'blockquote',
          'panel',
          'table',
          'tableRow',
          'tableHeader',
          'tableCell',
          'expand',
          'somethingNew',
        ),
        fc.array(tie('node'), { maxLength: 4 }),
        fc.integer({ min: 0, max: 9 }),
      )
      .map(([type, content, level]): Schema.JsonObject => ({ type, attrs: { level }, content })),
  ),
})).node

const isJsonArray = (node: Schema.Json): node is Schema.JsonArray => Array.isArray(node)
const isJsonObject = (node: Schema.Json): node is Schema.JsonObject =>
  Predicate.isObject(node) && !Array.isArray(node)

const leaves = (node: Schema.Json): ReadonlyArray<string> => {
  if (isJsonArray(node)) return node.flatMap(leaves)
  if (node === null || !isJsonObject(node)) return []
  const said = node['text']
  const own = node['type'] === 'text' && Predicate.isString(said) ? [said] : []
  return [...own, ...leaves(node['content'] ?? null)]
}

describe('The converters never throw and keep every text', () => {
  test('ADF: any JSON at all never throws', () => {
    fc.assert(
      fc.property(fc.jsonValue().map(Schema.decodeUnknownSync(Schema.Json)), (value) => {
        expect(Predicate.isString(adfToMarkdown(value))).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  test('ADF: a date of any timestamp, extreme ones included, never throws', () => {
    const stamp = fc.oneof(
      fc.constantFrom(8.64e15 + 1, -8.64e15 - 1, 1e300, -1e300, Number.MAX_SAFE_INTEGER),
      fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.integer(),
    )
    fc.assert(
      fc.property(stamp, fc.boolean(), (value, asText) => {
        const date = { type: 'date', attrs: { timestamp: asText ? String(value) : value } }
        const markdown = adfToMarkdown({
          type: 'doc',
          content: [{ type: 'paragraph', content: [date] }],
        })
        expect(Predicate.isString(markdown)).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  test('ADF: every text leaf of a document is in its Markdown', () => {
    fc.assert(
      fc.property(adfTree, (tree) => {
        const markdown = flat(adfToMarkdown(tree))
        for (const leaf of leaves(tree)) expect(markdown).toContain(flat(leaf))
      }),
      { numRuns: 500 },
    )
  })

  test('wiki: any text at all never throws', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (value) => {
        expect(Predicate.isString(wikiToMarkdown(value))).toBe(true)
      }),
      { numRuns: 500 },
    )
  })

  test('wiki: every word of headings, lists, code, links and lines is in its Markdown', () => {
    const plain = fc.stringMatching(/^[A-Za-z0-9][A-Za-z0-9 .,]{0,12}$/)
    const line = fc.oneof(
      fc
        .tuple(fc.integer({ min: 1, max: 6 }), plain)
        .map(([n, w]) => ({ wiki: `h${String(n)}. ${w}`, words: [w] })),
      fc
        .tuple(fc.stringMatching(/^[*#]{1,4}$/), plain)
        .map(([m, w]) => ({ wiki: `${m} ${w}`, words: [w] })),
      fc
        .tuple(plain, plain)
        .map(([t, u]) => ({ wiki: `[${t}|https://acme.test/${u}]`, words: [t, u] })),
      plain.map((w) => ({ wiki: `{code}\n${w}\n{code}`, words: [w] })),
      fc.string({ maxLength: 30 }).map((noise) => ({ wiki: noise, words: [] })),
      plain.map((w) => ({ wiki: w, words: [w] })),
    )
    fc.assert(
      fc.property(fc.array(line, { maxLength: 12 }), (lines) => {
        const markdown = flat(wikiToMarkdown(lines.map((one) => one.wiki).join('\n')))
        for (const one of lines) for (const w of one.words) expect(markdown).toContain(flat(w))
      }),
      { numRuns: 500 },
    )
  })
})

/** Reads a JQL quoted string from `at`: its value, and where it ends; null when it never closes. */
const readJqlString = (jql: string, at: number): { value: string; end: number } | null => {
  if (jql[at] !== '"') return null
  let value = ''
  for (let index = at + 1; index < jql.length; index += 1) {
    const char = jql[index]
    if (char === '\\') {
      index += 1
      value += jql[index] ?? ''
    } else if (char === '"') {
      return { value, end: index + 1 }
    } else {
      value += char
    }
  }
  return null
}

describe('A search text is one JQL string, whatever it holds', () => {
  test('quotes and backslashes are escaped', () => {
    expect(jqlString('say "hi" \\ bye')).toBe('"say \\"hi\\" \\\\ bye"')
  })

  test('no input breaks out of the string', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 80 }), (input) => {
        const quoted = jqlString(input)
        const jql = `project in ("SHOP") AND text ~ ${quoted} ORDER BY updated DESC`
        const at = jql.indexOf(quoted)
        const read = readJqlString(jql, at)
        expect(read).not.toBeNull()
        expect(jql.slice(read?.end ?? 0)).toBe(' ORDER BY updated DESC')
        // Line breaks and control characters become spaces; every other character is kept.
        expect(read?.value).toBe(
          [...input]
            .map((char) => ((char.codePointAt(0) ?? 0) < 32 || char === '\u007f' ? ' ' : char))
            .join(''),
        )
      }),
      { numRuns: 1000 },
    )
  })
})

describe('What a Cloud fingerprint is taken on', () => {
  test('keys sorted and localId left out: two serialisations of one document agree', () => {
    const one = adfFingerprintText({
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', attrs: { localId: 'a1' }, content: [text('Same')] }],
    })
    const other = adfFingerprintText({
      content: [
        { content: [{ text: 'Same', type: 'text' }], attrs: { localId: 'b2' }, type: 'paragraph' },
      ],
      version: 1,
      type: 'doc',
    })
    expect(one).toBe(other)
    expect(one).not.toContain('localId')
    expect(adfFingerprintText(null)).toBe('')
  })
})

describe('Jira dates are read as instants, whatever the user’s time zone', () => {
  test('one instant written in two zones gives one date', () => {
    expect(jiraInstant('2026-10-01T10:00:00.000+0200')).toBe('2026-10-01T08:00:00.000Z')
    expect(jiraInstant('2026-10-01T03:00:00.000-0500')).toBe('2026-10-01T08:00:00.000Z')
  })

  test('a date it cannot read is kept as written', () => {
    expect(jiraInstant('yesterday')).toBe('yesterday')
  })
})
