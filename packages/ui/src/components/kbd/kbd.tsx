import { cn } from 'cn'
import type { ReactNode } from 'react'

/**
 * A keystroke, drawn as the keys it is (design D2-06).
 *
 * What makes it read as a key rather than as code is the bottom edge: a cap is thicker where
 * it meets the board, and that one border is the whole illusion. Mono, because a row of keys
 * whose widths depend on their letters is a row that jitters as the shortcut changes.
 *
 * It is handed a keystroke already written for the platform — `Ctrl+B` here, `⌘ K` on a Mac —
 * because who owns the shortcut table is who knows the platform, and the design system does
 * not. It splits what it is given on the separator and draws one cap per key.
 */
const CAP =
  'inline-flex h-icon-lg min-w-icon-lg items-center justify-center rounded-sm border border-b-2 border-border bg-muted px-1 font-mono text-xs text-muted-foreground'

export interface KbdProps {
  /** The keystroke as the platform writes it: `Ctrl+B`, `Ctrl+Shift+P`, `⌘ K`. */
  keys: string
  /** Where the keys sit; never how they look. */
  className?: string | undefined
}

export function Kbd({ keys, className }: KbdProps): ReactNode {
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {keys
        .split(/[+\s]+/)
        .filter((key) => key !== '')
        .map((key) => (
          <kbd key={key} className={CAP}>
            {key}
          </kbd>
        ))}
    </span>
  )
}
