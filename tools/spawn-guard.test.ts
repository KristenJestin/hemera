import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import {
  SYSTEM_PROGRAMS,
  type SpawnRule,
  programOfLine,
  refusedBy,
  takeRefused,
} from './spawn-guard.ts'

const made: string[] = []
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A folder holding an executable `name`: the machine's own when outside the rule's folders. */
function folderWith(name: string): string {
  const folder = mkdtempSync(join(tmpdir(), 'hemera-spawn-guard-'))
  made.push(folder)
  mkdirSync(join(folder, 'bin'))
  writeFileSync(join(folder, 'bin', name), '#!/bin/sh\n')
  chmodSync(join(folder, 'bin', name), 0o755)
  return folder
}

const ruleOver = (folders: ReadonlyArray<string>): SpawnRule => ({
  folders,
  names: SYSTEM_PROGRAMS,
  platform: 'linux',
})

describe.runIf(process.platform !== 'win32')('A test never starts a program of the machine', () => {
  test('a real agent CLI found on the PATH is refused, naming it', () => {
    const machine = folderWith('claude')
    const program = refusedBy(ruleOver([join(machine, 'tests')]), {
      file: 'claude',
      args: ['--version'],
      env: { PATH: join(machine, 'bin') },
      cwd: machine,
    })
    expect(program).toBe(join(machine, 'bin', 'claude'))
  })

  test("a fake in the test's own temporary folder may run", () => {
    const fake = folderWith('claude')
    const program = refusedBy(ruleOver([fake]), {
      file: 'claude',
      args: [],
      env: { PATH: join(fake, 'bin') },
      cwd: fake,
    })
    expect(program).toBeNull()
  })

  test('a fake named by its path in a temporary folder may run', () => {
    const fake = folderWith('gh')
    const program = refusedBy(ruleOver([fake]), {
      file: join(fake, 'bin', 'gh'),
      args: [],
      env: { PATH: '' },
      cwd: fake,
    })
    expect(program).toBeNull()
  })

  test.each(SYSTEM_PROGRAMS)('the system program %s may run wherever it is', (name) => {
    const machine = folderWith(name)
    const program = refusedBy(ruleOver([]), {
      file: name,
      args: [],
      env: { PATH: join(machine, 'bin') },
      cwd: machine,
    })
    expect(program).toBeNull()
  })

  test('a program found nowhere is left to fail on its own', () => {
    const program = refusedBy(ruleOver([]), {
      file: 'codex',
      args: [],
      env: { PATH: '' },
      cwd: tmpdir(),
    })
    expect(program).toBeNull()
  })

  test("the suites' guard refuses a program of the machine before it runs", () => {
    // `uname` is on every POSIX machine, outside the temporary folders and the repository.
    expect(() => spawnSync('uname')).toThrow(/a test may not start .*uname/)
    expect(() => spawn('uname', ['-a'])).toThrow(/a test may not start .*uname/)
    // Both are kept for the setup, which fails the test that asked: taken here, as expected.
    expect(takeRefused()).toHaveLength(2)
  })
})

describe('A line Windows hands to cmd.exe is judged by the program it runs', () => {
  test('the program is the first word of the line, its carets removed', () => {
    const line = '"C:\\Program^ Files\\nodejs\\opencode.cmd ^"--version^""'
    expect(programOfLine(line)).toBe('C:\\Program Files\\nodejs\\opencode.cmd')
  })
})
