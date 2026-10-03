/**
 * The bridge between the renderer and the main process.
 *
 * It is CommonJS because a sandboxed preload cannot be an ES module, and it is this short on
 * purpose: the renderer is handed a narrow API through `contextBridge`, never `ipcRenderer`.
 * There is nothing to ask the main process for yet, so it only says which system it runs on.
 */

import { contextBridge } from 'electron'

const bridge: Window['hemera'] = { platform: process.platform }

contextBridge.exposeInMainWorld('hemera', bridge)
