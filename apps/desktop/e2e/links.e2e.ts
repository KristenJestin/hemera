/**
 * The window's link, in the real application: the port crosses the sandboxed preload, and every
 * way a page goes away closes its port in main and interrupts its stream down to the engine.
 */

import { join } from 'node:path'

import { browser, expect } from '@wdio/globals'

import {
  countOf,
  diagnosticOf,
  markPage,
  waitForEngine,
  waitForLines,
  waitForNewPage,
} from './diagnostic.ts'

const SPEC = 'links.e2e.ts'
const PRELOAD = join(import.meta.dirname, '..', 'dist', 'preload', 'index.cjs')
/** main's line for a closed port, and the engine's for its stream's handler that ended. */
const CLOSED = /\[main\] a window closed its link/
const ENDED = /\[engine\] engine\.statusChanges: (ended|interrupted)$/

/** Does something to the page, and checks that main and the engine both saw it go away. */
async function goesAway(action: () => Promise<void>): Promise<void> {
  await markPage()
  const closed = countOf(SPEC, CLOSED)
  const ended = countOf(SPEC, ENDED)
  await action()
  await waitForLines(SPEC, CLOSED, closed + 1)
  await waitForLines(SPEC, ENDED, ended + 1)
}

describe('The window’s link to main and the engine', () => {
  afterEach(function () {
    if (this.currentTest?.state === 'failed') console.log(diagnosticOf(SPEC).join('\n'))
  })

  it('reaches the engine through the preload, with the sandbox and context isolation on', async () => {
    await waitForEngine()
    // Isolated and sandboxed: the page sees neither Node nor what the preload itself holds.
    const page = await browser.execute(() => ({
      node: 'require' in window || 'process' in window,
      ipc: 'ipcRenderer' in window,
    }))
    expect(page).toEqual({ node: false, ipc: false })
  })

  it('a reload closes the page’s port in main and interrupts the engine’s handler', async () => {
    await goesAway(async () => {
      await browser.electron.execute((electron) => {
        electron.BrowserWindow.getAllWindows()[0]?.webContents.reload()
      })
    })
    await waitForNewPage()
  })

  it('a navigation does the same', async () => {
    await goesAway(async () => {
      await browser.electron.execute((electron) => {
        const contents = electron.BrowserWindow.getAllWindows()[0]?.webContents
        void contents?.loadURL(contents.getURL())
      })
    })
    await waitForNewPage()
  })

  it('the page’s own port sees main close it', async () => {
    await browser.execute(() => {
      const { port1, port2 } = new MessageChannel()
      Object.assign(window, { closedByMain: false })
      port1.addEventListener('close', () => Object.assign(window, { closedByMain: true }))
      port1.start()
      window.postMessage({ hemera: 'connect' }, '*', [port2])
    })
    await browser.pause(500)
    await browser.electron.execute(() => globalThis.hemeraProbe?.closeWindowLinks())
    await browser.waitUntil(
      async () => browser.execute(() => Reflect.get(window, 'closedByMain') === true),
      { timeout: 10_000, timeoutMsg: 'the page’s port never saw main close it' },
    )
    await markPage()
    await browser.electron.execute((electron) => {
      electron.BrowserWindow.getAllWindows()[0]?.webContents.reload()
    })
    await waitForNewPage()
  })

  it('a port from another origin is refused and logged', async () => {
    const refused = await browser.electron.execute((electron) => {
      const { port1, port2 } = new electron.MessageChannelMain()
      let closed = false
      port1.on('close', () => {
        closed = true
      })
      port1.start()
      electron.ipcMain.emit('hemera:connect', {
        ports: [port2],
        senderFrame: { url: 'https://example.com/' },
      })
      return new Promise<boolean>((resolve) => setTimeout(() => resolve(closed), 500))
    })
    expect(refused).toBe(true)
    await waitForLines(SPEC, /hemera:connect: refused a port from https:\/\/example\.com\//, 1)
  })

  it('streams agent-like items with an acknowledgement each, and says how fast', async () => {
    // Started without waiting on it: one request held for the whole stream outlasts the driver's
    // limit on a busy machine. Its measure is read once it has ended.
    await browser.electron.execute(() => {
      globalThis.hemeraLoaded = undefined
      void globalThis.hemeraProbe?.load(20_000, 200).then((measure) => {
        globalThis.hemeraLoaded = measure
      })
    })
    const measure = await browser.waitUntil(
      async () => browser.electron.execute(() => globalThis.hemeraLoaded),
      { timeout: 50_000, interval: 500, timeoutMsg: 'the load never ended' },
    )
    expect(measure.items).toBe(20_000)
    console.log(`load: ${JSON.stringify(measure)}`)
  })

  it('a window that closes does the same', async () => {
    const second = await browser.electron.execute((electron, preload) => {
      const [first] = electron.BrowserWindow.getAllWindows()
      const opened = new electron.BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
      })
      void opened.loadURL(first?.webContents.getURL() ?? '')
      return opened.id
    }, PRELOAD)
    // Its page hands main its port and subscribes as soon as it has loaded.
    await browser.pause(3_000)
    await goesAway(async () => {
      await browser.electron.execute((electron, id) => {
        electron.BrowserWindow.fromId(id)?.close()
      }, second)
    })
  })

  it('a renderer that crashes closes its port and interrupts the engine’s handler', async () => {
    await goesAway(async () => {
      await browser.electron.execute((electron) => {
        const contents = electron.BrowserWindow.getAllWindows()[0]?.webContents
        const pid = contents?.getOSProcessId()
        contents?.forcefullyCrashRenderer()
        // With the driver attached, Electron 44 leaves the renderer running after
        // `forcefullyCrashRenderer()`: its process is then killed, which is a crash to main.
        setTimeout(() => {
          if (contents?.isCrashed() === false && pid !== undefined) process.kill(pid, 'SIGKILL')
        }, 1_000)
      })
    })
    // Last of the file: the driver loses the page it drove along with the renderer.
  })
})
