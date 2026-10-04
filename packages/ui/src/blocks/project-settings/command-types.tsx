import type { ReactNode } from 'react'

import {
  IconAdjustments,
  IconBraces,
  IconBrowserCheck,
  IconBug,
  IconHammer,
  IconListCheck,
  IconScript,
  IconTestPipe,
  IconWorld,
} from '../../icons.ts'

/** The types a catalogue command has, the words for each, and the icon it wears everywhere. */
export const COMMAND_TYPES = [
  'serve',
  'test',
  'lint',
  'typecheck',
  'build',
  'e2e',
  'configure',
  'debug',
  'script',
] as const
export type CommandType = (typeof COMMAND_TYPES)[number]

/** What each type is called. */
export const TYPE_WORDS: Record<CommandType, string> = {
  serve: 'Service',
  test: 'Test',
  lint: 'Lint',
  typecheck: 'Typecheck',
  build: 'Build',
  e2e: 'End-to-end',
  configure: 'Configure',
  debug: 'Debug',
  script: 'Script',
}

/** The icon of each type: what a command looks like wherever it is, its live chip included. */
export function typeIcon(type: CommandType): ReactNode {
  switch (type) {
    case 'serve':
      return <IconWorld size="sm" />
    case 'test':
      return <IconTestPipe size="sm" />
    case 'lint':
      return <IconListCheck size="sm" />
    case 'typecheck':
      return <IconBraces size="sm" />
    case 'build':
      return <IconHammer size="sm" />
    case 'e2e':
      return <IconBrowserCheck size="sm" />
    case 'configure':
      return <IconAdjustments size="sm" />
    case 'debug':
      return <IconBug size="sm" />
    case 'script':
      return <IconScript size="sm" />
  }
}
