/**
 * A session's instructions in three layers: Hemera's base with its placeholders, the role's layer,
 * and the Project's instruction files — sent only to an agent that does not read them itself.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { openProfile } from '../src/engine/migrate.ts'
import { SYSTEM_GIT, gitLayer, spawnGit } from '../src/engine/git.ts'
import { createProject } from '../src/engine/projects.ts'
import { repositoryStatusesLayer } from '../src/engine/repositories.ts'
import { secretsRegistry } from '../src/engine/secrets.ts'
import {
  filesToSend,
  instructionFilesOf,
  instructionsText,
  languageName,
  placeRepositories,
  renderBase,
} from '../src/engine/sessions/instructions.ts'
import { TEST_ROLE } from './test-role.ts'
import { repository } from './repositories.ts'
import { SHIPPED, on, removeFolders, temporaryFolder } from './storage.ts'

let data: string
let work: string

beforeEach(async () => {
  data = temporaryFolder('session-instructions')
  work = temporaryFolder('session-instructions-work')
  await on(data, openProfile(data, SHIPPED, '1.0.0'))
})
afterEach(removeFolders)

const VALUES = {
  owner: 'mission ACME-12',
  role: 'the Builder',
  userLanguage: 'fr',
  specLanguage: 'en',
  readsMemory: true,
  testerMode: null,
  hemeraOnly: true,
}

describe('Hemera’s base layer', () => {
  test('its placeholders are filled: the owner, the role, the two languages', () => {
    const base = renderBase(VALUES)
    expect(base).toContain(
      'You are\none session of mission ACME-12, with the role **the Builder**.',
    )
    expect(base).toContain('is in **French**.')
    expect(base).toContain("the Project's Spec language, **English**.")
    expect(base).not.toMatch(/\{[a-zA-Z#/]/)
  })

  test('the Memory section is kept for a role that reads it and dropped for one that does not', () => {
    expect(renderBase(VALUES)).toContain('## The Memory')
    const without = renderBase({ ...VALUES, readsMemory: false })
    expect(without).not.toContain('## The Memory')
    expect(without).not.toContain('memory_read')
    expect(without).toContain('## How information reaches you')
  })

  test('the tester mode slot holds its paragraph only when the mode is on', () => {
    expect(renderBase(VALUES)).not.toContain('Tester mode')
    expect(
      renderBase({ ...VALUES, testerMode: 'Tester mode is on: report what you find.' }),
    ).toMatch(/Tester mode is on: report what you find\.$/)
  })

  test('only Hemera writes to a role but the Chat: the user writes to the Chat directly', () => {
    expect(renderBase(VALUES)).toContain('In a mission no human writes to you')
    const chat = renderBase({ ...VALUES, hemeraOnly: false })
    expect(chat).not.toContain('no human writes to you')
    expect(chat).toContain('## How information reaches you')
    expect(chat).not.toMatch(/\{[a-zA-Z#/]/)
  })

  test('a language Hemera cannot name is said as its tag', () => {
    expect(languageName('de')).toBe('German')
    expect(languageName('not a tag')).toBe('not a tag')
  })
})

describe('The three layers', () => {
  test('base, then the role, then the Project’s files, an empty layer left out', () => {
    const files = [{ repository: 'api', file: 'CLAUDE.md' as const, text: 'Run pnpm test.' }]
    const text = instructionsText('BASE', TEST_ROLE, files, 'en', 'en')
    expect(text.split('\n\n---\n\n')).toEqual([
      'BASE',
      TEST_ROLE.template,
      '# The Project’s own instructions\n\n## api/CLAUDE.md\n\nRun pnpm test.',
    ])
    expect(instructionsText('BASE', TEST_ROLE, [], 'en', 'en').split('\n\n---\n\n')).toHaveLength(2)
    const speaking = { ...TEST_ROLE, template: 'Answer in {user.language}, briefly.' }
    expect(instructionsText('BASE', speaking, [], 'fr', 'en')).toContain(
      'Answer in French, briefly.',
    )
    const writing = { ...TEST_ROLE, template: 'Write in {project.specLanguage}.' }
    expect(instructionsText('BASE', writing, [], 'en', 'de')).toContain('Write in German.')
    expect(
      instructionsText('BASE', { ...TEST_ROLE, projectLayer: false }, files, 'en', 'en').split(
        '\n\n---\n\n',
      ),
    ).toHaveLength(2)
  })
})

describe('The Project’s layer, and bare mode', () => {
  const twoRepositories = () => {
    const api = join(work, 'api')
    const web = join(work, 'web')
    mkdirSync(api, { recursive: true })
    mkdirSync(web, { recursive: true })
    writeFileSync(join(api, 'CLAUDE.md'), 'api: claude')
    writeFileSync(join(api, 'AGENTS.md'), 'api: agents')
    writeFileSync(join(web, 'AGENTS.md'), 'web: agents')
    return [
      { repository: 'api', folder: api },
      { repository: 'web', folder: web },
      { repository: 'shared', folder: join(work, 'shared') },
    ]
  }

  test('an agent that does not read them is sent its own file, the other one when it is absent, nothing when neither', () => {
    const sent = filesToSend(ADAPTERS.claude, 'linux', twoRepositories())
    expect(sent.map((one) => [one.repository, one.file, one.text])).toEqual([
      ['api', 'CLAUDE.md', 'api: claude'],
      ['web', 'AGENTS.md', 'web: agents'],
    ])
    const toOpencode = filesToSend(ADAPTERS.opencode, 'linux', twoRepositories())
    expect(toOpencode.map((one) => one.file)).toEqual(['AGENTS.md', 'AGENTS.md'])
  })

  test('an agent that reads them itself is sent none, never both', () => {
    expect(filesToSend(ADAPTERS.codex, 'linux', twoRepositories())).toEqual([])
  })

  test('the repositories of the main checkout, and for the settings what each agent does with them', async () => {
    const main = join(work, 'acme')
    repository(join(main, 'api'))
    repository(join(main, 'web'))
    writeFileSync(join(main, 'api', 'CLAUDE.md'), 'api: claude')
    const [places, files] = await on(
      data,
      Effect.gen(function* () {
        const project = yield* createProject({
          name: 'Acme',
          mainCheckout: main,
          repositories: ['api', 'web'],
        })
        return [
          yield* placeRepositories(project.id, main),
          yield* instructionFilesOf(project.id, 'linux'),
        ] as const
      }).pipe(
        Effect.provide(
          Layer.merge(
            gitLayer(spawnGit(SYSTEM_GIT, secretsRegistry().mask)),
            repositoryStatusesLayer,
          ),
        ),
      ),
    )
    expect(places).toEqual([
      { repository: 'api', folder: join(main, 'api') },
      { repository: 'web', folder: join(main, 'web') },
    ])
    expect(files[0]).toEqual({
      repository: 'api',
      files: ['CLAUDE.md'],
      agents: [
        { agent: 'claude', how: 'sent', file: 'CLAUDE.md' },
        { agent: 'codex', how: 'none', file: null },
        { agent: 'opencode', how: 'sent', file: 'CLAUDE.md' },
      ],
    })
    expect(files[1]?.files).toEqual([])
  })
})
