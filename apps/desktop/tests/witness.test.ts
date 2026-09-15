import { describe, expect, test } from 'vite-plus/test'

import { CALM } from '#renderer/application.tsx'
import { measureOf } from '#renderer/witness.ts'

/** Frame times of a run at `rate` hertz, with `spikes` inserted as longer frames. */
function frames(rate: number, count: number, spikes: number[] = []): number[] {
  const period = 1000 / rate
  const times = [0]
  for (let index = 1; index < count; index += 1) {
    times.push(times[index - 1]! + (spikes[index - 1] ?? period))
  }
  return times
}

describe('Transition à la fréquence de l’écran', () => {
  test('a run at the refresh rate reports that rate and a frame of one period', () => {
    const measure = measureOf(frames(165, 300))
    expect(measure.refreshRate).toBe(165)
    expect(measure.frames).toBe(300)
    expect(measure.longestFrame).toBeLessThan(2 * (1000 / 165))
  })

  test('a frame longer than two periods is what the measure reports', () => {
    const measure = measureOf(frames(60, 100, [16.7, 16.7, 48]))
    expect(measure.refreshRate).toBe(60)
    expect(measure.longestFrame).toBe(48)
    expect(measure.longestFrame).toBeGreaterThan(2 * (1000 / 60))
  })

  test('a run with no frame to compare says nothing rather than something', () => {
    expect(measureOf([])).toEqual({ refreshRate: 0, frames: 0, longestFrame: 0 })
    expect(measureOf([12])).toEqual({ refreshRate: 0, frames: 1, longestFrame: 0 })
  })
})

describe('Propriétés autorisées seules', () => {
  test('the calm personality is the spring the prototype settled on', () => {
    expect(CALM).toEqual({ type: 'spring', stiffness: 170, damping: 26 })
  })
})
