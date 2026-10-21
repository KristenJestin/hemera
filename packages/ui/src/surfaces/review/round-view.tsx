import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { QuestionCard } from '../../blocks/planning/question-card.tsx'
import { Button } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { IconCheck, IconChevronRight, IconListNumbers, IconPlus } from '../../icons.ts'
import { Chevron, Fold, ID, LINE, MARKED, PROSE, QUIET, Unfolding } from './review-parts.tsx'
import type { RailHandlers } from './review-rail.tsx'
import type { Round, RoundPoint } from './review-types.ts'

/**
 * A round, as a view over the Review page: a small Spec. Where it stands on one line — its
 * questions, Building · round N (a press away), back, closed — then its questions by waves, the
 * answered ones folded, and its points, written like requirements: each one line with the ids it
 * came from, unfolded to what it asks, its scenario, its decision.
 *
 * A point that goes against the Spec says so under its line and offers its three ways out: clarify
 * with a note, withdraw the remark, or cancel the point. A point that adds what the Spec never
 * asked for offers to start a mission of its own instead. Once the round is closed, nothing is
 * offered: it is read, the way it ended.
 */

export type PointAction = 'clarify' | 'withdraw' | 'cancel' | 'mission'

const KIND: Record<RoundPoint['kind'], string> = { fix: 'Fix', behaviour: 'Behaviour change' }

const OUTCOME: Record<'clarified' | 'withdrawn' | 'cancelled', string> = {
  clarified: 'Clarified',
  withdrawn: 'Remark withdrawn',
  cancelled: 'Point cancelled',
}

/** A point against the Spec: why, then its three ways out, or the one taken. */
function Conflict({
  point,
  onPoint,
}: {
  point: RoundPoint
  onPoint: (id: string, action: PointAction, note: string) => void
}): ReactNode {
  const [clarifying, setClarifying] = useState(false)
  const [note, setNote] = useState('')
  const conflict = point.conflict
  if (conflict === undefined) return null
  if (conflict.outcome !== undefined) {
    return (
      <p className="pr-4 pb-2 pl-10 text-xs text-muted-foreground">
        {`${OUTCOME[conflict.outcome]}${conflict.note === undefined ? '' : `: ${conflict.note}`}`}
      </p>
    )
  }
  return (
    <div className="mx-4 mb-2 ml-10 flex flex-col gap-2 rounded-md border border-border bg-warning-muted px-3 py-2">
      <p className="max-w-measure text-sm break-words text-warning-muted-foreground">
        {conflict.why}
      </p>
      {clarifying ? (
        <Input
          label={`The note on ${point.id}`}
          size="sm"
          value={note}
          onValueChange={setNote}
          placeholder="What the point means, against the Spec"
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || note.trim() === '') return
            event.preventDefault()
            onPoint(point.id, 'clarify', note.trim())
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setClarifying(true)}>
            Clarify with a note
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onPoint(point.id, 'withdraw', '')}>
            Withdraw the remark
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onPoint(point.id, 'cancel', '')}>
            Cancel the point
          </Button>
        </div>
      )}
    </div>
  )
}

/** A point on one line — its mark, its id, its title, its kind, its sources — and what it asks. */
function PointLine({
  point,
  closed,
  onPoint,
}: {
  point: RoundPoint
  closed: boolean
  onPoint: (id: string, action: PointAction, note: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex flex-col border-b border-border last:border-b-0">
      <div className={MARKED}>
        <StatusMark state={point.state} size="sm" legend />
        <button
          type="button"
          aria-expanded={open}
          className={cn(LINE, 'pl-2 hover:shadow-none')}
          onClick={() => setOpen(!open)}
        >
          <span className={ID}>{point.id}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{point.title}</span>
          <span className={QUIET}>{KIND[point.kind]}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">
            {point.sources.join(' · ')}
          </span>
          <Chevron open={open} />
        </button>
      </div>
      <Unfolding open={open}>
        <div className="flex flex-col gap-1.5 pr-4 pb-3 pl-10">
          <p className={PROSE}>{point.detail}</p>
          {point.scenario !== undefined && (
            <p className="text-sm text-muted-foreground">{`Scenario · ${point.scenario}`}</p>
          )}
          {point.decision !== undefined && (
            <p className="text-sm text-muted-foreground">{`Decision · ${point.decision}`}</p>
          )}
        </div>
      </Unfolding>
      {!closed && <Conflict point={point} onPoint={onPoint} />}
      {point.newMission !== undefined && !closed && (
        <div className="flex min-w-0 flex-wrap items-center gap-2 pr-4 pb-2 pl-10">
          <span className="min-w-0 text-sm text-muted-foreground">
            {`The Spec never asks for it: “${point.newMission}” can be a mission of its own.`}
          </span>
          <Button variant="secondary" size="sm" onClick={() => onPoint(point.id, 'mission', '')}>
            <IconPlus size="sm" />
            Start a mission from this
          </Button>
        </div>
      )}
    </li>
  )
}

/** Where the round stands, on one line; while it builds, the way to the Building page. */
function Where({ round, onOpenBuilding }: { round: Round; onOpenBuilding: () => void }): ReactNode {
  if (round.state === 'building') {
    return (
      <button
        type="button"
        className="flex min-h-control-md w-full items-center gap-2 rounded-md border border-border px-3 text-left text-sm outline-none hover:tinted focus-ring hover-motion"
        onClick={onOpenBuilding}
      >
        <StatusMark state="running" size="sm" />
        <span className="font-medium">{`Building · round ${String(round.n)}`}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{round.building}</span>
        <IconChevronRight size="sm" />
      </button>
    )
  }
  const words =
    round.state === 'grilling'
      ? `Questions before it starts · sent ${round.sentAt}`
      : `${round.state === 'closed' ? 'Closed' : 'Back'} · sent ${round.sentAt} · back ${round.backAt ?? ''}`
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      {round.state === 'closed' && <IconCheck size="sm" />}
      {words}
    </p>
  )
}

export interface RoundViewProps {
  round: Round
  question: RailHandlers['question']
  onPoint: (id: string, action: PointAction, note: string) => void
  onOpenBuilding: () => void
}

export function RoundView({ round, question, onPoint, onOpenBuilding }: RoundViewProps): ReactNode {
  const closed = round.state === 'closed'
  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      <Where round={round} onOpenBuilding={onOpenBuilding} />
      {round.waves.length > 0 && (
        <section aria-label="Questions" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Questions</h3>
          <Frame>
            <div className="flex flex-col py-1">
              {round.waves.map((wave) => {
                const left = wave.questions.filter((one) => one.state === 'open')
                const answered = left.length === 0
                return (
                  <Fold
                    key={wave.n}
                    glyph={<IconListNumbers size="sm" />}
                    title={`Wave ${String(wave.n)}`}
                    detail={answered ? 'answered' : `${String(left.length)} to answer`}
                    calls={!answered}
                    initiallyOpen={!answered}
                  >
                    <div className="flex flex-col gap-3 px-4 pb-3">
                      {wave.questions.map((one) => (
                        <QuestionCard
                          key={one.id}
                          question={one}
                          discussed={false}
                          mentionables={[]}
                          {...question}
                        />
                      ))}
                    </div>
                  </Fold>
                )
              })}
            </div>
          </Frame>
        </section>
      )}
      <section aria-label="Points" className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Points</h3>
        {round.points.length === 0 ? (
          <p className="text-sm text-muted-foreground">Written once the questions are answered.</p>
        ) : (
          <Frame>
            <ul aria-label="Points" className="flex flex-col">
              {round.points.map((point) => (
                <PointLine key={point.id} point={point} closed={closed} onPoint={onPoint} />
              ))}
            </ul>
          </Frame>
        )}
      </section>
    </div>
  )
}
