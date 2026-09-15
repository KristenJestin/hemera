import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import { CHANNELS, type ChannelName, windowCommandSchema } from '#index.ts'

const ipc = resolve(import.meta.dirname, '..')

/**
 * Type checks one call against the declaration and answers what the compiler said.
 *
 * The compiler is the thing under test, so it is run rather than imitated: a call written in
 * a file, `tsc` over that file, and whatever it reports.
 */
function compile(call: string) {
  const probe = join(ipc, 'tests', '.probe')
  mkdirSync(probe, { recursive: true })
  writeFileSync(
    join(probe, 'call.ts'),
    ["import type { Bridge } from '../../src/index.ts'", '', 'declare const bridge: Bridge', call]
      .join('\n')
      .concat('\n'),
  )
  writeFileSync(
    join(probe, 'tsconfig.json'),
    `${JSON.stringify(
      {
        extends: '../../../../tsconfig.base.json',
        compilerOptions: { types: [] },
        include: ['call.ts'],
      },
      null,
      2,
    )}\n`,
  )
  try {
    const result = spawnSync(`tsc -p "${join(probe, 'tsconfig.json')}"`, {
      cwd: ipc,
      encoding: 'utf8',
      shell: true,
    })
    return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` }
  } finally {
    rmSync(probe, { recursive: true, force: true })
  }
}

describe('Appel typé nominal', () => {
  test('the channels of the application are the ones declared', () => {
    const names: ChannelName[] = ['env.report', 'theme.set', 'window.command']
    expect(Object.keys(CHANNELS).toSorted()).toEqual(names.toSorted())
  })

  test('a declared channel called with conforming arguments compiles', () => {
    const result = compile("void bridge.invoke('window.command', { command: 'minimize' })")
    expect(result.output).toBe('')
    expect(result.ok).toBe(true)
  })

  test('the answer of a channel has the type the declaration gives it', () => {
    const result = compile(
      [
        "const report = await bridge.invoke('env.report', {})",
        'const version: string = report.versions.electron',
        'void version',
      ].join('\n'),
    )
    expect(result.output).toBe('')
    expect(result.ok).toBe(true)
  })

  test('the arguments schema rejects a command that is not one of the three', () => {
    expect(windowCommandSchema.safeParse({ command: 'minimize' }).success).toBe(true)
    expect(windowCommandSchema.safeParse({ command: 'explode' }).success).toBe(false)
  })
})

describe('Canal non déclaré', () => {
  test('a channel name the declaration does not carry does not compile', () => {
    const result = compile("void bridge.invoke('env.reoprt', {})")
    expect(result.ok).toBe(false)
    expect(result.output).toContain('env.reoprt')
  })

  test('a declared channel called with the wrong argument type does not compile', () => {
    const result = compile("void bridge.invoke('window.command', { command: 'explode' })")
    expect(result.ok).toBe(false)
    expect(result.output).toContain('explode')
  })

  test('an answer used as the wrong type does not compile', () => {
    const result = compile(
      [
        "const report = await bridge.invoke('env.report', {})",
        'const displays: number = report.displays',
        'void displays',
      ].join('\n'),
    )
    expect(result.ok).toBe(false)
    expect(result.output).toContain("is not assignable to type 'number'")
  })
})
