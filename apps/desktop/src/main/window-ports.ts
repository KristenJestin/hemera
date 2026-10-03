/**
 * The ports windows hand main, served one client each. A port comes from a page's preload on
 * `hemera:connect`; one from any frame but the application's own is refused, logged and closed.
 * A port that closes (the page reloaded, navigated, crashed or closed) is written down, and its
 * calls are interrupted down to the engine.
 */

import { fromMessagePortMain, makeServerProtocol, WindowRpcs } from '@hemera/ipc'
import { Effect } from 'effect'
import type { Scope } from 'effect'
import { RpcServer } from 'effect/rpc'
import { ipcMain } from 'electron/main'

import type { Log } from './diagnostic.ts'
import { isOwnFrame } from './origin.ts'
import type { windowHandlers } from './window-link.ts'

/** The channel the preload hands a page's port to main on. */
export const CONNECT_CHANNEL = 'hemera:connect'

export interface WindowPorts {
  /** Closes every window's port from main's side: the end-to-end suite's check of the page's. */
  readonly closeAll: () => void
}

export const serveWindows = (
  handlers: ReturnType<typeof windowHandlers>,
  origin: string,
  log: Log,
): Effect.Effect<WindowPorts, never, Scope.Scope> =>
  Effect.gen(function* () {
    const server = yield* makeServerProtocol
    yield* RpcServer.make(WindowRpcs, { disableFatalDefects: true }).pipe(
      Effect.provide(handlers),
      Effect.provideService(RpcServer.Protocol, server.protocol),
      Effect.forkScoped,
    )
    const open = new Set<Electron.MessagePortMain>()
    const connect = (event: Electron.IpcMainEvent): void => {
      const [port] = event.ports
      if (port === undefined) return
      const url = event.senderFrame?.url ?? null
      if (!isOwnFrame(url, origin)) {
        log(
          `${CONNECT_CHANNEL}: refused a port from ${url ?? 'a frame already gone'}, which is not ${origin}`,
        )
        port.close()
        return
      }
      const link = fromMessagePortMain(port)
      open.add(port)
      server.accept({
        ...link,
        start: (onMessage, onClose) =>
          link.start(onMessage, () => {
            open.delete(port)
            log(`a window closed its link (${url})`)
            onClose()
          }),
      })
    }
    ipcMain.on(CONNECT_CHANNEL, connect)
    yield* Effect.addFinalizer(() => Effect.sync(() => ipcMain.off(CONNECT_CHANNEL, connect)))
    return {
      closeAll: () => {
        for (const port of open) port.close()
      },
    }
  })
