import type { ReactNode } from 'react'

import { Face } from '../../components/face/face.tsx'
import type { FaceState } from '../../components/face/states.ts'
import { Frame } from '../../components/frame/frame.tsx'
import type { MissionStage } from './vocabulary.ts'

export interface StageCardProps {
  /** The stage the card stands for, which names it to whatever reads the page. */
  stage: MissionStage
  /** Hemera's face, in the expression of what happens. */
  face: FaceState
  /** What happens, or what waits for the user, in one line. */
  line: string
  /** Where the stage stands: its step under way and how far it is. */
  progress: { step: string; detail: string }
  /** The chips of what runs, when something does. */
  running?: ReactNode
}

/**
 * Where a mission's stage stands, at the top of its page, the same on every stage: the face, the
 * line that says what happens or what waits, and the progress line under it. Nothing in it leads
 * elsewhere: what waits for the user is right under it on the page.
 */
export function StageCard({ stage, face, line, progress, running }: StageCardProps): ReactNode {
  return (
    <section aria-label={stage} className="rounded-xl">
      <Frame>
        <div className="flex min-w-0 items-start gap-3 px-4 py-3">
          <Face state={face} size="md" legend />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p role="status" className="text-sm font-medium break-words">
              {line}
            </p>
            <p className="flex min-w-0 gap-1.5 text-xs text-muted-foreground">
              <span className="shrink-0 font-medium text-foreground">{progress.step}</span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 truncate">{progress.detail}</span>
            </p>
            {running !== undefined && <div className="flex flex-wrap gap-1.5 pt-1">{running}</div>}
          </div>
        </div>
      </Frame>
    </section>
  )
}
