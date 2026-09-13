import { describe, expect, test } from 'bun:test'

import { createWindowSizeGate } from '../src/platform/window-size.ts'

describe('Première mesure de fenêtre ignorée', () => {
  test('a sample without dimensions is refused', () => {
    const gate = createWindowSizeGate()
    expect(gate.accept({ width: 0, height: 0 })).toBeNull()
    expect(gate.representative).toBeNull()
  })

  test('the first sample carrying real dimensions is adopted', () => {
    const gate = createWindowSizeGate()
    gate.accept({ width: 0, height: 0 })
    expect(gate.accept({ width: 1280, height: 800 })).toEqual({ width: 1280, height: 800 })
    expect(gate.representative).toEqual({ width: 1280, height: 800 })
  })

  test('a later empty sample does not shrink the measurement already taken', () => {
    const gate = createWindowSizeGate()
    gate.accept({ width: 1280, height: 800 })
    expect(gate.accept({ width: 0, height: 0 })).toEqual({ width: 1280, height: 800 })
    expect(gate.accept({ width: -1, height: 800 })).toEqual({ width: 1280, height: 800 })
    expect(gate.representative).toEqual({ width: 1280, height: 800 })
  })

  test('a resize is adopted', () => {
    const gate = createWindowSizeGate()
    gate.accept({ width: 1280, height: 800 })
    expect(gate.accept({ width: 1024, height: 640 })).toEqual({ width: 1024, height: 640 })
  })

  test('a sample that is not a number is refused', () => {
    const gate = createWindowSizeGate()
    expect(gate.accept({ width: Number.NaN, height: 800 })).toBeNull()
    expect(gate.accept({ width: Number.POSITIVE_INFINITY, height: 800 })).toBeNull()
  })
})
