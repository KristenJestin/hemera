import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useId, useState } from 'react'

import { Badge } from '../../components/badge/badge.tsx'
import { Button } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { IconCircleCheck, IconPencil } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import type { Restatement, RestatementAnswer } from './model.ts'

/**
 * The review loop, through the chat: the agent's answer to the user's review, one restatement per
 * point — "I understood: …", and "This changes the Spec: rework?" when it does — each answered
 * "OK" or "No, it is…". A correction is the user's words, which the agent restates again. Once
 * every point is confirmed, the build goes back to work, and the block says so.
 *
 * A message block of the thread like any other, so it reads the same in the chat, in the
 * Conversation tab (V4) and, `compact` — one point at a time — in the dock of the minimised chat
 * (V5).
 */

const BLOCK = 'flex flex-col gap-3'

const LIST = 'flex flex-col gap-2'

const POINT = 'flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3'

const POINT_DONE = 'border-success/40'

const THEIRS = 'text-xs text-muted-foreground'

const UNDERSTOOD = 'text-sm text-foreground'

const ACTIONS = 'flex flex-wrap items-center gap-2'

const CONFIRMED = 'flex items-center gap-1.5 text-sm text-success-muted-foreground'

const CORRECTED = 'flex items-center gap-1.5 text-sm text-muted-foreground'

const TALLY = 'text-sm text-muted-foreground'

const ALL_DONE = 'flex items-center gap-1.5 text-sm font-medium text-foreground'

export interface RestatementsProps {
  restatements: Restatement[]
  /** One point at a time, without the lead sentence: the dock of the minimised chat. */
  compact?: boolean | undefined
  onAnswer: (id: string, answer: RestatementAnswer) => void
}

export function Restatements({
  restatements,
  compact = false,
  onAnswer,
}: RestatementsProps): ReactNode {
  const [answers, setAnswers] = useState<Partial<Record<string, RestatementAnswer>>>({})
  const confirmed = restatements.filter((one) => answers[one.id]?.ok === true).length
  const all = confirmed === restatements.length
  // Compact, one point at a time: the first one still unanswered.
  const next = restatements.find((one) => answers[one.id] === undefined)
  const shown = compact ? (next === undefined ? [] : [next]) : restatements

  const answer = (id: string, given: RestatementAnswer) => {
    setAnswers((before) => ({ ...before, [id]: given }))
    onAnswer(id, given)
  }

  return (
    <section aria-label="Your review, restated" className={BLOCK}>
      {!compact && (
        <p className="text-sm">
          {`I read your review as ${String(restatements.length)} points. Confirm each one, or tell me what it is; I go back to work once they are all confirmed.`}
        </p>
      )}
      <ol className={LIST}>
        {shown.map((one) => (
          <Point
            key={one.id}
            restatement={one}
            answer={answers[one.id]}
            onAnswer={(given) => answer(one.id, given)}
          />
        ))}
      </ol>
      <p role="status" className={all ? ALL_DONE : TALLY}>
        {all ? (
          <>
            <IconCircleCheck size="sm" className="text-success" aria-hidden="true" />
            All confirmed. The build goes back to work on them.
          </>
        ) : (
          `${String(confirmed)} of ${String(restatements.length)} confirmed`
        )}
      </p>
    </section>
  )
}

function Point({
  restatement,
  answer,
  onAnswer,
}: {
  restatement: Restatement
  answer: RestatementAnswer | undefined
  onAnswer: (answer: RestatementAnswer) => void
}): ReactNode {
  const named = useId()
  const [correcting, setCorrecting] = useState(false)
  const [correction, setCorrection] = useState('')
  const opening = useTransition(fold)
  const ok = answer?.ok === true
  return (
    <li aria-labelledby={named} className={cn(POINT, ok && POINT_DONE)}>
      <p className={THEIRS}>{`You wrote: « ${restatement.point} »`}</p>
      <p id={named} className={UNDERSTOOD}>
        <span className="font-medium">I understood: </span>
        {restatement.understood}
      </p>
      {restatement.changesSpec === true && (
        <p>
          <Badge tone="warning">This changes the Spec: rework?</Badge>
        </p>
      )}
      {ok ? (
        <p className={CONFIRMED}>
          <IconCircleCheck size="sm" aria-hidden="true" />
          {restatement.changesSpec === true ? 'Confirmed: the Spec is reworked first' : 'Confirmed'}
        </p>
      ) : answer?.ok === false ? (
        <p className={CORRECTED}>
          <IconPencil size="sm" aria-hidden="true" />
          {`You said: « ${answer.correction} ». The agent restates it.`}
        </p>
      ) : (
        <div className={ACTIONS}>
          <Button variant="primary" size="sm" onClick={() => onAnswer({ ok: true })}>
            OK
          </Button>
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={correcting}
            onClick={() => setCorrecting(!correcting)}
          >
            No, it is…
          </Button>
        </div>
      )}
      <AnimatePresence initial={false}>
        {correcting && answer === undefined && (
          <motion.div
            key="correct"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={opening}
          >
            <Input
              label="What it is"
              placeholder="Say it again, your way…"
              value={correction}
              onValueChange={setCorrection}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={correction.trim() === ''}
                  onClick={() => onAnswer({ ok: false, correction })}
                >
                  Send
                </Button>
              }
            />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}
