import type { ReactNode } from 'react'

import {
  IconBook2,
  IconDatabase,
  IconDeviceMobile,
  IconPackage,
  IconRocket,
  IconServer,
  IconTerminal,
  IconWorld,
} from '../../icons.ts'
import { LetterAvatar, type LetterTone, letterToneOf } from '../letter-avatar/letter-avatar.tsx'
import { Legend } from '../tooltip/legend.tsx'

/**
 * Who a Project or a repository is, in one round mark the size of a letter avatar: the letter in
 * the tone read from its name, unless the user chose otherwise — a tone of their own, one icon of a
 * short set, or a small image of their own, a logo. Shown wherever the Project is named: the
 * sidebar, the Project's header, its settings.
 *
 * The icons are a short set on purpose: a mark is told apart at a glance, and a set of five
 * thousand is a set nobody tells apart.
 */
export const MARK_ICONS = [
  'server',
  'world',
  'package',
  'database',
  'terminal',
  'book',
  'mobile',
  'rocket',
] as const

export type MarkIcon = (typeof MARK_ICONS)[number]

/** What each icon of the set is called, where it is chosen. */
export const MARK_ICON_WORDS: Record<MarkIcon, string> = {
  server: 'Server',
  world: 'Web',
  package: 'Package',
  database: 'Database',
  terminal: 'Terminal',
  book: 'Book',
  mobile: 'Mobile',
  rocket: 'Rocket',
}

/** One icon of the set, at the size it is drawn with. */
export function markIcon(icon: MarkIcon, size: 'sm' | 'mark' = 'sm'): ReactNode {
  const className = size === 'mark' ? 'size-3' : undefined
  switch (icon) {
    case 'server':
      return <IconServer size="sm" className={className} />
    case 'world':
      return <IconWorld size="sm" className={className} />
    case 'package':
      return <IconPackage size="sm" className={className} />
    case 'database':
      return <IconDatabase size="sm" className={className} />
    case 'terminal':
      return <IconTerminal size="sm" className={className} />
    case 'book':
      return <IconBook2 size="sm" className={className} />
    case 'mobile':
      return <IconDeviceMobile size="sm" className={className} />
    case 'rocket':
      return <IconRocket size="sm" className={className} />
  }
}

/** What the user chose for a mark; nothing chosen is the letter in the tone of its name. */
export interface Identity {
  tone?: LetterTone | undefined
  icon?: MarkIcon | undefined
  /** A small image of their own, as an address the renderer can draw: a logo. */
  image?: string | undefined
}

const ICON: Record<LetterTone, string> = {
  primary:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary-muted-foreground',
  info: 'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-info-muted text-info-muted-foreground',
  success:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-success-muted text-success-muted-foreground',
  warning:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-warning-muted text-warning-muted-foreground',
  build:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-build-muted text-build-muted-foreground',
}

const IMAGE = 'size-icon-sm shrink-0 rounded-full border border-border object-cover'

export interface ProjectMarkProps {
  name: string
  /** The other names of the same set, which decide whether one letter is enough. */
  others?: readonly string[] | undefined
  identity?: Identity | undefined
  /** Whether it says its name in a tooltip on itself. */
  legend?: boolean | undefined
}

export function ProjectMark({
  name,
  others,
  identity = {},
  legend = false,
}: ProjectMarkProps): ReactNode {
  const tone = identity.tone ?? letterToneOf(name)
  if (identity.image === undefined && identity.icon === undefined) {
    return <LetterAvatar name={name} others={others} tone={tone} legend={legend} />
  }
  const mark =
    identity.image === undefined ? (
      <span aria-hidden="true" className={ICON[tone]} data-mark-icon={identity.icon}>
        {identity.icon !== undefined && markIcon(identity.icon, 'mark')}
      </span>
    ) : (
      <img aria-hidden="true" alt="" src={identity.image} className={IMAGE} data-mark-image="" />
    )
  if (!legend) return mark
  return <Legend label={name}>{mark}</Legend>
}
