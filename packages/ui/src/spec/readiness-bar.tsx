import { AnimatePresence, motion } from 'motion/react'
import { Fragment, type ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { FILL_STEP, crossfade, fill, instant, useTransition } from '../motion.ts'
import type { GateCheckView, ReadinessView, SpecTarget } from './model.ts'

/**
 * How far the Spec is from `ready`, at the foot of the panel (lot 19, brief "Foot"; D7-10).
 *
 * Not a list of errors: a thin bar of seven segments, one per check of the gate, filled in the
 * success colour where the check passes. A failing segment names itself under the pointer and
 * under the keyboard. Under the bar, one sentence — `2 things before ready: a task for S2, the
 * credit-note question` — whose items are links that take the document to their target.
 *
 * When every check passes the sentence becomes `Ready to freeze` and `Mark ready` appears. It is
 * never drawn disabled: a button that cannot be pressed is a question it does not answer, and
 * the sentence is the answer. Only the human's press freezes the Spec; the gate is checked again
 * when it arrives (D7-10, "An obsolete request is refused").
 */

const GATE = 'flex items-center gap-2.5'

const BAR = 'flex flex-1 gap-1'

/** A segment: the track, and the fill inside it that grows from its left edge. */
const TRACK = 'relative h-1 flex-1 overflow-hidden rounded-full bg-accent'

const FILLED = 'absolute inset-0 origin-left rounded-full bg-success'

/**
 * A failing segment is a control, so the keyboard reaches its name too: a transparent box taller
 * than the four pixels of the track, the track drawn inside it.
 */
const FAILING = 'flex flex-1 items-center rounded-sm py-1.5 outline-none focus-ring'

const COUNT = 'font-mono text-xs text-muted-foreground'

const SAY = 'flex min-h-control-sm items-center gap-2.5 text-sm text-muted-foreground'

const LINK =
  'rounded-sm text-foreground underline decoration-input underline-offset-4 outline-none focus-ring hover:decoration-primary'

const OK = 'font-semibold text-success-muted-foreground'

const REFUSED = 'text-sm text-destructive-muted-foreground'

/** How many items the sentence names before it says `and 2 more`. */
const NAMED = 3

export interface ReadinessBarProps {
  readiness: ReadinessView
  /** A frozen Spec says when it was frozen instead of what is left. */
  frozenOn?: string | undefined
  /** An older revision says which one replaced it instead of offering to rework it. */
  replacedBy?: number | undefined
  /** Moves the focus of the document to the target of an item. */
  onGoTo: (target: SpecTarget) => void
  /** The human click that freezes the Spec. */
  onMarkReady: () => void
}

export function ReadinessBar({
  readiness,
  frozenOn,
  replacedBy,
  onGoTo,
  onMarkReady,
}: ReadinessBarProps): ReactNode {
  const transition = useTransition(crossfade)
  const passed = readiness.checks.filter((check) => check.passed).length
  const total = readiness.checks.length
  const full = passed === total
  return (
    <div className="flex flex-col gap-2">
      <div className={GATE}>
        <div
          role="group"
          aria-label={`Readiness, ${passed} of ${total} checks pass`}
          className={BAR}
        >
          {readiness.checks.map((check, index) => (
            <Segment key={check.check} check={check} index={index} />
          ))}
        </div>
        <span className={COUNT} aria-hidden="true">{`${passed}/${total}`}</span>
      </div>
      <div className={SAY}>
        {frozenOn !== undefined ? (
          <span>
            {replacedBy === undefined
              ? `Frozen on ${frozenOn} · nothing changes until you rework it`
              : `Frozen on ${frozenOn} · read only, revision ${replacedBy} replaced it`}
          </span>
        ) : full ? (
          <span className={OK}>Ready to freeze</span>
        ) : (
          <Sentence readiness={readiness} onGoTo={onGoTo} />
        )}
        <AnimatePresence initial={false}>
          {full && frozenOn === undefined && (
            <motion.span
              key="mark-ready"
              className="ml-auto flex"
              initial={{ filter: 'opacity(0)' }}
              animate={{ filter: 'opacity(1)' }}
              exit={{ filter: 'opacity(0)' }}
              transition={transition}
            >
              <Button variant="primary" size="sm" onClick={onMarkReady}>
                Mark ready
              </Button>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {readiness.refused !== undefined && (
        <p role="alert" className={REFUSED}>
          {readiness.refused}
        </p>
      )}
    </div>
  )
}

/** One check: filled when it passes, and a named control when it does not. */
function Segment({ check, index }: { check: GateCheckView; index: number }): ReactNode {
  const base = useTransition(fill)
  // Each segment a step behind the one before it, so a bar that fills at once sweeps from the
  // left; a system asking for less movement gets the bar filled, with nothing to wait on.
  const transition = base === instant ? base : { ...base, delay: index * FILL_STEP }
  const track = (
    <span className={TRACK}>
      {check.passed && (
        <motion.span
          className={FILLED}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={transition}
        />
      )}
    </span>
  )
  if (check.passed) {
    return (
      <span role="img" aria-label={`${check.check} passes`} className="flex flex-1 items-center">
        {track}
      </span>
    )
  }
  const name = check.detail ?? check.check
  return (
    <Tooltip label={name}>
      <button type="button" aria-label={name} className={FAILING}>
        {track}
      </button>
    </Tooltip>
  )
}

/** `3 things before ready: a, b, c and 2 more`, each item a link to where it is fixed. */
function Sentence({
  readiness,
  onGoTo,
}: {
  readiness: ReadinessView
  onGoTo: (target: SpecTarget) => void
}): ReactNode {
  const { todo } = readiness
  const named = todo.slice(0, NAMED)
  const more = todo.length - named.length
  return (
    <span>
      {`${todo.length} ${todo.length === 1 ? 'thing' : 'things'} before ready: `}
      {named.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 && ', '}
          {item.target === undefined ? (
            item.label
          ) : (
            <button
              type="button"
              className={LINK}
              onClick={() => {
                if (item.target !== undefined) onGoTo(item.target)
              }}
            >
              {item.label}
            </button>
          )}
        </Fragment>
      ))}
      {more > 0 && ` and ${more} more`}
    </span>
  )
}
