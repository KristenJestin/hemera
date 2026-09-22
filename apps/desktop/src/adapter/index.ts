/**
 * The program a bundled ACP adapter is run inside, and the one reason it exists (D5-21).
 *
 * An adapter is a Node script this application depends on, and a package of this application has
 * no Node to run it with: `process.execPath` is Electron, and the `runAsNode` fuse is off on
 * purpose — a packaged application that turns into a Node interpreter for whoever exports an
 * environment variable is the hole that fuse closes. What Electron offers instead is
 * `utilityProcess.fork`, which runs a script on Node in a process of its own without that fuse,
 * and that is what the main process starts this file as.
 *
 * A utility process has no standard input — `stdin` may only be `ignore`, and the `process.stdin`
 * it is given has already ended — and ACP is a conversation over standard input and output. So
 * the adapter is not run in this process but in a worker thread of it, which Node does give a
 * real `stdin`, `stdout` and `stderr` (`stdin: true` on the `Worker`). This file is the wire
 * between that worker's three pipes and the port the engine holds: nothing of ACP is read here,
 * and nothing of it reaches the main process.
 *
 * What is sent over the port is whole lines, and never the chunks they arrived in: NDJSON is what
 * the two ends speak, an ACP answer runs to tens of kilobytes, and a pipe cuts where it likes.
 */

import { Worker } from 'node:worker_threads'

import type { AdapterInput, AdapterOutput } from './protocol.ts'

/**
 * A reader that hands over whole lines and keeps what is not one yet.
 *
 * The remainder is the whole point: a chunk ends where the pipe decided, and half a JSON-RPC
 * message handed over as a line is a message the client cannot parse and never sees again.
 */
export function linesOf(deliver: (line: string) => void): (chunk: string) => void {
  let rest = ''
  return (chunk) => {
    const parts = (rest + chunk).split('\n')
    // The last part is whatever came after the last newline: it is the start of the next line,
    // or an empty string when the chunk ended on one.
    rest = parts.pop() ?? ''
    for (const line of parts) if (line !== '') deliver(line)
  }
}

if (process.parentPort !== undefined) {
  // The port arrives before anything is started, so that no line the adapter writes on its first
  // turn is spoken into a channel that does not exist yet.
  process.parentPort.once('message', (handed) => {
    const port = handed.ports[0]
    if (port === undefined) return

    const [script, ...args] = process.argv.slice(2)
    if (script === undefined) return

    // The worker is what has the three pipes: `argv` is appended to its own `process.argv`, so
    // the adapter reads the arguments it would have been started with on a command line.
    const worker = new Worker(script, {
      argv: args,
      env: process.env,
      stdin: true,
      stdout: true,
      stderr: true,
    })

    worker.stdout.setEncoding('utf8')
    worker.stdout.on(
      'data',
      linesOf((output) => {
        port.postMessage({ output } satisfies AdapterOutput)
      }),
    )
    worker.stderr.setEncoding('utf8')
    worker.stderr.on(
      'data',
      linesOf((diagnostic) => {
        port.postMessage({ diagnostic } satisfies AdapterOutput)
      }),
    )

    port.on('message', (event) => {
      // SAFETY: what the engine's side of this port puts on it, declared above as `AdapterInput`;
      // a port carries values, not types.
      const asked = event.data as AdapterInput
      if ('end' in asked) worker.stdin?.end()
      else worker.stdin?.write(asked.input)
    })
    port.start()

    // A worker that could not even load its script says so on `error`, and that is the only news
    // of it there will be: the line goes out as a diagnostic, and the process ends with it.
    worker.on('error', (failed: Error) => {
      port.postMessage({ diagnostic: failed.stack ?? failed.message } satisfies AdapterOutput)
      process.exit(1)
    })
    // The death itself is the main process's news to tell: it is the one that holds this process,
    // and a line posted on a port that is closing with it is a line nobody would read.
    worker.on('exit', (code) => {
      process.exit(code)
    })
  })
}
