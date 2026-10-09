import { ApplicationRpcs } from './application.ts'
import { EngineRpcs } from './engine.ts'
import { SoundPreviewRpcs, WindowNoticeRpcs } from './notifications.ts'
import { HemeraAutoRpcs } from './permissions.ts'
import { JiraTokenRpcs } from './tickets.ts'

/**
 * What the window may ask main: the engine's calls, which main forwards, and main's own, the
 * notifications it draws, the sounds it previews and Hemera Auto's key it seals included.
 */
export const WindowRpcs = EngineRpcs.merge(
  ApplicationRpcs,
  WindowNoticeRpcs,
  SoundPreviewRpcs,
  HemeraAutoRpcs,
  JiraTokenRpcs,
)
