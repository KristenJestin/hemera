/**
 * What Hemera masks before anything is written, shown or sent: the known values of secrets, and
 * the shapes of credentials it recognises without knowing their value. Every mask is `•••`.
 */

import * as fc from 'fast-check'
import { describe, expect, test } from 'vite-plus/test'

import { MASK, maskAction, maskRecord, maskShapes, maskText } from '../src/domain/index.ts'

/** A value as a secret is: long enough to mean something, and nothing a shape would catch. */
const secretValue = fc
  .string({ minLength: 4, maxLength: 24, unit: 'grapheme-ascii' })
  .filter((value) => value.trim().length >= 4 && !value.includes(MASK))

/** Ordinary text around a secret: words, punctuation, line ends. */
const around = fc.string({ maxLength: 40, unit: 'grapheme-ascii' })

describe('No registered value survives masking', () => {
  test('in text, wherever it stands and however often', () => {
    fc.assert(
      fc.property(
        fc.array(secretValue, { minLength: 1, maxLength: 4 }),
        around,
        around,
        (values, before, after) => {
          const text = `${before}${values.join(before)}${after}${values[0] ?? ''}`
          const masked = maskText(text, values)
          for (const value of values) expect(masked).not.toContain(value)
        },
      ),
    )
  })

  test('in every string of a structured value, keys and nesting included', () => {
    fc.assert(
      fc.property(secretValue, around, (value, words) => {
        const masked = JSON.stringify(
          maskRecord(
            { note: `${words}${value}`, nested: { list: [value, words], deep: { text: value } } },
            [value],
          ),
        )
        expect(masked).not.toContain(value)
      }),
    )
  })
})

describe('Known values are masked whole, the longest first', () => {
  test('a value that contains another is masked whole, not around the shorter one', () => {
    expect(maskText('password hunter2-staging and hunter2', ['hunter2', 'hunter2-staging'])).toBe(
      `password ${MASK} and ${MASK}`,
    )
  })

  test('values that overlap without containing each other are masked over their whole span', () => {
    const masked = maskText('xxabcdefyy', ['abcd', 'cdef'])
    expect(masked).toBe(`xx${MASK}yy`)
  })

  test('no part of two overlapping values survives, wherever they overlap', () => {
    fc.assert(
      fc.property(secretValue, fc.integer({ min: 1, max: 3 }), around, (value, cut, words) => {
        const first = value.slice(0, value.length - cut)
        const second = value.slice(cut)
        const masked = maskText(`${words}${value}${words}`, [first, second])
        expect(masked).not.toContain(first)
        expect(masked).not.toContain(second)
      }),
    )
  })

  test('an empty value is never a secret', () => {
    expect(maskText('nothing to hide', [''])).toBe('nothing to hide')
  })
})

describe('Each recognised shape is masked without its value being known', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    [
      'a private key block',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXk',
    ],
    ['an OpenAI style key', 'key sk-ant-api03-abcdefghijklmnop', 'sk-ant-api03'],
    ['a GitHub token', 'ghp_0123456789abcdefghijABCDEFGHIJ012345', 'ghp_0123'],
    ['a GitHub OAuth token', 'gho_0123456789abcdefghijABCDEFGHIJ012345', 'gho_0123'],
    [
      'a fine-grained GitHub token',
      'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
      'github_pat_11',
    ],
    ['a Slack token', 'xoxb-1234-5678-abcdef', 'xoxb-1234'],
    ['a GitLab token', 'glpat-abcdefghij0123456789', 'glpat-abc'],
    ['an AWS access key', 'AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'],
    [
      'a JSON Web Token',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
      'eyJhbGciOiJIUzI1NiJ9',
    ],
    ['an Authorization header', 'Authorization: Bearer abc.def-ghi', 'abc.def-ghi'],
    ['a Proxy-Authorization header', 'Proxy-Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['a Cookie header', 'Cookie: session=a1b2c3; theme=dark', 'a1b2c3'],
    ['a Set-Cookie header', 'Set-Cookie: id=a3fWa; Expires=Wed', 'a3fWa'],
    ['a bare Bearer credential', 'use Bearer abc.def-ghi now', 'abc.def-ghi'],
    ['a bare Basic credential', 'send Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
    ['a password assigned', 'DB_PASSWORD=hunter2', 'hunter2'],
    ['a token given', 'token: t0k3n-value', 't0k3n-value'],
    ['a secret assigned', 'client_secret = s3cr3t', 's3cr3t'],
    ['an API key assigned', 'api_key=k-123456', 'k-123456'],
    ['an API key spelt another way', 'apiKey: k-123456', 'k-123456'],
    ['an AWS secret access key', 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI', 'wJalrXUtnFEMI'],
    ['a secret key of a web framework', 'SECRET_KEY=django-insecure-abc', 'django-insecure-abc'],
    ['a password between double quotes', 'password="correct horse battery"', 'horse battery'],
    ['a secret between single quotes', "client_secret: 'abc def'", 'def'],
    ['a password with separators in it', 'password=ab,cd;ef', 'cd;ef'],
    ['a password in JSON with an escaped quote', '{"password": "ab\\"cd"}', 'cd'],
    ['a cookie as a JSON header', '{"cookie":"session=abc123def"}', 'abc123def'],
    ['an authorization as a JSON header', '{"Authorization":"token deadbeef0011"}', 'deadbeef0011'],
  ]
  for (const [what, text, leaked] of cases) {
    test(`${what} is masked`, () => {
      const masked = maskShapes(text)
      expect(masked).not.toContain(leaked)
      expect(masked).toContain(MASK)
    })
  }

  test('a URL loses the password of its user information, and keeps its host', () => {
    const masked = maskShapes('postgres://user:hunter2@db.example.com/app')
    expect(masked).not.toContain('hunter2')
    expect(masked).toBe(`postgres://user:${MASK}@db.example.com/app`)
  })

  test('a header keeps its name, and a command line around a credential stays readable', () => {
    const masked = maskShapes(
      'curl -H "Authorization: Bearer sk-live-SECRET" https://api.example.com/v1',
    )
    expect(masked).toContain('curl -H')
    expect(masked).toContain('Authorization')
    expect(masked).toContain('https://api.example.com/v1')
    expect(masked).not.toContain('sk-live-SECRET')
  })

  test('ordinary words that only resemble a label are left alone', () => {
    for (const text of ['max_tokens: 4096', 'the tokens were counted', 'PORT=3000']) {
      expect(maskShapes(text)).toBe(text)
    }
  })
})

describe('A structured value is masked string by string, a credential field whole', () => {
  test('a field whose name says it is a credential is masked whole, whatever it holds', () => {
    expect(
      maskRecord(
        { user: 'acme', password: 'plain', options: { apiKey: 'x', authorization: 'y', token: 3 } },
        [],
      ),
    ).toEqual({
      user: 'acme',
      password: MASK,
      options: { apiKey: MASK, authorization: MASK, token: MASK },
    })
  })
})

describe('An action is never sent in part', () => {
  test('known values and shapes are masked, and the action is sent', () => {
    expect(
      maskAction(
        {
          tool: 'commands_run',
          line: 'curl -H "Authorization: Bearer sk-live-SECRET" https://api.example.com',
          cwd: '/work',
          arguments: { content: 'value known-value', options: { apiKey: 'hidden' } },
        },
        ['known-value'],
      ),
    ).toEqual({
      tool: 'commands_run',
      line: `curl -H "Authorization: ${MASK}" https://api.example.com`,
      cwd: '/work',
      arguments: { content: `value ${MASK}`, options: { apiKey: MASK } },
    })
  })

  test('an action whose path held a registered value is refused', () => {
    expect(
      maskAction({ tool: 'fs_write', path: '/work/known-value/notes.txt' }, ['known-value']),
    ).toBeNull()
  })

  test('the same holds for every destination field', () => {
    for (const field of ['path', 'target', 'cwd', 'command', 'program', 'line', 'url', 'host']) {
      expect(maskAction({ [field]: 'x known-value y' }, ['known-value'])).toBeNull()
    }
  })
})
