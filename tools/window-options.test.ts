import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import {
  ALLOWED_WEB_PREFERENCES,
  analyze,
  refusalsOf,
  webPreferenceKeys,
} from './window-options.ts'

const application = resolve(import.meta.dirname, '..', 'apps', 'desktop')

describe('Options de plateforme refusées', () => {
  test('the application asks the platform for nothing AGENTS.md refuses', () => {
    expect(analyze(application)).toEqual([])
  })

  // A symbolic link to nothing is listed and then cannot be read, as a source file another test
  // writes and removes while the tree is walked (the deliberate errors of verification.test.ts):
  // the walk goes on instead of failing with ENOENT.
  test.skipIf(process.platform === 'win32')('a source file that is gone is not source', () => {
    const root = mkdtempSync(join(tmpdir(), 'hemera-window-options-'))
    try {
      mkdirSync(join(root, 'src', 'main'), { recursive: true })
      symlinkSync(join(root, 'nothing.ts'), join(root, 'src', 'main', 'gone.ts'))
      expect(analyze(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the window carries only the allowed webPreferences', () => {
    const source = `new BrowserWindow({ webPreferences: { ${ALLOWED_WEB_PREFERENCES.map(
      (key) => `${key}: x`,
    ).join(', ')} } })`
    expect(webPreferenceKeys(source)).toEqual([...ALLOWED_WEB_PREFERENCES])
    expect(refusalsOf('window.ts', source)).toEqual([])
  })

  test('reading a platform flag out of a command line is not passing it', () => {
    const source = 'const backend = /--ozone-platform(?:-hint)?=([\\w-]+)/.exec(commandLine)\n'
    expect(refusalsOf('src/main/environment.ts', source)).toEqual([])
  })

  test('the keyring a Linux start asks for is the one switch the application adds', () => {
    const source = "app.commandLine.appendSwitch('password-store', store)\n"
    expect(refusalsOf('src/main/index.ts', source)).toEqual([])
    for (const other of [
      "app.commandLine.appendSwitch('enable-features', 'X')\n",
      "app.commandLine.appendArgument('--password-store=basic')\n",
      'app.commandLine.appendSwitch(name, value)\n',
    ]) {
      expect(refusalsOf('src/main/index.ts', other).map((refusal) => refusal.found)).toEqual([
        'commandLine.appendSwitch',
      ])
    }
  })

  test.each([
    [
      'an ozone hint',
      "app.commandLine.appendSwitch('--ozone-platform-hint', 'auto')\n",
      'commandLine.appendSwitch',
    ],
    [
      'node in the renderer',
      'new BrowserWindow({ webPreferences: { nodeIntegration: true } })\n',
      'nodeIntegration: true',
    ],
    [
      'a webPreferences option outside the list',
      'new BrowserWindow({ webPreferences: { sandbox: true, webSecurity: false } })\n',
      'webSecurity',
    ],
    [
      'a window option that loses the preloaded renderer',
      "new BrowserWindow({ partition: 'persist:hemera' })\n",
      'partition',
    ],
    [
      'a platform variable set by the application',
      "process.env.ELECTRON_OZONE_PLATFORM_HINT = 'wayland'\n",
      'ELECTRON_OZONE_PLATFORM_HINT',
    ],
  ])('%s is refused, naming the file and what it found', (_case, source, found) => {
    const refusals = refusalsOf('src/main/window.ts', source)
    expect(refusals.map((refusal) => refusal.found)).toContain(found)
    expect(refusals[0]!.file).toBe('src/main/window.ts')
  })
})
