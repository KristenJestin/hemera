/**
 * Hemera's MCP server, as an agent is handed it: its address, and a bearer token minted per agent
 * process and session, revoked when the session ends or its process dies. The server is #33's;
 * until it exists, no endpoint is there, and an agent is refused rather than started without
 * Hemera's tools (bare mode leaves it no other).
 */

import { Context, Effect, Layer, Schema } from 'effect'

/** Hemera's tools cannot be handed to an agent: their server is not there. */
export class EndpointUnavailable extends Schema.TaggedError<EndpointUnavailable>()(
  'EndpointUnavailable',
  {},
) {
  override get message(): string {
    return 'Hemera’s tools are not available to agents yet.'
  }
}

export class HemeraEndpoint extends Context.Service<
  HemeraEndpoint,
  {
    readonly url: Effect.Effect<string, EndpointUnavailable>
    /** A token for this session, refused once revoked. */
    readonly mint: (sessionId: string) => Effect.Effect<string, EndpointUnavailable>
    readonly revoke: (sessionId: string) => Effect.Effect<void>
  }
>()('HemeraEndpoint') {}

/** Until #33 serves Hemera's tools: no endpoint, so no agent is started bare of them. */
export const noEndpoint = Layer.succeed(HemeraEndpoint, {
  url: Effect.fail(new EndpointUnavailable()),
  mint: () => Effect.fail(new EndpointUnavailable()),
  revoke: () => Effect.void,
})
