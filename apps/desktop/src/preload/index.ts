/**
 * The bridge between the renderer and the main process.
 *
 * It is CommonJS because a sandboxed preload cannot be an ES module, and it is this short on
 * purpose: it hands the renderer one function, never `ipcRenderer` itself. What that function
 * may be called with is decided by the shared channel declaration, on both sides.
 */

import type {
  Bridge,
  ChannelArguments,
  ChannelName,
  ChannelResponse,
  EngineEvent,
} from '@hemera/ipc'
import { ENGINE_EVENT_CHANNEL } from '@hemera/ipc'
import { contextBridge, ipcRenderer } from 'electron'

/**
 * The wrapper `ipcRenderer` puts around what a handler threw.
 *
 * A refused channel answers with a sentence written for whoever asked — "the repository
 * location "../elsewhere" is refused: it resolves outside the workspace root" — and the page
 * shows it under the field it was typed in. Electron carries it back inside "Error invoking
 * remote method 'X': Error: …", which is about the transport and not about what was asked.
 * Taken off here, in the one place that knows there is a transport at all.
 */
const WRAPPED = /^Error invoking remote method '[^']*': (?:\w*Error: )?/

const bridge: Bridge = {
  invoke: async <K extends ChannelName>(
    channel: K,
    argument: ChannelArguments<K>,
  ): Promise<ChannelResponse<K>> => {
    try {
      // SAFETY: the main process answers this channel with the handler `handle<K>()` registered,
      // whose return type is `ChannelResponse<K>`; the wire carries the value, not the type.
      return (await ipcRenderer.invoke(channel, argument)) as ChannelResponse<K>
    } catch (refused) {
      if (!(refused instanceof Error)) throw refused
      throw new Error(refused.message.replace(WRAPPED, ''), { cause: refused })
    }
  },
  /**
   * Everything the engine pushes, on one subscription.
   *
   * The listener is given the event itself and never the Electron event that carried it: the
   * sender, the channel and the rest of the transport are the preload's business, and a page that
   * could read them could read what it has no use for. What comes back is the way to stop
   * listening, which is what a page that closed its Session calls.
   */
  on: (listener) => {
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- what Electron hands a listener first, which is the transport and not something this side parses
    const heard = (_carrier: unknown, event: EngineEvent) => listener(event)
    ipcRenderer.on(ENGINE_EVENT_CHANNEL, heard)
    return () => {
      ipcRenderer.removeListener(ENGINE_EVENT_CHANNEL, heard)
    }
  },
}

contextBridge.exposeInMainWorld('hemera', bridge)
