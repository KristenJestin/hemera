import { type ReactNode, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { InPlaceText } from './in-place-text.tsx'
import type { QuestionView } from './model.ts'
import { StageHead } from './stage-head.tsx'

/**
 * The questions of a Spec on the stage (lot 19, brief "Stage").
 *
 * Each is asked the way `shape` asks it: one question, the agent's recommendation with it, the
 * phase it belongs to and `blocking` when it stops the Spec from being ready. The answer field
 * is not drawn until it is asked for — a column of empty boxes reads as a form to fill — and
 * the answer is handed over when the caret leaves it, to reach the agent with its next turn.
 * An answered question stays in the list, quieter, with who answered it.
 */

const ITEM = 'flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-0.5'

const BODY = 'text-sm font-semibold'

const ANSWERED = 'text-sm font-medium text-muted-foreground'

const QUIET = 'text-sm text-muted-foreground'

const CHIPS = 'mt-1 flex flex-wrap gap-1.5'

export interface QuestionsStageProps {
  questions: QuestionView[]
  /** Whether a question can be answered here: a draft, at its current revision. */
  editable: boolean
  /** An answer, once, when the caret leaves its field with something in it. */
  onAnswer: (id: string, answer: string) => void
}

export function QuestionsStage({ questions, editable, onAnswer }: QuestionsStageProps): ReactNode {
  const open = questions.filter((question) => question.answer === undefined).length
  const answered = questions.length - open
  return (
    <div className="flex flex-col gap-2">
      <StageHead title="Questions" facts={[`${open} open`, `${answered} answered`]} />
      {questions.length === 0 ? (
        <p className={QUIET}>No question: nothing is left for you to decide.</p>
      ) : (
        <ul aria-label="Questions">
          {questions.map((question) => (
            <Question
              key={question.id}
              question={question}
              editable={editable}
              onAnswer={(answer) => onAnswer(question.id, answer)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Question({
  question,
  editable,
  onAnswer,
}: {
  question: QuestionView
  editable: boolean
  onAnswer: (answer: string) => void
}): ReactNode {
  const [answering, setAnswering] = useState(false)
  const answer = question.answer
  return (
    <li className={ITEM}>
      <p className={answer === undefined ? BODY : ANSWERED}>{question.body}</p>
      {answer !== undefined ? (
        <p className={QUIET}>{`${answer.text} · ${answer.by}`}</p>
      ) : (
        question.recommendation !== undefined && (
          <p className={QUIET}>{`Recommended by the agent: ${question.recommendation}`}</p>
        )
      )}
      <p className={CHIPS}>
        {question.blocking && answer === undefined && <Badge tone="primary">blocking</Badge>}
        <Badge>{question.phase}</Badge>
        {(question.stories ?? []).map((key) => (
          <Badge key={key}>{key}</Badge>
        ))}
      </p>
      {answer === undefined &&
        editable &&
        (answering ? (
          <InPlaceText
            label={`Answer to: ${question.body}`}
            value=""
            rows={2}
            autoFocus
            placeholder="Your answer goes to the agent on its next turn"
            onCommit={(text) => {
              const said = text.trim()
              if (said !== '') onAnswer(said)
              else setAnswering(false)
            }}
          />
        ) : (
          <span className="mt-1 flex">
            <Button variant="link" size="sm" onClick={() => setAnswering(true)}>
              Answer…
            </Button>
          </span>
        ))}
    </li>
  )
}
