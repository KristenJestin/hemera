/**
 * Where the fake agent used to live, kept so the client's suite still asks for it here.
 *
 * The peer itself is `#engine/agents/fake.ts` now, because it is no longer only a test's double:
 * `fakeSupervisor` answers the `ProcessSupervisor` port, and the engine's runtime is tested by
 * injecting it. One file, one implementation, and no second fake to keep in step.
 */

export * from '../src/engine/agents/fake.ts'
