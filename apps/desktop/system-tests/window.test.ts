import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

const desktop = resolve(import.meta.dir, '..')

/**
 * Launches the desktop entry and reads its output until the window announces itself,
 * then stops the process. Needs a graphical session: this is a system test, never part of
 * the business suite.
 */
async function openWindowAndReadAnnouncement(timeoutMs: number): Promise<string[]> {
  const child = Bun.spawn(['bun', 'src/entry/main.tsx'], {
    cwd: desktop,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const lines: string[] = []
  const deadline = Date.now() + timeoutMs
  try {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    while (Date.now() < deadline) {
      // Reading the next chunk has to wait for the previous one; the chunks are a stream,
      // not a set of independent promises.
      // oxlint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      const parts = buffered.split('\n')
      buffered = parts.pop() ?? ''
      lines.push(...parts.map((line) => line.trim()).filter((line) => line.length > 0))
      if (lines.some((line) => line.startsWith('window opened'))) break
    }
  } finally {
    child.kill()
    await child.exited
  }
  return lines
}

describe('Démarrage applicatif', () => {
  test('the embedded fonts are registered before the window is created', async () => {
    const lines = await openWindowAndReadAnnouncement(60_000)
    const fonts = lines.findIndex((line) => line.startsWith('fonts registered'))
    const window = lines.indexOf('[gpuix] created native window')
    expect(fonts).toBeGreaterThanOrEqual(0)
    expect(window).toBeGreaterThanOrEqual(0)
    // A font registered after the text system starts is never used by the renderer.
    expect(fonts).toBeLessThan(window)
    expect(lines[fonts]).toMatch(/^fonts registered (\d+)\/\1$/)
  }, 90_000)

  test('the desktop entry opens a real native window on this host', async () => {
    const lines = await openWindowAndReadAnnouncement(60_000)
    expect(lines).toContain('[gpuix] created native window')

    const announcement = lines.find((line) => line.startsWith('window opened'))
    expect(announcement).toBeDefined()
    const [width, height] = announcement!
      .replace('window opened ', '')
      .split('x')
      .map((value) => Number.parseInt(value, 10))
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  }, 90_000)
})
