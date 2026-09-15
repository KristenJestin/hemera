import { resolve } from 'node:path'
import { describe, expect, test } from 'vite-plus/test'

import {
  ALLOWED_WEB_PREFERENCES,
  analyze,
  refusalsOf,
  webPreferenceKeys,
} from './window-options.ts'

const application = resolve(import.meta.dirname, '..', 'apps', 'desktop')

describe('Options de plateforme refusées', () => {
  test('the application asks the platform for nothing D0-05 refuses', () => {
    expect(analyze(application)).toEqual([])
  })

  test('the window this lot opens carries only the allowed webPreferences', () => {
    const source = `new BrowserWindow({ webPreferences: { ${ALLOWED_WEB_PREFERENCES.map(
      (key) => `${key}: x`,
    ).join(', ')} } })`
    expect(webPreferenceKeys(source)).toEqual([...ALLOWED_WEB_PREFERENCES])
    expect(refusalsOf('window.ts', source)).toEqual([])
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
