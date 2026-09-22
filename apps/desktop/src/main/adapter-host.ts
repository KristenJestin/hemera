/**
 * The main process as the launcher of the bundled adapters, and as nothing else (D5-21).
 *
 * The engine is where an agent is started, stopped and spoken to — but a bundled adapter is a
 * Node script, and a package of this application has no Node to run one with: `process.execPath`
 * is Electron, and the `runAsNode` fuse is off so that a packaged application cannot be talked
 * into being a Node interpreter. `utilityProcess.fork` is what Electron offers instead, it runs
 * on Node without that fuse, and it exists in the main process alone.
 *
 * So the engine asks here, and this file forks — this application's own bootstrap, never
 * anything the asker names — hands the two ends of a channel to the engine and to the adapter,
 * and steps out of the conversation. What an agent says never crosses the main process.
 */

import { join } from 'node:path'

import { MessageChannelMain, utilityProcess } from 'electron/main'
import type { ForkOptions, MessagePortMain, UtilityProcess } from 'electron'

import type { AdapterAsk, AdapterTell } from '../adapter/protocol.ts'
import { diagnostic } from './diagnostic.ts'

/** What an adapter's process is called in Electron's process list and in a task manager. */
const SERVICE_NAME = 'agent-adapter'

/**
 * How the adapter's process is forked, with only the properties the engine named.
 *
 * Built in statements rather than by spreading a conditional empty object, the way the engine's
 * own supervisor builds what it hands a spawn: an environment or a directory the ask did not
 * carry is not a property at all.
 *
 * The adapter's own three pipes are the worker's, inside that process, and they travel on the
 * port: what is left on these two is whatever the bootstrap itself has to say, which is how a
 * bootstrap that could not start at all is read.
 */
function forkOptions(
  env: Record<string, string> | undefined,
  cwd: string | undefined,
): ForkOptions {
  const options: ForkOptions = { stdio: ['ignore', 'pipe', 'pipe'], serviceName: SERVICE_NAME }
  if (env !== undefined) options.env = env
  if (cwd !== undefined) options.cwd = cwd
  return options
}

/**
 * Answers the engine's requests to start an adapter, for as long as the engine is there.
 *
 * The forked processes are held so that nothing collects them while they run, and let go of when
 * they end. Nothing else is kept: the engine holds the pid, and stopping a tree is its business.
 */
export function serveAdapters(engine: UtilityProcess, main: string): void {
  const bootstrap = join(main, '..', 'adapter', 'index.js')
  const running = new Set<UtilityProcess>()

  engine.on('message', (message) => {
    // SAFETY: the I/O boundary of this seam — the engine puts `AdapterAsk` on this port, and a
    // port carries values rather than types. Anything else is not ours and is left alone.
    const asked = message as Partial<AdapterAsk>
    if (asked.channel !== 'adapter') return
    const { id, script, args, env, cwd } = asked
    if (id === undefined || script === undefined || args === undefined) return

    const answer = (tell: AdapterTell, ports: MessagePortMain[] = []) => {
      try {
        engine.postMessage(tell, ports)
      } catch (gone) {
        // The engine ended between the ask and the answer: what it asked for has nowhere to go,
        // and the process below dies with the application either way.
        diagnostic(`answering the engine about adapter ${String(id)} failed: ${String(gone)}`)
      }
    }

    let started: UtilityProcess
    try {
      started = utilityProcess.fork(bootstrap, [script, ...args], forkOptions(env, cwd))
    } catch (refused) {
      answer({ channel: 'adapter', id, tell: 'failed', cause: String(refused) })
      return
    }

    running.add(started)
    started.stderr?.setEncoding('utf8')
    started.stderr?.on('data', (line: string) => {
      diagnostic(`adapter ${String(id)}: ${line.trimEnd()}`)
    })
    started.stdout?.setEncoding('utf8')
    started.stdout?.on('data', (line: string) => {
      diagnostic(`adapter ${String(id)}: ${line.trimEnd()}`)
    })

    started.on('spawn', () => {
      // The channel is made once the process exists, and its two ends go to the two programs
      // that speak over it. The main process keeps neither.
      const channel = new MessageChannelMain()
      started.postMessage({}, [channel.port1])
      answer({ channel: 'adapter', id, tell: 'started', pid: started.pid }, [channel.port2])
    })
    started.on('exit', (code) => {
      running.delete(started)
      answer({ channel: 'adapter', id, tell: 'exited', code })
    })
  })
}
