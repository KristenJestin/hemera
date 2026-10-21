import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Dialog } from '../../components/dialog/dialog.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { MONO, QUIET } from './review-parts.tsx'
import type { ShipPreview } from './review-types.ts'

/**
 * Ship's confirmation: one question, and under it only what there is to say before the mission
 * leaves — what leaves, per repository; the changes made outside Hemera that leave with it and
 * what they make to re-run; the proofs verified by hand the user has not validated (open question
 * 78, recommended: listed here, Ship still possible, since validating them is the user's own
 * call); the rules of the Project changed since the mission copied them; the CI of each pull
 * request. A part with nothing to say is not drawn.
 *
 * It opens on the preview read before and Confirm is not drawn until the fresh one has landed
 * (`confirmable`): what the user confirms is what they read.
 *
 * With the Local preset there is no forge: the action is Mark as delivered, a dated stamp. Open
 * question 80, recommended: it merges each repository's branch into its local base, fast forward
 * when it can — the only merge without a pull request the rules allow — so the cleanup's guard
 * sees the work merged.
 */

const PART = 'flex flex-col gap-1.5'

const HEAD = 'text-sm font-medium'

const NOTE = 'max-w-measure text-sm text-muted-foreground'

function Part({ name, children }: { name: string; children: ReactNode }): ReactNode {
  return (
    <section aria-label={name} className={PART}>
      <h3 className={HEAD}>{name}</h3>
      {children}
    </section>
  )
}

export interface ShipDialogProps {
  missionKey: string
  preview: ShipPreview
  /** Whether `preview` was read as the confirmation opened: Confirm is drawn only then. */
  confirmable: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function ShipDialog({
  missionKey,
  preview,
  confirmable,
  open,
  onOpenChange,
  onConfirm,
}: ShipDialogProps): ReactNode {
  const local = preview.local !== undefined
  const confirm = local ? 'Mark as delivered' : 'Ship now'
  return (
    <Dialog
      title={local ? `Mark ${missionKey} as delivered?` : `Ship ${missionKey}?`}
      description={
        local
          ? 'This Project has no forge: delivering is a dated stamp, then the end of the mission.'
          : 'The mission is good: the delivery rules take it from here, and only version bumps change it after.'
      }
      size="wide"
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          {confirmable && (
            <Button
              variant="primary"
              onClick={() => {
                onConfirm()
                onOpenChange(false)
              }}
            >
              {confirm}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {local && preview.local !== undefined ? (
          <Part name="What happens">
            <ul className="flex flex-col gap-0.5">
              {preview.local.merges.map((merge) => (
                <li key={merge.repository} className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 font-mono text-xs">{merge.repository}</span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {`Merges the mission’s branch into ${merge.into}, here, fast forward when it can`}
                  </span>
                </li>
              ))}
            </ul>
          </Part>
        ) : (
          <Part name="What leaves">
            <ul className="flex flex-col gap-0.5">
              {preview.leaving.map((one) => (
                <li
                  key={one.repository}
                  aria-label={one.repository}
                  className="flex min-w-0 items-center gap-2 text-sm"
                >
                  <span className="w-24 shrink-0 font-mono text-xs">{one.repository}</span>
                  <span className={MONO}>{one.branch}</span>
                  <span className={QUIET}>{one.summary}</span>
                </li>
              ))}
            </ul>
          </Part>
        )}
        {preview.outside.length > 0 && (
          <Part name="Changed outside Hemera">
            <ul className="flex flex-col gap-0.5">
              {preview.outside.map((one) => (
                <li key={one.path} className={MONO}>
                  {one.path}
                </li>
              ))}
            </ul>
            <p className={NOTE}>
              {`They leave too. Before pushing, Hemera re-runs what they touch, and pushes only if it is green again: ${preview.redo.join(', ')}.`}
            </p>
          </Part>
        )}
        {preview.unvalidated.length > 0 && (
          <Part name="Not validated by you">
            <ul className="flex flex-col gap-0.5">
              {preview.unvalidated.map((one) => (
                <li key={one.id} className="flex min-w-0 items-center gap-2 text-sm">
                  <StatusMark state="waiting" size="sm" />
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{one.id}</span>
                  <span className="min-w-0 truncate">{one.title}</span>
                </li>
              ))}
            </ul>
            <p className={NOTE}>They are verified by hand: shipping now leaves them as they are.</p>
          </Part>
        )}
        {preview.rules.length > 0 && (
          <Part name="Rules changed since this mission">
            <ul className="flex flex-col gap-0.5">
              {preview.rules.map((rule) => (
                <li key={rule.what} className="text-sm">
                  {rule.before === undefined || rule.now === undefined
                    ? `${rule.what} changed in the Project since this mission copied them. This delivery keeps the mission’s copy.`
                    : `${rule.what}: ${rule.before} when the mission started, ${rule.now} now. This delivery keeps ${rule.before}.`}
                </li>
              ))}
            </ul>
          </Part>
        )}
        {preview.ci.length > 0 && (
          <Part name="Pull requests’ CI">
            <ul className="flex flex-col gap-0.5">
              {preview.ci.map((one) => (
                <li key={one.repository} className="flex min-w-0 items-center gap-2 text-sm">
                  <StatusMark state={one.state} size="sm" legend />
                  <span className="shrink-0">{`${one.repository} #${String(one.number)}`}</span>
                  <span className="text-muted-foreground">{one.words}</span>
                </li>
              ))}
            </ul>
          </Part>
        )}
      </div>
    </Dialog>
  )
}
