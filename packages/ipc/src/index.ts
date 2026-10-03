/**
 * The links between Hemera's processes: the transport (Effect RPC over MessagePorts) and one
 * RPC group per domain, every value declared with `Schema`. Nothing here imports Electron.
 */
export {
  closedAs,
  closesWith,
  connectionClosed,
  fromMessagePort,
  fromMessagePortMain,
  isConnectionClosed,
  makeClientProtocol,
  makeServerProtocol,
  streamClosedAs,
  type MessagePortLike,
  type MessagePortMainLike,
  type Port,
  type ServerProtocol,
} from './protocol.ts'
export * from './engine.ts'
export * from './application.ts'
export * from './agents.ts'
export * from './window.ts'
