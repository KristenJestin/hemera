/**
 * The main process: one window, the engine, and the links between them.
 *
 * It takes the single-instance lock, starts the engine once Electron is ready, serves the ports
 * windows hand it, opens the window on the opening colour of the system's theme, keeps the page
 * from navigating anywhere but to itself, and quits when the window closes. `--report` prints
 * the environment report once the window has loaded, and quits.
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Effect } from 'effect'
import { shell } from 'electron/common'
import { BrowserWindow, Menu, app, nativeTheme, screen } from 'electron/main'

import { openDiagnosticLog, type Log } from './diagnostic.ts'
import { startEngine } from './engine-process.ts'
import { identityOf } from './identity.ts'
import { applicationOrigin } from './origin.ts'
import { installProbe } from './probe.ts'
import { rendererSource } from './renderer-source.ts'
import { collectReport } from './report.ts'
import { windowHandlers } from './window-link.ts'
import { OPENING_COLORS, headless, windowOptions } from './window-options.ts'
import { serveWindows } from './window-ports.ts'

const main = dirname(fileURLToPath(import.meta.url))

/** Asked for on the command line: start as usual, say what this machine is, and leave. */
const REPORT_FLAG = '--report'

/** Whether a URL is one the user's own browser may be handed, rather than this window. */
function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

async function openWindow(log: Log): Promise<BrowserWindow> {
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  const window = new BrowserWindow(windowOptions(main, OPENING_COLORS[theme], process.env))
  const source = rendererSource()

  // A `window.open()` is always denied and a navigation away from the page is prevented; a web
  // address still opens, in the user's own browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('render-process-gone', (_, { reason, exitCode }) => {
    log(`the page's process is gone (${reason}, code ${String(exitCode)})`)
  })
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
    if (isWebUrl(event.url)) void shell.openExternal(event.url)
  })

  await (source.kind === 'server'
    ? window.loadURL(source.location)
    : window.loadFile(source.location))
  return window
}

/** Everything main runs once Electron is ready, for as long as the application lives. */
const run = Effect.gen(function* () {
  const dataFolder = app.getPath('userData')
  const log = openDiagnosticLog(dataFolder, 'main')
  const identity = identityOf(app.getAppPath(), app.getVersion())
  log(`starting ${identity.version} on channel ${identity.channel}, data folder ${dataFolder}`)

  const underSuite = headless(process.env)
  const engine = yield* startEngine(main, { dataFolder, ...identity }, log, underSuite)

  const report = Effect.sync(() => collectReport(identity, dataFolder, screen))
  const application = {
    report,
    relaunch: Effect.sync(() => {
      app.relaunch()
      app.exit(0)
    }),
  }
  // Served before the page loads: the first thing the page does is hand over its port.
  const windows = yield* serveWindows(
    windowHandlers(engine.client, application, log),
    applicationOrigin(rendererSource()),
    log,
  )
  if (engine.probe !== undefined) yield* installProbe(engine.probe, engine.process, windows)
  yield* Effect.promise(() => openWindow(log))

  if (process.argv.includes(REPORT_FLAG)) {
    process.stdout.write(`${JSON.stringify(yield* report)}\n`)
    app.quit()
  }
  return yield* Effect.never
})

/**
 * No menu at all, which also takes its keystrokes with it: the default menu owns Ctrl+W, and a
 * frameless window with no menu bar would close itself on a keystroke nobody chose.
 */
Menu.setApplicationMenu(null)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [first] = BrowserWindow.getAllWindows()
    // Under the end-to-end suite with no window on screen, handing the window back would put it
    // on screen and take the focus of whoever is using the machine: it stays where it is.
    if (first === undefined || headless(process.env)) return
    if (first.isMinimized()) first.restore()
    first.focus()
  })

  void app.whenReady().then(() => Effect.runFork(Effect.scoped(run)))
}

app.on('window-all-closed', () => {
  app.quit()
})
