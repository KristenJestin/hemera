import { ApplicationRpcs } from './application.ts'
import { EngineRpcs } from './engine.ts'
import { WindowNoticeRpcs } from './notifications.ts'

/**
 * What the window may ask main: the engine's calls, which main forwards, and main's own, the
 * notifications it draws included.
 */
export const WindowRpcs = EngineRpcs.merge(ApplicationRpcs, WindowNoticeRpcs)
