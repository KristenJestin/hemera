import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { MentionField } from '../../components/mention-field/mention-field.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconAlertTriangle,
  IconHelpCircle,
  IconBolt,
  IconCheck,
  IconHandStop,
  IconLink,
} from '../../icons.ts'
import { STAGE_DOT } from '../mission/vocabulary.ts'
import { InputDot } from './planning-marks.tsx'
import type { Dependency, PlanningData, Triage, Vision } from './planning-types.ts'

const ROW = 'flex min-w-0 items-start gap-2 border-b border-border px-4 py-2.5 last:border-b-0'

const QUIET = 'text-xs text-muted-foreground'

const TRIAGE_TITLE: Record<Triage['kind'], string> = {
  existing_mission: 'Belongs elsewhere',
  delivered: 'Already delivered',
  too_small: 'Small enough without a mission',
}

/**
 * The Planner's triage answer: the request belongs to another mission, is already delivered, or is
 * too small for one. Keep planning goes on here; the other mission opens from its key.
 */
export function TriageCard({
  triage,
  onKeepPlanning,
  onOpenMission,
}: {
  triage: Triage
  onKeepPlanning: () => void
  onOpenMission: (key: string) => void
}): ReactNode {
  const { ref } = triage
  return (
    <section aria-label={TRIAGE_TITLE[triage.kind]}>
      <Frame
        header={
          <FrameHeader
            icon={
              <span className="flex text-warning">
                <IconHelpCircle size="md" />
              </span>
            }
            title={TRIAGE_TITLE[triage.kind]}
          />
        }
      >
        <div className="flex flex-col gap-3 px-4 py-3">
          <p className="text-sm break-words">{triage.text}</p>
          {triage.basedOnProposed && (
            <p className={QUIET}>It rests on a requirement of the living spec still proposed.</p>
          )}
          <div className="flex flex-wrap gap-1">
            <Button variant="secondary" size="sm" onClick={onKeepPlanning}>
              Keep planning
            </Button>
            {ref !== null && (
              <Button variant="ghost" size="sm" onClick={() => onOpenMission(ref)}>
                Open {ref}
              </Button>
            )}
          </div>
        </div>
      </Frame>
    </section>
  )
}

/** What changed on the mission's ticket: each change, its difference, its state as a dot, Seen. */
export function TicketCard({
  ticket,
  onSeen,
}: {
  ticket: NonNullable<PlanningData['ticket']>
  onSeen: (id: string) => void
}): ReactNode {
  if (ticket.changes.length === 0) return null
  return (
    <section aria-label={`${ticket.key} changed`}>
      <Frame
        header={
          <FrameHeader
            icon={
              <span className="flex text-warning">
                <IconAlertTriangle size="md" />
              </span>
            }
            title={`${ticket.key} changed`}
          />
        }
      >
        <ul aria-label="Ticket changes" className="flex flex-col">
          {ticket.changes.map((change) => (
            <li key={change.id} className={ROW}>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1 truncate">{change.what}</span>
                  <span className="shrink-0">{change.at}</span>
                </p>
                <div className="flex flex-col text-sm break-words">
                  {change.difference.split('\n').map((line, index) =>
                    line.startsWith('- ') ? (
                      <del key={`${String(index)}${line}`} className="text-muted-foreground">
                        {line.slice(2)}
                      </del>
                    ) : (
                      <ins key={`${String(index)}${line}`} className="no-underline">
                        {line.startsWith('+ ') ? line.slice(2) : line}
                      </ins>
                    ),
                  )}
                </div>
              </div>
              <span className="flex pt-1">
                <InputDot state={change.inputState} />
              </span>
              <Button variant="ghost" size="sm" onClick={() => onSeen(change.id)}>
                Seen
              </Button>
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  )
}

/**
 * The dependencies the Planner proposed and those accepted, which only the user accepts or
 * rejects; a rejected one is not drawn. Frozen, they stay readable without their buttons.
 */
export function DependenciesCard({
  dependencies,
  frozen,
  onDecide,
}: {
  dependencies: readonly Dependency[]
  frozen: boolean
  onDecide: (id: string, accept: boolean) => void
}): ReactNode {
  const shown = dependencies.filter((dependency) => dependency.state !== 'rejected')
  if (shown.length === 0) return null
  return (
    <section aria-label="Dependencies">
      <Frame header={<FrameHeader icon={<IconLink size="md" />} title="Dependencies" />}>
        <ul aria-label="Dependency list" className="flex flex-col">
          {shown.map((dependency) => (
            <li key={dependency.id} className={ROW}>
              <span className="flex pt-1.5">
                <span aria-hidden="true" className={STAGE_DOT[dependency.dependsOnStage]} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
                <p className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-xs">{dependency.dependsOnKey}</span>
                  {dependency.dependsOnTitle !== null && (
                    <span className="truncate">{dependency.dependsOnTitle}</span>
                  )}
                </p>
                <p className="text-xs break-words text-muted-foreground">{dependency.reason}</p>
              </div>
              {dependency.state === 'proposed' && !frozen ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Accept the dependency on ${dependency.dependsOnKey}`}
                    onClick={() => onDecide(dependency.id, true)}
                  >
                    Accept
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Reject the dependency on ${dependency.dependsOnKey}`}
                    onClick={() => onDecide(dependency.id, false)}
                  >
                    Reject
                  </Button>
                </div>
              ) : dependency.state === 'accepted' ? (
                <Legend label="Accepted">
                  <span aria-hidden="true" className="flex pt-0.5 text-success">
                    <IconCheck size="sm" />
                  </span>
                </Legend>
              ) : null}
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  )
}

/** The user's vision, given at any time: what was given with its dot, and the field. */
export function VisionCard({
  visions,
  mentionables,
  onGive,
}: {
  visions: readonly Vision[]
  mentionables: readonly Mentionable[]
  onGive: (text: string) => void
}): ReactNode {
  const [text, setText] = useState('')
  return (
    <section aria-label="Your vision">
      <Frame header={<FrameHeader icon={<IconBolt size="md" />} title="Your vision" />}>
        <div className="flex min-w-0 flex-col gap-3 px-3 py-3">
          {visions.length > 0 && (
            <ul aria-label="Your vision so far" className="flex flex-col gap-2">
              {visions.map((vision) => (
                <li key={vision.id} className="flex min-w-0 items-start gap-2 text-sm">
                  <span className="flex pt-0.5">
                    <InputDot state={vision.inputState} />
                  </span>
                  <span className="min-w-0 flex-1 break-words">{vision.text}</span>
                  <span className={QUIET}>{vision.at}</span>
                </li>
              ))}
            </ul>
          )}
          <MentionField
            label="Your vision"
            placeholder="What you see for it, at any time…"
            value={text}
            onValueChange={(value) => setText(value)}
            mentionables={mentionables}
            onSubmit={() => {
              const said = text.trim()
              if (said === '') return
              onGive(said)
              setText('')
            }}
          />
        </div>
      </Frame>
    </section>
  )
}

/** Freeze pressed and refused: every reason in words, each naming what blocks it. */
export function FreezeRefusal({ reasons }: { reasons: readonly string[] }): ReactNode {
  return (
    <section aria-label="Freeze refused">
      <Frame
        header={
          <FrameHeader
            icon={
              <span className="flex text-warning">
                <IconHandStop size="md" />
              </span>
            }
            title="Not frozen"
          />
        }
      >
        <ul aria-label="Why Freeze was refused" className="flex flex-col">
          {reasons.map((reason) => (
            <li key={reason} className={ROW}>
              <span className="flex pt-0.5">
                <StatusMark state="waiting" size="sm" />
              </span>
              <span className="text-sm break-words">{reason}</span>
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  )
}
