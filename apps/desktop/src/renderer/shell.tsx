import { DatabaseRefused } from '@hemera/ipc'
import { Schema } from 'effect'

import type { EngineState } from './engine-start.ts'

const isRefused = Schema.is(DatabaseRefused)

/**
 * The empty shell: a drag zone where the title bar is, the name of the application, and a
 * sentence when the engine is late, has stopped, or could not open the data folder.
 */
export function Shell({ engine, onRelaunch }: { engine: EngineState; onRelaunch: () => void }) {
  return (
    <>
      <header />
      <main data-engine={engine.kind}>
        <h1>Hemera</h1>
        {engine.kind === 'late' && (
          <p role="status">
            Hemera’s engine has not started.
            {engine.dataFolder !== null && ` Its diagnostic is in ${engine.dataFolder}.`}
          </p>
        )}
        {engine.kind === 'ready' && isRefused(engine.status.database) && (
          <p role="alert">{engine.status.database.sentence}</p>
        )}
        {engine.kind === 'stopped' && (
          <>
            <p role="alert">Hemera’s engine stopped.</p>
            <button type="button" onClick={onRelaunch}>
              Restart Hemera
            </button>
          </>
        )}
      </main>
    </>
  )
}
