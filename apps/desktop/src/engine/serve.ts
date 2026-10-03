/**
 * What the engine answers. It holds no storage yet: it says it is ready, for which version and
 * channel and on which data folder, and lets whoever listens hear every change of that.
 */

import { EngineRpcs, type EngineStart, type EngineStatus } from '@hemera/ipc'
import { Effect, SubscriptionRef } from 'effect'

import { observed, observedStream, type Log } from '../main/diagnostic.ts'

export const engineHandlers = (start: EngineStart, log: Log) =>
  EngineRpcs.toLayer(
    Effect.gen(function* () {
      const status = yield* SubscriptionRef.make<EngineStatus>({ ready: true, ...start })
      return {
        'engine.status': () => SubscriptionRef.get(status).pipe(observed('engine.status', log)),
        'engine.statusChanges': () =>
          SubscriptionRef.changes(status).pipe(observedStream('engine.statusChanges', log)),
      }
    }),
  )
