/**
 * Effect RPC over a MessagePort: the transport of every link between Hemera's processes.
 *
 * One port is one connection, for exactly as long as the window or the process at the other end
 * lives. There is no handshake and no reconnection: a port queues what is posted to it until the
 * other side starts it, and a window that reloads or a process that comes back opens a new port
 * and builds a new client.
 *
 * - The server reads each port's messages in arrival order on one fiber, so an `Interrupt` or an
 *   `Ack` never overtakes its request. A closed port is reported in `disconnects`, and RpcServer
 *   interrupts every handler that client had running.
 * - A closed port fails the client's pending calls and every later one with an `RpcClientError`
 *   whose reason is a `SocketCloseError`; each link turns it into its own typed error.
 * - A failure while handling one incoming message stays with that request: the reader keeps
 *   going and tells the server to interrupt it. Effect 4.0.0 re-raises a stream item that fails
 *   to decode out of the reader (Effect-TS/effect#8610, fixed after 4.0.0 by #8627); without this
 *   guard the other calls of the connection die and the server keeps producing the stream.
 *
 * Nothing here waits on a clock: a long call is a call in flight that can be interrupted.
 */

import {
  Data,
  Effect,
  Exit,
  FiberSet,
  Match,
  Option,
  Predicate,
  Queue,
  Schema,
  Stream,
} from 'effect'
import type { Fiber, Scope } from 'effect'
import { RpcClient, RpcClientError, RpcServer } from 'effect/rpc'
import type { RpcMessage, RpcSerialization } from 'effect/rpc'
import { Socket } from 'effect/socket'

/** What the protocol needs of a port; DOM, Node and Electron ports are adapted to it. */
export interface Port {
  readonly post: (message: RpcMessage.FromClientEncoded | RpcMessage.FromServerEncoded) => void
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- what arrives on a port is unparsed until the envelope schema reads it
  readonly start: (onMessage: (data: unknown) => void, onClose: () => void) => void
  readonly close: () => void
}

/** A DOM `MessagePort` (the renderer) or Node's own, which share this much. */
export interface MessagePortLike {
  postMessage(message: RpcMessage.FromClientEncoded | RpcMessage.FromServerEncoded): void
  addEventListener(type: 'message' | 'close', listener: (event: Event) => void): void
  start(): void
  close(): void
}

/** Electron's `MessagePortMain` (main, the engine, an agents' process): `on` rather than events. */
export interface MessagePortMainLike {
  postMessage(message: RpcMessage.FromClientEncoded | RpcMessage.FromServerEncoded): void
  on(event: 'message', listener: (event: { readonly data: unknown }) => void): void
  once(event: 'close', listener: () => void): void
  start(): void
  close(): void
}

export const fromMessagePort = (port: MessagePortLike): Port => ({
  post: (message) => port.postMessage(message),
  start: (onMessage, onClose) => {
    port.addEventListener('message', (event) => {
      if (Predicate.hasProperty(event, 'data')) onMessage(event.data)
    })
    port.addEventListener('close', () => onClose())
    port.start()
  },
  close: () => port.close(),
})

export const fromMessagePortMain = (port: MessagePortMainLike): Port => ({
  post: (message) => port.postMessage(message),
  start: (onMessage, onClose) => {
    port.on('message', (event) => onMessage(event.data))
    port.once('close', onClose)
    port.start()
  },
  close: () => port.close(),
})

// The envelopes are read with a schema on arrival. What they carry (payloads, items, exits) is
// decoded by RpcServer and RpcClient against the schemas of each RPC.
const RequestId = Schema.Union([Schema.String, Schema.Number])

const FromClient = Schema.Union([
  Schema.Struct({
    _tag: Schema.tag('Request'),
    id: RequestId,
    tag: Schema.String,
    payload: Schema.Unknown,
    headers: Schema.Array(Schema.mutable(Schema.Tuple([Schema.String, Schema.String]))),
    isNotification: Schema.optionalKey(Schema.Literal(true)),
    traceId: Schema.optionalKey(Schema.String),
    spanId: Schema.optionalKey(Schema.String),
    sampled: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({ _tag: Schema.tag('Ack'), requestId: RequestId }),
  Schema.Struct({ _tag: Schema.tag('Interrupt'), requestId: RequestId }),
  Schema.Struct({ _tag: Schema.tag('Ping') }),
  Schema.Struct({ _tag: Schema.tag('Eof') }),
])

/** An exit is read whole by RpcClient against the schemas of its RPC; here only its kind. */
const ExitEncoded = Schema.declare(
  (exit): exit is RpcMessage.ExitEncoded<unknown, unknown> =>
    Predicate.isTagged(exit, 'Success') || Predicate.isTagged(exit, 'Failure'),
)

const FromServer = Schema.Union([
  Schema.Struct({
    _tag: Schema.tag('Chunk'),
    requestId: RequestId,
    values: Schema.NonEmptyArray(Schema.Unknown),
  }),
  Schema.Struct({
    _tag: Schema.tag('Exit'),
    requestId: RequestId,
    exit: ExitEncoded,
  }),
  Schema.Struct({ _tag: Schema.tag('Defect'), defect: Schema.Unknown }),
  Schema.Struct({ _tag: Schema.tag('Pong') }),
])

/** What the reader of a client handles: a server's message, or the news that the link closed. */
type Incoming = typeof FromServer.Type | RpcMessage.ClientProtocolError

/** What reaches one request: its stream items, then its exit. */
type Response = RpcMessage.ResponseChunkEncoded | RpcMessage.ResponseExitEncoded
type Mailbox = Queue.Queue<Response>

interface Delivery {
  readonly mailbox: Mailbox
  readonly fiber: Fiber.Fiber<void>
}

/** The two messages this protocol writes itself, as plain objects that clone onto a port. */
const { Interrupt: interrupt, ClientProtocolError: linkClosed } = Data.taggedEnum<
  RpcMessage.InterruptEncoded | RpcMessage.ClientProtocolError
>()

const readFromClient = Schema.decodeUnknownOption(FromClient)
const readFromServer = Schema.decodeUnknownOption(FromServer)

/**
 * Ports copy with structured clone, so there is no serialization step: the holes of the
 * envelopes are filled through the JSON codec, as Effect's own worker protocols do and as every
 * value that crosses a process link of Hemera does (`@hemera/core/schema`).
 */
const codecFor: RpcSerialization.CodecFor = Schema.toCodecJson

export interface ServerProtocol {
  readonly protocol: RpcServer.Protocol['Service']
  /** Serves one more client over `port`; callable from a plain Electron or DOM callback. */
  readonly accept: (port: Port) => void
}

/** The server side of a link: one RpcServer, any number of ports, one client per port. */
export const makeServerProtocol: Effect.Effect<ServerProtocol, never, Scope.Scope> = Effect.gen(
  function* () {
    const runFork = yield* FiberSet.makeRuntime<never, never, never>()
    const disconnects = yield* Queue.unbounded<number>()
    const ports = new Map<number, Port>()
    let nextClientId = 0
    let write: (
      clientId: number,
      message: RpcMessage.FromClientEncoded,
    ) => Effect.Effect<void> = () => Effect.void

    const protocol = yield* RpcServer.Protocol.make((writeRequest) => {
      write = writeRequest
      return Effect.succeed({
        disconnects,
        send: (clientId: number, response: RpcMessage.FromServerEncoded) =>
          Effect.sync(() => ports.get(clientId)?.post(response)),
        end: () => Effect.void,
        clientIds: Effect.sync(() => new Set(ports.keys())),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
        supportsNotifications: true,
        codecFor,
      })
    })

    const accept = (port: Port): void => {
      const clientId = nextClientId
      nextClientId += 1
      ports.set(clientId, port)
      const reader = runFork(
        Effect.gen(function* () {
          const inbox = yield* Queue.unbounded<RpcMessage.FromClientEncoded>()
          port.start(
            (data) => {
              const message = readFromClient(data)
              if (Option.isSome(message)) Queue.offerUnsafe(inbox, message.value)
            },
            () => {
              if (!ports.delete(clientId)) return
              reader.interruptUnsafe()
              Queue.offerUnsafe(disconnects, clientId)
            },
          )
          return yield* Effect.forever(
            Effect.flatMap(Queue.take(inbox), (message) => write(clientId, message)),
          )
        }),
      )
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const port of ports.values()) port.close()
        ports.clear()
      }),
    )

    return { protocol, accept }
  },
)

/** The error every call on a closed link fails with, naming who is no longer there. */
export const connectionClosed = (peer: string): RpcClientError.RpcClientError =>
  new RpcClientError.RpcClientError({
    reason: new Socket.SocketCloseError({ code: 1006, closeReason: `${peer} closed the link` }),
  })

/** Whether a call failed because its link is closed, rather than for any other reason. */
export const isConnectionClosed = <E>(error: E): boolean =>
  error instanceof RpcClientError.RpcClientError && error.reason instanceof Socket.SocketCloseError

/**
 * The client side of a link over one port, for the lifetime of the enclosing scope. `peer` names
 * the other end in the error a closed link fails with.
 */
export const makeClientProtocol = (
  port: Port,
  peer: string,
): Effect.Effect<RpcClient.Protocol['Service'], never, Scope.Scope> =>
  RpcClient.Protocol.make(
    Effect.fnUntraced(function* (writeResponse, clientIds) {
      const scope = yield* Effect.scope
      const inbox = yield* Queue.unbounded<Incoming>()
      /** The requests in flight, each delivered in order by a fiber of its own. */
      const deliveries = new Map<string | number, Delivery>()
      let closed: RpcClientError.RpcClientError | undefined

      const everyClient = (message: RpcMessage.FromServerEncoded) =>
        Effect.forEach(clientIds, (clientId) => writeResponse(clientId, message), {
          discard: true,
        })

      /**
       * Hands one request's responses to the client that asked, in order, until its exit.
       *
       * One fiber per request rather than the reader itself: RpcClient waits for room in a
       * stream's buffer, and a stream nobody reads (or one the caller has just interrupted) must
       * not hold back the answers of every other request on the link.
       */
      const deliver = (requestId: string | number, clientId: number, mailbox: Mailbox) =>
        Effect.gen(function* () {
          while (true) {
            const message = yield* Queue.take(mailbox)
            const delivered = yield* Effect.exit(writeResponse(clientId, message))
            // Effect-TS/effect#8610: RpcClient has already ended this call locally when it
            // re-raises. The other requests go on, and the server is told to stop this one.
            if (Exit.isFailure(delivered)) return port.post(interrupt({ requestId }))
            if (Predicate.isTagged(message, 'Exit')) return
          }
        }).pipe(Effect.ensuring(Effect.sync(() => deliveries.delete(requestId))))

      const toItsRequest = (
        message: RpcMessage.ResponseChunkEncoded | RpcMessage.ResponseExitEncoded,
      ): Effect.Effect<void> =>
        Effect.sync(() => {
          const delivery = deliveries.get(message.requestId)
          if (delivery !== undefined) Queue.offerUnsafe(delivery.mailbox, message)
        })

      const handle = (message: Incoming): Effect.Effect<void> =>
        Match.value(message).pipe(
          Match.tagsExhaustive({
            Chunk: toItsRequest,
            Exit: toItsRequest,
            Defect: everyClient,
            ClientProtocolError: everyClient,
            Pong: () => Effect.void,
          }),
        )

      const abandon = (requestId: string | number): void => {
        deliveries.get(requestId)?.fiber.interruptUnsafe()
        deliveries.delete(requestId)
      }

      port.start(
        (data) => {
          const message = readFromServer(data)
          if (Option.isSome(message)) Queue.offerUnsafe(inbox, message.value)
        },
        () => {
          closed ??= connectionClosed(peer)
          for (const requestId of [...deliveries.keys()]) abandon(requestId)
          Queue.offerUnsafe(inbox, linkClosed({ error: closed }))
        },
      )

      yield* Effect.forkScoped(Effect.forever(Effect.flatMap(Queue.take(inbox), handle)))
      yield* Effect.addFinalizer(() => Effect.sync(() => port.close()))

      const post = (message: RpcMessage.FromClientEncoded) =>
        Effect.try({
          try: () => port.post(message),
          catch: (cause) =>
            new RpcClientError.RpcClientError({
              reason: new RpcClientError.RpcClientDefect({
                message: 'An RPC message could not be posted on its port',
                cause,
              }),
            }),
        })

      return {
        send: (clientId: number, message: RpcMessage.FromClientEncoded) =>
          Effect.gen(function* () {
            if (closed !== undefined) return yield* Effect.fail(closed)
            if (Predicate.isTagged(message, 'Request')) {
              const mailbox = yield* Queue.unbounded<Response>()
              const fiber = yield* Effect.forkIn(deliver(message.id, clientId, mailbox), scope)
              deliveries.set(message.id, { mailbox, fiber })
            }
            if (Predicate.isTagged(message, 'Interrupt')) abandon(message.requestId)
            return yield* post(message)
          }),
        supportsAck: true,
        supportsTransferables: false,
        codecFor,
      }
    }),
  )

const isClientError = <E>(
  error: E | RpcClientError.RpcClientError,
): error is RpcClientError.RpcClientError => error instanceof RpcClientError.RpcClientError

/**
 * A call on a link as its caller sees it: a closed link becomes the link's own typed error
 * (`EngineGone`, `AgentsProcessGone`), and any other failure of the client itself, which is a
 * fault in Hemera rather than an answer, becomes a defect.
 */
export const closedAs =
  <G>(gone: () => G) =>
  <A, E, R>(
    self: Effect.Effect<A, E | RpcClientError.RpcClientError, R>,
  ): Effect.Effect<A, Exclude<E, RpcClientError.RpcClientError> | G, R> =>
    Effect.catchIf(
      self,
      isClientError,
      (error): Effect.Effect<never, G> =>
        isConnectionClosed(error) ? Effect.fail(gone()) : Effect.die(error),
      (other) => Effect.fail(other),
    )

/** `closedAs`, for a stream. */
export const streamClosedAs =
  <G>(gone: () => G) =>
  <A, E, R>(
    self: Stream.Stream<A, E | RpcClientError.RpcClientError, R>,
  ): Stream.Stream<A, Exclude<E, RpcClientError.RpcClientError> | G, R> =>
    Stream.catchIf(
      self,
      isClientError,
      (error): Stream.Stream<never, G> =>
        isConnectionClosed(error) ? Stream.fail(gone()) : Stream.die(error),
      (other) => Stream.fail(other),
    )
