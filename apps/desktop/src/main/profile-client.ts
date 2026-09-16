/**
 * The process that holds the database, started and handed its end of a channel (design D3-01).
 *
 * The fork is named, so the profile shows up as `profile` in Electron's own process list and
 * in a task manager. What is said over the channel, and what a silence means, is
 * `profile-conversation.ts`; this file is the Electron half and nothing else.
 */

import { join } from 'node:path'

import { MessageChannelMain, app, utilityProcess } from 'electron/main'

import { type ApplicationIdentity } from './channel.ts'
import { diagnostic } from './diagnostic.ts'
import { type ProfileConversation, profileConversation } from './profile-conversation.ts'

/**
 * Starts the process that holds the database and hands it its end of a channel.
 *
 * If it ever ends *on its own*, the application goes with it: a cockpit with no database has
 * nothing to show and nothing to write, and lot 3 does not restart it — it says so and quits.
 *
 * Ending because the application was already quitting is not that, and is not written down:
 * a log that says the database process ended every time the window is closed is a log in which
 * the one time it mattered reads like all the others.
 */
export function startProfile(
  main: string,
  directory: string,
  identity: ApplicationIdentity,
  migrations: string,
): ProfileConversation {
  const started = utilityProcess.fork(join(main, '..', 'profile', 'index.js'), [], {
    serviceName: 'profile',
  })

  let running = true
  let leaving = false
  app.on('before-quit', () => {
    leaving = true
  })

  started.on('exit', (code) => {
    running = false
    if (leaving) return
    diagnostic(`the process that holds the database ended with ${String(code)}; quitting`)
    app.quit()
  })

  const channel = new MessageChannelMain()
  started.postMessage(
    { directory, channel: identity.channel, version: identity.version, migrations },
    [channel.port2],
  )

  return profileConversation(channel.port1, () => running)
}
