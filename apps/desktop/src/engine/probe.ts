/**
 * The end-to-end suite's one seam into the engine, served only when the suite runs headless
 * (`HEMERA_E2E_HEADLESS=1`, as `window-options.ts`): it lets the suite crash the engine from
 * inside, have it start an agents' process for the test program, and stream at a high rate.
 * A run of Hemera outside the suite never opens this port.
 */

import { AgentsProcessGone, LaunchFailed, type AgentLine } from '@hemera/ipc'
import { Effect, Predicate, Schema, Stream } from 'effect'
import type { Scope } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import type { AgentsProcess } from './agents.ts'

export const Pid = Schema.TaggedStruct('Pid', { pid: Schema.Number })
export const Line = Schema.TaggedStruct('Line', { line: Schema.String })

/** An item shaped like what an agent streams: a turn's text, numbered. */
export const Item = Schema.Struct({ index: Schema.Number, text: Schema.String })

export const ProbeRpcs = RpcGroup.make(
  Rpc.make('probe.crash', { success: Schema.Void }),
  Rpc.make('probe.agents', {
    payload: { program: Schema.String, input: Schema.Array(Schema.String) },
    success: Schema.Union([Pid, Line]),
    error: Schema.Union([AgentsProcessGone, LaunchFailed]),
    stream: true,
  }),
  Rpc.make('probe.load', {
    payload: { count: Schema.Number, size: Schema.Number },
    success: Item,
    stream: true,
  }),
)

type Launch = (
  program: string,
  args: ReadonlyArray<string>,
) => Effect.Effect<AgentsProcess, LaunchFailed, Scope.Scope>

export const probeHandlers = (launch: Launch) =>
  ProbeRpcs.toLayer({
    'probe.crash': () => Effect.sync(() => process.crash()),
    'probe.agents': ({ program, input }) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const agents = yield* launch(program, [])
          yield* Effect.forEach(input, agents.write, { discard: true })
          return Stream.concat(
            Stream.make(Pid.make({ pid: agents.pid })),
            Stream.map(agents.output, (line: AgentLine) =>
              Line.make({
                line: Predicate.isTagged(line, 'Output') ? line.line : `! ${line.line}`,
              }),
            ),
          )
        }),
      ),
    'probe.load': ({ count, size }) =>
      // One item per chunk, as an agent's turn arrives: one acknowledgement per item.
      Stream.range(1, count).pipe(
        Stream.map((index) => Item.make({ index, text: 'x'.repeat(size) })),
        Stream.rechunk(1),
      ),
  })
