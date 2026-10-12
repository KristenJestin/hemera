import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { LetterAvatar } from '../../components/letter-avatar/letter-avatar.tsx'
import { LiveChip, type LiveState } from '../../components/live-chip/live-chip.tsx'
import { type Mentionable, MentionField } from '../../components/mention-field/mention-field.tsx'
import { IconCheck, IconFolder, IconMinus, IconX } from '../../icons.ts'
import type { Prototype, PrototypeVerdict } from './planning-types.ts'
import { LINE, QUIET, Unfolding } from './rail-fold.tsx'
import { NotSent, SendButton, useSending } from './sending.tsx'

/**
 * The Prototypers of the Planning page (#222): a chip in the stage card while one runs, like a
 * Probe's; once it handed its result back, a line that unfolds to it — what it built, where it is,
 * what the user said of it — with Validate and Set aside while nobody judged it.
 */

function liveOf(prototype: Prototype): LiveState {
  if (prototype.stuck) return 'stuck'
  if (prototype.state === 'done') return 'finished'
  if (prototype.state === 'failed') return 'failed'
  return 'running'
}

const AVATAR = <LetterAvatar name="Prototyper" tone="build" />

/** A Prototyper at work as its LiveChip: its letter avatar, and its step in the glance it opens. */
export function PrototypeChip({ prototype }: { prototype: Prototype }): ReactNode {
  return (
    <LiveChip
      name={
        prototype.question === null
          ? `Prototyper ${prototype.label}`
          : `Prototyper ${prototype.label} · ${prototype.question}`
      }
      icon={AVATAR}
      state={liveOf(prototype)}
      startedAt={prototype.startedAt}
      endedAt={prototype.endedAt}
      glance={{ kind: 'helper', type: 'Prototyper', step: prototype.step }}
    />
  )
}

const VERDICT_WORDS: Record<PrototypeVerdict, string> = {
  validated: 'Validated',
  'set-aside': 'Set aside',
}

/** The mark of where a result stands: validated, set aside, failed; nothing while it waits. */
function VerdictMark({ prototype }: { prototype: Prototype }): ReactNode {
  if (prototype.state === 'failed') {
    return (
      <span className="flex shrink-0 text-destructive">
        <IconX size="sm" aria-label="Failed" />
      </span>
    )
  }
  if (prototype.verdict === 'validated') {
    return (
      <span className="flex shrink-0 text-success">
        <IconCheck size="sm" aria-label="Validated" />
      </span>
    )
  }
  if (prototype.verdict === 'set-aside') {
    return (
      <span className="flex shrink-0 text-muted-foreground">
        <IconMinus size="sm" aria-label="Set aside" />
      </span>
    )
  }
  return <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warning" />
}

/** Validate at once; Set aside with what the user says of it, in a field that unfolds. */
function Judging({
  prototype,
  onJudge,
}: {
  prototype: Prototype
  onJudge: (id: string, verdict: PrototypeVerdict, note: string | null) => Promise<void>
}): ReactNode {
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const aside = useSending()
  const setAside = (): void => {
    aside.send(() => onJudge(prototype.id, 'set-aside', note.trim() === '' ? null : note.trim()))
  }
  return (
    <div className="flex flex-col gap-2">
      <Unfolding open={noting}>
        <Input
          label="Why you set it aside"
          placeholder="Optional"
          size="sm"
          value={note}
          onValueChange={setNote}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setAside()
          }}
          action={
            <Button
              variant="secondary"
              size="sm"
              state={aside.busy ? 'loading' : 'idle'}
              onClick={setAside}
            >
              Send
            </Button>
          }
        />
      </Unfolding>
      <NotSent refusal={aside.refusal} />
      <div className="flex flex-wrap items-center gap-1">
        <SendButton
          variant="secondary"
          size="sm"
          aria-label={`Validate ${prototype.label}`}
          onSend={() => onJudge(prototype.id, 'validated', null)}
        >
          Validate
        </SendButton>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Set aside ${prototype.label}`}
          aria-expanded={noting}
          onClick={() => setNoting(!noting)}
        >
          Set aside
        </Button>
      </div>
    </div>
  )
}

/**
 * A Prototyper's result summarised: its label and its question on one line, the mark of its
 * verdict. Unfolded, what it handed back, its folder, what the user said with their verdict — and,
 * while nobody judged it, Validate and Set aside.
 */
export function PrototypeLine({
  prototype,
  onJudge,
}: {
  prototype: Prototype
  /** Given while the result waits for a verdict. */
  onJudge?:
    | ((id: string, verdict: PrototypeVerdict, note: string | null) => Promise<void>)
    | undefined
}): ReactNode {
  const [open, setOpen] = useState(false)
  const question = prototype.question ?? 'Prototyper'
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${prototype.label} · ${question}`}
        className={cn(LINE, 'items-start')}
        onClick={() => setOpen(!open)}
      >
        <span className="w-icon-sm shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">
          {prototype.label}
        </span>
        <span className={cn('min-w-0 flex-1', open ? 'break-words' : 'truncate')}>{question}</span>
        <span className="flex pt-1">
          <VerdictMark prototype={prototype} />
        </span>
      </button>
      <Unfolding open={open}>
        <div className="flex min-w-0 flex-col gap-2 px-4 pb-3 pl-10 text-sm">
          {prototype.result !== null && (
            <p className="break-words whitespace-pre-line">{prototype.result}</p>
          )}
          {prototype.failure !== null && (
            <p className="break-words text-destructive">
              The Prototyper failed: {prototype.failure}
            </p>
          )}
          {prototype.folder !== null && (
            <p className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground">
              <span className="flex pt-0.5">
                <IconFolder size="sm" aria-label="Its folder" />
              </span>
              <span className="min-w-0 font-mono break-all select-text">{prototype.folder}</span>
            </p>
          )}
          {prototype.verdict !== null && (
            <p className={cn(QUIET, 'break-words whitespace-normal')}>
              {prototype.verdictNote === null
                ? VERDICT_WORDS[prototype.verdict]
                : `${VERDICT_WORDS[prototype.verdict]}: ${prototype.verdictNote}`}
            </p>
          )}
          {prototype.verdict === null && prototype.state === 'done' && onJudge !== undefined && (
            <Judging prototype={prototype} onJudge={onJudge} />
          )}
        </div>
      </Unfolding>
    </li>
  )
}

/** What the user asks the Planner to try: sent as it is, and the field let go once it is taken. */
export function AskPrototype({
  mentionables,
  onAsk,
}: {
  mentionables: readonly Mentionable[]
  onAsk: (question: string) => Promise<void>
}): ReactNode {
  const [text, setText] = useState('')
  const asking = useSending()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <MentionField
        label="Ask for a prototype"
        placeholder="What to try, in a throwaway folder…"
        value={text}
        onValueChange={(value) => setText(value)}
        mentionables={mentionables}
        disabled={asking.busy}
        onSubmit={() => {
          const said = text.trim()
          if (said === '') return
          asking.send(
            () => onAsk(said),
            () => setText(''),
          )
        }}
      />
      <NotSent refusal={asking.refusal} />
    </div>
  )
}
