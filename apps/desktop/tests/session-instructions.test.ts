/**
 * A session's instructions in three layers: Hemera's base with its placeholders, the role's layer,
 * and the Project's instruction files — sent only to an agent that does not read them itself.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'

import { TESTER_PARAGRAPH } from '@hemera/core/domain'
import { Effect, Layer } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { ADAPTERS } from '../src/engine/agents/adapters/index.ts'
import { SYSTEM_PROMPT_BOUNDARY } from '../src/engine/agents/prompt-blocks.ts'
import { openProfile } from '../src/engine/migrate.ts'
import { SYSTEM_GIT, gitLayer, spawnGit } from '../src/engine/git.ts'
import { startedWithTesterMode } from '../src/engine/tester/mode.ts'
import { createProject } from '../src/engine/projects.ts'
import { repositoryStatusesLayer } from '../src/engine/repositories.ts'
import { secretsRegistry } from '../src/engine/secrets.ts'
import { Database } from '../src/engine/storage/database.ts'
import { workspaceRepositories, workspaces } from '../src/engine/storage/schema.ts'
import {
  filesToSend,
  instructionFilesOf,
  instructionsText,
  languageName,
  placeRepositories,
  renderBase,
  renderSession,
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

describe('Hemera’s base layer, shared by every session of a role', () => {
  test('its placeholders are filled with the role, and it names no mission and no language', () => {
    const base = renderBase(VALUES)
    expect(base).toContain('You have\nthe role **the Builder**;')
    expect(base).not.toContain('ACME-12')
    expect(base).not.toContain('French')
    expect(base).not.toContain('## Language')
    expect(base).not.toMatch(/\{[a-zA-Z#/]/)
  })

  test('the Memory section is kept for a role that reads it and dropped for one that does not', () => {
    expect(renderBase(VALUES)).toContain('## The Memory')
    const without = renderBase({ ...VALUES, readsMemory: false })
    expect(without).not.toContain('## The Memory')
    expect(without).not.toContain('memory_read')
    expect(without).toContain('## How information reaches you')
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

describe('What belongs to one session', () => {
  test('the owner and the two languages are filled', () => {
    const session = renderSession(VALUES)
    expect(session).toContain('You are one session of mission ACME-12.')
    expect(session).toContain('is in **French**.')
    expect(session).toContain("the Project's Spec language, **English**.")
    expect(session).not.toMatch(/\{[a-zA-Z#/]/)
  })

  test('the tester mode slot holds its paragraph only when the mode is on', () => {
    expect(renderSession(VALUES)).not.toContain('Tester mode')
    expect(
      renderSession({ ...VALUES, testerMode: 'Tester mode is on: report what you find.' }),
    ).toMatch(/Tester mode is on: report what you find\.$/)
  })
})

describe('The instructions around the cache boundary', () => {
  const files = [{ repository: 'api', file: 'CLAUDE.md' as const, text: 'Run pnpm test.' }]
  const layers = (text: string) => text.split(`\n\n${SYSTEM_PROMPT_BOUNDARY}\n\n`)

  test('the base and the role’s layer, then the boundary, then the session and the Project’s files', () => {
    const [shared, session] = layers(instructionsText(VALUES, TEST_ROLE, files))
    expect(shared?.split('\n\n---\n\n')).toEqual([renderBase(VALUES), TEST_ROLE.template])
    expect(session?.split('\n\n---\n\n')).toEqual([
      renderSession(VALUES),
      '# The Project’s own instructions\n\n## api/CLAUDE.md\n\nRun pnpm test.',
    ])
  })

  test('an empty layer is left out, the boundary stays', () => {
    const [shared, session] = layers(instructionsText(VALUES, TEST_ROLE, []))
    expect(shared?.split('\n\n---\n\n')).toHaveLength(2)
    expect(session).toBe(renderSession(VALUES))
    const bare = layers(instructionsText(VALUES, { ...TEST_ROLE, template: '' }, []))
    expect(bare[0]).toBe(renderBase(VALUES))
    const unfiled = layers(instructionsText(VALUES, { ...TEST_ROLE, projectLayer: false }, files))
    expect(unfiled[1]).toBe(renderSession(VALUES))
  })

  test('the role’s layer takes the languages where it names them', () => {
    const speaking = { ...TEST_ROLE, template: 'Answer in {user.language}, briefly.' }
    expect(instructionsText(VALUES, speaking, [])).toContain('Answer in French, briefly.')
    const writing = { ...TEST_ROLE, template: 'Write in {project.specLanguage}.' }
    expect(instructionsText({ ...VALUES, specLanguage: 'de' }, writing, [])).toContain(
      'Write in German.',
    )
  })

  test('another mission, the other languages, the tester mode and the Project’s files change nothing before the boundary', () => {
    const [reference] = layers(instructionsText(VALUES, TEST_ROLE, []))
    const [other] = layers(
      instructionsText(
        {
          ...VALUES,
          owner: 'mission ACME-13',
          testerMode: TESTER_PARAGRAPH,
        },
        TEST_ROLE,
        files,
      ),
    )
    expect(other).toBe(reference)
  })

  test('the owner, the languages and the tester paragraph come after it', () => {
    const text = instructionsText({ ...VALUES, testerMode: TESTER_PARAGRAPH }, TEST_ROLE, files)
    const [shared, session] = layers(text)
    expect(shared).not.toContain('ACME-12')
    expect(shared).not.toContain(TESTER_PARAGRAPH)
    expect(session).toContain('mission ACME-12')
    expect(session).toContain(TESTER_PARAGRAPH)
    // The tester tools follow the kept text (#154): the paragraph stays findable after the boundary.
    expect(startedWithTesterMode(text)).toBe(true)
    expect(startedWithTesterMode(instructionsText(VALUES, TEST_ROLE, files))).toBe(false)
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

  test('a place written another way is the same place: a trailing separator, a drive letter in another case', async () => {
    const main = join(work, 'acme')
    repository(join(main, 'api'))
    const workspace = join(work, 'acme-export')
    const [onWindows, inWorkspace] = await on(
      data,
      Effect.gen(function* () {
        const project = yield* createProject({
          name: 'Acme',
          mainCheckout: main,
          repositories: ['api'],
        })
        const database = yield* Database
        yield* database.insert(workspaces).values({
          id: 'workspace-1',
          projectId: project.id,
          name: 'export',
          folder: workspace,
          createdAt: new Date().toISOString(),
        })
        yield* database.insert(workspaceRepositories).values({
          id: 'worktree-1',
          workspaceId: 'workspace-1',
          repositoryId: 'api',
          path: 'api',
          worktree: join(workspace, 'api'),
          position: 0,
          baseCommit: 'abc123',
        })
        return [
          yield* placeRepositories(project.id, `${main.toUpperCase()}${sep}`, 'win32'),
          yield* placeRepositories(project.id, `${workspace}${sep}`),
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
    expect(onWindows).toEqual([{ repository: 'api', folder: join(main, 'api') }])
    expect(inWorkspace).toEqual([{ repository: 'api', folder: join(workspace, 'api') }])
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
