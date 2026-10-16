/**
 * The known secret values, in the engine's memory only: registered by their source, masked in
 * whatever is written or shown, and no longer masked once their source is gone.
 *
 * The registry is fed by the variables of the Projects and their Workspaces, at the engine's
 * start and on every change; what it masks reaches the diagnostic, a run's output, a need's
 * fields and the errors of Git.
 */

import { mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

import { MASK, maskShapes, maskText } from '@hemera/core/domain'
import { Effect } from 'effect'
import * as fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { DIAGNOSTIC_FILE, openDiagnosticLog } from '../src/main/diagnostic.ts'
import { createMission } from '../src/engine/missions.ts'
import { getNeed, requestFromAgent } from '../src/engine/needs.ts'
import { createProject } from '../src/engine/projects.ts'
import { awaitRun, runOutput, startRun } from '../src/engine/runs.ts'
import { maskedHead, secretWorthy, secretsRegistry } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { commandRuns, needs } from '../src/engine/storage/schema.ts'
import { removeVariable, setVariable } from '../src/engine/variables.ts'
import { commandsEngine, nodeLine, script } from './commands-engine.ts'
import { KNOWN_SECRET, QUOTED_SECRET, expectMaskedJson } from './json-masked.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(() => {
  data = realpathSync.native(temporaryFolder('secrets'))
  work = realpathSync.native(temporaryFolder('secrets-work'))
})
afterEach(removeFolders)

const acme = () => {
  const folder = join(work, 'acme')
  mkdirSync(folder, { recursive: true })
  return createProject({ name: 'Acme', mainCheckout: folder, repositories: [] })
}

describe('The registry masks what is registered, and only while it is', () => {
  test('a value is masked once registered, and no longer once its source is unregistered', () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', ['hunter2'])
    expect(secrets.mask('the password is hunter2')).toBe(`the password is ${MASK}`)
    secrets.unregister('project-variables:acme')
    expect(secrets.mask('the password is hunter2')).toBe('the password is hunter2')
  })

  test('an empty value is never registered', () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', ['', 'abc123'])
    expect(secrets.values()).toEqual(['abc123'])
  })

  test('a boolean or a value under six characters is not registered, so `1` or `dev` stays in clear inside other words', () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', [
      '1',
      'dev',
      'true',
      '3000',
      '12.5',
      'quartz-violet-4471',
    ])
    expect(secrets.values()).toEqual(['quartz-violet-4471'])
    expect(secrets.mask('pnpm dev on port 3001, devices 1 to 10, true')).toBe(
      'pnpm dev on port 3001, devices 1 to 10, true',
    )
  })

  test('a real secret beside trivial values is still masked wherever it stands, inside a longer line too', () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', ['1', 'dev', 'quartz-violet-4471'])
    expect(
      secrets.mask(
        'curl https://dev.example.com/v1?key=quartz-violet-4471&page=1 --idquartz-violet-4471x',
      ),
    ).toBe(`curl https://dev.example.com/v1?key=${MASK}&page=1 --id${MASK}x`)
  })

  test('a number of six characters or more is a secret like any value: a 10-digit account id is masked inside a line, `3000` and `1` stay in clear', () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', ['8421397701', '3000', '1'])
    expect(secrets.values()).toEqual(['8421397701'])
    expect(secrets.mask('account 8421397701 on port 3000, retry 1')).toBe(
      `account ${MASK} on port 3000, retry 1`,
    )
  })

  test('a source registered again replaces its values', () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', ['first-value'])
    secrets.register('project-variables:acme', ['second-value'])
    expect(secrets.values()).toEqual(['second-value'])
  })
})

describe('The head of a long text is masked without masking the whole of it (#392)', () => {
  const VALUE = 'violet-heron-5521-quartz'

  test('a value the cut splits in two is never kept in clear, even when the values masked before it shorten the head', async () => {
    const secrets = secretsRegistry()
    secrets.register('suite', [VALUE])
    // Each value masked shortens the head, so what the cut split moves within what is kept.
    const text = `${VALUE} `.repeat(100_000)
    const head = await Effect.runPromise(maskedHead(secrets, text, 2000))
    expect(head).not.toContain('violet')
    expect(head.length).toBeLessThanOrEqual(2000)
  })

  test('a registered value longer than the margin, which the cut would split, is masked whole and never kept in part', async () => {
    const secrets = secretsRegistry()
    // A certificate kept as a variable: three times longer than the margin.
    const long = 'certificate-line-'.repeat(720)
    secrets.register('suite', [long])
    const text = `${'a'.repeat(1500)}${long}${'b'.repeat(1024 * 1024)}`
    const head = await Effect.runPromise(maskedHead(secrets, text, 2000))
    expect(head).not.toContain('certificate')
    expect(head.startsWith(`${'a'.repeat(1500)}${MASK}b`)).toBe(true)
  })

  test('a short text is masked whole, and a long one keeps the head it asked for, masked', async () => {
    const secrets = secretsRegistry()
    secrets.register('suite', [VALUE])
    const short = await Effect.runPromise(maskedHead(secrets, `key ${VALUE}`, 2000))
    expect(short).toBe(`key ${MASK}`)
    const long = await Effect.runPromise(
      maskedHead(secrets, `key ${VALUE} ${'x'.repeat(1024 * 1024)}`, 100),
    )
    expect(long).toBe(`key ${MASK} ${'x'.repeat(100 - `key ${MASK} `.length)}`)
  })
})

describe('The registry masks a JSON text as JSON (#397)', () => {
  const registry = () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', [KNOWN_SECRET])
    return secrets
  }
  const texts = [
    JSON.stringify([QUOTED_SECRET, `key ${KNOWN_SECRET}`]),
    JSON.stringify({ label: `Use ${QUOTED_SECRET}`, detail: KNOWN_SECRET }),
    JSON.stringify([{ id: 'A', label: QUOTED_SECRET, detail: `${KNOWN_SECRET}.` }], null, 2),
  ]

  test('a serialized list or object holding a quoted credential and a known value keeps nothing of either, and stays JSON', async () => {
    const secrets = registry()
    const paced = await Effect.runPromise(Effect.forEach(texts, secrets.maskPaced))
    for (const masked of [...texts.map(secrets.mask), ...paced]) expectMaskedJson(masked)
  })

  test('JSON lines among text keep nothing of either, and each stays JSON', async () => {
    const secrets = registry()
    const printed = ['Proposals:', ...texts.slice(0, 2)].join('\n')
    const paced = await Effect.runPromise(secrets.maskPaced(printed))
    for (const masked of [secrets.mask(printed), paced]) {
      const [head, ...lines] = masked.split('\n')
      expect(head).toBe('Proposals:')
      for (const line of lines) expectMaskedJson(line)
    }
  })

  test('a text that is not JSON is masked as plain text masks it', async () => {
    const secrets = registry()
    const plainTexts = [
      `Sign with ${QUOTED_SECRET} then ${KNOWN_SECRET}.`,
      'Authorization: Bearer abcdef123456 was sent',
      `Two lines: ${KNOWN_SECRET}\nand https://user:hunter22@example.test/x`,
    ]
    const plain = plainTexts.map((one) => maskText(one, [KNOWN_SECRET]))
    expect(plainTexts.map(secrets.mask)).toEqual(plain)
    expect(await Effect.runPromise(Effect.forEach(plainTexts, secrets.maskPaced))).toEqual(plain)
  })
})

describe('The registry masks a JSON string written inside a text as a JSON string (#401)', () => {
  const registry = () => {
    const secrets = secretsRegistry()
    secrets.register('project-variables:acme', [KNOWN_SECRET, 'se"same-4417'])
    return secrets
  }
  // Each: the prose before the JSON, the JSON, and what must not be left.
  const texts: ReadonlyArray<readonly [string, string, ReadonlyArray<string>]> = [
    ['The user answered: ', '{\n  "a": "password=\\"a b\\""\n}', ['a b']],
    ['The user answered: ', '[\n  "password=\\"a b\\"",\n  "token: \\"c d\\""\n]', ['a b', 'c d']],
    ['The user answered: ', JSON.stringify({ a: QUOTED_SECRET, b: KNOWN_SECRET }), ['a b']],
    ['Said: ', '{\n  "h": "Authorization: Bearer \\"a b\\" tail"\n}', ['a b', 'tail']],
    ['Note: ', '{"a":"x se\\"same-4417 y"}', ['same-4417']],
  ]

  test('JSON after a sentence keeps nothing of a quoted credential or a known value, and still parses', async () => {
    const secrets = registry()
    const after = '\nthat is all'
    const written = texts.map(([before, json]) => `${before}${json}${after}`)
    const paced = await Effect.runPromise(Effect.forEach(written, secrets.maskPaced))
    texts.forEach(([before, , kept], index) => {
      const masked = secrets.mask(written[index] ?? '')
      expect(paced[index]).toBe(masked)
      expect(masked.startsWith(before) && masked.endsWith(after), masked).toBe(true)
      for (const secret of [...kept, KNOWN_SECRET]) expect(masked).not.toContain(secret)
      expect(() => JSON.parse(masked.slice(before.length, -after.length)), masked).not.toThrow()
    })
  })
})

describe('Every line written through the diagnostic sink is masked', () => {
  test('no registered value survives a line of the diagnostic', () => {
    fc.assert(
      fc.property(
        fc
          .string({ minLength: 6, maxLength: 20, unit: 'grapheme-ascii' })
          .filter((value) => secretWorthy(value) && !value.includes('\n')),
        fc.string({ maxLength: 30, unit: 'grapheme-ascii' }),
        (value, words) => {
          const folder = temporaryFolder('secrets-sink')
          const secrets = secretsRegistry()
          secrets.register('jev-key', [value])
          openDiagnosticLog(folder, 'engine', secrets.mask)(`${words}${value}${words}`)
          expect(readFileSync(join(folder, DIAGNOSTIC_FILE), 'utf8')).not.toContain(value)
        },
      ),
      { numRuns: 50 },
    )
  })

  test('main, which holds no registry, still masks the shapes of credentials', () => {
    const folder = temporaryFolder('secrets-main')
    openDiagnosticLog(
      folder,
      'main',
      maskShapes,
    )('fetched https://user:hunter2@git.example.com/acme')
    expect(readFileSync(join(folder, DIAGNOSTIC_FILE), 'utf8')).not.toContain('hunter2')
  })
})

describe('The variables of the Projects and Workspaces are registered', () => {
  test('on every change, and a variable removed is no longer masked in new writes', async () => {
    const secrets = secretsRegistry()
    const [set, removed] = await commandsEngine(data, { secrets })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const scope = { projectId: project.id, workspaceId: null }
          yield* setVariable({ ...scope, key: 'DB_URL', value: 'postgres-value-42' })
          const whileSet = secrets.mask('connecting to postgres-value-42')
          yield* removeVariable({ ...scope, key: 'DB_URL' })
          return [whileSet, secrets.mask('connecting to postgres-value-42')]
        }),
      ),
    )
    expect(set).toBe(`connecting to ${MASK}`)
    expect(removed).toBe('connecting to postgres-value-42')
  })

  test('at the engine’s start, from the variables already in the Profile', async () => {
    await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.flatMap(acme(), (project) =>
          setVariable({
            projectId: project.id,
            workspaceId: null,
            key: 'API_TOKEN',
            value: 'tok-from-before',
          }),
        ),
      ),
    )
    const secrets = secretsRegistry()
    await commandsEngine(data, { secrets })(() => Effect.void)
    expect(secrets.mask('sent tok-from-before')).toBe(`sent ${MASK}`)
  })
})

describe('What a command prints, and what an agent asks, is masked before it is kept', () => {
  test('a run’s output is masked in what is shown and in what is stored', async () => {
    const secrets = secretsRegistry()
    const [shown, stored] = await commandsEngine(data, { secrets })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          yield* setVariable({
            projectId: project.id,
            workspaceId: null,
            key: 'DEPLOY_KEY',
            value: 'deploy-key-77',
          })
          const started = yield* startRun({
            projectId: project.id,
            workspaceId: null,
            commandId: null,
            line: nodeLine(
              script("console.log('using deploy-key-77 and ghp_0123456789abcdefghij')"),
            ),
            folder: null,
            startedBy: 'user',
            sessionId: null,
          })
          yield* awaitRun(started.id)
          const database = yield* Database
          const rows = yield* database.select({ output: commandRuns.output }).from(commandRuns)
          return [(yield* runOutput(started.id)).output, rows[0]?.output ?? ''] as const
        }),
      ),
    )
    for (const text of [shown, stored]) {
      expect(text).toContain('using')
      expect(text).not.toContain('deploy-key-77')
      expect(text).not.toContain('ghp_0123456789abcdefghij')
    }
  })

  test('a value written with a template is masked as it was filled for the process', async () => {
    const output = await commandsEngine(data)(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          yield* setVariable({
            projectId: project.id,
            workspaceId: null,
            key: 'SESSION_SECRET',
            value: 'pw-for-{project}-zz',
          })
          const started = yield* startRun({
            projectId: project.id,
            workspaceId: null,
            commandId: null,
            line: nodeLine(script('console.log(`got ${process.env.SESSION_SECRET}`)')),
            folder: null,
            startedBy: 'user',
            sessionId: null,
          })
          yield* awaitRun(started.id)
          return (yield* runOutput(started.id)).output
        }),
      ),
    )
    expect(output).toContain(`got ${MASK}`)
    expect(output).not.toContain('pw-for-')
  })

  test('the fields of a need an agent asks for are masked before they are stored', async () => {
    const secrets = secretsRegistry()
    secrets.register('jev-key', ['jev-KEY-123'])
    const [need, stored] = await commandsEngine(data, {
      secrets,
      missions: { grants: { holds: () => Effect.succeed(true) } },
    })(({ profile }) =>
      profile.use(
        Effect.gen(function* () {
          const project = yield* acme()
          const { id } = yield* createMission({
            projectId: project.id,
            idea: { sentence: 'Export the invoices', ticket: null },
          })
          const asked = yield* requestFromAgent(
            { id: 'session-1', role: 'builder', missionId: id },
            'Decision',
            {
              question: 'Is jev-KEY-123 the key to use?',
              options: ['yes', 'no'],
              recommended: null,
            },
            null,
          )
          const database = yield* Database
          const rows = yield* database.select({ fields: needs.fields }).from(needs)
          return [yield* getNeed(asked.id), rows[0]?.fields ?? ''] as const
        }),
      ),
    )
    expect(stored).not.toContain('jev-KEY-123')
    expect(need.fields).toMatchObject({ question: `Is ${MASK} the key to use?` })
  })
})
