import { type ReactNode } from 'react'
import {
  IconBan,
  IconBook2,
  IconGitBranch,
  IconListNumbers,
  IconTerminal,
  IconVariable,
} from '../../icons.ts'

/**
 * What the setup agent proposes for a new Project, one kind per card: the repositories, the
 * commands with their roles, the preparation recipe, the variables, and the commands never to
 * run. Each kind is drawn here twice — in short, as the card shows it, and as the lines of its
 * inline editor — and once more as its skeleton while the agent is still reading.
 *
 * In short means one line per thing, in the faces the settings use for it: a path or a line in
 * the mono face, a value always masked, a role as its glyph. A repository the agent found deeper
 * in the folder than Hemera looked carries the search glyph, with its legend.
 */
export type SetupKind =
  | 'repositories'
  | 'commands'
  | 'preparation'
  | 'variables'
  | 'specLanguage'
  | 'never'

export const SETUP_KINDS: readonly SetupKind[] = [
  'repositories',
  'commands',
  'preparation',
  'variables',
  'specLanguage',
  'never',
]

export const SETUP_TITLES: Record<SetupKind, string> = {
  repositories: 'Repositories',
  commands: 'Commands',
  preparation: 'Preparation',
  variables: 'Variables',
  specLanguage: 'Spec language',
  never: 'Never run',
}

export function setupIcon(kind: SetupKind): ReactNode {
  switch (kind) {
    case 'repositories':
      return <IconGitBranch size="sm" />
    case 'commands':
      return <IconTerminal size="sm" />
    case 'preparation':
      return <IconListNumbers size="sm" />
    case 'variables':
      return <IconVariable size="sm" />
    case 'specLanguage':
      return <IconBook2 size="sm" />
    case 'never':
      return <IconBan size="sm" />
  }
}
