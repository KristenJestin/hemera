/**
 * The environment variables of a Project and of its Workspaces: set, listed with a mask, revealed
 * on request, removed, and given to a process with the Workspace's over the Project's. A value is
 * often a secret: none ever reaches a domain event, the diagnostic log or an error.
 */

import { realpathSync } from 'node:fs'

import { InvalidVariableKey, NewBranch, UnknownVariable } from '@hemera/ipc'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { observed } from '../src/main/diagnostic.ts'
import { readEvents } from '../src/engine/journal.ts'
import { SqliteClient } from '../src/engine/storage/database.ts'
import {
  MASK,
  environmentAt,
  listVariables,
  removeVariable,
  revealVariable,
  setVariable,
} from '../src/engine/variables.ts'
import { createWorkspace, placeOf } from '../src/engine/workspaces.ts'
import { removeFolders, temporaryFolder } from './storage.ts'
import { atlas, atlasOnDisk, opened, workspaceEngine } from './workspace-engine.ts'

let data: string
let main: string

beforeEach(async () => {
  data = realpathSync.native(temporaryFolder('variables'))
  main = atlasOnDisk(realpathSync.native(temporaryFolder('variables-work')))
  await opened(data)
})
afterEach(removeFolders)

const SECRET = 'hunter2-0f1e2d3c'

/** Atlas, and a Workspace over its first repository, recorded and not prepared. */
const atlasWithWorkspace = Effect.gen(function* () {
  const project = yield* atlas(main)
  const workspace = yield* createWorkspace({
    projectId: project.id,
    name: 'login-form',
    repositories: [project.repositories[0]?.id ?? ''],
    mode: NewBranch.make({}),
  })
  return { project, workspace }
})

describe('Variables are listed with a mask and revealed on request', () => {
  test('a list names each variable with the mask, and reveal answers the one value asked', async () => {
    const [listed, revealed] = await workspaceEngine(data)(
      Effect.gen(function* () {
        const { project } = yield* atlasWithWorkspace
        const scope = { projectId: project.id, workspaceId: null }
        yield* setVariable({ ...scope, key: 'API_TOKEN', value: SECRET })
        yield* setVariable({ ...scope, key: 'MODE', value: 'dev' })
        yield* setVariable({ ...scope, key: 'MODE', value: 'test' })
        return [
          yield* listVariables(scope),
          yield* revealVariable({ ...scope, key: 'API_TOKEN' }),
        ] as const
      }),
    )
    expect(listed).toEqual([
      { key: 'API_TOKEN', value: MASK },
      { key: 'MODE', value: MASK },
    ])
    expect(revealed).toBe(SECRET)
  })

  test('a removed variable is gone, and removing it again says it is unknown', async () => {
    const [listed, again] = await workspaceEngine(data)(
      Effect.gen(function* () {
        const { project } = yield* atlasWithWorkspace
        const scope = { projectId: project.id, workspaceId: null }
        yield* setVariable({ ...scope, key: 'MODE', value: 'dev' })
        yield* removeVariable({ ...scope, key: 'MODE' })
        return [
          yield* listVariables(scope),
          yield* Effect.flip(removeVariable({ ...scope, key: 'MODE' })),
        ] as const
      }),
    )
    expect(listed).toEqual([])
    expect(again).toBeInstanceOf(UnknownVariable)
  })

  test('a key that is not an environment name is refused', async () => {
    const refused = await workspaceEngine(data)(
      Effect.gen(function* () {
        const { project } = yield* atlasWithWorkspace
        return yield* Effect.flip(
          setVariable({ projectId: project.id, workspaceId: null, key: '1-PORT', value: 'x' }),
        )
      }),
    )
    expect(refused).toBeInstanceOf(InvalidVariableKey)
  })
})

describe('The process environment, then the Project, then the Workspace', () => {
  test('a Workspace’s variable wins over the Project’s, which wins over the process’s', async () => {
    process.env['HEMERA_TEST_ORDER'] = 'process'
    process.env['HEMERA_TEST_KEPT'] = 'process'
    try {
      const environment = await workspaceEngine(data)(
        Effect.gen(function* () {
          const { project, workspace } = yield* atlasWithWorkspace
          const projectScope = { projectId: project.id, workspaceId: null }
          const workspaceScope = { projectId: project.id, workspaceId: workspace.id }
          yield* setVariable({ ...projectScope, key: 'HEMERA_TEST_ORDER', value: 'project' })
          yield* setVariable({ ...projectScope, key: 'HEMERA_TEST_PROJECT', value: 'project' })
          yield* setVariable({ ...workspaceScope, key: 'HEMERA_TEST_ORDER', value: 'workspace' })
          return yield* environmentAt(yield* placeOf(project.id, workspace.id))
        }),
      )
      expect(environment['HEMERA_TEST_ORDER']).toBe('workspace')
      expect(environment['HEMERA_TEST_PROJECT']).toBe('project')
      expect(environment['HEMERA_TEST_KEPT']).toBe('process')
    } finally {
      delete process.env['HEMERA_TEST_ORDER']
      delete process.env['HEMERA_TEST_KEPT']
    }
  })
})

describe('A variable’s value never appears in an event, the diagnostic log or an error', () => {
  test('set, changed and removed: the journal names the key and never the value', async () => {
    const events = await workspaceEngine(data)(
      Effect.gen(function* () {
        const { project, workspace } = yield* atlasWithWorkspace
        const scope = { projectId: project.id, workspaceId: workspace.id }
        yield* setVariable({ ...scope, key: 'API_TOKEN', value: SECRET })
        yield* setVariable({ ...scope, key: 'API_TOKEN', value: `${SECRET}-2` })
        yield* removeVariable({ ...scope, key: 'API_TOKEN' })
        return (yield* readEvents({})).events
      }),
    )
    const written = JSON.stringify(events)
    expect(written).toContain('API_TOKEN')
    expect(written).not.toContain(SECRET)
  })

  test('a write the data folder refuses names neither the value in its error nor in the log', async () => {
    const logged: string[] = []
    const refused = await workspaceEngine(data)(
      Effect.gen(function* () {
        const { project } = yield* atlasWithWorkspace
        const sql = yield* SqliteClient
        yield* sql`CREATE TRIGGER refuse_variables BEFORE INSERT ON environment_variables
          BEGIN SELECT RAISE(ABORT, 'the disk is full'); END`
        return yield* Effect.flip(
          setVariable({
            projectId: project.id,
            workspaceId: null,
            key: 'TOKEN',
            value: SECRET,
          }).pipe(
            // What the engine's handler of `variables.set` writes to the diagnostic log.
            observed('variables.set', (line) => logged.push(line)),
          ),
        )
      }),
    )
    expect(refused.message).toContain('the disk is full')
    expect(refused.message).not.toContain(SECRET)
    expect(JSON.stringify(refused)).not.toContain(SECRET)
    expect(logged.join('\n')).toContain('variables.set: failed')
    expect(logged.join('\n')).not.toContain(SECRET)
  })
})
