import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { IconGitCompare } from '../icons.ts'

/**
 * What a section says when your text could not be saved because it moved under it (D7-12).
 *
 * Inside the section and not over the page: the conflict is this section's, and the text it is
 * about stays right under it, in the editor, whole — last writer wins is refused, and a
 * conflict never loses an unsaved human text. Three answers and no fourth: look at both,
 * write yours on top of the current version, or let yours go.
 */

const BANNER =
  'flex flex-col gap-2 rounded-md border border-destructive bg-destructive-muted px-3 py-2.5 text-sm font-medium text-destructive-muted-foreground'

export interface ConflictBannerProps {
  /** The version your text was written on. */
  base: number
  /** The version the section is at. */
  current: number
  /** Whether the current text is shown beside yours. */
  comparing: boolean
  onCompare: () => void
  /** Writes your text as a new human version on top of the current one. */
  onApply: () => void
  /** Lets your text go and keeps the current one. */
  onDiscard: () => void
}

export function ConflictBanner({
  base,
  current,
  comparing,
  onCompare,
  onApply,
  onDiscard,
}: ConflictBannerProps): ReactNode {
  return (
    <div role="group" aria-label="Conflict" className={BANNER}>
      <p>{`Your text was written on v${base}; the section is at v${current}.`}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" aria-pressed={comparing} onClick={onCompare}>
          <IconGitCompare size="sm" />
          Compare
        </Button>
        <Button size="sm" onClick={onApply}>{`Apply mine on v${current}`}</Button>
        <Button size="sm" variant="ghost" onClick={onDiscard}>
          Discard mine
        </Button>
      </div>
    </div>
  )
}
