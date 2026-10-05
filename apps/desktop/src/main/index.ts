/**
 * The main process: one window, the engine, and the links between them.
 *
 * It takes the single-instance lock, starts the engine once Electron is ready, serves the ports
 * windows hand it, opens the window on the opening colour of the system's theme, keeps the page
 * from navigating anywhere but to itself, and quits when the window closes. `--report` prints
 * the environment report once the window has loaded, and quits.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { maskShapes } from '@hemera/core/domain'
import { closedAs, EngineGone, type WindowNotice } from '@hemera/ipc'
import { Effect, PubSub, Stream } from 'effect'
import { shell } from 'electron/common'
import { BrowserWindow, Menu, app, dialog, nativeTheme, screen } from 'electron/main'

import { DIAGNOSTIC_FILE, openDiagnosticLog, type Log } from './diagnostic.ts'
import { readSidecar, writeSidecar } from './display-sidecar.ts'
import { startEngine } from './engine-process.ts'
import { identityOf } from './identity.ts'
import { applicationOrigin } from './origin.ts'
import { GROUP_WINDOW } from './notifications.ts'
import { runNotifier } from './notifier.ts'
import { installProbe } from './probe.ts'
import { rendererSource } from './renderer-source.ts'
import { collectReport } from './report.ts'
import { refreshDisplay, windowHandlers, type Application } from './window-link.ts'
import { OPENING_COLORS } from './opening-colors.ts'
import { headless, windowOptions } from './window-options.ts'
import { serveWindows } from './window-ports.ts'
import { previewSound, soundsFolderOf } from './sounds.ts'
import { systemNotifierPorts, systemSounds } from './system-notifier.ts'

const main = dirname(fileURLToPath(import.meta.url))

/**
 * The migrations this build carries, beside its bundles. Resolved from this file rather than from
 * `app.getAppPath()`: both agree in a package and in a development run, and only this one is
 * still right when Electron is pointed straight at the built entry point, as the end-to-end
 * suite does.
 */
const MIGRATIONS = join(main, '..', '..', 'drizzle')

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

/** The opening colours of the theme the window wears now. */
const wornColors = () => OPENING_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']

/**
 * Paints the frame of an open window in the theme worn now: what shows before the page draws (a
 * reload) and the system's buttons, which the page cannot paint.
 */
function repaint(window: BrowserWindow): void {
  const colors = wornColors()
  window.setBackgroundColor(colors.background)
  window.setTitleBarOverlay({ color: colors.sheet, symbolColor: colors.foreground })
}

async function openWindow(log: Log): Promise<BrowserWindow> {
  const window = new BrowserWindow(windowOptions(main, wornColors(), process.env))
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
  // Main holds no secret value: it masks the shapes of credentials.
  const log = openDiagnosticLog(dataFolder, 'main', maskShapes)
  const identity = identityOf(app.getAppPath(), app.getVersion())
  log(`starting ${identity.version} on channel ${identity.channel}, data folder ${dataFolder}`)

  // The theme the user chose, worn from the first frame: the engine's answer comes later, and
  // corrects the hint if it was missing or out of date.
  nativeTheme.themeSource = readSidecar(dataFolder)?.theme ?? 'system'

  const underSuite = headless(process.env)
  const engine = yield* startEngine(
    main,
    { dataFolder, migrations: MIGRATIONS, ...identity },
    log,
    underSuite,
  )

  const report = Effect.sync(() => collectReport(identity, dataFolder, screen))
  // What main tells the window of notifications: whoever listens hears it from then on.
  const notices = yield* PubSub.unbounded<WindowNotice>()
  const sounds = systemSounds({ soundsFolder: soundsFolderOf(main), quiet: underSuite, log })
  const application: Application = {
    report,
    relaunch: Effect.sync(() => {
      app.relaunch()
      app.exit(0)
    }),
    showLog: Effect.sync(() => shell.showItemInFolder(join(dataFolder, DIAGNOSTIC_FILE))),
    chooseFolder: Effect.promise(async () => {
      const [window] = BrowserWindow.getAllWindows()
      const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
      const chosen = await (window === undefined
        ? dialog.showOpenDialog(options)
        : dialog.showOpenDialog(window, options))
      return chosen.canceled ? null : (chosen.filePaths[0] ?? null)
    }),
    display: (preferences) =>
      Effect.sync(() => {
        nativeTheme.themeSource = preferences.theme
        writeSidecar(dataFolder, preferences, log)
      }),
    notices: Stream.fromPubSub(notices),
    preview: previewSound(sounds),
  }
  yield* refreshDisplay(engine.client, application).pipe(Effect.ignore, Effect.forkScoped)
  // Served before the page loads: the first thing the page does is hand over its port.
  const windows = yield* serveWindows(
    windowHandlers(engine.client, application, log),
    applicationOrigin(rendererSource()),
    log,
  )
  if (engine.probe !== undefined) {
    yield* installProbe(engine.probe, engine.process, windows, engine.client, application)
  }
  // The notices the engine tells, delivered from here: in the window or by the system.
  yield* runNotifier(
    engine.client['notifications.feed'](),
    systemNotifierPorts({
      settings: engine.client['notifications.settings']().pipe(closedAs(() => new EngineGone())),
      tell: (notice) => PubSub.publishUnsafe(notices, notice),
      sounds,
      quiet: underSuite,
      log,
    }),
    GROUP_WINDOW,
  ).pipe(Effect.forkScoped)
  yield* Effect.promise(() => openWindow(log))
  // The theme changes under the window — chosen in Hemera, or the system's when it follows it.
  nativeTheme.on('updated', () => {
    for (const window of BrowserWindow.getAllWindows()) repaint(window)
  })
  // Only now may what waits for the window run: the commands run at each opening.
  yield* engine.client['engine.windowShown']().pipe(
    Effect.catch((failure) =>
      Effect.sync(() => log(`the engine was not told the window is shown: ${failure.message}`)),
    ),
    Effect.forkScoped,
  )

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
