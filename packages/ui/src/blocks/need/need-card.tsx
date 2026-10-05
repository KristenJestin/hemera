import { cn } from 'cn'
import { type ReactNode, useId, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Frame, FrameFooter } from '../../components/frame/frame.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconAlertTriangle,
  IconCheck,
  IconClockPause,
  IconHelpCircle,
  IconPlug,
  IconShieldLock,
} from '../../icons.ts'

/**
 * A need: what blocks and waits for the user, the same card wherever it is met — Home's Needs you,
 * the top of a mission, behind a notification.
 *
 * Its band says whose it is: the kind's glyph and "Needs you", then the mission (a link, left out
 * on the mission's own page), when, and the role that raised it. The body is the title and the
 * agent's own words, then what that kind asks: the call and the two reasons of a permission, the
 * options of a decision, the attempts of an error, the action of what is missing. The actions are
 * the band below. What cannot be chosen is not drawn: Allow for this mission is not there on a
 * sensitive place or outside a mission, Discuss only while the mission is in Planning.
 *
 * Once answered or expired, the card is one faint line: the glyph, Applied or Expired, the title,
 * and the answer or the reason.
 */
export type NeedKind = 'permission' | 'decision' | 'error' | 'environment'

/** What each kind is, in words: the legend of its glyph. */
export const NEED_KINDS: Record<NeedKind, string> = {
  permission: 'Permission',
  decision: 'Decision',
  error: 'Error',
  environment: 'Something missing',
}

const GLYPHS: Record<NeedKind, typeof IconHelpCircle> = {
  permission: IconShieldLock,
  decision: IconHelpCircle,
  error: IconAlertTriangle,
  environment: IconPlug,
}

export type PermissionChoice = 'allow-once' | 'allow-for-mission' | 'deny'

export interface DecisionOption {
  label: string
  /** The option the agent recommends, with its reason. */
  recommended?: string | undefined
}

export interface Attempt {
  what: string
  output: string
}

/** What the kind asks, each with its own fields. */
export type NeedAsk =
  | {
      kind: 'permission'
      command: string
      agentReason: string
      hemeraReason: string
      /** The choices offered: Allow for this mission only on an ordinary place of a mission. */
      choices: readonly PermissionChoice[]
    }
  | { kind: 'decision'; options: readonly DecisionOption[] }
  | { kind: 'error'; attempts: readonly Attempt[]; proposed: string }
  | {
      kind: 'environment'
      /** Its action, Retry unless the need names another. */
      action?: string | undefined
      /** The settings section it points at, by its name. */
      settings?: string | undefined
    }

/** How the need stands: still waiting, or settled with what settled it. */
export type NeedState =
  | { state: 'waiting' }
  | { state: 'applied'; answer: string }
  | { state: 'expired'; reason: string }

export interface NeedCardProps {
  ask: NeedAsk
  title: string
  /** What the agent wrote about it, as it wrote it. */
  text?: string | undefined
  /** The mission it belongs to; left out outside a mission and on the mission's own page. */
  missionKey?: string | undefined
  /** When it was raised, as the card says it: `4 min`, `yesterday`. */
  when: string
  /** The role that raised it; left out when Hemera did. */
  role?: string | undefined
  status?: NeedState | undefined
  /** Whether the mission is in Planning: only then can a need be discussed. */
  planning?: boolean | undefined
  onOpenMission?: (() => void) | undefined
  onPermission?: ((choice: PermissionChoice) => void) | undefined
  onChoose?: ((option: string) => void) | undefined
  onWrite?: ((answer: string) => void) | undefined
  onApply?: (() => void) | undefined
  onLook?: (() => void) | undefined
  onRetry?: (() => void) | undefined
  onSettings?: (() => void) | undefined
  onDiscuss?: (() => void) | undefined
}

const META =
  'flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm font-normal text-muted-foreground'
const KEY = 'font-mono text-xs'
const BODY = 'flex flex-col gap-3 px-4 py-3'
const TITLE = 'text-base font-semibold text-foreground'
const PROSE = 'max-w-prose text-sm text-foreground whitespace-pre-line'
const LABEL = 'text-xs font-medium text-muted-foreground'
// A command or an output wraps rather than scrolls: a scrolled block is a stop the keyboard must make.
const CODE =
  'rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm whitespace-pre-wrap break-words'
const FAINT =
  'flex h-control-md min-w-0 items-center gap-2 rounded-lg border border-border px-3 text-sm text-muted-foreground'

/** The kind's glyph, drawn alone: a list row puts its own legend on it. */
export function NeedGlyphShape({ kind }: { kind: NeedKind }): ReactNode {
  const Shape = GLYPHS[kind]
  return <Shape size="md" aria-hidden="true" />
}

/** The kind's glyph with its legend. */
export function NeedGlyph({ kind }: { kind: NeedKind }): ReactNode {
  return (
    <Legend label={NEED_KINDS[kind]}>
      <span className="inline-flex text-primary-muted-foreground" data-need-kind={kind}>
        <NeedGlyphShape kind={kind} />
      </span>
    </Legend>
  )
}

/** A labelled stretch of the body: a short label above what it names. */
function Part({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  )
}

function Header({
  kind,
  missionKey,
  when,
  role,
  onOpenMission,
}: Pick<NeedCardProps, 'missionKey' | 'when' | 'role' | 'onOpenMission'> & {
  kind: NeedKind
}): ReactNode {
  const parts: ReactNode[] = []
  if (missionKey !== undefined) {
    parts.push(
      <Button key="key" variant="link" className={KEY} onClick={onOpenMission}>
        {missionKey}
      </Button>,
    )
  }
  parts.push(<span key="when">{when}</span>)
  if (role !== undefined) parts.push(<span key="role">{role}</span>)
  return (
    <div className="flex items-start gap-2 px-2.5 pt-2 pb-2.5">
      <span className="flex pt-0.5">
        <NeedGlyph kind={kind} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-base font-semibold">Needs you</h2>
        <p className={META}>
          {parts.map((part, at) => (
            <span key={at} className="inline-flex items-center gap-x-1.5">
              {at > 0 && <span aria-hidden="true">·</span>}
              {part}
            </span>
          ))}
        </p>
      </div>
    </div>
  )
}

const PERMISSION_LABELS: Record<PermissionChoice, string> = {
  'allow-once': 'Allow once',
  'allow-for-mission': 'Allow for this mission',
  deny: 'Deny',
}

/** The answer of one's own to a decision: a field that asks for nothing until it is used. */
function OwnAnswer({ onWrite }: { onWrite: ((answer: string) => void) | undefined }): ReactNode {
  const [answer, setAnswer] = useState('')
  const id = useId()
  return (
    <form
      className="flex min-w-0 items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (answer.trim() !== '') onWrite?.(answer.trim())
      }}
    >
      <label htmlFor={id} className="sr-only">
        Your own answer
      </label>
      <input
        id={id}
        className="h-control-md min-w-0 flex-1 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus-ring"
        placeholder="Your own answer…"
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
      />
      {answer.trim() !== '' && (
        <Button type="submit" size="md">
          Answer
        </Button>
      )}
    </form>
  )
}

function Ask({ ask, onWrite }: { ask: NeedAsk; onWrite: NeedCardProps['onWrite'] }): ReactNode {
  switch (ask.kind) {
    case 'permission':
      return (
        <>
          <pre className={CODE}>
            <code>{ask.command}</code>
          </pre>
          <Part label="Agent’s reason">
            <p className={PROSE}>{ask.agentReason}</p>
          </Part>
          <Part label="Why Hemera asks">
            <p className={PROSE}>{ask.hemeraReason}</p>
          </Part>
        </>
      )
    case 'decision':
      return <OwnAnswer onWrite={onWrite} />
    case 'error':
      return (
        <>
          <Part label="What was tried">
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
              {ask.attempts.map((attempt, at) => (
                <li key={at} className="flex flex-col gap-1">
                  <span>{attempt.what}</span>
                  <pre className={CODE}>
                    <code>{attempt.output}</code>
                  </pre>
                </li>
              ))}
            </ol>
          </Part>
          <Part label="Proposed">
            <p className={PROSE}>{ask.proposed}</p>
          </Part>
        </>
      )
    case 'environment':
      return null
  }
}

function Actions({
  ask,
  planning,
  ...on
}: Pick<
  NeedCardProps,
  | 'ask'
  | 'planning'
  | 'onPermission'
  | 'onChoose'
  | 'onApply'
  | 'onLook'
  | 'onRetry'
  | 'onSettings'
  | 'onDiscuss'
>): ReactNode {
  const discuss = planning === true && (
    <Button variant="ghost" onClick={on.onDiscuss}>
      Discuss
    </Button>
  )
  switch (ask.kind) {
    case 'permission':
      return (
        <>
          {ask.choices.map((choice) => (
            <Button
              key={choice}
              variant={choice === 'allow-once' ? 'primary' : 'secondary'}
              onClick={() => on.onPermission?.(choice)}
            >
              {PERMISSION_LABELS[choice]}
            </Button>
          ))}
          {discuss}
        </>
      )
    case 'decision':
      return (
        <>
          {ask.options.map((option) =>
            option.recommended === undefined ? (
              <Button key={option.label} onClick={() => on.onChoose?.(option.label)}>
                {option.label}
              </Button>
            ) : (
              // The recommended option is the primary, marked, its reason quoted under the hand.
              <Tooltip key={option.label} label={`Recommended: ${option.recommended}`} quote>
                <Button variant="primary" onClick={() => on.onChoose?.(option.label)}>
                  <IconCheck size="sm" aria-hidden="true" />
                  {option.label}
                </Button>
              </Tooltip>
            ),
          )}
          {discuss}
        </>
      )
    case 'error':
      return (
        <>
          <Button variant="primary" onClick={on.onApply}>
            Apply
          </Button>
          <Button onClick={on.onLook}>Let me look</Button>
        </>
      )
    case 'environment':
      return (
        <>
          <Button variant="primary" onClick={on.onRetry}>
            {ask.action ?? 'Retry'}
          </Button>
          {ask.settings !== undefined && (
            <Button variant="ghost" onClick={on.onSettings}>
              Open Settings › {ask.settings}
            </Button>
          )}
        </>
      )
  }
}

export function NeedCard({
  ask,
  title,
  text,
  missionKey,
  when,
  role,
  status = { state: 'waiting' },
  planning = false,
  onOpenMission,
  onWrite,
  ...on
}: NeedCardProps): ReactNode {
  if (status.state !== 'waiting') {
    const applied = status.state === 'applied'
    return (
      <div className={FAINT} data-need-state={status.state}>
        <NeedGlyph kind={ask.kind} />
        <span className="inline-flex shrink-0 items-center gap-1 font-medium">
          {applied ? (
            <IconCheck size="sm" aria-hidden="true" />
          ) : (
            <IconClockPause size="sm" aria-hidden="true" />
          )}
          {applied ? 'Applied' : 'Expired'}
        </span>
        <span className="min-w-0 truncate text-foreground">{title}</span>
        <span className="min-w-0 flex-1 truncate">{applied ? status.answer : status.reason}</span>
      </div>
    )
  }
  return (
    <Frame
      header={
        <Header
          kind={ask.kind}
          missionKey={missionKey}
          when={when}
          role={role}
          onOpenMission={onOpenMission}
        />
      }
      footer={
        <FrameFooter>
          <Actions ask={ask} planning={planning} {...on} />
        </FrameFooter>
      }
    >
      <article aria-label={`${NEED_KINDS[ask.kind]}: ${title}`} className={cn(BODY)}>
        <h3 className={TITLE}>{title}</h3>
        {text !== undefined && <p className={PROSE}>{text}</p>}
        <Ask ask={ask} onWrite={onWrite} />
      </article>
    </Frame>
  )
}
