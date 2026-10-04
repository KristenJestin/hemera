/**
 * The window's link to main, as components and hooks use it: a call is a promise that rejects
 * with the decoded typed error, a stream is a subscription whose unsubscribe interrupts it. Effect
 * stays in this file; nothing in a component or a hook sees it.
 *
 * The page opens its own port: it creates the channel, keeps one end, and posts the other to the
 * preload with `window.postMessage`, which hands it to main (`contextBridge` cannot carry a port).
 * A page that reloads opens a new one; main interrupts what the old one had in flight.
 */

import {
  fromMessagePort,
  makeClientProtocol,
  EngineGone,
  StorageFailed,
  WindowRpcs,
  type EngineStatus,
  type EnvironmentReport,
  type Port,
  type Project,
} from '@hemera/ipc'
import { Cause, Effect, Exit, Option, Scope, Stream } from 'effect'
import { RpcClient } from 'effect/rpc'

export interface Link {
  /** Rejects with `EngineGone` when the engine is not there. */
  readonly engineStatus: () => Promise<EngineStatus>
  /** The engine's status, then each change of it; `onEnd` hears why it stopped. */
  readonly onEngineStatus: (
    listener: (status: EngineStatus) => void,
    onEnd: (error: EngineGone) => void,
  ) => () => void
  readonly environmentReport: () => Promise<EnvironmentReport>
  /** Starts Hemera again, from scratch. */
  readonly relaunch: () => Promise<void>
  /** Shows the diagnostic log in the system's file manager. */
  readonly showLog: () => Promise<void>
  /** The Projects, in the order they were added. */
  readonly projects: () => Promise<ReadonlyArray<Project>>
  /** Rejects with `UnknownProject` when it no longer exists. */
  readonly project: (id: string) => Promise<Project>
  /** Each Project as a change left it, for as long as the listener listens. */
  readonly onProjectChanges: (
    listener: (project: Project) => void,
    onEnd: (error: Error) => void,
  ) => () => void
  readonly close: () => void
}

/** What the preload looks for on a message the page posts to itself. */
export const CONNECT = { hemera: 'connect' } as const

type Client = Effect.Success<ReturnType<typeof clientOver>>

const clientOver = (port: Port) =>
  RpcClient.make(WindowRpcs).pipe(
    Effect.provideServiceEffect(RpcClient.Protocol, makeClientProtocol(port, 'main')),
  )

/** The link over a port, whoever opened it. */
export function linkOver(port: Port): Link {
  const scope = Scope.makeUnsafe()
  const client = Effect.runPromise(Scope.provide(clientOver(port), scope))

  /** Runs a call, settling with its value or with its typed error itself. */
  const call = <A, E>(ask: (client: Client) => Effect.Effect<A, E>): Promise<A> =>
    client
      .then((ready) => Effect.runPromiseExit(ask(ready)))
      .then((exit) => (Exit.isSuccess(exit) ? exit.value : Promise.reject(failureOf(exit.cause))))

  /**
   * Follows a stream until the listener stops: each value to `listener`, and the typed error it
   * failed with, if `ends` recognises it, to `onEnd`. An interruption is not an end anyone hears.
   */
  const follow = <A, E, F extends E>(
    open: (client: Client) => Stream.Stream<A, E>,
    listener: (value: A) => void,
    ends: (error: E) => error is F,
    onEnd: (error: F) => void,
  ): (() => void) => {
    let stopped = false
    let stop = (): void => {
      stopped = true
    }
    void client.then((ready) => {
      if (stopped) return
      const fiber = Effect.runFork(
        Stream.runForEach(open(ready), (value) => Effect.sync(() => listener(value))),
      )
      fiber.addObserver((exit) => {
        if (Exit.isSuccess(exit)) return
        const failure = Cause.findErrorOption(exit.cause)
        if (Option.isSome(failure) && ends(failure.value)) onEnd(failure.value)
      })
      stop = () => fiber.interruptUnsafe()
    })
    return () => stop()
  }

  return {
    engineStatus: () => call((ready) => ready['engine.status']()),
    onEngineStatus: (listener, onEnd) =>
      follow(
        (ready) => ready['engine.statusChanges'](),
        listener,
        (error) => error instanceof EngineGone,
        onEnd,
      ),
    environmentReport: () => call((ready) => ready['environment.report']()),
    relaunch: () => call((ready) => ready['application.relaunch']()),
    showLog: () => call((ready) => ready['application.showLog']()),
    projects: () => call((ready) => ready['projects.list']()),
    project: (id) => call((ready) => ready['projects.get']({ id })),
    onProjectChanges: (listener, onEnd) =>
      follow(
        (ready) => ready['projects.changes'](),
        listener,
        (error) => error instanceof StorageFailed || error instanceof EngineGone,
        onEnd,
      ),
    close: () => {
      Effect.runFork(Scope.close(scope, Exit.void))
    },
  }
}

const failureOf = <E>(cause: Cause.Cause<E>) => {
  const failure = Cause.findErrorOption(cause)
  return Option.isSome(failure) ? failure.value : Cause.squash(cause)
}

/** Opens the page's link to main. */
export function connect(): Link {
  const { port1, port2 } = new MessageChannel()
  window.postMessage(CONNECT, '*', [port2])
  return linkOver(fromMessagePort(port1))
}
