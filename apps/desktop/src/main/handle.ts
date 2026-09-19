/**
 * The main process end of the typed bridge (design D0-04).
 *
 * Every message is read twice before anything happens: once to see where it came from, once
 * to see whether it says what its channel declares. A message that fails either is refused
 * with an error that names the channel and the field, written to the log, and dropped — the
 * handler is never reached, so a refused message has no effect to undo. The deciding is in
 * `bridge.ts`, which knows nothing of Electron and can therefore be run without one.
 */

import type { ChannelArguments, ChannelName, ChannelResponse } from '@hemera/ipc'
import { ipcMain, type IpcMainInvokeEvent } from 'electron/main'
import { Effect } from 'effect'

import { applicationOrigin, decide } from './bridge.ts'
import { diagnostic, type Log, reported, said } from './diagnostic.ts'

export type { Log }

/**
 * One channel, one frontier (design D3-03).
 *
 * The handler is a program rather than a function that already ran: everything the main process
 * does is written in Effect, and this is the one place per channel where such a program is
 * actually run. A program that fails does so with a type, and the reason reaches the log before
 * the refusal reaches the page.
 */
export function handle<K extends ChannelName, E>(
  channel: K,
  handler: (argument: ChannelArguments<K>) => Effect.Effect<ChannelResponse<K>, E>,
  log: Log = diagnostic,
): void {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- what Electron hands over is unparsed by definition; `decide` parses it
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, argument: unknown) => {
    const frame = event.senderFrame
    const decision = decide(
      channel,
      frame === null ? null : { url: frame.url },
      argument,
      applicationOrigin(),
    )
    if (!decision.accepted) {
      log(decision.reason)
      throw new Error(decision.reason)
    }
    // Run to an outcome rather than to a rejection: `runPromise` rejects with the fibre's
    // failure wrapped in one of its own, whose message is a rendering of a cause and not the
    // sentence a refusal was written as. What crosses back to the page is that sentence.
    const outcome = await Effect.runPromise(
      handler(decision.argument).pipe(
        Effect.match({
          onSuccess: (value) => ({ answered: true as const, value }),
          onFailure: (failed) => ({
            answered: false as const,
            line: reported(failed),
            said: said(failed),
          }),
        }),
      ),
    )
    if (!outcome.answered) {
      log(`${channel}: ${outcome.line}`)
      throw new Error(outcome.said)
    }
    return outcome.value
  })
}
