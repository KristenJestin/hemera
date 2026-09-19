/**
 * The bridge between the renderer and the main process.
 *
 * It is CommonJS because a sandboxed preload cannot be an ES module, and it is this short on
 * purpose: it hands the renderer one function, never `ipcRenderer` itself. What that function
 * may be called with is decided by the shared channel declaration, on both sides.
 */

import type { Bridge, ChannelArguments, ChannelName, ChannelResponse } from '@hemera/ipc'
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
}

contextBridge.exposeInMainWorld('hemera', bridge)
