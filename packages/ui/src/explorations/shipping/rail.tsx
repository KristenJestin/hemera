import { type ReactNode, useState } from 'react'

import { StageCard } from '../../blocks/mission/stage-card.tsx'
import { Button } from '../../components/button/button.tsx'
import { Textarea } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { LetterAvatar } from '../../components/letter-avatar/letter-avatar.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { IconBug, IconGitCompare, IconPlus, IconX } from '../../icons.ts'
import {
  CODE,
  Calls,
  Chevron,
  LINE,
  MONO,
  PROSE,
  QUIET,
  ROW,
  Unfolding,
} from '../../surfaces/review/review-parts.tsx'
import type { Fix, ShippingMoment, TeamComment } from './types.ts'

/**
 * The Shipping page's rail, top to bottom as on every stage: what happens (the stage card, and
 * the fix of a CI broken after the merge while there is one), then what waits for the user here
 * (For you: the fix to accept, the team's comments). The needs of the delivery — a click, a manual
 * step, an approval, a forge's CLI — stand above the page, in the frame's own list.
 */

export interface RailHandlers {
  onAcceptFix: () => void
  onRefuseFix: (why: string) => void
  onOpenFixRound: () => void
  onStartMission: (comment: string) => void
  onDismissComment: (comment: string) => void
}

/** The stage card, the same as every stage's. */
export function ShippingCard({
  moment,
  loading,
}: {
  moment: ShippingMoment
  loading: boolean
}): ReactNode {
  return (
    <StageCard
      stage="Shipping"
      face={loading ? 'loading' : moment.face}
      line={loading ? 'Reading where the delivery stands' : moment.now}
      progress={loading ? { step: 'Shipping', detail: 'reading the waves' } : moment.progress}
    />
  )
}

/**
 * The fix of a CI broken after the merge: a round of its own (its number follows the mission's
 * rounds), its steps one line each; once proven, its diff and the user's acceptance; then its pull
 * request. Once merged, one quiet line.
 */
export function FixCard({ fix, handlers }: { fix: Fix; handlers: RailHandlers }): ReactNode {
  const [refusing, setRefusing] = useState(false)
  const [why, setWhy] = useState('')
  const title = `Fix · round ${String(fix.round)} · ${fix.repository}`
  const merged = fix.steps.length === 0
  const toAccept = fix.steps.some(
    (one) => one.name === 'Your acceptance' && one.state === 'waiting',
  )
  if (merged) {
    return (
      <section aria-label={title}>
        <Frame>
          <div className={ROW}>
            <StatusMark state="done" size="sm" legend />
            <span className="shrink-0 font-medium">{title}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {fix.pull === undefined ? '' : `#${String(fix.pull.number)} ${fix.pull.words}`}
            </span>
          </div>
        </Frame>
      </section>
    )
  }
  return (
    <section aria-label={title}>
      <Frame>
        <div className="flex flex-col py-1">
          <button type="button" className={LINE} onClick={handlers.onOpenFixRound}>
            <span aria-hidden="true" className="flex shrink-0 text-build">
              <IconBug size="sm" />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
            <span className={QUIET}>Open the round</span>
          </button>
          <ol aria-label="Steps of the fix" className="flex flex-col">
            {fix.steps.map((one) => (
              <li key={one.name} className={ROW}>
                <StatusMark state={one.state} size="sm" legend />
                <span className="shrink-0">{one.name}</span>
                {one.detail !== undefined && (
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {one.detail}
                  </span>
                )}
              </li>
            ))}
          </ol>
          {toAccept && fix.diff !== undefined && (
            <div className="flex flex-col gap-2 px-4 pt-1 pb-3">
              <pre className={CODE} aria-label="The fix’s diff">
                <code>{fix.diff}</code>
              </pre>
              {refusing ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (why.trim() !== '') handlers.onRefuseFix(why.trim())
                  }}
                >
                  <Textarea
                    label="What is wrong with the fix"
                    rows={2}
                    value={why}
                    onValueChange={setWhy}
                  />
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" size="sm">
                      Send back
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRefusing(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={handlers.onAcceptFix}>
                    Accept the fix
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setRefusing(true)}>
                    Send it back
                  </Button>
                </div>
              )}
            </div>
          )}
          {fix.pull !== undefined && (
            <div className={ROW}>
              <StatusMark state={fix.pull.state} size="sm" legend />
              <IconGitCompare size="sm" aria-hidden="true" />
              <span className="shrink-0">{`${fix.repository} #${String(fix.pull.number)}`}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {fix.pull.words}
              </span>
            </div>
          )}
        </div>
      </Frame>
    </section>
  )
}

/** A team comment written while the mission ships: what it says, and a mission of its own. */
function CommentLine({
  comment,
  names,
  handlers,
}: {
  comment: TeamComment
  names: readonly string[]
  handlers: RailHandlers
}): ReactNode {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex flex-col">
      <button type="button" aria-expanded={open} className={LINE} onClick={() => setOpen(!open)}>
        <Chevron open={open} />
        <LetterAvatar name={comment.author} others={names} />
        <span className="shrink-0 font-medium">{comment.author}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{comment.text}</span>
        <Calls />
      </button>
      <Unfolding open={open}>
        <div className="flex flex-col gap-3 pr-4 pb-3 pl-10">
          <span className={MONO}>{`${comment.anchor} · ${comment.when}`}</span>
          <p className={PROSE}>{comment.text}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              aria-label={`Start a mission from ${comment.id}`}
              onClick={() => handlers.onStartMission(comment.id)}
            >
              <IconPlus size="sm" />
              Start a mission from this
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Dismiss ${comment.id}`}
              onClick={() => handlers.onDismissComment(comment.id)}
            >
              <IconX size="sm" />
              Dismiss
            </Button>
          </div>
        </div>
      </Unfolding>
    </li>
  )
}

/** What waits for the user on this page: the team's comments. Hidden when nothing waits. */
export function ForYou({
  team,
  handlers,
}: {
  team: readonly TeamComment[]
  handlers: RailHandlers
}): ReactNode {
  if (team.length === 0) return null
  const names = team.map((one) => one.author)
  return (
    <section aria-label="For you" className="flex flex-col gap-1.5">
      <h2 className="px-1 text-xs font-medium text-muted-foreground">For you</h2>
      <Frame>
        <ul aria-label="Team comments" className="flex flex-col py-1">
          {team.map((one) => (
            <CommentLine key={one.id} comment={one} names={names} handlers={handlers} />
          ))}
        </ul>
      </Frame>
    </section>
  )
}
