/**
 * The links between Hemera's processes: the transport (Effect RPC over MessagePorts) and one
 * RPC group per domain, every value declared with `Schema`. Nothing here imports Electron.
 */
export {
  connectionClosed,
  fromMessagePort,
  fromMessagePortMain,
  isConnectionClosed,
  makeClientProtocol,
  makeServerProtocol,
  type MessagePortLike,
  type MessagePortMainLike,
  type Port,
  type ServerProtocol,
} from './protocol.ts'
