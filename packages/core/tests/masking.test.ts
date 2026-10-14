/**
 * What Hemera masks before anything is written, shown or sent: the known values of secrets, and
 * the shapes of credentials it recognises without knowing their value. Every mask is `•••`.
 */

import * as fc from 'fast-check'
import { describe, expect, test } from 'vite-plus/test'

import {
  MASK,
  maskAction,
  maskPrinted,
  maskRecord,
  maskShapes,
  maskText,
} from '../src/domain/index.ts'

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

/**
 * The fixtures shaped like a provider's token, made of parts at run time: a secret scanner reading
 * this file must not take a whole fake for a leaked token.
 */
const joined = (...parts: ReadonlyArray<string>): string => parts.join('')
const FAKE = {
  anthropic: joined('sk-', 'ant-api03-', 'abcdefghijklmnop'),
  github: joined('ghp', '_0123456789', 'abcdefghijABCDEFGHIJ012345'),
  githubOAuth: joined('gho', '_0123456789', 'abcdefghijABCDEFGHIJ012345'),
  githubFineGrained: joined('github', '_pat_', '11ABCDEFG0123456789_abcdefghijklmnop'),
  slack: joined('xoxb', '-1234-5678-', 'abcdef'),
  gitlab: joined('glpat', '-abcdefghij', '0123456789'),
  bitbucketAppPassword: joined('ATBB', '0123456789abcdef', 'ABCDEF0123456789AB'),
  atlassian: joined('ATATT', '3xFfGF0abcdefghij_', 'ABCDEFGHIJ-0123456789=AB12CD34'),
  bitbucketDataCenter: joined('BBDC', '-MDEyMzQ1Njc4OTAx', 'OkFCQ0RFRkdISUpLTE1OT1BRUlNU'),
  aws: joined('AKIA', 'ABCDEFGHIJKLMNOP'),
  jwt: joined('eyJhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxIn0', '.c2lnbmF0dXJl'),
}

describe('Each recognised shape is masked without its value being known', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    [
      'a private key block',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXk',
    ],
    ['an OpenAI style key', `key ${FAKE.anthropic}`, 'sk-ant-api03'],
    ['a GitHub token', FAKE.github, 'ghp_0123'],
    ['a GitHub OAuth token', FAKE.githubOAuth, 'gho_0123'],
    ['a fine-grained GitHub token', FAKE.githubFineGrained, 'github_pat_11'],
    ['a Slack token', FAKE.slack, 'xoxb-1234'],
    ['a GitLab token', FAKE.gitlab, 'glpat-abc'],
    ['a Bitbucket app password', FAKE.bitbucketAppPassword, 'ATBB0123'],
    ['an Atlassian API token', FAKE.atlassian, 'ATATT3xFfGF0'],
    ['a Bitbucket Data Center access token', FAKE.bitbucketDataCenter, 'BBDC-MDEy'],
    ['an AWS access key', FAKE.aws, FAKE.aws],
    ['a JSON Web Token', FAKE.jwt, 'eyJhbGciOiJIUzI1NiJ9'],
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

/** How many times `word` stands in `text`. */
const occurrences = (text: string, word: string): number => text.split(word).length - 1

/** Whether the text is JSON as a whole, or JSON on each of its lines that is not blank. */
const jsonShape = (text: string): 'whole' | 'lines' | 'text' => {
  const parses = (part: string) => {
    try {
      JSON.parse(part)
      return true
    } catch {
      return false
    }
  }
  if (parses(text)) return 'whole'
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  return lines.length > 0 && lines.every(parses) ? 'lines' : 'text'
}

/**
 * The rule of `maskPrinted`: no word of the text is left more often than masking the whole text
 * leaves it, and what was JSON (whole, or line by line) is JSON still.
 */
const holdsTheRule = (text: string, values: ReadonlyArray<string>): string => {
  const printed = maskPrinted(text, values)
  const whole = maskText(text, values)
  for (const word of new Set(text.match(/[\p{L}\p{N}_]{3,}/gu) ?? [])) {
    expect(occurrences(printed, word), word).toBeLessThanOrEqual(occurrences(whole, word))
  }
  const shape = jsonShape(text)
  if (shape !== 'text') expect(jsonShape(printed)).toBe(shape)
  return printed
}

describe('What a CLI printed is masked at least as much as the whole text would be', () => {
  const pem = ['MIIEowIBAAKCAQEAbodyline', '-----END RSA PRIVATE KEY-----']
  const cases: ReadonlyArray<
    readonly [string, string, ReadonlyArray<string>, ReadonlyArray<string>]
  > = [
    [
      'a private key begun in a JSON line',
      ['{"msg":"-----BEGIN RSA PRIVATE KEY-----"}', ...pem].join('\n'),
      [],
      ['MIIEowIBAAKCAQEAbodyline'],
    ],
    [
      'a private key begun in a JSON string line',
      ['"-----BEGIN RSA PRIVATE KEY-----"', ...pem].join('\n'),
      [],
      ['MIIEowIBAAKCAQEAbodyline'],
    ],
    [
      'a private key with a line of digits in it',
      ['-----BEGIN RSA PRIVATE KEY-----', 'b3BlbnNzaC1rZXk', '12345678', ...pem].join('\n'),
      [],
      ['b3BlbnNzaC1rZXk', '12345678', 'MIIEowIBAAKCAQEAbodyline'],
    ],
    ['a key shaped like a token', '[{"ghp_Q1w2e3r4t5y6u7i8o9p0":1}]', [], ['Q1w2e3r4t5y6u7i8o9p0']],
    ['a cookie field in a list', '[{"cookie":"sessionid=abcdef123"}]', [], ['abcdef123']],
    [
      'a Set-Cookie header deep in a list',
      '[{"response":{"headers":{"Set-Cookie":"sid=zz99887766; Path=/"}}}]',
      [],
      ['zz99887766'],
    ],
    [
      'a Set-Cookie header in NDJSON',
      '{"id":1}\n{"headers":{"Set-Cookie":"sid=zz99887766"}}',
      [],
      ['zz99887766'],
    ],
    ['a known value as an escaped key', '[{"pa\\"ssKEY123":1}]', ['pa"ssKEY123'], ['ssKEY123']],
    [
      'a known value as an escaped key of an object',
      '{"pa\\"ssKEY123":1}',
      ['pa"ssKEY123'],
      ['ssKEY123'],
    ],
    [
      'a known value as a key with an accent',
      '[{"caféSECRETKEY":1}]',
      ['caféSECRETKEY'],
      ['SECRETKEY'],
    ],
    [
      'a known value escaped in a value',
      'warn\n{"k":"pa\\"ssKEY123"}',
      ['pa"ssKEY123'],
      ['ssKEY123'],
    ],
    [
      'credential fields in NDJSON',
      '{"token":"plain-1"}\n{"note":"password=\\"x2secret\\""}',
      [],
      ['plain', 'x2secret'],
    ],
    [
      'credential fields and shapes in an array',
      '[{"token":"plain-3","body":"use ghp_0123456789abcdefghij"}]',
      [],
      ['plain', 'ghp_0123456789abcdefghij'],
    ],
    [
      'JSON lines mixed with text',
      '{"a":"x"}\nwarning: token=zzsecret55\n{"b":"Bearer abcdefgh1234"}',
      [],
      ['zzsecret55', 'abcdefgh1234'],
    ],
    [
      'NDJSON ending its lines with CRLF',
      '{"token":"plain-4"}\r\n{"x":"Bearer abcdefgh1234"}\r\n',
      [],
      ['plain', 'abcdefgh1234'],
    ],
    [
      'a label, its value on the next line',
      'db:\n  password:\n    "hunter2xyz"',
      [],
      ['hunter2xyz'],
    ],
    ['a label and its value on two JSON lines', '"password:"\n"hunter2xyz"', [], ['hunter2xyz']],
    ['a known number in a list', '[{"n":424242}]', ['424242'], ['424242']],
    [
      'a known value over two lines of numbers',
      '48213977\n55120934',
      ['48213977\n55120934'],
      ['48213977', '55120934'],
    ],
    [
      'a known value that is JSON itself, in a list',
      `[${JSON.stringify({ auths: { reg: { auth: 'dXNlcjpodW50ZXIy' } } })}]`,
      [JSON.stringify({ auths: { reg: { auth: 'dXNlcjpodW50ZXIy' } } })],
      ['dXNlcjpodW50ZXIy'],
    ],
  ]
  for (const [what, text, known, secrets] of cases) {
    test(`${what}: nothing of the secret is left, and JSON stays JSON`, () => {
      const printed = holdsTheRule(text, known)
      for (const secret of secrets) expect(printed).not.toContain(secret)
    })
  }

  test('what is not masked is left as it was printed: big numbers, spacing, escapes', () => {
    const text = '{\n  "id": 12345678901234567890,\n  "name": "caf\\u00e9",\n  "n": 1.50\n}'
    expect(maskPrinted(text, [])).toBe(text)
    const ndjson = '{"id":12345678901234567890}\n{"id":98765432109876543210, "ok":true}'
    expect(maskPrinted(ndjson, [])).toBe(ndjson)
  })

  test('a field named as a credential is masked whole, whatever it holds, and stays JSON', () => {
    expect(
      JSON.parse(maskPrinted('[{"token":{"a":"plain"},"password":7,"user":"octo"}]', [])),
    ).toEqual([{ token: MASK, password: MASK, user: 'octo' }])
  })

  test('any JSON, whole or line by line, with secrets anywhere in it', () => {
    const secret = fc.constantFrom(
      'ghp_0123456789abcdefghij',
      'Bearer abcdefgh1234',
      'password=hunter2',
      'Cookie: sid=zz99887766',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEbody\n-----END RSA PRIVATE KEY-----',
      'known-VALUE-1',
    )
    const withSecrets = fc.letrec<{ value: fc.JsonValue }>((tie) => ({
      value: fc.oneof(
        fc.jsonValue({ maxDepth: 1 }),
        secret,
        fc.array(tie('value'), { maxLength: 3 }),
        fc.dictionary(fc.oneof(fc.string({ maxLength: 6 }), secret), tie('value'), {
          maxKeys: 3,
        }),
      ),
    })).value
    fc.assert(
      fc.property(
        fc.array(withSecrets, { minLength: 1, maxLength: 3 }),
        fc.boolean(),
        (values, lines) => {
          const text = lines
            ? values.map((value) => JSON.stringify(value)).join('\n')
            : JSON.stringify(values, null, 2)
          const printed = holdsTheRule(text, ['known-VALUE-1'])
          for (const leaked of [
            '0123456789abcdefghij',
            'abcdefgh1234',
            'hunter2',
            'zz99887766',
            'MIIEbody',
            'known-VALUE-1',
          ]) {
            expect(printed).not.toContain(leaked)
          }
        },
      ),
    )
  })
})
