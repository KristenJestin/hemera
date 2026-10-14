/**
 * What Hemera masks before anything is written, shown or sent: the known values of secrets, and
 * the shapes of credentials it recognises without knowing their value. Every mask is `•••`.
 */

import { Effect } from 'effect'
import * as fc from 'fast-check'
import { describe, expect, test } from 'vite-plus/test'

import {
  isJson,
  MASK,
  maskAction,
  maskPrinted,
  maskPrintedPaced,
  maskRecord,
  maskShapes,
  maskText,
  maskTextPaced,
} from '../src/domain/index.ts'
import * as inTurn from './oracle/masking-in-turn.ts'

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

  test('a JSON Web Token is masked whole when another token starts inside it', () => {
    const header = 'eyJhbGciOiJIUzI1NiJ9'
    const payload = 'eyJzdWIiOiJib2JAZXhhbXBsZS50ZXN0In0'
    for (const token of [
      `${header}.${payload}.ghp_Q1w2E3r4T5Q1w2E3r4T5sig`,
      `${header}.${payload}.sk-abcdefgh12`,
      `${header}.${payload}.AKIAABCDEFGHIJKLMNOP`,
      `${header}-AKIAABCDEFGHIJKLMNOP.${payload}.c2ln`,
    ]) {
      expect(String(maskText(`auth ${token}`, []))).toBe(`auth ${MASK}`)
      expect(maskPrinted(`auth ${token}`, [])).toBe(`auth ${MASK}`)
    }
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

  test('an action whose destination cannot be masked is refused, as a partial action', () => {
    // A quoted value of megabytes after a label: the pattern of a quoted value throws on it.
    const unmaskable = `token: "${'x'.repeat(16 * 1024 * 1024)}"`
    expect(maskAction({ tool: 'commands_run', line: unmaskable }, [])).toBeNull()
    expect(maskAction({ tool: 'fs_write', note: unmaskable }, [])).toEqual({
      tool: 'fs_write',
      note: MASK,
    })
  })

  test('the same holds for every destination field', () => {
    for (const field of ['path', 'target', 'cwd', 'command', 'program', 'line', 'url', 'host']) {
      expect(maskAction({ [field]: 'x known-value y' }, ['known-value'])).toBeNull()
    }
  })
})

/** How many times `word` stands in `text`. */
const occurrences = (text: string, word: string): number => text.split(word).length - 1

/** Whether `JSON.parse` reads the text. */
const parses = (text: string) => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** Whether the text is JSON as a whole, or JSON on each of its lines that is not blank. */
const jsonShape = (text: string): 'whole' | 'lines' | 'text' => {
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
    // A match that ends in a mask an earlier rule laid (a known value, a cut private key).
    [
      'a Cookie header ending in a known value',
      'Cookie: sid=abc123 KNOWNSECRET1',
      ['KNOWNSECRET1'],
      ['abc123'],
    ],
    [
      'a Cookie header ending in a known value, in JSON',
      '{"h":"Cookie: sid=abc123 KNOWNSECRET1"}',
      ['KNOWNSECRET1'],
      ['abc123'],
    ],
    [
      'a Set-Cookie header ending in a known value, in a gh --json list',
      '[{"headers":"Set-Cookie: sid=abc123; KNOWNSECRET1"}]',
      ['KNOWNSECRET1'],
      ['abc123'],
    ],
    [
      'an Authorization header ending in a known value',
      'Authorization: Basic dXNlcjpwYXNz KNOWNSECRET1',
      ['KNOWNSECRET1'],
      ['dXNlcjpwYXNz'],
    ],
    [
      'a cut private key ending in a known value',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEbodyQQ\nKNOWNSECRET1',
      ['KNOWNSECRET1'],
      ['MIIEbodyQQ'],
    ],
    [
      'a cut private key ending in a known value, in a JSON string',
      JSON.stringify({ k: '-----BEGIN RSA PRIVATE KEY-----\nMIIEbodyQQ\nKNOWNSECRET1' }),
      ['KNOWNSECRET1'],
      ['MIIEbodyQQ'],
    ],
    [
      'a URL password ending in a known value',
      'git remote: https://bob:pwQQ7KNOWNSECRET1@h.test/x',
      ['KNOWNSECRET1'],
      ['pwQQ7'],
    ],
    [
      'a Cookie header ending in a private key',
      'Cookie: sid=abc123 -----BEGIN RSA PRIVATE KEY-----',
      [],
      ['abc123'],
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

  test('a known value as printed, escape and all, is masked over the characters it writes', () => {
    const printed = String.raw`{"a":"pre xx\u0041yyy post"}`
    expect(maskPrinted(printed, [String.raw`xx\u0041yyy`])).toBe(`{"a":"pre ${MASK} post"}`)
  })

  test('a line is read as JSON exactly when JSON.parse reads it', () => {
    const piece = fc.constantFrom(
      '{',
      '}',
      '[',
      ']',
      '"',
      ',',
      ':',
      ' ',
      '\t',
      '\n',
      '\r',
      '\u00a0',
      '\\',
      '\\u00e9',
      '\\u12',
      '\\uZZZZ',
      '\\n',
      '\\x',
      '\u0001',
      'u',
      '0',
      '00',
      '1',
      '-',
      '.',
      'e',
      'E',
      '+',
      'true',
      'false',
      'null',
      'tru',
      'a',
    )
    const spaced = fc
      .tuple(fc.jsonValue(), fc.constantFrom(undefined, 2, '\t'))
      .map(([value, indent]) => JSON.stringify(value, null, indent))
    const line = fc.oneof(
      fc.json(),
      spaced,
      fc.array(piece, { maxLength: 12 }).map((pieces) => pieces.join('')),
      fc.tuple(fc.json(), fc.nat(), fc.array(piece, { maxLength: 2 })).map(([json, at, pieces]) => {
        const cut = at % (json.length + 1)
        return json.slice(0, cut) + pieces.join('') + json.slice(cut)
      }),
      fc.tuple(fc.json(), fc.nat()).map(([json, at]) => json.slice(0, at % (json.length + 1))),
      fc.string(),
    )
    fc.assert(
      fc.property(line, (text) => {
        expect(isJson(text), text).toBe(parses(text))
      }),
      { numRuns: 20_000 },
    )
  })

  test('JSON nested deeper than a call stack reaches is masked, and stays JSON', () => {
    const depth = 100_000
    const open = '{"a":['.repeat(depth)
    const close = ']}'.repeat(depth)
    expect(maskPrinted(`${open}"${FAKE.github}"${close}`, [])).toBe(`${open}"${MASK}"${close}`)
    expect(maskPrinted(`${open}{"token":[1,{"b":2}]}${close}`, [])).toBe(
      `${open}{"token":"${MASK}"}${close}`,
    )
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
  test('outputs built from fragments: no marker the whole-text mask hides is left, no known value', () => {
    const known = ['knownAAA1', 'kn"own2BB', 'k\\nown3CC', '9876543', 'café4DD', '😀5EE']
    const marker = fc.nat({ max: 999 }).map((index) => `Mk${index}Zq`)
    // One shape nested in another, each holding a marker no mask may leave, whatever the order the
    // shapes run in: `Sx<n>Zq`. Each opens on `;`, which no shape takes as the start of its value:
    // a Bearer or a Basic credential just before does not take the nested shape's first word.
    const hidden = fc.nat({ max: 999 }).map((index) => `Sx${index}Zq`)
    const inner = fc.constantFrom(
      'ghp_Q1w2E3r4T5Q1w2E3r4T5',
      'sk-abcdefgh12',
      'AKIAABCDEFGHIJKLMNOP',
      'c2ln',
    )
    const nested = fc.oneof(
      fc
        .tuple(hidden, hidden, inner)
        .map(([header, payload, signature]) => `;eyJ${header}.eyJ${payload}.${signature}`),
      fc
        .tuple(hidden, inner, hidden)
        .map(([header, token, payload]) => `;eyJ${header}-${token}.eyJ${payload}.c2ln`),
      hidden.map((value) => `;password=https://u:${value}@h.test`),
      fc
        .tuple(hidden, hidden)
        .map(([header, payload]) => `;Authorization: Bearer eyJ${header}.eyJ${payload}.c2ln`),
      hidden.map((body) => `;-----BEGIN RSA PRIVATE KEY-----\n${body}`),
    )
    const fragment = fc.oneof(
      {
        weight: 6,
        arbitrary: fc.constantFrom(
          'password=',
          'password: ',
          'token:',
          'api_key=',
          '"',
          "'",
          ' ',
          '\n',
          ',',
          ':',
          '\\',
          'Bearer ',
          'Authorization: ',
          'Cookie: ',
          'Set-Cookie: ',
          'set-cookie=',
          'Basic ',
          'https://u:',
          '@h.test',
          '-----BEGIN RSA PRIVATE KEY-----',
          '-----END RSA PRIVATE KEY-----',
          'ghp_',
          'sk-',
          'eyJ',
          '.',
          '123',
          '{',
          '}',
          '[',
          ']',
          'x',
        ),
      },
      { weight: 3, arbitrary: marker },
      { weight: 1, arbitrary: fc.constantFrom(...known) },
      { weight: 2, arbitrary: nested },
    )
    const text = fc.array(fragment, { minLength: 1, maxLength: 8 }).map((parts) => parts.join(''))
    const name = fc.oneof(
      text,
      fc.constantFrom('a', 'body', 'token', 'cookie', 'name', 'Authorization', 'x'),
    )
    const json = fc.letrec<{ value: fc.JsonValue }>((tie) => ({
      value: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        text,
        fc.constantFrom(123, 9876543, true, null, 1.5),
        fc.array(tie('value'), { minLength: 1, maxLength: 3 }),
        fc.dictionary(name, tie('value'), { minKeys: 1, maxKeys: 3 }),
      ),
    })).value
    const line = fc.oneof(
      text,
      json.map((value) => JSON.stringify(value)),
    )
    const printed = fc.oneof(
      json.map((value) => JSON.stringify(value)),
      json.map((value) => JSON.stringify(value, null, 2)),
      fc
        .tuple(
          fc.array(
            json.map((value) => JSON.stringify(value)),
            { minLength: 1, maxLength: 4 },
          ),
          fc.constantFrom('\n', '\r\n'),
        )
        .map(([lines, end]) => lines.join(end)),
      fc
        .tuple(fc.array(line, { minLength: 1, maxLength: 4 }), fc.constantFrom('\n', '\r\n'))
        .map(([lines, end]) => lines.join(end)),
    )
    fc.assert(
      fc.property(printed, (output) => {
        const masked = holdsTheRule(output, known)
        const whole = maskText(output, known)
        for (const mark of new Set(output.match(/Mk\d+Zq/g) ?? [])) {
          expect(occurrences(masked, mark), mark).toBeLessThanOrEqual(occurrences(whole, mark))
        }
        expect(whole).not.toMatch(/Sx\d+Zq/)
        expect(masked).not.toMatch(/Sx\d+Zq/)
        for (const value of known) {
          expect(masked).not.toContain(value)
          expect(masked).not.toContain(JSON.stringify(value).slice(1, -1))
        }
      }),
      { numRuns: 5_000 },
    )
  })
})

/**
 * A shape of credential written around a marker no mask may leave (`Sx<n>Zq`, in any case): what
 * stands before its value, its value, and what it needs after it. `glued` says its value does not
 * begin a word, so another shape cannot stand at its start; `closed` that it is a credential only
 * while nothing stands between its value and its tail.
 */
interface Written {
  readonly head: string
  readonly value: string
  readonly tail: string
  readonly glued: boolean
  readonly closed: boolean
}

/** The shapes, one writing of each per marker, and the known values written as they are. */
const writings = (mark: string, known: string): ReadonlyArray<Written> => {
  const word = (head: string, value: string, tail = '', glued = false, closed = false) => ({
    head,
    value,
    tail,
    glued,
    closed,
  })
  const upper = mark.toUpperCase().padEnd(16, 'A')
  return [
    word('-----BEGIN RSA PRIVATE KEY-----\n', mark, '\n-----END RSA PRIVATE KEY-----'),
    word('-----BEGIN OPENSSH PRIVATE KEY-----\n', mark),
    word('Authorization: ', mark),
    word('Cookie: ', mark),
    word('set-cookie=', mark),
    word('Bearer ', mark),
    word('Basic ', mark.padEnd(8, 'A')),
    word(`eyJ${mark}.eyJ${mark}.`, `c2ln${mark}`),
    word(`eyJ${mark}-`, `AKIA${upper}.eyJ${mark}.c2ln`, '', true),
    word('ghp_', mark.padEnd(16, 'A'), '', true),
    word('sk-', mark.padEnd(8, 'A'), '', true),
    word('AKIA', upper, '', true),
    word('https://u:', mark, '@h.test', true, true),
    word('password=', mark),
    word('token: ', `"${mark} x"`),
    word("api_key='", mark, "'"),
    word('', known),
  ]
}

/**
 * Where the inner shape stands in the outer one's value: at its start, after the outer value and a
 * `-` (still inside most values), or after a separator that ends some of them.
 */
const POSITIONS = ['start', 'middle', ' ', ';', '.', ',', '=', ':', '/', '\n', '"'] as const

/** One writing nested in another's value, at a position; nothing when there is no such writing. */
const nested = (
  outerAt: number,
  innerAt: number,
  where: (typeof POSITIONS)[number],
  outerMark: string,
  innerMark: string,
  known: ReadonlyArray<string>,
): string | undefined => {
  const outer = writings(outerMark, known[0] ?? '')[outerAt]
  const inner = writings(innerMark, known[1] ?? '')[innerAt]
  if (outer === undefined || inner === undefined) return undefined
  const shape = `${inner.head}${inner.value}${inner.tail}`
  // A glued value has no start another shape can stand at: its inner shape goes after it. A
  // closed shape with another inside may be no credential at all: no marker in its value then.
  return where === 'start' && !outer.glued
    ? `${outer.head}${shape}${outer.tail}`
    : `${outer.head}${outer.closed ? 'pw' : outer.value}${where === 'start' || where === 'middle' ? '-' : where}${shape}${outer.tail}`
}

/**
 * One writing nested in another's value, at a position, masked by every function that masks
 * text: none leaves a marker, and paced masking gives what masking at once gives.
 */
const leavesNoMarker = async (
  outerAt: number,
  innerAt: number,
  where: (typeof POSITIONS)[number],
  outerMark: string,
  innerMark: string,
): Promise<void> => {
  const known = [`kn0wn${outerMark}`, `kn0wn${innerMark}x`]
  const text = nested(outerAt, innerAt, where, outerMark, innerMark, known)
  if (text === undefined) return
  const forms = [
    maskText(text, known),
    maskRecord({ body: text }, known)['body'],
    maskAction({ note: text }, known)?.['note'],
    maskPrinted(text, known),
    maskPrinted(JSON.stringify({ body: text }), known),
    maskPrinted(JSON.stringify([text, { text }]), known),
    await Effect.runPromise(maskTextPaced(text, known, 0)),
    await Effect.runPromise(maskPrintedPaced(text, known, 0)),
  ]
  for (const masked of forms) expect(masked, text).not.toMatch(/sx\d+zq/i)
  expect(forms[6], text).toBe(forms[0])
  expect(forms[7], text).toBe(forms[3])
}

describe('Every shape is matched on the text as it was given', () => {
  // Each shape sees the original text, and what is masked is every stretch any of them hides: a
  // shape that takes the first word of another no longer hides the rest of it.
  const leaks: ReadonlyArray<readonly [string, string, string]> = [
    [
      'a Bearer credential that takes the scheme of a URL',
      'Bearer password=https://user:value@host.test',
      'value',
    ],
    [
      'a Basic credential that takes the first part of a web token',
      `Basic eyJxAAAA-${FAKE.github}.eyJy.sig`,
      'eyJy',
    ],
  ]
  for (const [what, text, secret] of leaks) {
    test(`${what} leaves nothing of the other`, async () => {
      for (const masked of [
        maskShapes(text),
        maskText(text, []),
        maskPrinted(text, []),
        maskPrinted(JSON.stringify({ body: text }), []),
        await Effect.runPromise(maskTextPaced(text, [])),
        await Effect.runPromise(maskPrintedPaced(text, [])),
      ]) {
        expect(masked).not.toContain(secret)
      }
    })
  }

  test('a shape glued to a known value is masked as when the value stood apart', async () => {
    const known = ['kn0wnValue']
    const glued = [
      [FAKE.github, 'abcdefghij'],
      [FAKE.aws, 'EFGHIJKLMNOP'],
      [FAKE.jwt, 'eyJzdWIiOiIxIn0'],
      ['Bearer Sx1Zq', 'Sx1Zq'],
      ['Basic Sx1ZqAAA', 'Sx1Zq'],
      ['Cookie: Sx1Zq', 'Sx1Zq'],
      ['https://u:Sx1Zq@h.test', 'Sx1Zq'],
    ] as const
    await Promise.all(
      glued.map(async ([shape, secret]) => {
        const text = `${known[0] ?? ''}${shape}`
        for (const masked of [
          maskText(text, known),
          maskPrinted(text, known),
          maskPrinted(JSON.stringify({ body: text }), known),
          await Effect.runPromise(maskTextPaced(text, known, 0)),
          await Effect.runPromise(maskPrintedPaced(text, known, 0)),
        ]) {
          expect(masked, text).not.toContain(secret)
          expect(masked, text).not.toContain('kn0wn')
        }
      }),
    )
  })

  test('a shape nested in another, every pair at every position, leaves none of its markers', async () => {
    const indexes = writings('', '').map((_, index) => index)
    // Run at once, the paced maskings take turns with one another.
    await Promise.all(
      indexes.flatMap((outerAt) =>
        indexes.flatMap((innerAt) =>
          POSITIONS.map((where) => leavesNoMarker(outerAt, innerAt, where, 'Sx1Zq', 'Sx2Zq')),
        ),
      ),
    )
  })

  test('the same with markers of any length, 5,000 samples', async () => {
    const mark = fc.nat({ max: 99_999 }).map((index) => `Sx${index}Zq`)
    const at = fc.nat({ max: writings('', '').length - 1 })
    await fc.assert(
      fc.asyncProperty(at, at, fc.constantFrom(...POSITIONS), mark, mark, leavesNoMarker),
      { numRuns: 5_000 },
    )
  })
})

/** The markers a text holds, which no mask may leave once a mask hid them: `Mk<n>Zq`, `Sx<n>Zq`. */
const markersOf = (text: string): ReadonlySet<string> =>
  new Set(text.match(/(?:Mk|Sx)\d+Zq/gi) ?? [])

/**
 * Masking hides at least all that masking the shapes in turn hid (`feature/1.0` before #381, the
 * oracle): no marker and no known value is left more often than the oracle leaves it, by any of
 * the functions that mask text, paced or not.
 */
const hidesAtLeastTheOracle = async (text: string, known: ReadonlyArray<string>): Promise<void> => {
  const oracle = inTurn.maskText(text, known)
  const masks = [
    maskText(text, known),
    maskPrinted(text, known),
    await Effect.runPromise(maskTextPaced(text, known, 0)),
    await Effect.runPromise(maskPrintedPaced(text, known, 0)),
  ]
  for (const masked of masks) {
    for (const word of [...markersOf(text), ...known]) {
      expect(occurrences(masked, word), `${word} in ${JSON.stringify(text)}`).toBeLessThanOrEqual(
        occurrences(oracle, word),
      )
    }
  }
}

describe('Masking hides at least all that masking the shapes in turn hid', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEbody\n-----END RSA PRIVATE KEY-----'
  // A stretch an earlier shape hid holds a space, a quote or a line end; masked first, it let a
  // later shape's value run on through it, and what is glued after it was hidden too.
  const glued: ReadonlyArray<readonly [string, string]> = [
    ["a label's value through a private key", `password=${pem}Sx1Zq`],
    ["a header's value through a private key", `Authorization: ${pem}Sx2Zq`],
    ["a URL's password through a private key", `https://u:${pem}Sx3Zq@h.test`],
    ["a label's value through a quoted header value", 'password=cookie="a b"Sx4Zq'],
    ["a URL's password through a quoted header value", 'https://u:cookie="a b"Sx5Zq@h.test'],
    [
      "a label's value through a header's value through a private key",
      `password=cookie=${pem}tail with Sx9Zq`,
    ],
  ]
  for (const [what, text] of glued) {
    test(`${what}: what is glued after it stays hidden`, async () => {
      expect(inTurn.maskText(text, [])).not.toMatch(/Sx\d+Zq/)
      await hidesAtLeastTheOracle(text, [])
      await hidesAtLeastTheOracle(JSON.stringify({ body: text }), [])
    })
  }

  test('every shape nested in another, at every position', async () => {
    const indexes = writings('', '').map((_, index) => index)
    const known = ['kn0wnSx1Zq', 'kn0wnSx2Zqx']
    await Promise.all(
      indexes.flatMap((outerAt) =>
        indexes.flatMap((innerAt) =>
          POSITIONS.map((where) => {
            const text = nested(outerAt, innerAt, where, 'Sx1Zq', 'Sx2Zq', known)
            return text === undefined ? Promise.resolve() : hidesAtLeastTheOracle(text, known)
          }),
        ),
      ),
    )
  })

  test('outputs built from fragments, 5,000 samples', async () => {
    const known = ['knownAAA1', 'kn"own2BB', 'k\\nown3CC', '9876543', 'café4DD']
    const fragment = fc.oneof(
      {
        weight: 8,
        arbitrary: fc.constantFrom(
          'password',
          'token',
          'api_key',
          'secret',
          '=',
          ': ',
          ':',
          '"',
          "'",
          ' ',
          '\n',
          ',',
          '-',
          '_',
          '.',
          '/',
          '@',
          '\\',
          'Bearer ',
          'Authorization: ',
          'Cookie: ',
          'set-cookie=',
          'Basic ',
          '://',
          'https://u:',
          '@h.test',
          '-----BEGIN RSA PRIVATE KEY-----',
          '-----END RSA PRIVATE KEY-----',
          'ghp_',
          'ghp_ABCDEFGHIJKLMNOPQR',
          'sk-abcdefgh',
          'AKIAABCDEFGHIJKLMNOP',
          'eyJ',
          '.eyJ',
          '-eyJ',
          '123',
          '{',
          '}',
          '[',
          ']',
          'x',
        ),
      },
      { weight: 3, arbitrary: fc.nat({ max: 999 }).map((index) => `Mk${index}Zq`) },
      { weight: 1, arbitrary: fc.constantFrom(...known) },
    )
    const text = fc.array(fragment, { minLength: 1, maxLength: 14 }).map((parts) => parts.join(''))
    const json = fc.letrec<{ value: fc.JsonValue }>((tie) => ({
      value: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        text,
        fc.constantFrom(123, 9876543, true, null),
        fc.array(tie('value'), { minLength: 1, maxLength: 3 }),
        fc.dictionary(fc.oneof(text, fc.constantFrom('a', 'token', 'cookie')), tie('value'), {
          minKeys: 1,
          maxKeys: 3,
        }),
      ),
    })).value
    const printed = fc.oneof(
      text,
      json.map((value) => JSON.stringify(value)),
      fc
        .tuple(
          fc.array(
            fc.oneof(
              text,
              json.map((value) => JSON.stringify(value)),
            ),
            {
              minLength: 1,
              maxLength: 4,
            },
          ),
          fc.constantFrom('\n', '\r\n'),
        )
        .map(([lines, end]) => lines.join(end)),
    )
    await fc.assert(
      fc.asyncProperty(printed, (output) => hidesAtLeastTheOracle(output, known)),
      { numRuns: 5_000 },
    )
  })
})

/**
 * A text masked by every function that masks text, at once and paced: none leaves a marker
 * (`Sx<n>Zq`), and paced masking gives what masking at once gives.
 */
const leavesNoMarkerIn = async (text: string, known: ReadonlyArray<string>): Promise<void> => {
  const forms = [
    maskText(text, known),
    maskRecord({ body: text }, known)['body'],
    maskAction({ note: text }, known)?.['note'],
    maskPrinted(text, known),
    maskPrinted(JSON.stringify({ body: text }), known),
    maskPrinted(JSON.stringify([text, { text }]), known),
    await Effect.runPromise(maskTextPaced(text, known, 0)),
    await Effect.runPromise(maskPrintedPaced(text, known, 0)),
    await Effect.runPromise(maskPrintedPaced(JSON.stringify({ body: text }), known, 0)),
  ]
  for (const masked of forms) expect(masked, text).not.toMatch(/sx\d+zq/i)
  expect(forms[6], text).toBe(forms[0])
  expect(forms[7], text).toBe(forms[3])
  expect(forms[8], text).toBe(forms[4])
}

/**
 * An outer shape whose value runs on to a space or a quote: what stands before its value, and what
 * it needs after it.
 */
const OUTERS: ReadonlyArray<readonly [head: string, tail: string]> = [
  ['password=', ''],
  ['DB_PASSWORD=', ''],
  ['api_key: ', ''],
  ['cookie=', ''],
  ['Cookie: ', ''],
  ['Authorization: ', ''],
  ['set-cookie=', ''],
  ['https://u:', '@h.test'],
  ['git remote https://bob:', '@h.test/r'],
]

/** The names of an inner shape whose value is quoted: labels, and headers. */
const INNER_NAMES = ['token', 'api_key', 'password', 'secret', 'cookie', 'Authorization'] as const

/** Quoted values that hold a space, the other quote, or an escaped quote. */
const QUOTED_VALUES = ['"a b"', "'a b'", `'a"b'`, String.raw`"a\"b c"`, `"a'b"`] as const

/** A known value that holds a space, written over wherever it stands. */
const SPACED_KNOWN = 'k n0wn'

/** A private key block, which holds spaces and line ends. */
const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEbody\n-----END RSA PRIVATE KEY-----'

/**
 * What may stand in the outer value before the inner shape: nothing, a word, or a hidden stretch
 * that holds a space, the inner name glued after it.
 */
const BEFORE_INNER = ['', 'pw-', 'a.', SPACED_KNOWN, PEM] as const

/** What stands between the inner name and its quoted value. */
const SEPARATORS = ['=', ':', ': ', ' = '] as const

/** What may stand before the outer shape, taking its name in a value of its own. */
const BEFORE_OUTER = ['', 'Bearer ', 'Basic '] as const

/** An outer shape whose value holds an inner one with a quoted value, a marker glued after it. */
const quotedInside = (
  before: string,
  outer: readonly [head: string, tail: string],
  inValue: string,
  name: string,
  separator: string,
  quoted: string,
  mark: string,
): string => `${before}${outer[0]}${inValue}${name}${separator}${quoted}${mark}${outer[1]}`

describe('What follows a quoted value inside another value stays hidden', () => {
  // A label's quoted value is hidden by itself; the outer value (a label's bare value, a header's,
  // a URL's password) stopped at its quote or its space, and what follows it stayed readable.
  const leaks: ReadonlyArray<readonly [string, string, string]> = [
    ["a label's value through a quoted label value", 'password=token="a b"Sx6Zq', 'Sx6Zq'],
    [
      "a label's value through a quoted api key",
      'DB_PASSWORD=api_key="x y"tailSECRET',
      'tailSECRET',
    ],
    ["a URL's password through a quoted label value", 'https://u:token="a b"Sx7Zq@h.test', 'Sx7Zq'],
    [
      "a remote's password through a quoted label value",
      'git remote https://bob:token="p q"S3cret@h.test/r',
      'S3cret',
    ],
    ['a cookie through a label value quoted around a quote', `cookie=password='a"b'Sx8Zq`, 'Sx8Zq'],
  ]
  for (const [what, text, secret] of leaks) {
    test(`${what}: ${text} leaves nothing of what follows it`, async () => {
      const json = JSON.stringify({ body: text })
      for (const masked of [
        maskText(text, []),
        maskShapes(text),
        maskRecord({ body: text }, [])['body'],
        maskAction({ note: text }, [])?.['note'],
        maskPrinted(text, []),
        maskPrinted(json, []),
        await Effect.runPromise(maskTextPaced(text, [], 0)),
        await Effect.runPromise(maskPrintedPaced(text, [], 0)),
        await Effect.runPromise(maskPrintedPaced(json, [], 0)),
      ]) {
        expect(masked, text).toBeTypeOf('string')
        expect(masked, text).not.toContain(secret)
      }
      await hidesAtLeastTheOracle(text, [])
      await hidesAtLeastTheOracle(json, [])
    })
  }

  test('a label after a Bearer or Basic credential reads on through a quoted value', async () => {
    // The credential's value takes the label's name, and the label's value still reads on.
    await leavesNoMarkerIn('Bearer password=token="a b"Sx1Zq', [])
    await leavesNoMarkerIn('Basic password=token="a b"Sx2Zq', [])
    await leavesNoMarkerIn('Bearer a/password=token="a b"Sx3Zq', [])
  })

  test('a private key or a known value after the quoted value is read through too', async () => {
    // Each holds a space, and the value around them reads on through both.
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEbody\n-----END RSA PRIVATE KEY-----'
    await leavesNoMarkerIn(`password=token="a b"${pem}Sx1Zq`, [])
    await hidesAtLeastTheOracle(`password=token="a b"${pem}Sx1Zq`, [])
    await leavesNoMarkerIn('password=token="a b"k n0wnSx2Zq', ['k n0wn'])
    await hidesAtLeastTheOracle('password=token="a b"k n0wnSx2Zq', ['k n0wn'])
  })

  test('a quoted value only the shapes in turn find is read through too', async () => {
    // Glued to a known value, the header begins no word until the value is written over.
    await leavesNoMarkerIn('Authorization: kn0wnCookie: "a b"Sx1Zq', ['kn0wn'])
    await hidesAtLeastTheOracle('Authorization: kn0wnCookie: "a b"Sx1Zq', ['kn0wn'])
  })

  test('an inner name glued after a hidden stretch that holds a space stays readable', async () => {
    // The outer value runs through the stretch and ends on the inner name: what is written over
    // stops at the stretch's last space, and the inner label still reads its value.
    const texts = [
      `password=${SPACED_KNOWN}token: "a"Sx1Zq`,
      `password=${PEM}token: "a"Sx3Zq`,
      `password=${PEM}token = 'a b'Sx4Zq`,
    ]
    await Promise.all(
      texts.map(async (text) => {
        await leavesNoMarkerIn(text, [SPACED_KNOWN])
        await hidesAtLeastTheOracle(text, [SPACED_KNOWN])
      }),
    )
  })

  test(
    'every outer shape around every quoted inner one, at every position, leaves no marker',
    { timeout: 600_000 },
    async () => {
      const texts = BEFORE_OUTER.flatMap((before) =>
        OUTERS.flatMap((outer) =>
          BEFORE_INNER.flatMap((inValue) =>
            INNER_NAMES.flatMap((name) =>
              SEPARATORS.flatMap((separator) =>
                QUOTED_VALUES.map((quoted) =>
                  quotedInside(before, outer, inValue, name, separator, quoted, 'Sx1Zq'),
                ),
              ),
            ),
          ),
        ),
      )
      // Run at once, the paced maskings take turns with one another.
      await Promise.all(
        texts.map(async (text) => {
          await leavesNoMarkerIn(text, [SPACED_KNOWN])
          await hidesAtLeastTheOracle(text, [SPACED_KNOWN])
        }),
      )
    },
  )

  test(
    'the same with quoted values and markers of any kind, 5,000 samples',
    { timeout: 600_000 },
    async () => {
      const units = (quote: string) =>
        quote === '"'
          ? fc.constantFrom('a', ' ', "'", String.raw`\"`, '\\\\', '@', '/', ':', '=')
          : fc.constantFrom('a', ' ', '"', '\\', '@', '/', ':', '=')
      const quoted = fc
        .constantFrom('"', "'")
        .chain((quote) =>
          fc
            .array(units(quote), { maxLength: 6 })
            .map((parts) => `${quote}${parts.join('')}${quote}`),
        )
      const mark = fc.nat({ max: 99_999 }).map((index) => `Sx${index}Zq`)
      const after = fc.constantFrom('', ' and more', '\nnext', ';', ',x')
      const text = fc
        .tuple(
          fc.constantFrom(...BEFORE_OUTER),
          fc.constantFrom(...OUTERS),
          fc.constantFrom(...BEFORE_INNER),
          fc.constantFrom(...INNER_NAMES),
          fc.constantFrom(...SEPARATORS),
          quoted,
          mark,
          after,
        )
        .map(
          ([before, outer, inValue, name, separator, value, marker, rest]) =>
            `${quotedInside(before, outer, inValue, name, separator, value, marker)}${rest}`,
        )
      const known = ['kn0wnAAA1', SPACED_KNOWN]
      await fc.assert(
        fc.asyncProperty(text, async (written) => {
          await leavesNoMarkerIn(written, known)
          await hidesAtLeastTheOracle(written, known)
        }),
        { numRuns: 5_000 },
      )
    },
  )
})

/** How long `work` takes, run `times` times, in milliseconds. */
const timed = (work: () => string, times: number): number => {
  const start = performance.now()
  for (let run = 0; run < times; run += 1) work()
  return performance.now() - start
}

/**
 * How much longer masking takes on an input 16 times larger: about 16 when it is linear, 256 when
 * quadratic. The two sizes are timed in turn, seven times, each run long enough to be measured,
 * and each keeps its fastest: a load on the machine weighs on both alike.
 */
const growth = (make: (size: number) => string, mask: (text: string) => string, size: number) => {
  const small = make(size)
  const large = make(16 * size)
  let times = 1
  while (timed(() => mask(small), times) < 10) times *= 2
  let fastestSmall = Number.POSITIVE_INFINITY
  let fastestLarge = Number.POSITIVE_INFINITY
  for (let round = 0; round < 7; round += 1) {
    fastestSmall = Math.min(
      fastestSmall,
      timed(() => mask(small), times),
    )
    fastestLarge = Math.min(
      fastestLarge,
      timed(() => mask(large), times),
    )
  }
  return fastestLarge / fastestSmall
}

describe('Masking takes time in proportion to what it masks, whatever it is given', () => {
  const token = `ghp_${'Q1w2E3r4T5'.repeat(2)}`
  const text = (printed: string) => maskText(printed, [])
  const printed = (output: string) => maskPrinted(output, [])
  const cases: ReadonlyArray<
    readonly [string, (size: number) => string, (text: string) => string, number]
  > = [
    ['a run of a-a-a- (labels)', (size) => 'a-'.repeat(size / 2), text, 4_000],
    ['a run of a.a.a. (URLs)', (size) => 'a.'.repeat(size / 2), text, 4_000],
    ['a run of eyJ-eyJ- (web tokens)', (size) => 'eyJ-'.repeat(size / 4), text, 4_000],
    ['a run of password-password-', (size) => 'password-'.repeat(size / 9), text, 270],
    ['a run of password_password_', (size) => 'password_'.repeat(size / 9), text, 270],
    ['a run of password=password=', (size) => 'password='.repeat(size / 9), text, 4_000],
    [
      'labels nested in labels (password=a.token="b")',
      (size) => 'password=a.token="b" '.repeat(size / 21),
      text,
      4_000,
    ],
    [
      'labels read through quoted labels (password=token="a b"x)',
      (size) => 'password=token="a b"x '.repeat(size / 22),
      text,
      4_000,
    ],
    [
      'tokens with no space or quote between them',
      (size) => `${token},`.repeat(size / 25),
      text,
      64_000,
    ],
    [
      'a JSON string of URLs read through quoted labels',
      (size) => JSON.stringify({ body: 'https://u:token="a b"x@h '.repeat(size / 25) }),
      printed,
      4_000,
    ],
    [
      'a run of a-a-a- in a JSON string',
      (size) => JSON.stringify([{ body: 'a-'.repeat(size / 2) }]),
      printed,
      4_000,
    ],
    [
      'a JSON string holding many tokens',
      (size) => JSON.stringify({ body: Array.from({ length: size / 25 }, () => token).join(' ') }),
      printed,
      20_000,
    ],
    [
      'a JSON string holding many labelled values',
      (size) => JSON.stringify({ body: 'password="x" '.repeat(size / 13) }),
      printed,
      4_000,
    ],
    [
      'lines that open like JSON and are not',
      (size) => '{"a" x\n'.repeat(size / 7),
      printed,
      4_000,
    ],
    ['lines of a diff', (size) => '-a\n'.repeat(size / 3), printed, 4_000],
    [
      'NDJSON lines holding tokens',
      (size) => `{"t":"${token}"}\n`.repeat(size / 31),
      printed,
      4_000,
    ],
  ]
  for (const [what, make, mask, size] of cases) {
    test(
      `${what}: 16 times the input takes less than 64 times as long`,
      { timeout: 600_000 },
      () => {
        expect(growth(make, mask, size)).toBeLessThan(64)
      },
    )
  }
})

describe('Masking a long output lets the engine go on', () => {
  test('another fiber runs while a long output is masked, and the mask is the same', async () => {
    const token = `ghp_${'Q1w2E3r4T5'.repeat(2)}`
    const output = JSON.stringify({ body: Array.from({ length: 40_000 }, () => token).join(' ') })
    let turns = 0
    let timerFired = false
    const { masked, turnsWhileMasking } = await Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.forkChild(
          Effect.forever(
            Effect.andThen(
              Effect.sync(() => {
                turns += 1
              }),
              Effect.yieldNow,
            ),
          ),
        )
        setTimeout(() => {
          timerFired = true
        }, 0)
        const before = turns
        const result = yield* maskPrintedPaced(output, [])
        return { masked: result, turnsWhileMasking: turns - before }
      }),
    )
    expect(turnsWhileMasking).toBeGreaterThan(0)
    expect(timerFired).toBe(true)
    expect(masked).toBe(maskPrinted(output, []))
  })

  test('maskings that run at once give each the mask it gives alone', async () => {
    const lines = (name: string, count: number) =>
      Array.from(
        { length: count },
        (_, index) => `${name} ${index} Bearer ${name}${index}Zq ghp_${'Q1w2E3r4T5'.repeat(2)}`,
      ).join('\n')
    const first = lines('Aa', 3_000)
    const second = lines('Bb', 2_000)
    // Slices of 0 ms: each masking gives way after every step, so the two take turns step by
    // step, whatever the speed of the machine.
    const [firstPrinted, secondText, secondPrinted] = await Effect.runPromise(
      Effect.all(
        [
          maskPrintedPaced(first, [], 0),
          maskTextPaced(second, [], 0),
          maskPrintedPaced(second, [], 0),
        ],
        { concurrency: 'unbounded' },
      ),
    )
    expect(firstPrinted).toBe(maskPrinted(first, []))
    expect(secondText).toBe(maskText(second, []))
    expect(secondPrinted).toBe(maskPrinted(second, []))
  })
})

/** Known values that cannot be read: any masking given them throws. */
class Unreadable extends Array<string> {
  override [Symbol.iterator](): ArrayIterator<string> {
    throw new Error('the values cannot be read')
  }
}

describe('A mask that fails gives •••, never the text, and never fails', () => {
  // A quoted value of megabytes after a label: the pattern of a quoted value runs out of the
  // stack its engine backtracks on, and throws.
  const quoted = `token: "${'x'.repeat(16 * 1024 * 1024)}"`
  const unreadable = new Unreadable()

  test('a pattern that throws on a quoted value of megabytes', async () => {
    expect(maskText(quoted, [])).toBe(MASK)
    expect(maskPrinted(quoted, [])).toBe(MASK)
    expect(await Effect.runPromise(maskTextPaced(quoted, []))).toBe(MASK)
    expect(await Effect.runPromise(maskPrintedPaced(quoted, []))).toBe(MASK)
  })

  test('known values that throw as they are read', async () => {
    expect(maskText('a ghp_ text', unreadable)).toBe(MASK)
    expect(maskPrinted('{"a":"text"}', unreadable)).toBe(MASK)
    expect(await Effect.runPromise(maskTextPaced('a text', unreadable))).toBe(MASK)
    expect(await Effect.runPromise(maskPrintedPaced('{"a":"text"}', unreadable))).toBe(MASK)
  })
})
