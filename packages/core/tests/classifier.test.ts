import { describe, expect, test } from 'vite-plus/test'

import { classifierVerdictFromScores, localClassifierVerdict } from '#index.ts'

describe('Local rules settle only understood calls', () => {
  test('a contained directory listing needs no evaluator', () => {
    expect(localClassifierVerdict({ tool: 'fs_list', target: 'inside' })).toBe('allow')
    expect(
      localClassifierVerdict({
        tool: 'commands_run',
        target: 'inside',
        command: { program: '/usr/bin/ls', args: [], shell: false, platform: 'linux' },
      }),
    ).toBe('allow')
  })

  test('rm -rf .git is refused even inside the Workspace', () => {
    expect(
      localClassifierVerdict({
        tool: 'commands_run',
        target: 'inside',
        command: { program: 'rm', args: ['-rf', '.git'], shell: false, platform: 'linux' },
      }),
    ).toBe('deny')
  })

  test('a compound or ambiguous command cannot borrow the listing allowance', () => {
    for (const args of [['&&', 'rm', '-rf', '.git'], ['-la'], ['../outside']]) {
      expect(
        localClassifierVerdict({
          tool: 'commands_run',
          target: 'inside',
          command: { program: '/usr/bin/ls', args, shell: false, platform: 'linux' },
        }),
      ).toBe('defer')
    }
    expect(
      localClassifierVerdict({
        tool: 'commands_run',
        target: 'inside',
        command: { program: '/usr/bin/ls', args: [], shell: true, platform: 'linux' },
      }),
    ).toBe('defer')
    expect(
      localClassifierVerdict({
        tool: 'commands_run',
        target: 'inside',
        command: { program: 'ls', args: [], shell: false, platform: 'linux' },
      }),
    ).toBe('defer')
    expect(localClassifierVerdict({ tool: 'fs_list', target: 'outside' })).toBe('defer')
    expect(localClassifierVerdict({ tool: 'fs_list', target: 'unknown' })).toBe('defer')
  })
})

describe('Risk and authorization thresholds are applied in order', () => {
  const decide = (risk: number, approval: number, userRequested: number, hasHumanContext = true) =>
    classifierVerdictFromScores({ risk, approval, userRequested, hasHumanContext })

  test('the destructive threshold wins even when the user asked', () => {
    expect(decide(2.499, 0, 1)).toBe('allow')
    expect(decide(2.5, 0, 1)).toBe('deny')
    expect(decide(3, 1, 1)).toBe('deny')
  })

  test('medium risk or high approval needs supported human intent', () => {
    expect(decide(1.499, 0.749, 0)).toBe('allow')
    expect(decide(1.5, 0, 0.849)).toBe('ask')
    expect(decide(1.5, 0, 0.85)).toBe('allow')
    expect(decide(0, 0.75, 0.849)).toBe('ask')
    expect(decide(0, 0.75, 0.85)).toBe('allow')
    expect(decide(1.5, 1, 1, false)).toBe('ask')
  })

  test('invalid scores can never allow', () => {
    expect(decide(Number.NaN, 0, 0)).toBe('ask')
    expect(decide(0, Number.POSITIVE_INFINITY, 0)).toBe('ask')
    expect(decide(0, 0, -0.1)).toBe('ask')
    expect(decide(3.1, 0, 0)).toBe('ask')
  })
})
