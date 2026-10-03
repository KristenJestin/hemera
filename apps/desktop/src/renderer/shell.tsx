import type { EngineState } from './engine-start.ts'

/**
 * The empty shell: a drag zone where the title bar is, the name of the application, and a
 * sentence when the engine is late or has stopped.
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
