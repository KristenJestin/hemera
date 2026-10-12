import type { ReactNode } from 'react'

import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { IconCheck, IconEye, IconLink, IconMessages, IconTestPipe } from '../../icons.ts'
import { FreshnessLine } from './cold-read.tsx'
import { FindingLine } from './for-you.tsx'
import { DependenciesCard, VisionCard } from './planning-cards.tsx'
import type { PlanningData, PlanningHandlers, Question } from './planning-types.ts'
import { ProbeChip } from './probes.tsx'
import { QuestionCard } from './question-card.tsx'
import { Fold } from './rail-fold.tsx'
import { SendButton } from './sending.tsx'

export interface EverythingElseProps {
  data: PlanningData
  mentionables: readonly Mentionable[]
  handlers: PlanningHandlers
}

/** A question no longer asked: withdrawn, replaced by another, or made moot by a decision. */
const setAside = ({ state }: Question): boolean =>
  state === 'withdrawn' || state === 'replaced' || state === 'moot'

/**
 * What no longer waits, one quiet line each, every one folded: the questions answered (and how
 * many the Planner still takes in), the cold read's last pass — what it settled, or why it
 * stopped, and another pass to run —, the Probes that ended, the dependencies, and the vision,
 * which the user may give at any time.
 */
export function EverythingElse({ data, mentionables, handlers }: EverythingElseProps): ReactNode {
  const answered = data.questions.filter((question) => question.state === 'answered')
  const aside = data.questions.filter(setAside)
  const taking = answered.filter((question) => question.answers.at(-1)?.inputState !== 'integrated')
  const pass = data.passes.at(-1)
  const done = pass?.state === 'done' ? pass : undefined
  const settled = done?.findings.filter((finding) => finding.fate !== 'open') ?? []
  const ended = data.probes.filter(
    (probe) => probe.state !== 'running' && probe.state !== 'preparing',
  )
  const dependencies = data.dependencies.filter((dependency) => dependency.state !== 'rejected')
  const proposed = dependencies.filter((dependency) => dependency.state === 'proposed')
  return (
    <section aria-label="Everything else" className="flex flex-col">
      {answered.length + aside.length > 0 && (
        <Fold
          glyph={<IconCheck size="sm" />}
          title="Answered"
          detail={[
            String(answered.length),
            ...(taking.length > 0 ? [`${String(taking.length)} being taken into account`] : []),
            ...(aside.length > 0 ? [`${String(aside.length)} set aside`] : []),
          ].join(' · ')}
        >
          <ul aria-label="Answered questions" className="flex flex-col gap-1 pb-2">
            {[...answered, ...aside].map((question) => (
              <li key={question.id}>
                <QuestionCard
                  question={question}
                  discussed={data.discussions.some(
                    (discussion) =>
                      discussion.item.kind === 'question' && discussion.item.id === question.id,
                  )}
                  mentionables={mentionables}
                  onAnswer={handlers.onAnswer}
                  onWaitOnSomeone={handlers.onWaitOnSomeone}
                  onCopyDraft={handlers.onCopyDraft}
                  onAcceptProposed={handlers.onAcceptProposed}
                  onDismissProposed={handlers.onDismissProposed}
                  onDiscuss={handlers.onDiscuss}
                />
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {pass !== undefined && (pass.state === 'done' || pass.state === 'failed') && (
        <Fold
          glyph={<IconEye size="sm" />}
          title={`Cold read ${pass.label}`}
          detail={
            pass.state === 'failed'
              ? 'Stopped before its report'
              : pass.findings.length === 0
                ? 'Nothing found'
                : `${String(settled.length)} settled`
          }
        >
          <div className="flex flex-col pb-2">
            {pass.state === 'failed' && (
              <p className="px-4 py-2 pl-10 text-sm break-words text-destructive">
                The cold read failed: {pass.failure}
              </p>
            )}
            {pass.state === 'done' && <FreshnessLine freshness={data.freshness} />}
            {settled.length > 0 && (
              <ul aria-label="Settled findings" className="flex flex-col">
                {settled.map((finding) => (
                  <FindingLine key={finding.id} finding={finding} onDismiss={undefined} />
                ))}
              </ul>
            )}
            {!data.frozen && (
              <div className="px-4 pt-1 pl-10">
                <SendButton variant="link" size="sm" onSend={handlers.onRunColdRead}>
                  Run another cold read
                </SendButton>
              </div>
            )}
          </div>
        </Fold>
      )}
      {ended.length > 0 && (
        <Fold
          glyph={<IconTestPipe size="sm" />}
          title="Probes"
          detail={`${String(ended.length)} ended`}
        >
          <div className="flex flex-wrap gap-1.5 px-4 pb-2 pl-10">
            {ended.map((probe) => (
              <ProbeChip key={probe.id} probe={probe} onOpen={handlers.onOpenProbe} />
            ))}
          </div>
        </Fold>
      )}
      {dependencies.length > 0 && (
        <Fold
          glyph={<IconLink size="sm" />}
          title="Dependencies"
          detail={
            proposed.length > 0
              ? `${String(dependencies.length)} · ${String(proposed.length)} proposed`
              : String(dependencies.length)
          }
        >
          <div className="pb-2">
            <DependenciesCard
              dependencies={dependencies}
              frozen={data.frozen}
              onDecide={handlers.onDecideDependency}
            />
          </div>
        </Fold>
      )}
      {!data.frozen && (
        <Fold
          glyph={<IconMessages size="sm" />}
          title="Your vision"
          detail={
            data.visions.length === 0 ? 'At any time' : `${String(data.visions.length)} given`
          }
        >
          <div className="pb-2">
            <VisionCard
              visions={data.visions}
              mentionables={mentionables}
              onGive={handlers.onGiveVision}
            />
          </div>
        </Fold>
      )}
    </section>
  )
}
