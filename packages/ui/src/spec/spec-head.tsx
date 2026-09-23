import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { Menu } from '../components/menu/menu.tsx'
import { StatusDot } from '../components/status-dot/status-dot.tsx'
import { IconRefresh } from '../icons.ts'
import type { RevisionView, SpecStatus, SpecType } from './model.ts'

/**
 * The first line of the Spec panel: which Spec, what kind, where it stands (lot 19, brief
 * "Head").
 *
 * The key in mono, because it is what a person types to find it again; the title; the type as
 * a quiet chip; the status as a dot and a word — a draft is a plain dot, `ready` the success
 * one. A revision is only named once there is more than one, and then as the picker of the
 * revisions, the older ones read only. `Rework` stands at the end of the line of a `ready` Spec
 * and nowhere else: it is the one way back to a draft (core.md, "Spec and revisions").
 */

const HEAD = 'flex min-h-control-sm items-center gap-2.5'

const KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const TITLE = 'min-w-0 truncate text-base font-semibold'

const STATUS = 'flex shrink-0 items-center gap-1.5 text-xs'

const END = 'ml-auto flex shrink-0 items-center gap-1.5'

export interface SpecHeadProps {
  specKey: string
  title: string
  type: SpecType
  status: SpecStatus
  /** The revision shown. */
  revision: number
  /** Every revision, newest first. */
  revisions: RevisionView[]
  /** Shows another revision; an older one is read only. */
  onPickRevision: (revision: number) => void
  /** Opens the rework of a `ready` Spec. */
  onRework: () => void
}

export function SpecHead({
  specKey,
  title,
  type,
  status,
  revision,
  revisions,
  onPickRevision,
  onRework,
}: SpecHeadProps): ReactNode {
  const ready = status === 'ready'
  return (
    <div className={HEAD}>
      <span className={KEY}>{specKey}</span>
      <h2 className={TITLE}>{title}</h2>
      <Badge>{type}</Badge>
      <span className={STATUS}>
        <StatusDot status={ready ? 'success' : 'pending'} />
        <span className={ready ? 'text-success-muted-foreground' : 'text-muted-foreground'}>
          {status}
        </span>
      </span>
      {(revisions.length > 1 || ready) && (
        <span className={END}>
          {revisions.length > 1 && (
            <Menu
              label={`rev ${revision}`}
              groups={[
                revisions.map((one) => ({
                  label: `rev ${one.number} · ${one.detail}`,
                  onSelect: () => onPickRevision(one.number),
                })),
              ]}
            />
          )}
          {ready && (
            // The height of the picker beside it, which is a menu's own trigger: two controls of
            // two heights at the end of one line read as two lines.
            <Button onClick={onRework}>
              <IconRefresh size="sm" />
              Rework
            </Button>
          )}
        </span>
      )}
    </div>
  )
}
