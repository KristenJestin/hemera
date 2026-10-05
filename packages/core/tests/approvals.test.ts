/**
 * Approvals that never block the agent: the waiting answer, the texts a result is handed over
 * with, and the identity of an action allowed for the whole mission (CT-19): the same command or
 * nothing, and an identity that falls when its script, its program or its catalogue line moved.
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  type ActionIdentity,
  grantKey,
  identityChange,
  resultText,
  variablesSet,
  waitingText,
} from '../src/domain/index.ts'

const line = (
  words: ReadonlyArray<string>,
  more: Partial<ActionIdentity> = {},
): ActionIdentity => ({
  tool: 'commands_run',
  catalogue: null,
  catalogueLine: null,
  program: '/usr/bin/pnpm',
  words,
  folder: '.',
  repository: null,
  variables: [],
  script: null,
  target: null,
  ...more,
})

describe('The agent is answered at once, never held', () => {
  test('the waiting text names the request and says nothing happened', () => {
    expect(waitingText(3)).toBe(
      "Waiting for the user's approval, request #3. This action has not happened; do not assume it did. Continue with work that does not depend on it, or end your turn saying you wait. The answer will be handed to you when the user gives it.",
    )
  })
})

describe('A result is handed over in one of four sentences', () => {
  test('done, failed, refused by the user, not executed', () => {
    const request = { number: 2, tool: 'commands_run' }
    expect(resultText({ ...request, result: 'done', text: 'exit code 0' })).toBe(
      'Request #2 (commands_run) was approved by the user, and Hemera has now done it. Its result:\n\nexit code 0',
    )
    expect(resultText({ ...request, result: 'failed', text: 'it did not start' })).toBe(
      'Request #2 (commands_run) was approved by the user, but nothing was done: it did not start',
    )
    expect(resultText({ ...request, result: 'refused', text: '' })).toBe(
      'Request #2 (commands_run) was refused by the user. Nothing was done.',
    )
    expect(
      resultText({
        ...request,
        result: 'not-executed',
        text: 'the situation changed since it was allowed',
      }),
    ).toBe(
      'Request #2 (commands_run) was not executed: the situation changed since it was allowed.',
    )
  })
})

describe('The variables a line sets are named, never their values', () => {
  test('leading assignments and those of env', () => {
    expect(variablesSet(['CI=1', 'NODE_ENV=test', 'pnpm', 'test'])).toEqual(['CI', 'NODE_ENV'])
    expect(variablesSet(['env', '-i', 'TOKEN=abc', 'node', 'x.js'])).toEqual(['TOKEN'])
    expect(variablesSet(['pnpm', 'test', 'A=1'])).toEqual([])
  })
})

describe('Allow for this mission covers the same command, never a prefix', () => {
  test('pnpm test does not authorise pnpm test --update', () => {
    expect(grantKey(line(['pnpm', 'test']))).not.toBe(grantKey(line(['pnpm', 'test', '--update'])))
    expect(grantKey(line(['pnpm', 'test']))).toBe(grantKey(line(['pnpm', 'test'])))
  })

  test('the folder, the repository and the variables are part of it', () => {
    const base = grantKey(line(['pnpm', 'test']))
    expect(grantKey(line(['pnpm', 'test'], { folder: 'api' }))).not.toBe(base)
    expect(grantKey(line(['pnpm', 'test'], { repository: 'web' }))).not.toBe(base)
    expect(grantKey(line(['pnpm', 'test'], { variables: ['CI'] }))).not.toBe(base)
  })

  test('a catalogue command is known by its id, whatever its line says now', () => {
    const seed = line(['pnpm', 'seed'], { catalogue: 'c1', catalogueLine: 'pnpm seed' })
    const changed = line(['pnpm', 'seed', '--all'], {
      catalogue: 'c1',
      catalogueLine: 'pnpm seed --all',
    })
    expect(grantKey(changed)).toBe(grantKey(seed))
    expect(identityChange(seed, changed)).toBe('the catalogue line changed')
  })

  test('the identity falls when the script or the program moved', () => {
    const granted = line(['./scripts/seed.sh'], { program: '/w/scripts/seed.sh', script: 'aa' })
    expect(identityChange(granted, granted)).toBeNull()
    expect(identityChange(granted, { ...granted, script: 'bb' })).toBe('the script changed')
    expect(identityChange(granted, { ...granted, program: '/elsewhere/seed.sh' })).toBe(
      'the program resolves elsewhere',
    )
  })
})
