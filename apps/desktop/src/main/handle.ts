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

import { applicationOrigin, decide } from './bridge.ts'

/** Where a refusal is written. A refused message is a fact, not a silence. */
export type Log = (reason: string) => void

export function handle<K extends ChannelName>(
  channel: K,
  handler: (argument: ChannelArguments<K>) => ChannelResponse<K> | Promise<ChannelResponse<K>>,
  log: Log = (reason) => {
    console.error(reason)
  },
): void {
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
    return await handler(decision.argument)
  })
}
