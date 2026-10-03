import { ApplicationRpcs } from './application.ts'
import { EngineRpcs } from './engine.ts'

/** What the window may ask main: the engine's calls, which main forwards, and main's own. */
export const WindowRpcs = EngineRpcs.merge(ApplicationRpcs)
