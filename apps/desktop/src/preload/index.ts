/**
 * The bridge between the renderer and the main process.
 *
 * It carries nothing yet: the typed channels arrive with `packages/ipc`. What it holds here
 * is the wiring — a CommonJS preload, because a sandboxed one cannot be an ES module, loaded
 * by a renderer that never sees Node.
 */

import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('hemera', {})
