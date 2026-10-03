/**
 * An agents' process, in the real application: the engine asks main to fork it for the test
 * program, talks to the program through the port main handed over, and a killed process ends its
 * stream with a typed error while the engine sees its exit.
 */

import { join } from 'node:path'

import { browser, expect } from '@wdio/globals'

import { diagnosticOf, waitForEngine, waitForLines } from './diagnostic.ts'

const SPEC = 'agents.e2e.ts'
const ECHO = join(import.meta.dirname, '..', 'tests', 'fixtures', 'echo.mjs')

describe('An agents’ process started through main', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('answers the engine through its port, and a kill ends its stream with a typed error', async () => {
    await waitForEngine()
    const pid = await browser.electron.execute(
      async (_, program) =>
        globalThis.hemeraProbe?.startAgents(program, ['hello', 'pieces in two']),
      ECHO,
    )
    expect(pid).toBeGreaterThan(0)
    await browser.waitUntil(
      async () =>
        (await browser.electron.execute(() => globalThis.hemeraProbe?.agentsLines()))?.length === 2,
      { timeout: 10_000, timeoutMsg: 'the program’s lines never came back' },
    )
    await browser.electron.execute((_, killed) => process.kill(killed), pid ?? 0)
    const outcome = await browser.electron.execute(async () =>
      globalThis.hemeraProbe?.agentsOutcome(),
    )
    expect(outcome).toEqual({ ended: 'An agent’s process stopped.', lines: ['hello', 'in two'] })
    await waitForLines(SPEC, /\[engine\] agents' process for .*echo\.mjs exited with code/, 1)
  })
})
