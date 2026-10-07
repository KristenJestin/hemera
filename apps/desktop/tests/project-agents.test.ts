/**
 * The agent and permission sections of a Project's settings (#53), as plain values: the commands
 * never run, the cap and the budget, the model of each role, and the instruction files.
 */

import { NeverCommand, NeverProgram, type NeverEntry } from '@hemera/core/domain'
import type { RepositoryInstructions, RoleModels } from '@hemera/ipc'
import { describe, expect, test } from 'vite-plus/test'

import {
  instructionsOf,
  limitRefusal,
  limitRowsOf,
  limitsWith,
  neverLinesOf,
  neverRefusalOf,
  projectRoleModelsOf,
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
    expect(projectRoleModelsOf(roles)).toEqual([
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
      { agent: 'Claude Code', reads: ['CLAUDE.md'] },
      { agent: 'Codex', reads: ['AGENTS.md'] },
    ])
  })
})
