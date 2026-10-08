/**
 * Reading a ticket tolerantly: its Markdown split by headings of any level, ATX or setext, each
 * heading mapped to one of the eight Spec sections when a tolerant matcher recognises it, every
 * other part kept as unrecognised text in order, and the WHEN … THEN … lines under Requirements
 * read as scenarios. It never throws and never loses a character.
 */

import * as fc from 'fast-check'
import { Arbitrary, Effect, Predicate, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  type SectionsRead,
  fingerprintInput,
  matchSection,
  readSections,
} from '../src/domain/index.ts'

/** Every part of a reading, in the order of the text. */
const partsOf = (read: SectionsRead) =>
  [...read.sections, ...read.unrecognised].toSorted((one, other) => one.at - other.at)

/** The text a reading was made from, put back together from its parts. */
const rebuilt = (read: SectionsRead) =>
  partsOf(read)
    .map((part) => `${part.markup}${part.text}`)
    .join('')

/** Markdown-shaped text: headings of every kind, fences, lists, blank lines and noise. */
const markdownish = fc
  .array(
    fc.oneof(
      fc.constantFrom(
        '# Why',
        '## Goals / Non-goals:',
        '### 2. Risks & trade-offs',
        'Impact',
        '======',
        '------',
        '```',
        '~~~',
        '- WHEN a user signs in THEN the menu shows their name',
        'WHEN the cart is empty',
        'THEN checkout is refused',
        '',
        '   ',
        '#',
        '#no-heading',
        '> ## quoted',
        '\r',
      ),
      fc.string({ maxLength: 30 }),
    ),
    { maxLength: 40 },
  )
  .chain((lines) => fc.constantFrom('\n', '\r\n').map((ending) => lines.join(ending)))

describe('readSections never throws and never loses text', () => {
  test('any string read from its schema is read back whole, in order', async () => {
    const result = await Effect.runPromise(
      Arbitrary.checkEffect(
        Arbitrary.schema(Schema.String),
        (text) => rebuilt(readSections(text)) === text,
      ),
    )
    expect(Arbitrary.formatCheckFailure(result)).toBeUndefined()
    expect(Predicate.isTagged(result, 'Passed')).toBe(true)
  })

  test('Markdown-shaped text, headings, fences and both line endings, is read back whole', () => {
    fc.assert(
      fc.property(markdownish, (text) => {
        const read = readSections(text)
        expect(rebuilt(read)).toBe(text)
        const starts = partsOf(read).map((part) => part.at)
        expect(new Set(starts).size).toBe(starts.length)
      }),
      { numRuns: 500 },
    )
  })

  test('an empty description gives no section, no unrecognised text and no error', () => {
    expect(readSections('')).toEqual({ sections: [], unrecognised: [] })
  })
})

describe('Headings of any level and form map to the eight sections', () => {
  test('ATX headings of every level, setext headings, and their text as written', () => {
    const read = readSections(
      [
        '## Why',
        'Exports are slow.',
        '',
        'Goals',
        '-----',
        'Export in one click.',
        '#### Impact ####',
        'The `api` and `web` repositories.',
        'Open questions',
        '==============',
        'Which formats?',
      ].join('\n'),
    )
    expect(read.sections.map((one) => [one.section, one.heading, one.text])).toEqual([
      ['why', 'Why', 'Exports are slow.\n\n'],
      ['goals', 'Goals', 'Export in one click.\n'],
      ['impact', 'Impact', 'The `api` and `web` repositories.\n'],
      ['open_questions', 'Open questions', 'Which formats?'],
    ])
    expect(read.unrecognised).toEqual([])
  })

  test('case, accents, punctuation, emoji, numbering and trailing colons are ignored', () => {
    for (const [heading, section] of [
      ['WHY?', 'why'],
      ['1. Why:', 'why'],
      ['🎯 Goals / Non-goals', 'goals'],
      ['Non goals', 'goals'],
      ['II) Requirements', 'requirements'],
      ['Risks', 'risks'],
      ['Trade-offs', 'risks'],
      ['Risks & trade-offs', 'risks'],
      ['Migration plan:', 'migration'],
      ['Décisions', 'decisions'],
      ['Open Questions ❓', 'open_questions'],
      ['3) Impact —', 'impact'],
    ] as const) {
      expect([heading, matchSection(heading)]).toEqual([heading, section])
    }
  })

  test('translated names from the table are accepted', () => {
    for (const [heading, section] of [
      ['Pourquoi', 'why'],
      ['Objectifs', 'goals'],
      ['Exigences', 'requirements'],
      ['Risques et compromis', 'risks'],
      ['Questions ouvertes', 'open_questions'],
      ['Anforderungen', 'requirements'],
      ['Preguntas abiertas', 'open_questions'],
    ] as const) {
      expect([heading, matchSection(heading)]).toEqual([heading, section])
    }
  })

  test('a heading it cannot map is not a section', () => {
    expect(matchSection('Screenshots')).toBeNull()
    expect(matchSection('Why not both')).toBeNull()
    expect(matchSection('')).toBeNull()
  })
})

describe('What it cannot map is kept, in order, with its heading', () => {
  test('text before the first heading and under unknown headings stays as unrecognised text', () => {
    const read = readSections(
      [
        'Reported by the support team.',
        '## Steps to reproduce',
        '1. Open the export menu',
        '## Why',
        'Exports time out.',
        '### Screenshots',
        'none',
      ].join('\n'),
    )
    expect(read.unrecognised.map((one) => [one.heading, one.text])).toEqual([
      [null, 'Reported by the support team.\n'],
      ['Steps to reproduce', '1. Open the export menu\n'],
      ['Screenshots', 'none'],
    ])
    expect(read.sections.map((one) => one.section)).toEqual(['why'])
  })

  test('a heading inside a fenced code block is code, not a heading', () => {
    const read = readSections(['## Why', '```md', '## Goals', '```', 'after'].join('\n'))
    expect(read.sections).toHaveLength(1)
    expect(read.sections[0]?.text).toBe('```md\n## Goals\n```\nafter')
  })

  test('a thematic break after a blank line is not a setext heading', () => {
    const read = readSections(['Why', '', '---', 'text'].join('\n'))
    expect(read.sections).toEqual([])
    expect(read.unrecognised).toHaveLength(1)
  })
})

describe('Requirements written to the remote standard are read as scenarios', () => {
  test('WHEN … THEN … on one line or on two, emphasis and list markers ignored', () => {
    const read = readSections(
      [
        '## Requirements',
        'Exports keep the accents.',
        '- **WHEN** a note holds "café" **THEN** the file holds "café"',
        'WHEN the export is empty',
        'THEN the file has a header only',
        'When lowercase, then it is prose.',
      ].join('\n'),
    )
    const [requirements] = read.sections
    expect(requirements?.section).toBe('requirements')
    expect(requirements?.scenarios).toEqual([
      { when: 'a note holds "café"', then: 'the file holds "café"' },
      { when: 'the export is empty', then: 'the file has a header only' },
    ])
    expect(requirements?.text).toContain('When lowercase, then it is prose.')
  })

  test('scenarios are read under Requirements only', () => {
    const read = readSections(['## Why', 'WHEN a THEN b'].join('\n'))
    expect(read.sections[0]?.scenarios).toEqual([])
  })
})

describe('The fingerprint input is the provider’s text, normalised', () => {
  test('line endings, trailing spaces and the Unicode form do not change it', () => {
    expect(fingerprintInput('Export', 'Line one  \r\nLine two\t\r\n')).toBe(
      fingerprintInput('Export', 'Line one\nLine two\n'),
    )
    expect(fingerprintInput('Cafe\u0301', '')).toBe(fingerprintInput('Caf\u00e9', ''))
    expect(fingerprintInput('Export', 'a')).not.toBe(fingerprintInput('Export', 'b'))
    expect(fingerprintInput('Export a', '')).not.toBe(fingerprintInput('Export', 'a'))
  })
})
