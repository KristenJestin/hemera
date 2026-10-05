/**
 * The agents' process: a utility process main forks for one program the engine asked for.
 *
 * It is this application's own program, never the one named: the program is its first argument
 * and runs in a worker (`program.ts`). Main posts the port the engine holds the other end of
 * before anything else; the process ends with the program, on the program's own code.
 */

import { fromMessagePortMain } from '@hemera/ipc'
import { Effect } from 'effect'
// A utility process reaches its parent through `process.parentPort`, declared by Electron.
import type { ParentPort } from 'electron'

import { runProgram } from './program.ts'

const [program, ...args] = process.argv.slice(2)

const parent: ParentPort = process.parentPort

parent.once('message', ({ ports: [port] }) => {
  if (port === undefined || program === undefined) process.exit(2)
  // Main forked this process with the environment the engine asked for over its own.
  void Effect.runPromise(
    Effect.scoped(runProgram(fromMessagePortMain(port), program, args, process.env)),
  ).then((code) => process.exit(code))
})
