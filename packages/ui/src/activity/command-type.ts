import type { FunctionComponent } from 'react'

import {
  IconAdjustments,
  IconBug,
  IconChecklist,
  IconFlask,
  IconHammer,
  type IconProps,
  IconScript,
  IconServer,
} from '../icons.ts'

/**
 * What a command of the catalogue is for, and the one icon each type is drawn with (D8-07).
 *
 * Seven types replace the three kinds of lot 18: `serve` is what stays up and publishes an
 * address, and the six others end with an exit code. The icon is fixed by the design system and
 * not picked by the reader, so a `test` reads as a test in the settings, in the panel and in the
 * thread alike — the same shape everywhere, which is what an icon is for.
 */
export const COMMAND_TYPES = [
  'serve',
  'test',
  'lint',
  'build',
  'configure',
  'debug',
  'script',
] as const

export type CommandType = (typeof COMMAND_TYPES)[number]

/** Where one `serve` command runs: once per Workspace, or once for the whole Project (D8-07). */
export const COMMAND_SCOPES = ['workspace', 'project'] as const

export type CommandScope = (typeof COMMAND_SCOPES)[number]

/** The icon of each type: the one the design system fixes, and the only one it is drawn with. */
export const COMMAND_TYPE_ICONS: Record<CommandType, FunctionComponent<IconProps>> = {
  serve: IconServer,
  test: IconFlask,
  lint: IconChecklist,
  build: IconHammer,
  configure: IconAdjustments,
  debug: IconBug,
  script: IconScript,
}

/** The word a type is read as, where a badge or a select names it. */
export const COMMAND_TYPE_LABELS: Record<CommandType, string> = {
  serve: 'Serve',
  test: 'Test',
  lint: 'Lint',
  build: 'Build',
  configure: 'Configure',
  debug: 'Debug',
  script: 'Script',
}
