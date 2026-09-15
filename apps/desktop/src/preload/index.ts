/**
 * The bridge between the renderer and the main process.
 *
 * It is CommonJS because a sandboxed preload cannot be an ES module, and it is this short on
 * purpose: it hands the renderer one function, never `ipcRenderer` itself. What that function
 * may be called with is decided by the shared channel declaration, on both sides.
 */

import type { Bridge, ChannelArguments, ChannelName, ChannelResponse } from '@hemera/ipc'
import { contextBridge, ipcRenderer } from 'electron'

const bridge: Bridge = {
  invoke: async <K extends ChannelName>(
    channel: K,
    argument: ChannelArguments<K>,
  ): Promise<ChannelResponse<K>> =>
    // SAFETY: the main process answers this channel with the handler `handle<K>()` registered,
    // whose return type is `ChannelResponse<K>`; the wire carries the value, not the type.
    (await ipcRenderer.invoke(channel, argument)) as ChannelResponse<K>,
}

contextBridge.exposeInMainWorld('hemera', bridge)
