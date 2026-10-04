import type { ReactNode } from 'react'

import { Face } from '../face/face.tsx'
import type { FaceState } from '../face/states.ts'

/**
 * What an area says when it has nothing to show — or, worn by `ErrorState`, when what it shows
 * could not be had. One shape for both, after shadcn's `Empty`: centred in the area it fills, an
 * icon in a quiet square or Hemera's face, a title, one line, and what to do about it.
 *
 * Never a sentence against the left edge with a lone button under it: an empty area is a place
 * the eye lands on, so it is laid out as one.
 */
const AREA = 'flex min-h-full w-full flex-1 items-center justify-center p-8'

const CONTENT = 'flex max-w-sm flex-col items-center gap-4 text-center'

/** The square an icon sits in: the page's quieter surface, rounder than a control. */
const ICON =
  'flex size-control-lg items-center justify-center rounded-lg bg-muted text-muted-foreground'

const WORDS = 'flex flex-col items-center gap-1'

const TITLE = 'text-base font-semibold text-foreground text-center'

const DESCRIPTION = 'text-sm text-muted-foreground'

export interface EmptyProps {
  /** The icon of what is missing, in its square. */
  icon?: ReactNode
  /** Hemera's face in place of an icon, in the state given: for what is Hemera's to fill. */
  face?: FaceState | undefined
  title: string
  /** One line: what would be here, or what went wrong, in words. */
  description?: string | undefined
  /** What fills it: one button, sometimes two. */
  action?: ReactNode
}

export function Empty({ icon, face, title, description, action }: EmptyProps): ReactNode {
  return (
    <div className={AREA} data-empty="">
      <div className={CONTENT} data-empty-content="">
        {face !== undefined ? (
          <span className="flex" data-empty-media="face">
            <Face state={face} size="lg" />
          </span>
        ) : (
          icon !== undefined && (
            <span className={ICON} data-empty-media="icon" aria-hidden="true">
              {icon}
            </span>
          )
        )}
        <div className={WORDS}>
          <h2 className={TITLE}>{title}</h2>
          {description !== undefined && <p className={DESCRIPTION}>{description}</p>}
        </div>
        {action !== undefined && <div className="flex items-center gap-2">{action}</div>}
      </div>
    </div>
  )
}
