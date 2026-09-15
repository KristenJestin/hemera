import { describe, expect, test } from 'vite-plus/test'

import { applicationOrigin, decide, isOwnFrame } from '#main/bridge.ts'

const ORIGIN = 'http://localhost:5173'

/** The page of the application, as the main process sees a message arrive from it. */
const ownFrame = { url: `${ORIGIN}/index.html` }

describe('Appel typé nominal', () => {
  test('a declared channel called with conforming arguments is accepted as declared', () => {
    const decision = decide('window.command', ownFrame, { command: 'minimize' }, ORIGIN)
    expect(decision.accepted).toBe(true)
    expect(decision.accepted && decision.argument).toEqual({ command: 'minimize' })
  })

  test('the channel with no argument is accepted on an empty object', () => {
    expect(decide('env.report', ownFrame, {}, ORIGIN).accepted).toBe(true)
  })

  test('the origin is the renderer server while developing, and the file once packaged', () => {
    expect(applicationOrigin({ kind: 'server', location: `${ORIGIN}/` })).toBe(ORIGIN)
    expect(applicationOrigin({ kind: 'bundle', location: 'C:\\app\\renderer\\index.html' })).toBe(
      'file://',
    )
  })
})

describe('Message non conforme', () => {
  test('a message whose argument breaks the schema is refused, naming channel and field', () => {
    const decision = decide('window.command', ownFrame, { command: 'explode' }, ORIGIN)
    expect(decision.accepted).toBe(false)
    expect(decision.accepted || decision.reason).toContain('window.command')
    expect(decision.accepted || decision.reason).toContain('command')
  })

  test.each([
    ['a missing field', {}],
    ['a field of the wrong type', { command: 7 }],
    ['nothing at all', undefined],
    ['a string where an object is declared', 'minimize'],
  ])('%s is refused and no handler is reached', (_case, argument) => {
    const decision = decide('window.command', ownFrame, argument, ORIGIN)
    expect(decision.accepted).toBe(false)
    // A refusal carries a reason and no argument: there is nothing for a handler to run on.
    expect(decision).not.toHaveProperty('argument')
  })
})

describe('Émetteur inconnu', () => {
  test.each([
    ['another origin', { url: 'https://example.invalid/page' }],
    ['a file when the page is served', { url: 'file:///C:/somewhere/else.html' }],
    ['a frame that is already gone', null],
  ])('a message from %s is refused without being read', (_case, emitter) => {
    const decision = decide('window.command', emitter, { command: 'minimize' }, ORIGIN)
    expect(decision.accepted).toBe(false)
    expect(decision.accepted || decision.reason).toContain('window.command')
  })

  test('the origin of the packaged application is the file the window was loaded from', () => {
    expect(isOwnFrame({ url: 'file:///C:/app/renderer/index.html' }, 'file://')).toBe(true)
    expect(isOwnFrame({ url: 'https://example.invalid/' }, 'file://')).toBe(false)
  })

  test('a url that is not one is refused rather than thrown on', () => {
    expect(isOwnFrame({ url: 'not a url' }, ORIGIN)).toBe(false)
  })
})
