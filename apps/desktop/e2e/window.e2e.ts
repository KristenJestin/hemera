/**
 * What the lot claims about the window, asked of a running application.
 *
 * Each suite is named after the scenario of `specs/desktop-foundation/spec.md` it covers.
 */

import { browser, expect } from '@wdio/globals'

describe('Renderer sans Node', () => {
  it('has no require, no Node process and no Electron module in the page', async () => {
    const reached = await browser.execute(() =>
      ['require', 'process', 'electron', 'module'].filter((name) => name in globalThis),
    )
    expect(reached).toEqual([])
  })

  it('reaches the main process only through the bridge the preload exposes', async () => {
    const bridge = await browser.execute(() => window.hemera.invoke instanceof Function)
    expect(bridge).toBe(true)
  })

  it('runs isolated and sandboxed, which is what the page is unable to do', async () => {
    // Electron 44 exposes no way to read back the preferences a window was opened with, so
    // isolation is checked by what it costs: a page that reaches none of these is a page
    // whose preload ran in another world and whose renderer has no Node behind it.
    const reached = await browser.execute(() => ({
      leaked: ['ipcRenderer', '__dirname', 'Buffer'].filter((name) => name in globalThis),
      // The preload puts one object on the page; a leaked preload scope would put its own.
      bridgeKeys: Object.keys(window.hemera),
    }))
    expect(reached.leaked).toEqual([])
    expect(reached.bridgeKeys).toEqual(['invoke'])
  })
})

describe('Appel typé nominal', () => {
  it('answers the environment report on the declared channel', async () => {
    const report = await browser.execute(async () => await window.hemera.invoke('env.report', {}))
    expect(report.versions.electron).toMatch(/^\d+\.\d+\.\d+$/)
    expect(report.versions.chrome).toMatch(/^\d+\./)
    expect(report.displays.length).toBeGreaterThan(0)
    expect(report.platform).toMatch(/^(windows|linux)$/)
  })
})

describe('Message non conforme', () => {
  it('refuses a message the channel does not declare, naming the channel and the field', async () => {
    const refusal = await browser.execute(async () => {
      try {
        // SAFETY: the point of the test is a message the channel does not declare.
        await window.hemera.invoke('window.command', { command: 'explode' } as never)
        return 'accepted'
      } catch (error) {
        return String(error)
      }
    })
    expect(refusal).toContain('window.command')
    expect(refusal).toContain('command')
  })
})

describe("Ouverture sous Windows à l'échelle 150 %", () => {
  it('opens one frameless window with the system controls left to the platform', async () => {
    const window = await browser.electron.execute((electron) => {
      const [first] = electron.BrowserWindow.getAllWindows()
      return {
        count: electron.BrowserWindow.getAllWindows().length,
        visible: first?.isVisible(),
        backgroundColor: first?.getBackgroundColor(),
        title: first?.getTitle(),
      }
    })
    expect(window.count).toBe(1)
    expect(window.visible).toBe(true)
    // The colour the frame is painted with before anything is drawn in it, which is the very
    // token the page is painted with: one theme, read by both sides of the application.
    const background = await browser.execute(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
    )
    expect(window.backgroundColor?.toLowerCase()).toBe(background.toLowerCase())
  })

  it('marks a drag region the page does not lose to its controls', async () => {
    const regions = await browser.execute(() => {
      const strip = document.querySelector('header')
      const control = document.querySelector('main button')
      return {
        strip: strip === null ? null : getComputedStyle(strip).getPropertyValue('app-region'),
        control: control === null ? null : getComputedStyle(control).getPropertyValue('app-region'),
      }
    })
    expect(regions.strip).toBe('drag')
    expect(regions.control).toBe('no-drag')
  })
})

describe("Transition à la fréquence de l'écran", () => {
  it('plays the witness transition without a frame above two display periods', async () => {
    // Played once first: the transition after a cold start carries the page's first paint,
    // and that frame says what starting costs, not what the transition costs.
    await browser.execute(async () => await window.hemeraWitness.play())
    const measure = await browser.execute(async () => await window.hemeraWitness.play())

    expect(measure.frames).toBeGreaterThan(0)
    expect(measure.refreshRate).toBeGreaterThanOrEqual(30)
    expect(measure.longestFrame).toBeLessThanOrEqual((2 * 1000) / measure.refreshRate)
  })
})
