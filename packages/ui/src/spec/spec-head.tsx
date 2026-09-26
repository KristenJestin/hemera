import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button, IconButton } from '../components/button/button.tsx'
import { Menu } from '../components/menu/menu.tsx'
import { StatusDot, type StatusTone } from '../components/status-dot/status-dot.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconChevronRight, IconRefresh } from '../icons.ts'
import type { RevisionView, SpecStatus, SpecType } from './model.ts'
import { SPEC_TYPE_ICONS } from './spec-icons.ts'

/**
 * The first line of the Spec panel: which Spec, what kind, where it stands (lot 19, brief
 * "Head").
 *
 * The key in mono, because it is what a person types to find it again; the title; the type as
 * a quiet chip; the status as a dot and a word — a draft is a plain dot, `ready` the success
 * one. A revision is only named once there is more than one, and then as the picker of the
 * revisions, the older ones read only. `Rework` stands at the end of the line of a `ready` Spec
 * and nowhere else: it is the one way back to a draft (core.md, "Spec and revisions"). The very
 * end is the fold, which takes the panel back to its band beside the chat (brief revision 4).
 */

const HEAD = 'flex min-h-control-sm items-center gap-2.5'

const KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const TITLE = 'min-w-0 truncate text-base font-semibold'

const STATUS = 'flex shrink-0 items-center gap-1.5 text-xs'

const END = 'ml-auto flex shrink-0 items-center gap-1.5'

/**
 * The dot of each status (D8-13): a draft is nothing yet, a frozen Spec is the success one, a
 * Spec a build has taken on is running, and one taken back is the quiet one.
 */
const DOT: Record<SpecStatus, StatusTone> = {
  draft: 'pending',
  ready: 'success',
  in_progress: 'running',
  cancelled: 'cancelled',
}

export interface SpecHeadProps {
  specKey: string
  title: string
  type: SpecType
  status: SpecStatus
  /** The revision shown. */
  revision: number
  /** Every revision, newest first. */
  revisions: RevisionView[]
  /** Whether the revision shown is an older one, which is read only and cannot be reworked. */
  superseded?: boolean | undefined
  /** Shows another revision; an older one is read only. */
  onPickRevision: (revision: number) => void
  /** Opens the rework of a `ready` Spec. */
  onRework: () => void
  /** Folds the panel to its band; the button is drawn only when this is given. */
  onFold?: (() => void) | undefined
}

export function SpecHead({
  specKey,
  title,
  type,
  status,
  revision,
  revisions,
  superseded = false,
  onPickRevision,
  onRework,
  onFold,
}: SpecHeadProps): ReactNode {
  const ready = status === 'ready'
  const TypeIcon = SPEC_TYPE_ICONS[type]
  const reworkable = ready && !superseded
  return (
    <div className={HEAD}>
      <span className={KEY}>{specKey}</span>
      <h2 className={TITLE}>{title}</h2>
      <Badge icon={<TypeIcon size="sm" aria-hidden="true" />}>{type}</Badge>
      <span className={STATUS}>
        <StatusDot status={DOT[status]} />
        <span className={ready ? 'text-success-muted-foreground' : 'text-muted-foreground'}>
          {status}
        </span>
      </span>
      {(revisions.length > 1 || reworkable || onFold !== undefined) && (
        <span className={END}>
          {revisions.length > 1 && (
            <Menu
              // The newest is the Spec as it stands; an older one is said by when it was frozen.
              label={revision === revisions[0]?.number ? 'Latest' : 'Earlier'}
              groups={[
                revisions.map((one) => ({
                  label: one.detail,
                  onSelect: () => onPickRevision(one.number),
                })),
              ]}
            />
          )}
          {reworkable && (
            // The height of the picker beside it, which is a menu's own trigger: two controls of
            // two heights at the end of one line read as two lines.
            <Button onClick={onRework}>
              <IconRefresh size="sm" />
              Rework
            </Button>
          )}
          {onFold !== undefined && (
            <Tooltip label="Fold the Spec">
              <IconButton
                variant="ghost"
                size="sm"
                icon={<IconChevronRight size="sm" />}
                aria-label="Fold the Spec"
                onClick={onFold}
              />
            </Tooltip>
          )}
        </span>
      )}
    </div>
  )
}
