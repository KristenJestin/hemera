/**
 * What the setup agent proposes, and how each change is said (#44): one title and its details,
 * the same on the card, in the Journal and to the agent; never a variable's value.
 */

import { Result, Schema } from 'effect'
import { describe, expect, test } from 'vite-plus/test'

import { SetupProposal, setupChangeDetails, setupChangeTitle } from '../src/domain/setup.ts'

const proposed = Schema.decodeUnknownResult(SetupProposal)

describe('A change is said in one title and its details', () => {
  test('each kind has its title', () => {
    expect(setupChangeTitle({ kind: 'repository', path: 'web' })).toBe('Declare the repository web')
    expect(
      setupChangeTitle({
        kind: 'command',
        name: 'test',
        type: 'test',
        line: 'pnpm test',
        replaces: false,
      }),
    ).toBe('Add the command test')
    expect(
      setupChangeTitle({
        kind: 'command',
        name: 'test',
        type: 'test',
        line: 'pnpm test',
        replaces: true,
      }),
    ).toBe('Change the command test')
    expect(setupChangeTitle({ kind: 'step', step: 'copy', path: '.env.example' })).toBe(
      'Add a preparation step that copies .env.example',
    )
    expect(setupChangeTitle({ kind: 'step', step: 'run', command: 'install' })).toBe(
      'Add a preparation step that runs install',
    )
    expect(setupChangeTitle({ kind: 'variable', name: 'ACME_REGION', replaces: false })).toBe(
      'Set the variable ACME_REGION',
    )
  })

  test('a command says its roles and its write globs; a variable never its value', () => {
    expect(
      setupChangeDetails({
        kind: 'command',
        name: 'format',
        type: 'script',
        line: 'pnpm format',
        repository: 'web',
        check: false,
        askBeforeRunning: true,
        writeGlobs: ['src/**/*.ts'],
        replaces: false,
      }),
    ).toEqual([
      { label: 'Type', value: 'script' },
      { label: 'Line', value: 'pnpm format' },
      { label: 'Runs in', value: 'web' },
      { label: 'Asks before running', value: 'yes' },
      { label: 'Writes', value: 'src/**/*.ts' },
    ])
    expect(setupChangeDetails({ kind: 'variable', name: 'ACME_TOKEN', replaces: true })).toEqual([
      { label: 'Scope', value: 'the Project' },
      { label: 'Value', value: 'replaced, not shown' },
    ])
  })
})

describe('What a proposal may carry', () => {
  test('the four kinds of 1.0, and no Workspace action', () => {
    expect(Result.isSuccess(proposed({ kind: 'repository', path: 'web' }))).toBe(true)
    expect(Result.isSuccess(proposed({ kind: 'variable', name: 'A', value: 'b' }))).toBe(true)
    expect(Result.isFailure(proposed({ kind: 'workspace_create', name: 'scratch' }))).toBe(true)
  })
})
