import type { ReactNode } from 'react'

import {
  IconArrowUp,
  IconBolt,
  IconBrandBitbucket,
  IconBrandGithub,
  IconChecklist,
  IconDeviceDesktop,
  IconGitMerge,
  IconGitPullRequest,
  IconListCheck,
  IconPackage,
  IconPlayerPlay,
  IconTag,
  IconTerminal,
} from '../../icons.ts'
import type { ForgeView, StepKind } from './delivery-model.ts'

/** The glyph of a step's kind. */
export function stepIcon(kind: StepKind): ReactNode {
  switch (kind) {
    case 'push':
      return <IconArrowUp size="sm" />
    case 'pull-request':
      return <IconGitPullRequest size="sm" />
    case 'bump':
      return <IconPackage size="sm" />
    case 'merge':
    case 'local-merge':
      return <IconGitMerge size="sm" />
    case 'ci':
      return <IconChecklist size="sm" />
    case 'remote-action':
      return <IconPlayerPlay size="sm" />
    case 'published':
      return <IconTag size="sm" />
    case 'command':
      return <IconTerminal size="sm" />
    case 'agent':
      return <IconBolt size="sm" />
    case 'confirm':
      return <IconListCheck size="sm" />
  }
}

/** The glyph of a forge. */
export function forgeIcon(forge: Pick<ForgeView, 'kind'>): ReactNode {
  if (forge.kind === 'github') return <IconBrandGithub size="sm" />
  if (forge.kind === 'none') return <IconDeviceDesktop size="sm" />
  return <IconBrandBitbucket size="sm" />
}
