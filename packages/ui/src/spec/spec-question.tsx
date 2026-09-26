import { type ReactNode, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { AgentText } from '../message/agent-text.tsx'
import { type SpecAnswer, type SpecQuestionView, answerText } from './model.ts'

/**
 * A question of the Spec, asked in the thread (lot 19, brief revision 2, "Questions are asked in
 * the chat").
 *
 * Drawn the way a permission request is — a card the turn is waiting on — because it is the same
 * situation: the agent has stopped and the next move is the reader's. The question, its
 * `blocking` chip and its phase; the answers the agent offers as a list, one of them marked
 * `recommended`; and a last choice of the reader's own, `Other`, with its field, for the answer
 * nobody offered. An option is answered by pressing it; the field by `Answer`.
 *
 * The choices are Hemera's to label (recette of 26 September 2026, issue #134): each is lettered
 * A, B, C… in the order the agent gave them, the recommended one wears its badge, and `Other` is
 * always the last one, whatever the agent offered. The agent writes the choices and nothing
 * around them; a letter, a "(recommended)" or an "other" of its own would be said twice.
 *
 * The question is Markdown, as everything the agent writes is, and reads as the thread reads it
 * (issue #134).
 *
 * Once answered, the card folds to the question with the answer in muted text under it. A turn
 * stopped before it was answered folds it too, and says so: the question stays open in the Spec's
 * register.
 */

const CARD = 'flex flex-col gap-2.5 rounded-lg border border-primary bg-primary-muted p-3'

const HEAD = 'flex flex-wrap items-center gap-1.5'

/**
 * The question as the agent wrote it, in Markdown, drawn as the thread draws what the agent says
 * (issue #134): bold, code and lists read as bold, code and lists rather than as their marks.
 */
const BODY = 'font-medium text-foreground'

const OPTIONS = 'flex flex-col gap-1'

const OPTION =
  'flex w-full items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-left text-sm outline-none focus-ring hover:border-primary'

/** A choice's letter, which is Hemera's and not the agent's: A, B, C… and the next for `Other`. */
const LETTER =
  'flex size-5 shrink-0 items-center justify-center rounded-sm border border-border font-mono text-xs text-muted-foreground'

/** `Other`: the last choice, drawn as one, with the reader's field and its `Answer` in it. */
const OTHER =
  'flex w-full items-center gap-2 rounded-md border border-input bg-card py-1 pr-1 pl-3 text-sm'

const FOLDED = 'flex flex-col gap-1'

const ASKED = 'text-foreground'

const QUIET = 'text-sm text-muted-foreground'

/** The reader's own answer: a field on the choice's surface, the ring on the box around it. */
const OWN_BOX = 'flex min-w-0 flex-1 rounded-md focus-ring'

const OWN =
  'h-control-sm w-full bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground'

/** The letter of the choice at `index`: A for the first. */
function letterOf(index: number): string {
  return String.fromCodePoint(65 + index)
}

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
        <div className={ASKED}>
          <AgentText text={question.body} />
        </div>
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
      <div className={BODY}>
        <AgentText text={question.body} />
      </div>
      <ul aria-label="Answers" className={OPTIONS}>
        {question.options.map((option, index) => (
          <li key={option.id}>
            <button
              type="button"
              className={OPTION}
              onClick={() => onAnswer({ optionId: option.id })}
            >
              <span className={LETTER}>{letterOf(index)}</span>
              <span className="min-w-0 flex-1">{option.label}</span>
              {option.recommended === true && <Badge tone="success">recommended</Badge>}
            </button>
          </li>
        ))}
        {/* Always there, always last: the answer nobody offered is the reader's to give. */}
        <li className={OTHER}>
          <span className={LETTER}>{letterOf(question.options.length)}</span>
          <span className={OWN_BOX}>
            <input
              aria-label="Other"
              className={OWN}
              placeholder="Other: your own answer…"
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
        </li>
      </ul>
    </div>
  )
}
