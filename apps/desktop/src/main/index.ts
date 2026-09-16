/**
 * The main process: it opens the window, wires the channels, and answers `--report`.
 *
 * Anything that must exist before the window does is awaited at the top level of this file:
 * the module loads asynchronously, so a dynamic import would arrive after Electron is ready.
 * `ready` itself is not: Electron emits it once this module has finished evaluating, so a
 * top-level `await app.whenReady()` waits for an event its own waiting prevents.
 *
 * Which profile this start opens is decided here, first of all and before anything is created
 * (design D3-06): `userData` is moved onto it, so the single instance lock, the persisted
 * window state and everything else Electron files under `userData` follow the profile rather
 * than the machine.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { MotionMeasure } from '@hemera/ipc'
import { BrowserWindow, Menu, app, nativeTheme } from 'electron/main'
import { Effect } from 'effect'

import {
  type ApplicationIdentity,
  applicationVersion,
  channel,
  chooseProfile,
  profileDirectory,
} from './channel.ts'
import { registerChannels } from './channels.ts'
import { openDiagnosticLog, reported, writeDiagnosticTo } from './diagnostic.ts'
import { readSidecar } from './display-sidecar.ts'
import { collectReport } from './environment.ts'
import { startProfile } from './profile-client.ts'
import { createWindow, loadWindow } from './window.ts'

const main = dirname(fileURLToPath(import.meta.url))

/**
 * The migrations this build carries, which travel with the bundles rather than beside them.
 *
 * Resolved from this file and not from `app.getAppPath()`: the two agree inside a package and
 * during a development run, and only this one is still right when Electron is pointed straight
 * at the built entry point, which is how the end-to-end suite starts the application.
 */
const MIGRATIONS = join(main, '..', '..', 'drizzle')

/** Asked for by `pnpm report`: start as usual, say what this machine is, and leave. */
const REPORT_FLAG = '--report'

const identity: ApplicationIdentity = {
  channel: channel(app.isPackaged, app.getAppPath()),
  version: applicationVersion(app.isPackaged, app.getVersion(), process.env),
}

const choice = chooseProfile(identity.channel, process.platform, process.env, process.argv)

/**
 * A start that was refused, said where it can still be read.
 *
 * The folder the argument named is the one thing this start must not write into, so the
 * refusal goes to the profile this channel would have opened on its own.
 */
function refuse(reason: string): never {
  openDiagnosticLog(
    profileDirectory(identity.channel, process.platform, process.env),
    'main',
  )(reason)
  app.exit(1)
  // `app.exit` leaves immediately; its type does not say so, and the profile is a `string`.
  throw new Error(reason)
}

const profile = choice.accepted ? choice.directory : refuse(choice.reason)

app.setPath('userData', profile)

const log = openDiagnosticLog(profile, 'main')
writeDiagnosticTo(log)
log(`starting channel ${identity.channel}, version ${identity.version}, profile ${profile}`)

/**
 * No menu at all, which also takes its keystrokes with it.
 *
 * Electron gives a window a default menu, and the default menu owns Ctrl+W — so a frameless
 * application with no menu bar anywhere on screen still closes itself on a keystroke nobody
 * chose, from a menu nobody can see. The shortcuts of the application are declared in the
 * renderer, in one table, and that is the whole list.
 */
Menu.setApplicationMenu(null)

/**
 * One instance per profile, and the lock is on the profile because `userData` is.
 *
 * A second start on the same profile has nothing to do but hand the window back: two programs
 * on one database is how a profile gets two writers. Two profiles run side by side, which is
 * the whole point of the `dev` one.
 */
if (!app.requestSingleInstanceLock()) {
  log('a first instance already holds this profile; this one steps aside')
  app.quit()
} else {
  app.on('second-instance', () => {
    const [first] = BrowserWindow.getAllWindows()
    if (first === undefined) return
    if (first.isMinimized()) first.restore()
    first.focus()
  })

  void app.whenReady().then(async () => {
    // The database is opened in its own process, and only once the application is ready: it is
    // the one program that holds the profile's file, and the main process never touches it.
    const profileProcess = startProfile(main, profile, identity, MIGRATIONS)

    // Where the profile turned out to stand, written down once (design D3-09). It is asked for
    // rather than assumed: the migration it is at is the migrator's own answer, and the version
    // that wrote it last is the name a refusal would have given. Nothing waits for this — a log
    // line is not what the window is for — and a profile that cannot say so says that instead.
    void Effect.runPromise(
      profileProcess.ask('profile.status', {}).pipe(
        Effect.match({
          onSuccess: (status) =>
            log(
              `database at ${status.lastMigration ?? 'no migration yet'}, last written by ${status.writtenByVersion ?? 'nobody'}`,
            ),
          onFailure: (failed) =>
            log(`the profile did not say where it stands: ${reported(failed)}`),
        }),
      ),
    )

    // What the last start left, read before there is a window to paint: the frame, the system's
    // own buttons and the page all come up wearing it, and the profile corrects it afterwards
    // if it disagrees. A start with nothing to go on opens on the desktop's own theme.
    const hint = readSidecar(profile)
    if (hint !== null) nativeTheme.themeSource = hint.theme

    // Wired before the page loads: the first thing it does is say which theme it wants, and a
    // channel with nobody on it would answer that with an error in the application's own console.
    const window = createWindow(main)
    registerChannels(window, identity, profileProcess, profile)
    await loadWindow(window)

    if (process.argv.includes(REPORT_FLAG)) {
      // The transition is played and counted in the page, because that is where frames are
      // rendered; the main process only asks for it and files what came back.
      //
      // It is played three times and the last one is filed. The first folds after a cold start
      // carry the page's first paints and the compositor layer the panel is given — eighteen
      // milliseconds on this machine, three periods of a 165 Hz display — and those frames say
      // what starting costs, not what the fold costs. What the lot asks of the fold is measured
      // on a window that has already drawn it.
      const play = 'window.hemeraWitness.play()'
      await window.webContents.executeJavaScript(play)
      await window.webContents.executeJavaScript(play)
      // SAFETY: `play` is the renderer's `window.hemeraWitness.play`, declared in `bridge.d.ts`
      // to resolve a `MotionMeasure`; `executeJavaScript` returns it untyped.
      const motion = (await window.webContents.executeJavaScript(play)) as MotionMeasure
      // Read after the page has painted: what the GPU decided is only true once it drew.
      process.stdout.write(JSON.stringify({ ...(await collectReport(identity)), motion }))
      app.quit()
    }
  })
}

app.on('window-all-closed', () => {
  app.quit()
})
