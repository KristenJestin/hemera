import type { ReactNode } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { type Mark, type SpecQuestionView, answerText } from './model.ts'
import { PartHead } from './part-head.tsx'

/**
 * The questions of the Spec document: a register, and nothing to answer in (lot 19, brief
 * revision 2, "Questions are asked in the chat").
 *
 * A question is asked in the thread, where the conversation it belongs to is, and answered
 * there. The document keeps the record: each question, open or answered, the answer once there
 * is one, and for an open one the way back to where it is asked — `answer in the chat`, which
 * takes the thread to its block.
 */

const ITEM = 'flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-1'

const BODY = 'text-sm font-semibold'

const ANSWERED = 'text-sm font-medium text-muted-foreground'

const QUIET = 'text-sm text-muted-foreground'

const CHIPS = 'mt-1 flex flex-wrap items-center gap-1.5'

export interface QuestionsPartProps {
  questions: SpecQuestionView[]
  mark: Mark
  /** Takes the thread to where an open question is asked. */
  onGoToQuestion: (id: string) => void
}

export function QuestionsPart({ questions, mark, onGoToQuestion }: QuestionsPartProps): ReactNode {
  const open = questions.filter((question) => question.answer === null).length
  const answered = questions.length - open
  return (
    <div className="flex flex-col gap-1.5">
      <PartHead
        title={`Questions · ${open} open`}
        mark={mark}
        facts={answered > 0 ? [`${answered} answered`] : []}
      />
      {questions.length === 0 ? (
        <p className={QUIET}>No question: nothing is left for you to decide.</p>
      ) : (
        <ul aria-label="Questions">
          {questions.map((question) => {
            const answer = answerText(question)
            return (
              <li key={question.id} className={ITEM}>
                <p className={answer === null ? BODY : ANSWERED}>{question.body}</p>
                {answer !== null && <p className={QUIET}>{answer}</p>}
                <p className={CHIPS}>
                  {question.blocking && answer === null && <Badge tone="primary">blocking</Badge>}
                  <Badge>{question.phase}</Badge>
                  {(question.stories ?? []).map((key) => (
                    <Badge key={key}>{key}</Badge>
                  ))}
                  {answer === null && (
                    <Button
                      variant="link"
                      size="sm"
                      aria-label={`Answer in the chat: ${question.body}`}
                      onClick={() => onGoToQuestion(question.id)}
                    >
                      answer in the chat
                    </Button>
                  )}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
