/**
 * Says what the system prefers, for the length of one story.
 *
 * The preference is a media query, and a media query is answered by the browser: a story
 * cannot decide it from the inside, and a `MotionConfig` only reaches what motion animates.
 * The stylesheet answers the same query on its own (`motion-safe`, the popup utilities), so
 * the one way to test both at once is to ask the browser to say what the system prefers.
 *
 * Answers `null` where nobody is driving the browser, which is the catalogue opened by hand:
 * the reader sees what their own system asked for, and the story says so.
 */
export async function emulateReducedMotion(): Promise<(() => Promise<void>) | null> {
  const runner = await import('vitest/browser').catch(() => null)
  if (runner === null) return null
  const session = runner.cdp()
  const set = async (preference: string): Promise<void> => {
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: preference }],
    })
  }
  await set('reduce')
  // The emulation travels over the protocol and the page answers when it arrives; a story that
  // acted before then would be testing the preference it was trying to change.
  await until(() => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches)
  return async () => {
    await set('no-preference')
    await until(() => !globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }
}

/** Waits for the page to agree, a frame at a time. */
function until(reached: () => boolean): Promise<void> {
  return new Promise((settle) => {
    const look = (): void => {
      if (reached()) {
        settle()
        return
      }
      requestAnimationFrame(look)
    }
    look()
  })
}
