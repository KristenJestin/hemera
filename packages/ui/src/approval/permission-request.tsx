import { cn } from 'cn'
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react'

import { Badge } from '../components/badge/badge.tsx'
import { Button } from '../components/button/button.tsx'
import { IconAlertTriangle } from '../icons.ts'

/**
 * The gate: the turn is stopped, and it does not go on until someone answers (design D17-09).
 *
 * An agent that is allowed to edit files has to be told when it may. The answer is not a
 * dialogue — it is a decision, taken once, about one call — so the card says what the call would
 * do, the parameters that decide the answer, and the complete change when the call carries one.
 * A gate that hides what it is guarding is a gate people learn to open without reading.
 *
 * The buttons are the agent's options, all of them, in the order of the risk they carry: the
 * refusal first, the one-shot permission next, and the standing rule last, because a rule that
 * outlives the request is the one answer that deserves a second look. Nothing here invents an
 * answer the agent did not offer — a client that offers "allow always" to an agent that only
 * asked once is a client that widens a permission on its own.
 *
 * The card does not take the keyboard: it arrives while the reader is somewhere else, and
 * stealing the caret from a half-written sentence is how a prompt stops being finished. The
 * arrows walk the options from inside the card, Escape takes the refusal, and Enter is the
 * focused button's own press.
 */
const CARD = 'flex flex-col gap-2 rounded-lg border border-warning bg-warning-muted p-3'

/** The line that says what is being decided, and that it is waiting on a person. */
const HEAD = 'flex items-center gap-2 text-sm font-medium text-foreground'

const ICON = 'flex shrink-0 text-warning-muted-foreground'

/** What the call would do, in the agent's own sentence. */
const INTENT = 'text-sm text-muted-foreground'

/** The parameters that decide the answer: a label, and the value it holds. */
const PARAMETERS = 'flex flex-col gap-1 text-sm'

const PARAMETER = 'flex items-baseline gap-2'

const LABEL = 'shrink-0 text-xs text-muted-foreground'

const VALUE = 'min-w-0 truncate font-mono text-foreground'

/** The command or the path the decision is about, in the font that reads as an instruction. */
const COMMAND = 'overflow-x-auto rounded-md border border-border bg-card px-2 py-1 font-mono text-xs whitespace-pre text-foreground'

const OPTIONS = 'flex flex-wrap items-center justify-end gap-2'

const SCOPE = 'text-xs text-muted-foreground'

/** The kinds of option an agent may offer, as the protocol names them. */
export type PermissionOptionKind =
  | 'allow_once'
  | 'allow_always'
  | 'reject_once'
  | 'reject_always'

export interface PermissionOption {
  /** The id the agent gave this option; it is what goes back in the reply. */
  optionId: string
  kind: PermissionOptionKind
  /** What the agent calls it, shown as it is: the agent is the one that owns the words. */
  name: string
}

/** A parameter of the call that a reader would want before answering. */
export interface PermissionParameter {
  label: string
  value: string
}

export interface PermissionRequestProps {
  /** The tool the agent wants to use, as the agent names it. */
  toolName: string
  /** What the call would do, in one sentence. */
  intent: string
  /** The parameters that decide the answer, if any. */
  parameters?: readonly PermissionParameter[] | undefined
  /** The command or the path the answer is about, if there is one. */
  command?: string | undefined
  /** The complete change the call would make, when the agent sent one. */
  diff?: ReactNode
  /** What the agent offers; the order it is given in is not the order it is shown in. */
  options: readonly PermissionOption[]
  /**
   * How long an "always" answer is remembered. Said out loud, because a standing rule the reader
   * cannot name is a rule they will be surprised by later.
   */
  scope?: string | undefined
  onDecide: (option: PermissionOption) => void
  /** Where the card sits; never how it looks. */
  className?: string | undefined
}

/** The risk an option carries, which is the order the buttons are read in. */
const RISK: Record<PermissionOptionKind, number> = {
  reject_once: 0,
  allow_once: 1,
  allow_always: 2,
  reject_always: 3,
}

/** What an option that carries no name of its own is called. */
const WORDS: Record<PermissionOptionKind, string> = {
  reject_once: 'Reject once',
  allow_once: 'Allow once',
  allow_always: 'Always allow',
  reject_always: 'Never allow',
}

/** How an option is drawn: the one-shot permission is the primary action, refusals are not. */
const TREATMENT: Record<PermissionOptionKind, 'primary' | 'secondary' | 'ghost'> = {
  allow_once: 'primary',
  allow_always: 'secondary',
  reject_once: 'ghost',
  reject_always: 'ghost',
}

export function PermissionRequest({
  toolName,
  intent,
  parameters,
  command,
  diff,
  options,
  scope,
  onDecide,
  className,
}: PermissionRequestProps): ReactNode {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const [focused, setFocused] = useState(0)
  // Sorted rather than kept: the agent sends its options in its own order, and the reader reads
  // them from the safest answer to the most lasting one.
  const sorted = [...options].sort((left, right) => RISK[left.kind] - RISK[right.kind])
  const standing = sorted.some(
    (option) => option.kind === 'allow_always' || option.kind === 'reject_always',
  )

  function press(kind: PermissionOptionKind): void {
    const chosen = sorted.find((option) => option.kind === kind)
    if (chosen !== undefined) {
      onDecide(chosen)
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const count = sorted.length
    if (count === 0) return
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      const next = (focused + 1) % count
      buttons.current[next]?.focus()
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      const previous = (focused - 1 + count) % count
      buttons.current[previous]?.focus()
    }
    if (event.key === 'Escape') {
      // Escape takes the refusal when the agent offered one, and nothing when it did not: a client
      // that answers for the reader is a client that decides for them.
      press('reject_once')
    }
  }

  return (
    <div
      role="group"
      aria-label={`Permission for ${toolName}`}
      className={cn(CARD, className)}
      onKeyDown={onKeyDown}
    >
      <div className={HEAD}>
        <span aria-hidden="true" className={ICON}>
          <IconAlertTriangle size="sm" />
        </span>
        {toolName}
        <Badge tone="warning">Waiting for you</Badge>
      </div>
      <p className={INTENT}>{intent}</p>
      {parameters === undefined || parameters.length === 0 ? null : (
        <dl className={PARAMETERS}>
          {parameters.map((parameter) => (
            <div key={parameter.label} className={PARAMETER}>
              <dt className={LABEL}>{parameter.label}</dt>
              <dd className={VALUE}>{parameter.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {command === undefined ? null : <pre className={COMMAND}>{command}</pre>}
      {diff}
      <div className={OPTIONS}>
        {sorted.map((option, index) => (
          <Button
            key={option.optionId}
            ref={(node) => {
              buttons.current[index] = node
            }}
            variant={TREATMENT[option.kind]}
            size="sm"
            onFocus={() => {
              setFocused(index)
            }}
            onClick={() => {
              onDecide(option)
            }}
          >
            {option.name === '' ? WORDS[option.kind] : option.name}
          </Button>
        ))}
      </div>
      {standing && scope !== undefined ? (
        <p className={SCOPE}>An “always” answer is remembered for {scope}.</p>
      ) : null}
    </div>
  )
}
