import { describe, expect, test } from 'vite-plus/test'

import { watchProgress } from './stories-watchdog.ts'

/** A clock the test moves by hand, in seconds. */
function clock() {
  let seconds = 0
  return {
    now: () => seconds * 1000,
    advance: (by: number) => {
      seconds += by
    },
  }
}

const SETUP_CARD = 'storybook-dark src/blocks/setup/setup-card.stories.tsx'
const BALL_MARK = 'storybook-light src/blocks/ball/ball-mark.stories.tsx'

describe('A stories run that stops finishing files is called stalled, naming what it waits on', () => {
  test('a run whose files keep finishing is never stalled, however long it lasts', () => {
    const time = clock()
    const watch = watchProgress({ idleMs: 90_000, now: time.now })
    watch.queue(BALL_MARK)
    watch.queue(SETUP_CARD)
    watch.start(BALL_MARK)
    time.advance(80)
    watch.finish(BALL_MARK)
    watch.start(SETUP_CARD)
    time.advance(80)
    expect(watch.verdict()).toBeNull()
  })

  test('a file that never reports stalls the run once every other file has finished', () => {
    const time = clock()
    const watch = watchProgress({ idleMs: 90_000, now: time.now })
    watch.queue(BALL_MARK)
    watch.queue(SETUP_CARD)
    watch.start(SETUP_CARD)
    watch.start(BALL_MARK)
    time.advance(20)
    watch.finish(BALL_MARK)
    time.advance(89)
    expect(watch.verdict()).toBeNull()
    time.advance(2)
    const verdict = watch.verdict()
    expect(verdict).toContain('no story file finished in the last 90 s')
    expect(verdict).toContain(SETUP_CARD)
    expect(verdict).not.toContain(BALL_MARK)
  })

  test('files still waiting for a slot are counted, not listed as running', () => {
    const time = clock()
    const watch = watchProgress({ idleMs: 90_000, now: time.now })
    watch.queue(SETUP_CARD)
    watch.queue(BALL_MARK)
    watch.start(SETUP_CARD)
    time.advance(91)
    const verdict = watch.verdict()
    expect(verdict).toContain(`Running: ${SETUP_CARD}`)
    expect(verdict).toContain('Waiting for a slot: 1 file')
  })

  test('the quiet before the first file finishes counts from the start of the run', () => {
    const time = clock()
    const watch = watchProgress({ idleMs: 90_000, now: time.now })
    watch.queue(SETUP_CARD)
    watch.start(SETUP_CARD)
    time.advance(60)
    expect(watch.verdict()).toBeNull()
    time.advance(31)
    expect(watch.verdict()).toContain(SETUP_CARD)
  })

  test('a run with nothing left to wait for is never stalled', () => {
    const time = clock()
    const watch = watchProgress({ idleMs: 90_000, now: time.now })
    watch.queue(BALL_MARK)
    watch.start(BALL_MARK)
    watch.finish(BALL_MARK)
    time.advance(3600)
    expect(watch.verdict()).toBeNull()
  })
})
