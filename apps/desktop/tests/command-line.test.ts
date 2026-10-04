/**
 * How the words of a line become a process, without a shell: as they are on POSIX, and on Windows
 * through `cmd.exe /d /s /c` for a `.cmd` or `.bat` shim, every word escaped so that `cmd.exe`
 * reads nothing in it as its own syntax.
 */

import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vite-plus/test'

import { type Lookup, invocationOf } from '../src/engine/command-line.ts'
import { removeFolders, temporaryFolder } from './storage.ts'

const windowsLookup = (bin: string): Lookup => ({
  cwd: bin,
  path: bin,
  pathExt: '.COM;.EXE;.BAT;.CMD',
  comspec: 'C:\\Windows\\system32\\cmd.exe',
})

describe('A line becomes a process without a shell', () => {
  test('on POSIX the words are the program and its arguments, as they are', () => {
    const lookup = { cwd: '/', path: '/usr/bin', pathExt: '', comspec: '' }
    expect(invocationOf(['pnpm', 'dev', 'a&b'], 'linux', lookup)).toEqual({
      program: 'pnpm',
      args: ['dev', 'a&b'],
      verbatim: false,
    })
  })

  test("on Windows a .cmd shim goes through cmd.exe as one quoted line, cmd.exe's syntax escaped", () => {
    const bin = realpathSync.native(temporaryFolder('shims'))
    writeFileSync(join(bin, 'pnpm.cmd'), '@echo off\r\n')
    const invocation = invocationOf(
      ['pnpm', 'dev', 'a&b', 'two words'],
      'win32',
      windowsLookup(bin),
    )
    removeFolders()
    expect(invocation?.program).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(invocation?.verbatim).toBe(true)
    expect(invocation?.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    const line = invocation?.args[3] ?? ''
    expect(line).toContain('^"dev^"')
    expect(line).toContain('^"a^&b^"')
    expect(line).toContain('^"two^ words^"')
  })

  test('on Windows a bare name is the shim cmd.exe would run, never a file without an extension', () => {
    // What corepack and npm install beside each other: a shell script for Git Bash, and the shim.
    const bin = realpathSync.native(temporaryFolder('shims'))
    writeFileSync(join(bin, 'pnpm'), '#!/bin/sh\n')
    writeFileSync(join(bin, 'pnpm.cmd'), '@echo off\r\n')
    const invocation = invocationOf(['pnpm', 'dev'], 'win32', windowsLookup(bin))
    removeFolders()
    expect(invocation?.program).toBe('C:\\Windows\\system32\\cmd.exe')
    expect(invocation?.args[3]).toContain('pnpm.cmd')
  })

  test('on Windows a shim under node_modules/.bin has its words escaped twice', () => {
    const root = realpathSync.native(temporaryFolder('shims'))
    const bin = join(root, 'node_modules', '.bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'vite.cmd'), '@echo off\r\n')
    const invocation = invocationOf(['vite', 'a&b'], 'win32', windowsLookup(bin))
    removeFolders()
    expect(invocation?.args[3]).toContain('^^^"a^^^&b^^^"')
  })

  test('on Windows a program that is not a shim is started directly', () => {
    const bin = realpathSync.native(temporaryFolder('shims'))
    writeFileSync(join(bin, 'node.exe'), '')
    const invocation = invocationOf(['node', 'a&b'], 'win32', windowsLookup(bin))
    removeFolders()
    expect(invocation).toEqual({ program: 'node', args: ['a&b'], verbatim: false })
  })
})
