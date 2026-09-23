import { type ReactNode, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { type SpecAnswer, type SpecQuestionView, answerText } from './model.ts'

/**
 * A question of the Spec, asked in the thread (lot 19, brief revision 2, "Questions are asked in
 * the chat").
 *
 * Drawn the way a permission request is — a card the turn is waiting on — because it is the same
 * situation: the agent has stopped and the next move is the reader's. The question, its
 * `blocking` chip and its phase; the answers the agent offers as a list, one of them marked
 * `recommended` as `shape` is asked to; and a field of the reader's own, `Something else…`, for
 * the answer nobody offered. An option is answered by pressing it; the field by `Answer`.
 *
 * Once answered, the card folds to a line with the answer in muted text. A turn stopped before it
 * was answered folds it too, and says so: the question stays open in the Spec's register.
 */

const CARD = 'flex flex-col gap-2.5 rounded-lg border border-primary bg-primary-muted p-3'

const HEAD = 'flex flex-wrap items-center gap-1.5'

const BODY = 'text-sm font-semibold text-foreground'

const OPTIONS = 'flex flex-col gap-1'

const OPTION =
  'flex w-full items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-left text-sm outline-none focus-ring hover:border-primary'

const FOLDED = 'flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm'

const QUIET = 'text-muted-foreground'

/** The reader's own answer: a field on the card's surface, the ring on the box around it. */
const OWN_BOX = 'flex min-w-0 flex-1 rounded-md focus-ring'

const OWN =
  'h-control-sm w-full rounded-md border border-input bg-card px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground'

export interface SpecQuestionProps {
  question: SpecQuestionView
  /** The turn was stopped before it was answered. */
  cancelled?: boolean | undefined
  /** The answer: an option pressed, or the reader's own words. */
  onAnswer: (answer: SpecAnswer) => void
}

export function SpecQuestion({
  question,
  cancelled = false,
  onAnswer,
}: SpecQuestionProps): ReactNode {
  const [own, setOwn] = useState('')
  const answer = answerText(question)
  if (answer !== null || cancelled) {
    return (
      <div role="group" aria-label={`Question: ${question.body}`} className={FOLDED}>
        <span className="font-medium text-foreground">{question.body}</span>
        <span className={QUIET}>
          {answer ?? 'Not answered · the turn was stopped; it stays open in the Spec'}
        </span>
      </div>
    )
  }
  const said = own.trim()
  return (
    <div role="group" aria-label={`Question: ${question.body}`} className={CARD}>
      <p className={HEAD}>
        {question.blocking && <Badge tone="primary">blocking</Badge>}
        <Badge>{question.phase}</Badge>
      </p>
      <p className={BODY}>{question.body}</p>
      <ul aria-label="Answers" className={OPTIONS}>
        {question.options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              className={OPTION}
              onClick={() => onAnswer({ optionId: option.id })}
            >
              <span className="min-w-0 flex-1">{option.label}</span>
              {option.recommended === true && <Badge tone="success">recommended</Badge>}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <span className={OWN_BOX}>
          <input
            aria-label="Something else"
            className={OWN}
            placeholder="Something else…"
            value={own}
            onChange={(event) => setOwn(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || said === '') return
              event.preventDefault()
              onAnswer({ text: said })
            }}
          />
        </span>
        <Button
          variant="primary"
          size="sm"
          // Pressable once there are words: an answer of nothing is not an answer.
          disabled={said === ''}
          onClick={() => onAnswer({ text: said })}
        >
          Answer
        </Button>
      </div>
    </div>
  )
}
