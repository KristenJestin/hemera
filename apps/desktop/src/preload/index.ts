/**
 * The bridge between the renderer and the main process.
 *
 * It is CommonJS because a sandboxed preload cannot be an ES module, and it is this short on
 * purpose: the page is handed its platform through `contextBridge`, never `ipcRenderer`, and the
 * one other thing the preload does is carry the page's port to main. `contextBridge` cannot carry
 * a `MessagePort`, so the page posts it to its own window and the preload, which shares the DOM,
 * passes it on. Only the page itself is heard, never a frame inside it.
 */

import { contextBridge, ipcRenderer } from 'electron'

/** The channel main receives the page's port on. */
const CONNECT_CHANNEL = 'hemera:connect'

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.hemera !== 'connect') return
  const [port] = event.ports
  if (port !== undefined) ipcRenderer.postMessage(CONNECT_CHANNEL, null, [port])
})

const bridge: Window['hemera'] = { platform: process.platform }

contextBridge.exposeInMainWorld('hemera', bridge)
