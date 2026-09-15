/**
 * What the lot claims about the target the application runs on, asked of a running one.
 *
 * Some of these only apply to some machines: a fractional scale needs two displays scaled
 * differently, and a named degradation needs a driver that refuses acceleration. Those suites
 * skip where they do not apply rather than asserting something the machine cannot answer —
 * they keep their name, so the traceability table still finds the scenario they cover.
 */

import { browser, expect } from '@wdio/globals'

import type { EnvironmentReport } from '@hemera/ipc'

async function report(): Promise<EnvironmentReport> {
  return await browser.execute(async () => await window.hemera.invoke('env.report', {}))
}

/** Moves the window onto a display and answers the pixel ratio the page then reads. */
async function ratioOnDisplay(id: number): Promise<number> {
  await browser.electron.execute((electron, wanted: number) => {
    const [window] = electron.BrowserWindow.getAllWindows()
    const display = electron.screen.getAllDisplays().find((screen) => screen.id === wanted)
    if (window === undefined || display === undefined) return
    window.setBounds({
      x: display.bounds.x + 60,
      y: display.bounds.y + 60,
      width: 640,
      height: 420,
    })
  }, id)
  await browser.pause(1200)
  return await browser.execute(() => window.devicePixelRatio)
}

describe('Échelle fractionnaire par écran', () => {
  it('reports the pixel ratio of the display the window is on', async function () {
    const displays = (await report()).displays
    const scales = [...new Set(displays.map((display) => display.scaleFactor))]
    if (scales.length < 2) {
      this.skip()
      return
    }

    // SAFETY: guarded just above, `scales` has at least two entries.
    const [one, other] = scales as [number, number]
    const onOne = await ratioOnDisplay(displays.find((d) => d.scaleFactor === one)!.id)
    const onOther = await ratioOnDisplay(displays.find((d) => d.scaleFactor === other)!.id)

    // The page reads the ratio of the display it is on, not the one it started on.
    expect([onOne, onOther]).toEqual([one, other])
  })
})

describe('Compositing matériel constaté', () => {
  it('reports hardware compositing and GPU rasterisation, or skips where there is none', async function () {
    const graphics = (await report()).graphics
    if (graphics.features.gpu_compositing !== 'enabled') {
      this.skip()
      return
    }
    expect(graphics.features.rasterization).toBe('enabled')
    expect(graphics.device).not.toBeNull()
  })
})

describe('Dégradation nommée', () => {
  it('names the degraded feature and starts anyway, with no sandbox flag added', async function () {
    const current = await report()
    if (current.graphics.features.gpu_compositing === 'enabled') {
      this.skip()
      return
    }
    // The window is open — the application started — and the report says what is degraded.
    expect(current.graphics.features.gpu_compositing).toMatch(/disabled|software|unavailable/)
    const commandLine = await browser.electron.execute(() => process.argv.join(' '))
    expect(commandLine).not.toContain('--no-sandbox')
    expect(commandLine).not.toContain('--disable-gpu')
  })
})
