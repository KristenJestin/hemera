/**
 * A bundled adapter, started as a process of Node and spoken to as if it were a spawn (D5-21).
 *
 * The engine starts every agent, and two of the three are a Node script this application carries.
 * Nothing here can run one: this program is itself a utility process, `process.execPath` is
 * Electron, and the `runAsNode` fuse is off so that a packaged application cannot be talked into
 * being a Node interpreter by an environment variable. `utilityProcess.fork` is Electron's own
 * answer — a script on Node, in a process of its own, with that fuse still off — and it lives in
 * the main process.
 *
 * So the launch is asked for over the port this process was forked with, and what comes back is a
 * pid and a `MessagePort` joined to the adapter's own process. From there the conversation is
 * this engine's and the adapter's: nothing of ACP crosses the main process. What this file
 * answers is the same `HostProcess` the spawn answers, so the supervisor above it — the group,
 * the grace, the escalation of D5-04 — is one policy over two ways of starting a program.
 *
 * The process it is handed the pid of is a real one, and the adapter's own children are its
 * children: `taskkill /T` on that pid takes the tree down on Windows exactly as it does for a
 * spawn. What it is not is a process group of its own, which is what a POSIX stop would signal;
 * the supervisor is told so, and takes the tree down by pid there too.
 */

import type { MessagePortMain } from 'electron'

import type {
  AdapterAsk,
  AdapterInput,
  AdapterOutput,
  AdapterTell,
} from '../../adapter/protocol.ts'
import type { HostProcess, HostProcessOptions, Signal } from './supervisor.ts'

/** One launch of this run, numbered so that every answer about it finds its own listener. */
let launches = 0

/** The launches still waiting to hear about themselves, under the number they were asked as. */
const listening = new Map<number, (tell: AdapterTell, port: MessagePortMain | undefined) => void>()

/** Whether the one listener on this process's own port has been attached yet. */
let attached = false

/**
 * The one listener on this process's port, attached the first time an adapter is asked for.
 *
 * One and not one per launch: the port is the engine's whole conversation with the process that
 * forked it, and a listener per agent would be a listener per agent left on it.
 */
function attachOnce(): void {
  if (attached || process.parentPort === undefined) return
  attached = true
  process.parentPort.on('message', (handed) => {
    // SAFETY: the I/O boundary of this seam — the main process puts `AdapterTell` on this port,
    // and a port carries values rather than types. Anything else on it is not ours.
    const tell = handed.data as Partial<AdapterTell>
    if (tell.channel !== 'adapter' || tell.id === undefined || tell.tell === undefined) return
    // SAFETY: the three fields that name one of the answers above have just been read off it.
    listening.get(tell.id)?.(tell as AdapterTell, handed.ports[0])
  })
}

/** What the main process is asked, with only the properties the caller named. */
function askFor(
  id: number,
  script: string,
  args: readonly string[],
  options: HostProcessOptions,
): AdapterAsk {
  const ask: AdapterAsk = { channel: 'adapter', id, script, args: [...args] }
  if (options.env !== undefined) ask.env = options.env
  if (options.cwd !== undefined) ask.cwd = options.cwd
  return ask
}

/**
 * Asks the main process for a bundled adapter, and answers what can be said to it.
 *
 * It answers at once and the process arrives later, which is the one difference with a spawn:
 * `pid` is read through, so that it is the pid once there is one, and what is written before
 * the port exists waits for it rather than being lost. The supervisor waits for the spawn
 * before it writes anything, so the wait is a safety net and not the normal path.
 */
export function forkedScript(
  script: string,
  args: readonly string[],
  options: HostProcessOptions,
): HostProcess {
  attachOnce()
  const id = launches
  launches += 1

  let port: MessagePortMain | undefined
  let pid: number | undefined
  const held: AdapterInput[] = []
  let spawned: (() => void) | undefined
  let ended: ((code: number | null, signal: string | null) => void) | undefined
  let refused: ((cause: string) => void) | undefined
  let readOut: ((line: string) => void) | undefined
  let readErr: ((line: string) => void) | undefined

  const send = (message: AdapterInput): void => {
    if (port === undefined) held.push(message)
    else port.postMessage(message)
  }

  listening.set(id, (tell, given) => {
    if (tell.tell === 'started') {
      pid = tell.pid
      port = given
      port?.on('message', (event) => {
        // SAFETY: the other end of this port is the adapter's bootstrap, which puts exactly
        // `AdapterOutput` on it; a port carries values, not types.
        const wrote = event.data as AdapterOutput
        if ('output' in wrote) readOut?.(wrote.output)
        else readErr?.(wrote.diagnostic)
      })
      port?.start()
      for (const message of held) port?.postMessage(message)
      held.length = 0
      spawned?.()
      return
    }
    listening.delete(id)
    if (tell.tell === 'failed') {
      refused?.(tell.cause)
      return
    }
    // An end before a start is a process that never was one, which is a command that could not
    // be run rather than an agent that stopped: the supervisor is waiting for one or the other.
    if (pid === undefined) refused?.(`the adapter ended with ${String(tell.code)} before it ran`)
    else ended?.(tell.code, null)
  })

  if (process.parentPort === undefined) {
    // Nothing forked this program, so nothing can fork an adapter for it. The refusal is left
    // for the listener the supervisor is about to attach.
    queueMicrotask(() => {
      listening.delete(id)
      refused?.('this program was not started by Hemera, and cannot start an adapter')
    })
  } else {
    process.parentPort.postMessage(askFor(id, script, args, options))
  }

  return {
    get pid() {
      return pid
    },
    write: (line) => {
      send({ input: line })
      return true
    },
    end: () => {
      send({ end: true })
    },
    signal: (signal: Signal) => {
      if (pid === undefined) return
      process.kill(pid, signal)
    },
    onSpawn: (listener) => {
      spawned = listener
    },
    onExit: (listener) => {
      ended = listener
    },
    onFailure: (listener) => {
      refused = listener
    },
    onStdout: (listener) => {
      readOut = listener
    },
    onStderr: (listener) => {
      readErr = listener
    },
  }
}
