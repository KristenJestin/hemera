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
