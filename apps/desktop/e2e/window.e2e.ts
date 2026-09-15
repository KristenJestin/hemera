/**
 * What the lot claims about the window, asked of a running application.
 *
 * Each suite is named after the scenario of `specs/desktop-foundation/spec.md` it covers, so
 * the traceability table finds it by that name and by nothing else.
 */

import { browser, expect } from '@wdio/globals'

describe('Renderer sans Node', () => {
  it('has no require, no Node process and no Electron module in the page', async () => {
    const reached = await browser.execute(() => ({
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      electron: typeof (globalThis as { electron?: unknown }).electron,
      module: typeof (globalThis as { module?: unknown }).module,
    }))
    expect(reached.require).toBe('undefined')
    expect(reached.process).toBe('undefined')
    expect(reached.electron).toBe('undefined')
    expect(reached.module).toBe('undefined')
  })

  it('reaches the main process only through the bridge the preload exposes', async () => {
    const bridge = await browser.execute(
      () => typeof (window as unknown as { hemera?: { invoke?: unknown } }).hemera?.invoke,
    )
    expect(bridge).toBe('function')
  })

  it('runs isolated and sandboxed, which is what the page is unable to do', async () => {
    // Electron 44 exposes no way to read back the preferences a window was opened with, so
    // isolation is checked by what it costs: a page that reaches none of these is a page
    // whose preload ran in another world and whose renderer has no Node behind it.
    const reached = await browser.execute(() => ({
      ipcRenderer: typeof (globalThis as { ipcRenderer?: unknown }).ipcRenderer,
      dirname: typeof (globalThis as Record<string, unknown>)['__dirname'],
      buffer: typeof (globalThis as { Buffer?: unknown }).Buffer,
      // The preload puts one object on the page; a leaked preload scope would put its own.
      bridgeKeys: Object.keys(window.hemera),
    }))
    expect(reached.ipcRenderer).toBe('undefined')
    expect(reached.dirname).toBe('undefined')
    expect(reached.buffer).toBe('undefined')
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
    // The colour the frame is painted with before anything is drawn in it.
    expect(window.backgroundColor?.toLowerCase()).toBe('#12141a')
  })

  it('marks a drag region the page does not lose to its controls', async () => {
    const regions = await browser.execute(() => {
      const strip = document.querySelector('.title-bar')
      const control = document.querySelector('.title-bar ~ .page button')
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
