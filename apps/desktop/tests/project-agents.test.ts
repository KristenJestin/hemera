/**
 * The agent and permission sections of a Project's settings (#53), as plain values: the commands
 * never run, the cap and the budget, the model of each role, and the instruction files.
 */

import { NeverCommand, NeverProgram, type NeverEntry } from '@hemera/core/domain'
import type { RepositoryInstructions, RoleModels } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  instructionsOf,
  latestWrites,
  limitRefusal,
  limitRowsOf,
  limitsWith,
  neverLinesOf,
  neverRefusalOf,
  projectRoleModelsOf,
  rolePickerAgentsOf,
  withNever,
  withoutNever,
} from '../src/renderer/project-agents.ts'

const CATALOGUE = [{ id: 'deploy', name: 'web: deploy' }]

const ENTRIES: NeverEntry[] = [
  NeverProgram.make({ words: ['git', 'push', '--force'] }),
  NeverCommand.make({ commandId: 'deploy' }),
]

describe('Never run', () => {
  test('a program by its words, a command of the catalogue by its name', () => {
    expect(neverLinesOf(ENTRIES, CATALOGUE).map((one) => one.line)).toEqual([
      'git push --force',
      'web: deploy',
    ])
  })

  test('a line is added as its words, quotes kept whole; one is removed by its row', () => {
    const added = withNever(ENTRIES, `  docker system prune "--all"  `)
    expect(added.at(-1)).toEqual(
      NeverProgram.make({ words: ['docker', 'system', 'prune', '--all'] }),
    )
    const [first] = neverLinesOf(added, CATALOGUE)
    expect(withoutNever(added, first?.id ?? '')).toEqual(added.slice(1))
  })

  test('an empty line, or one already refused, is said in words', () => {
    expect(neverRefusalOf('  ', ENTRIES, CATALOGUE)).toBe('Write the command to refuse.')
    expect(neverRefusalOf('git  push --force', ENTRIES, CATALOGUE)).toBe(
      '“git push --force” is already refused.',
    )
    expect(neverRefusalOf('terraform apply', ENTRIES, CATALOGUE)).toBeUndefined()
  })
})

describe('Cap and budget', () => {
  const LIMITS = { cap: 1, budget: { launches: 8, attempts: 12, rounds: 3 } }

  test('the cap first, then the budget; a value equal to the default reads as the default', () => {
    expect(limitRowsOf(LIMITS)).toEqual([
      { id: 'cap', label: 'Sub-agents at once', value: '1', fallback: 3 },
      { id: 'launches', label: 'Launches', value: null, fallback: 8 },
      { id: 'attempts', label: 'Automatic retries', value: '12', fallback: 30 },
      { id: 'rounds', label: 'Automatic rounds', value: null, fallback: 3 },
    ])
  })

  test('a field written changes its limit; an emptied one goes back to the default', () => {
    expect(limitsWith(LIMITS, 'cap', '4')).toEqual({ ...LIMITS, cap: 4 })
    expect(limitsWith(LIMITS, 'cap', null)).toEqual({ ...LIMITS, cap: 3 })
    expect(limitsWith(LIMITS, 'attempts', null)).toEqual({
      ...LIMITS,
      budget: { ...LIMITS.budget, attempts: 30 },
    })
  })

  test('the cap is a whole number from 1 to 6; a budget, a whole number from 0 to 999', () => {
    expect(limitRefusal('cap', '7')).toBe('Write a whole number from 1 to 6.')
    expect(limitRefusal('cap', '2.5')).toBe('Write a whole number from 1 to 6.')
    expect(limitRefusal('cap', '6')).toBeUndefined()
    expect(limitRefusal('rounds', '0')).toBeUndefined()
    expect(limitRefusal('rounds', 'many')).toBe('Write a whole number from 0 to 999.')
    expect(limitRefusal('rounds', null)).toBeUndefined()
  })
})

describe('Models by role', () => {
  test('with the application’s level unset, the default is the application’s, not the override', () => {
    const inProject: RoleModels[] = [
      {
        role: 'builder',
        displayName: 'the Builder',
        app: null,
        project: { agent: 'codex', model: 'gpt-large', effort: null },
        mission: null,
        resolved: { agent: 'codex', model: 'gpt-large', effort: null, level: 'project' },
      },
    ]
    const inApp: RoleModels[] = [
      {
        role: 'builder',
        displayName: 'the Builder',
        app: null,
        project: null,
        mission: null,
        resolved: { agent: 'claude', model: 'sonnet', effort: null, level: 'app' },
      },
    ]
    expect(projectRoleModelsOf(inProject, inApp)).toEqual([
      {
        role: 'the Builder',
        override: { agent: 'codex', model: 'gpt-large', effort: undefined },
        appDefault: { agent: 'claude', model: 'sonnet', effort: undefined },
      },
    ])
  })

  test('the Project’s override, or none, over the application’s model', () => {
    const roles: RoleModels[] = [
      {
        role: 'builder',
        displayName: 'the Builder',
        app: { agent: 'claude', model: 'sonnet', effort: 'high' },
        project: { agent: 'codex', model: null, effort: null },
        mission: null,
        resolved: { agent: 'codex', model: null, effort: null, level: 'project' },
      },
      {
        role: 'helper',
        displayName: 'a helper',
        app: null,
        project: null,
        mission: null,
        resolved: { agent: 'claude', model: 'haiku', effort: null, level: 'app' },
      },
    ]
    const inApp: RoleModels[] = roles.map((role) => ({
      ...role,
      project: null,
      resolved: { ...(role.app ?? role.resolved), level: 'app' },
    }))
    expect(projectRoleModelsOf(roles, inApp)).toEqual([
      {
        role: 'the Builder',
        override: { agent: 'codex', model: 'default', effort: undefined },
        appDefault: { agent: 'claude', model: 'sonnet', effort: 'high' },
      },
      {
        role: 'a helper',
        override: null,
        appDefault: { agent: 'claude', model: 'haiku', effort: undefined },
      },
    ])
  })
})

describe('The models the role rows offer', () => {
  test('each row’s own model, on its own agent, though none is marked', () => {
    const agents = [
      { id: 'claude', label: 'Claude Code', installed: true, signedIn: true },
      { id: 'codex', label: 'Codex', installed: true, signedIn: true },
    ] as const
    const role = (
      name: string,
      project: RoleModels['project'],
      resolved: RoleModels['resolved'],
    ): RoleModels => ({
      role: name,
      displayName: name,
      app: null,
      project,
      mission: null,
      resolved,
    })
    const inProject = [
      role(
        'builder',
        { agent: 'codex', model: 'gpt-large', effort: null },
        {
          agent: 'codex',
          model: 'gpt-large',
          effort: null,
          level: 'project',
        },
      ),
    ]
    const inApp = [
      role('builder', null, { agent: 'claude', model: 'sonnet', effort: null, level: 'app' }),
      role('setup', null, { agent: 'claude', model: 'opus', effort: null, level: 'app' }),
    ]
    const offered = rolePickerAgentsOf(agents, [], inProject, inApp)
    expect(offered.map((agent) => [agent.id, agent.models.map((model) => model.id)])).toEqual([
      ['claude', ['default', 'sonnet', 'opus']],
      ['codex', ['default', 'gpt-large']],
    ])
  })
})

describe('Instructions', () => {
  test('each repository’s files, and the files each agent reads by itself', () => {
    const rows: RepositoryInstructions[] = [
      {
        repository: 'api',
        files: ['CLAUDE.md', 'AGENTS.md'],
        agents: [
          { agent: 'claude', how: 'itself', file: 'CLAUDE.md' },
          { agent: 'codex', how: 'itself', file: 'AGENTS.md' },
        ],
      },
      {
        repository: 'web',
        files: ['AGENTS.md'],
        agents: [
          { agent: 'claude', how: 'sent', file: 'AGENTS.md' },
          { agent: 'codex', how: 'itself', file: 'AGENTS.md' },
        ],
      },
    ]
    const seen = instructionsOf(rows, [
      { id: 'claude', label: 'Claude Code' },
      { id: 'codex', label: 'Codex' },
    ])
    expect(seen.repositories).toEqual([
      { repository: 'api', files: ['CLAUDE.md', 'AGENTS.md'] },
      { repository: 'web', files: ['AGENTS.md'] },
    ])
    expect(seen.agents).toEqual([
      { id: 'claude', agent: 'Claude Code', reads: ['CLAUDE.md'] },
      { id: 'codex', agent: 'Codex', reads: ['AGENTS.md'] },
    ])
  })
})

describe('A Project’s agent setting written', () => {
  /** A write the test settles by hand. */
  const held = <A>() => {
    const { promise, resolve, reject } = Promise.withResolvers<A>()
    return { promise, settle: { resolve, reject } }
  }
  const settled = () => new Promise<void>((resolve) => setImmediate(resolve))

  test('a write the engine refuses is said, for what is shown to go back to what it keeps', async () => {
    const write = latestWrites()
    const kept: number[] = []
    const refused: string[] = []
    write(
      () => Promise.reject(new Error('Hemera could not write to its profile.')),
      (answer: number) => kept.push(answer),
      (failure) => refused.push(failure.message),
    )
    await settled()
    expect(kept).toEqual([])
    expect(refused).toEqual(['Hemera could not write to its profile.'])
  })

  test('writes run one after the other: the next starts once the one before has answered', async () => {
    const write = latestWrites()
    const first = held<number>()
    const started: string[] = []
    write(
      () => {
        started.push('first')
        return first.promise
      },
      () => undefined,
      () => undefined,
    )
    write(
      () => {
        started.push('second')
        return Promise.resolve(2)
      },
      () => undefined,
      () => undefined,
    )
    await settled()
    expect(started).toEqual(['first'])
    first.settle.resolve(1)
    await settled()
    expect(started).toEqual(['first', 'second'])
  })

  test('only the latest answer is heard, but every refusal is', async () => {
    const write = latestWrites()
    const heard: string[] = []
    const said = {
      kept: (answer: number) => heard.push(`kept ${String(answer)}`),
      refused: (failure: Error) => heard.push(`refused ${failure.message}`),
    }
    write(() => Promise.resolve(1), said.kept, said.refused)
    write(() => Promise.reject(new Error('not a whole number')), said.kept, said.refused)
    write(() => Promise.resolve(3), said.kept, said.refused)
    await settled()
    await settled()
    expect(heard).toEqual(['refused not a whole number', 'kept 3'])
  })
})
