import { describe, expect, test } from 'vite-plus/test'

import { EngineMainRpcs, EngineServedRpcs, WindowRpcs } from '../src/index.ts'

/** Served by the engine, asked by no screen yet: the window is not offered them. */
const UNUSED = ['evidence.setPublishable', 'teamComments.startMissionFrom']

describe('The window is offered only what a screen uses', () => {
  test('the engine serves the calls no screen asks for, and main does not forward them to the window', () => {
    const served = new Set(EngineServedRpcs.requests.keys())
    const main = new Set(EngineMainRpcs.requests.keys())
    const window = new Set(WindowRpcs.requests.keys())
    expect(UNUSED.filter((name) => served.has(name))).toEqual(UNUSED)
    expect(UNUSED.filter((name) => main.has(name))).toEqual([])
    expect(UNUSED.filter((name) => window.has(name))).toEqual([])
  })
})
