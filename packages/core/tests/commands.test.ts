/**
 * The address a run publishes, read from what it printed (D6-12, D8-09), the line a machine
 * runs (D8-07), and which type joins a run already going (D8-07).
 */

import { describe, expect, test } from 'vite-plus/test'

import {
  COMMAND_SCOPES,
  COMMAND_TYPES,
  UnknownCommandScopeError,
  UnknownCommandTypeError,
  addressIn,
  commandScope,
  commandType,
  joinsRunningRun,
  lineFor,
  portOf,
} from '#index.ts'

describe('The address a dev server prints is found', () => {
  test('on the machine name and on each loopback spelling', () => {
    expect(addressIn('ready on http://localhost:5173/')).toBe('http://localhost:5173')
    expect(addressIn('listening at http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(addressIn('bound to http://0.0.0.0:8080')).toBe('http://0.0.0.0:8080')
    expect(addressIn('serving https://[::1]:4443/app')).toBe('https://[::1]:4443')
  })

  test('through the colour codes a terminal program paints it with', () => {
    const painted =
      '  \u001b[32m➜\u001b[39m  Local: \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m'
    expect(addressIn(painted)).toBe('http://localhost:5173')
  })

  test('as the first address the output names', () => {
    expect(addressIn('http://127.0.0.1:4000 then http://localhost:5000')).toBe(
      'http://127.0.0.1:4000',
    )
    expect(addressIn('nothing here but https://example.com:443')).toBeNull()
  })

  test('a loopback address still needs its port', () => {
    expect(addressIn('open http://localhost/ in a browser')).toBeNull()
  })
})

describe('A Portless address is an address', () => {
  test('a `<name>.localhost` host with a port is found, and its port read', () => {
    const url = addressIn('portless: ready at http://login-form-dev.localhost:1355 (proxy)')
    expect(url).toBe('http://login-form-dev.localhost:1355')
    expect(portOf(url ?? '')).toBe(1355)
  })

  test('a `<name>.localhost` host without a port is found, and names no port', () => {
    const url = addressIn('portless: ready at http://login-form-dev.localhost/ (proxy)')
    expect(url).toBe('http://login-form-dev.localhost')
    expect(portOf(url ?? '')).toBeNull()
  })

  test('the port of a loopback address is read as well', () => {
    expect(portOf('http://localhost:3000')).toBe(3000)
    expect(portOf('https://[::1]:4443')).toBe(4443)
  })
})

describe('The machine runs its own variant', () => {
  const seed = { line: './scripts/seed.sh', lineWindows: 'scripts\\seed.cmd', lineLinux: null }

  test('Windows runs its own line when the command has one', () => {
    expect(lineFor(seed, 'win32')).toBe('scripts\\seed.cmd')
  })

  test('Linux runs the default line when it has none, and its own when it has one', () => {
    expect(lineFor(seed, 'linux')).toBe('./scripts/seed.sh')
    expect(lineFor({ ...seed, lineLinux: 'bash scripts/seed.sh' }, 'linux')).toBe(
      'bash scripts/seed.sh',
    )
  })

  test('a system with no variant of its own runs the default line', () => {
    expect(lineFor({ ...seed, lineLinux: 'bash scripts/seed.sh' }, 'darwin')).toBe(
      './scripts/seed.sh',
    )
  })
})

describe('Only a running serve is joined', () => {
  test.each(COMMAND_TYPES)('%s', (type) => {
    expect(joinsRunningRun(type, true)).toBe(type === 'serve')
    expect(joinsRunningRun(type, false)).toBe(false)
  })
})

describe('A type and a scope are words the catalogue knows', () => {
  test('each of the seven types and the two scopes is read as itself', () => {
    for (const type of COMMAND_TYPES) expect(commandType(type)).toBe(type)
    for (const scope of COMMAND_SCOPES) expect(commandScope(scope)).toBe(scope)
  })

  test('a word of lot 18, or none at all, is refused naming the seven', () => {
    expect(() => commandType('app')).toThrow(UnknownCommandTypeError)
    expect(() => commandType('check')).toThrow(
      /serve, test, lint, build, configure, debug or script/,
    )
    expect(() => commandScope('everywhere')).toThrow(UnknownCommandScopeError)
  })
})
