/**
 * Starting a mission from the Project's field: the ticket references it recognises and their
 * canonical form, the mission keys it opens, the words it searches, and the provisional title a
 * mission starts with.
 */

import * as fc from 'fast-check'
import { Option, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import {
  CanonicalTicket,
  GithubIssue,
  JiraKey,
  canonicalTicket,
  parseMissionKey,
  parseTicketReference,
  provisionalTitleOf,
  searchTextOf,
  searchWordsOf,
  ticketKeyOf,
  ticketUrlOf,
} from '../src/domain/index.ts'

const canonicalOf = (text: string): string | null => {
  const reference = parseTicketReference(text)
  return reference === null ? null : canonicalTicket(reference)
}

describe('A ticket reference is recognised with its canonical form', () => {
  test('a GitHub issue URL, on github.com or on any other host', () => {
    expect(parseTicketReference('https://github.com/acme/shop/issues/41')).toEqual(
      GithubIssue.make({ host: 'github.com', owner: 'acme', repo: 'shop', number: 41 }),
    )
    expect(canonicalOf('https://github.com/acme/shop/issues/41')).toBe(
      'github:github.com/acme/shop#41',
    )
    expect(canonicalOf('https://git.acme.test/acme/shop/issues/7')).toBe(
      'github:git.acme.test/acme/shop#7',
    )
  })

  test('the short form owner/repo#n names no host, and is github.com’s until one is resolved', () => {
    const short = parseTicketReference('acme/shop#41')
    expect(short).toEqual(GithubIssue.make({ host: null, owner: 'acme', repo: 'shop', number: 41 }))
    expect(canonicalOf('acme/shop#41')).toBe('github:github.com/acme/shop#41')
    if (short === null) throw new Error('not recognised')
    expect(ticketUrlOf(short)).toBe('https://github.com/acme/shop/issues/41')
  })

  test('a Jira browse URL, with its host', () => {
    expect(parseTicketReference('https://jira.acme.test/browse/SHOP-7')).toEqual(
      JiraKey.make({ host: 'jira.acme.test', key: 'SHOP-7' }),
    )
    expect(canonicalOf('https://jira.acme.test/browse/SHOP-7')).toBe('jira:jira.acme.test/SHOP-7')
  })

  test('a bare key, in any case, without a host', () => {
    expect(parseTicketReference('shop-7')).toEqual(JiraKey.make({ host: null, key: 'SHOP-7' }))
    expect(canonicalOf('SHOP-7')).toBe('jira:/SHOP-7')
    expect(canonicalOf('A1B2C3D4E5-12')).toBe('jira:/A1B2C3D4E5-12')
  })

  test('spaces, angle brackets, a trailing slash and a query string are tolerated', () => {
    expect(canonicalOf('  <https://github.com/acme/shop/issues/41/>  ')).toBe(
      'github:github.com/acme/shop#41',
    )
    expect(canonicalOf('https://jira.acme.test/browse/SHOP-7?focusedCommentId=3')).toBe(
      'jira:jira.acme.test/SHOP-7',
    )
    expect(canonicalOf(' <acme/shop#41> ')).toBe('github:github.com/acme/shop#41')
  })

  test('anything else is not a reference: it is searched as words', () => {
    for (const text of [
      '',
      'Export notes as Markdown',
      'fix SHOP-7 today',
      'https://github.com/acme/shop/pull/41',
      'https://github.com/acme/shop',
      'S-1',
      'ABCDEFGHIJK-1',
      '1SHOP-7',
      'SHOP-',
      'acme/shop',
      '#41',
    ]) {
      expect(parseTicketReference(text)).toBeNull()
    }
  })

  test('its display key is the ticket’s own, and its URL is the provider’s page when known', () => {
    const github = parseTicketReference('https://GitHub.com/Acme/Shop/issues/41')
    const jira = parseTicketReference('https://jira.acme.test/browse/shop-7')
    const bare = parseTicketReference('shop-7')
    if (github === null || jira === null || bare === null) throw new Error('not recognised')
    expect(ticketKeyOf(github)).toBe('acme/shop#41')
    expect(ticketUrlOf(github)).toBe('https://github.com/acme/shop/issues/41')
    expect(ticketKeyOf(jira)).toBe('SHOP-7')
    expect(ticketUrlOf(jira)).toBe('https://jira.acme.test/browse/SHOP-7')
    expect(ticketUrlOf(bare)).toBeNull()
  })

  test('the canonical form is a schema: a canonical string decodes, a typed reference does not', () => {
    const decode = Schema.decodeUnknownOption(CanonicalTicket)
    expect(Option.isSome(decode('github:github.com/acme/shop#41'))).toBe(true)
    expect(Option.isSome(decode('jira:/SHOP-7'))).toBe(true)
    expect(Option.isNone(decode('acme/shop#41'))).toBe(true)
  })
})

/** A name GitHub takes for an owner or a repository. */
const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/)
const number = fc.integer({ min: 1, max: 99_999 })
const host = fc.constantFrom('github.com', 'git.acme.test', 'code.example.org')
const jiraKey = fc.stringMatching(/^[A-Z][A-Z0-9]{1,9}$/)

/** One letter in either case. */
const anyCase = (text: string) =>
  fc
    .array(fc.boolean(), { minLength: text.length, maxLength: text.length })
    .map((uppers) =>
      [...text].map((char, at) => (uppers[at] === true ? char.toUpperCase() : char)).join(''),
    )

/** Around a reference, what a paste brings with it. */
const wrapped = (core: string) =>
  fc
    .record({
      spaces: fc.constantFrom('', ' ', '  ', '\t'),
      brackets: fc.boolean(),
    })
    .map(({ spaces, brackets }) => `${spaces}${brackets ? `<${core}>` : core}${spaces}`)

/** A GitHub issue, and one of the ways it is written. */
const githubSpelling = fc
  .tuple(name, name, number, fc.boolean())
  .chain(([owner, repo, n, onGithub]) => {
    const where = onGithub ? 'github.com' : 'git.acme.test'
    const url = `${where}/${owner}/${repo}/issues/${String(n)}`
    return fc.tuple(
      fc.constant<string>(`github:${where}/${owner}/${repo}#${String(n)}`),
      fc.oneof(
        anyCase(`https://${url}`).chain(wrapped),
        fc.constant(`http://${url}/`),
        fc.constant(`https://${url}?q=1`),
        ...(onGithub ? [anyCase(`${owner}/${repo}#${String(n)}`).chain(wrapped)] : []),
      ),
    )
  })

/** A Jira key, and one of the ways it is written: bare, or a browse URL of one host. */
const jiraSpelling = fc
  .tuple(jiraKey, number, host, fc.boolean())
  .chain(([letters, n, where, bare]) => {
    const key = `${letters}-${String(n)}`
    return bare
      ? fc.tuple(fc.constant<string>(`jira:/${key}`), anyCase(key).chain(wrapped))
      : fc.tuple(
          fc.constant<string>(`jira:${where}/${key}`),
          anyCase(`https://${where}/browse/${key}`).chain(wrapped),
        )
  })

describe('Two spellings of one reference give one canonical form', () => {
  test('a GitHub issue: URL with or without a slash or a query, in any case, short form', () => {
    fc.assert(
      fc.property(githubSpelling, ([expected, spelling]) => {
        expect(canonicalOf(spelling)).toBe(expected)
      }),
    )
  })

  test('a Jira key: bare in any case, or a browse URL of one host', () => {
    fc.assert(
      fc.property(jiraSpelling, ([expected, spelling]) => {
        expect(canonicalOf(spelling)).toBe(expected)
      }),
    )
  })
})

describe('Prose with no reference shape is no reference', () => {
  test('words of letters, spaces and punctuation give none', () => {
    const word = fc.stringMatching(/^[A-Za-zÀ-ÿ]{1,12}[.,!?]?$/)
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 12 }), (words) => {
        expect(parseTicketReference(words.join(' '))).toBeNull()
      }),
    )
  })
})

describe('A mission key is recognised in any case', () => {
  test('its prefix and number, whatever the case and the spaces around it', () => {
    expect(parseMissionKey(' acme-12 ')).toEqual({ prefix: 'ACME', number: 12 })
    expect(parseMissionKey('ACME-12')).toEqual({ prefix: 'ACME', number: 12 })
    expect(parseMissionKey('acme 12')).toBeNull()
    expect(parseMissionKey('Export notes')).toBeNull()
  })
})

describe('The search column is lower case without accents, and so are the words searched', () => {
  test('a title with accents and capitals is found by plain lower-case words', () => {
    const column = searchTextOf(['ACME-3', 'Exporter les notes en Markdown', 'Crème brûlée'])
    expect(column).toBe('acme-3 exporter les notes en markdown creme brulee')
    expect(searchWordsOf('  MARKDOWN   Brûlée ')).toEqual(['markdown', 'brulee'])
    expect(searchWordsOf('   ')).toEqual([])
  })
})

describe('The provisional title of a mission', () => {
  test('the provisional title is the first line of the request, cut on a word when it is long', () => {
    expect(provisionalTitleOf('\n  Fix   the menu \nmore')).toBe('Fix the menu')
    const long = provisionalTitleOf(`${'word '.repeat(30)}end`)
    expect(long.length).toBeLessThanOrEqual(81)
    expect(long.endsWith('word…')).toBe(true)
    expect(provisionalTitleOf('   ')).toBe('New mission')
  })

  test('a line of 80 characters is kept whole; one word longer than 80 is cut at 80', () => {
    const exact = 'a'.repeat(80)
    expect(provisionalTitleOf(exact)).toBe(exact)
    expect(provisionalTitleOf('b'.repeat(100))).toBe(`${'b'.repeat(80)}…`)
  })

  test('never longer than 80 characters and an ellipsis, whatever the text', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (text) => {
        expect(provisionalTitleOf(text).length).toBeLessThanOrEqual(81)
      }),
    )
  })
})
