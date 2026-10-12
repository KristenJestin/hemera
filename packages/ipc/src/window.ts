import { ApplicationRpcs } from './application.ts'
import { EngineApartRpcs, EngineCoreRpcs } from './engine.ts'
import { SoundPreviewRpcs, WindowNoticeRpcs } from './notifications.ts'
import { HemeraAutoRpcs } from './permissions.ts'
import { JiraTokenRpcs } from './tickets.ts'

/**
 * What the window may ask main: the engine's calls, which main forwards, and main's own, the
 * notifications it draws, the sounds it previews and Hemera Auto's key it seals included.
 */
export const WindowCoreRpcs = EngineCoreRpcs.merge(
  ApplicationRpcs,
  WindowNoticeRpcs,
  SoundPreviewRpcs,
  HemeraAutoRpcs,
  JiraTokenRpcs,
)

/** The window's calls whole: main serves the groups of `EngineApartRpcs` as a layer of their own. */
export const WindowRpcs = WindowCoreRpcs.merge(EngineApartRpcs)
