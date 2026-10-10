import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Loading } from '../../components/loading/loading.tsx'
import type { Mentionable } from '../../components/mention-field/mention-field.tsx'
import { MentionField } from '../../components/mention-field/mention-field.tsx'
import { IconCheck } from '../../icons.ts'
import type { Discussion, DiscussionHandlers } from './planning-types.ts'

const QUIET = 'text-xs text-muted-foreground'

export interface DiscussionThreadProps extends DiscussionHandlers {
  /** The discussion; null before its first message, which opens it. */
  discussion: Discussion | null
  /** What it is on, as the user calls it: `Q5`. */
  on: string
  mentionables: readonly Mentionable[]
}

/**
 * A discussion: the conversation at a reading measure, the agent's proposed decision with Accept,
 * a decision the user writes, and Close without a decision. Only the user closes it. Before its
 * first message there is only the field: that message opens it.
 */
export function DiscussionThread({
  discussion,
  on,
  mentionables,
  onSay,
  onAccept,
  onClose,
}: DiscussionThreadProps): ReactNode {
  const [text, setText] = useState('')
  const [deciding, setDeciding] = useState(false)
  const submit = (): void => {
    const said = text.trim()
    if (said === '') return
    if (deciding) onClose(said)
    else onSay(said)
    setText('')
    setDeciding(false)
  }
  if (discussion === null) {
    return (
      <section aria-label={`Discuss ${on}`} className="flex max-w-measure min-w-0 flex-col gap-3">
        <MentionField
          label={`Your first message on ${on}`}
          placeholder="What you want to talk through…"
          value={text}
          onValueChange={(value) => setText(value)}
          mentionables={mentionables}
          onSubmit={submit}
          autoFocus
        />
      </section>
    )
  }
  // The proposal stands in its own box with Accept: its message is not repeated in the thread.
  const messages = discussion.messages.filter(
    (message) => !(message.proposal && message.text === discussion.proposal?.text),
  )
  return (
    <section
      aria-label={`Discussion ${discussion.label}`}
      className="flex max-w-measure min-w-0 flex-col gap-3"
    >
      <ol aria-label={`Messages of ${discussion.label}`} className="flex flex-col gap-3">
        {messages.map((message) => (
          <li
            key={`${message.at} ${message.author} ${message.text}`}
            className={cn('flex flex-col gap-1 text-sm', message.author === 'user' && 'items-end')}
          >
            <span className={QUIET}>
              {message.author === 'user' ? 'You' : 'Hemera'} · {message.at}
            </span>
            <p
              className={cn(
                'max-w-full rounded-lg px-3 py-2 break-words whitespace-pre-line',
                message.author === 'user' ? 'bg-muted' : 'border border-border',
              )}
            >
              {message.text}
            </p>
          </li>
        ))}
      </ol>
      {discussion.state === 'closed' ? (
        <p className="flex items-start gap-2 text-sm break-words text-muted-foreground">
          <span className="flex shrink-0 pt-0.5">
            <IconCheck size="sm" />
          </span>
          {discussion.outcome === 'decision'
            ? `Closed on a decision: ${discussion.decision ?? ''}`
            : 'Closed without a decision'}
        </p>
      ) : (
        <>
          {discussion.proposal !== null && (
            <div
              role="group"
              aria-label="Proposed decision"
              className="flex flex-col gap-2 rounded-lg border border-primary px-3 py-2"
            >
              <span className={QUIET}>Proposed decision · {discussion.proposal.at}</span>
              <p className="text-sm font-medium break-words">{discussion.proposal.text}</p>
              <div>
                <Button variant="primary" size="sm" onClick={onAccept}>
                  Accept
                </Button>
              </div>
            </div>
          )}
          {discussion.waitsOn === 'agent' && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loading size="sm" label="Hemera answers" />
              Hemera answers…
            </p>
          )}
          {discussion.plannerFailed !== null && (
            <p className="text-sm break-words text-destructive">{discussion.plannerFailed}</p>
          )}
          <MentionField
            label={
              deciding
                ? `Your decision on ${discussion.label}`
                : `Your message in ${discussion.label}`
            }
            placeholder={deciding ? 'The decision, as it goes in Decisions…' : 'Reply…'}
            value={text}
            onValueChange={(value) => setText(value)}
            mentionables={mentionables}
            onSubmit={submit}
          />
          <div className="flex flex-wrap gap-1">
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={deciding}
              onClick={() => setDeciding(!deciding)}
            >
              Write a decision
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onClose(null)}>
              Close without a decision
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
