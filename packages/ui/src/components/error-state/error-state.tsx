import type { ReactNode } from 'react'

import { IconAlertTriangle } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { Empty } from '../empty/empty.tsx'

/**
 * What an area says when what it shows could not be had: `Empty`'s own shape — centred, an icon or
 * Hemera's face, a title, one line — the line saying what went wrong in words, and "Try again".
 * Said as an alert, once, to whatever reads the page.
 */
export interface ErrorStateProps {
  title: string
  /** What went wrong, in words: the cause as it was given, never a code alone. */
  description: string
  /** Asks again. */
  onRetry: () => void
  /** Whether it is asking again: the button says it is working and keeps its place. */
  retrying?: boolean | undefined
  /** Hemera's face, in its error state, in place of the icon: for Hemera's own failures. */
  face?: boolean | undefined
}

export function ErrorState({
  title,
  description,
  onRetry,
  retrying = false,
  face = false,
}: ErrorStateProps): ReactNode {
  return (
    <div role="alert" className="flex w-full flex-1">
      <Empty
        icon={face ? undefined : <IconAlertTriangle size="md" />}
        face={face ? 'error' : undefined}
        title={title}
        description={description}
        action={
          <Button onClick={onRetry} state={retrying ? 'loading' : 'idle'}>
            Try again
          </Button>
        }
      />
    </div>
  )
}
