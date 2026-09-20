import { useState } from 'react'
import type { ReactNode } from 'react'

import type { Session, SessionEntry } from '@hemera/ipc'
import {
  MessageBubble,
  MessageDaySeparator,
  MessageFooter,
  MessageGroup,
  MessageHeader,
  MessageRow,
  MessageScroller,
  NavigationRail,
  PromptInput,
  SessionEmpty,
  SessionHeader,
  type MessageState,
  type NavigationTick,
} from '@hemera/ui'

import type { PendingMessage } from '../sessions-store.ts'
import { dayOf, timeOf } from '../when.ts'

/**
 * The thread of one Session (design D4b-02, D4b-08).
 *
 * The page is the assembly and nothing else: the head, the thread, the box it is written in.
 * What a message is worth — kept, on its way, refused — is the store's answer, and what any of
 * it looks like is the design system's; this puts the three in a column and hands the two
 * decisions it does make to the pieces that own them.
 *
 * The two it makes are grouping and words. Consecutive messages of one author on one day are
 * one group, because a name repeated over every line of a burst is a column of the same word
 * down the page; and a message on its way is a group of its own, because the foot of a group
 * says where its messages stand and one foot cannot say two things at once.
 */
const PAGE = 'mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-6 py-6'

/** Who the thread is written by, which in this lot is one person and nobody else (D4b-09). */
const AUTHOR = 'You'

/** One message of the thread as this page draws it, kept or not. */
interface ThreadMessage {
  key: string
  body: string
  at: Date
  state: MessageState
  reason?: string | undefined
  onRetry?: (() => void) | undefined
}

/** Consecutive messages of one author, on one day, standing in the same place. */
interface ThreadGroup {
  key: string
  day: string
  /** Whether this group starts a day the one before it was not on. */
  opensDay: boolean
  state: MessageState
  messages: ThreadMessage[]
}

export function SessionPage({
  session,
  projectName,
  entries,
  pending,
  onSend,
  onRename,
  onArchive,
  onRestore,
  onRetry,
}: {
  session: Session
  projectName: string
  /** The thread as the engine numbered it, oldest first. */
  entries: SessionEntry[]
  /** What has been sent and not yet kept, in the order it was sent. */
  pending: PendingMessage[]
  onSend: (text: string) => void
  onRename: (title: string) => void
  onArchive: () => void
  onRestore: () => void
  onRetry: (key: string) => void
}): ReactNode {
  const [value, setValue] = useState('')
  const now = new Date()
  const messages = [
    ...entries.map((entry): ThreadMessage => ({
      key: entry.id,
      body: entry.body,
      at: new Date(entry.createdAt),
      state: 'saved',
    })),
    ...pending.map((waiting): ThreadMessage => ({
      key: waiting.key,
      body: waiting.body,
      at: new Date(waiting.writtenAt),
      state: waiting.state,
      reason: waiting.reason ?? undefined,
      onRetry: waiting.state === 'failed' ? () => onRetry(waiting.key) : undefined,
    })),
  ]
  const groups = grouped(messages, now)

  return (
    <div className={PAGE}>
      <SessionHeader
        title={session.title}
        subtitle={said(session, projectName, entries.length, now)}
        archived={session.archivedAt !== null}
        onRename={onRename}
        onArchive={onArchive}
        onRestore={onRestore}
      />
      {messages.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SessionEmpty />
        </div>
      ) : (
        <MessageScroller
          label={`Thread of ${session.title}`}
          rail={<NavigationRail ticks={ticksOf(groups)} activeKey={messages.at(-1)?.key} />}
        >
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-5">
              {group.opensDay && <MessageDaySeparator day={group.day} />}
              <MessageGroup
                header={<MessageHeader author={AUTHOR} time={timeOf(group.messages[0]!.at)} />}
                footer={
                  <MessageFooter
                    state={group.state}
                    reason={group.messages[0]?.reason}
                    onRetry={group.messages[0]?.onRetry}
                  />
                }
              >
                {group.messages.map((one) => (
                  <MessageRow key={one.key}>
                    <MessageBubble tone="tint" pending={one.state !== 'saved'}>
                      {one.body}
                    </MessageBubble>
                  </MessageRow>
                ))}
              </MessageGroup>
            </div>
          ))}
        </MessageScroller>
      )}
      <PromptInput
        value={value}
        onValueChange={setValue}
        onSend={(text) => {
          // The box is cleared here and not by the component: what is sent leaves the composer
          // the moment it is in the thread, where it is shown as being written rather than as
          // kept (design D4b-02).
          onSend(text)
          setValue('')
        }}
      />
    </div>
  )
}

/** What the head says under the title: what kind of Session it is, and what it holds. */
function said(session: Session, projectName: string, messages: number, now: Date): string {
  const kept = `${String(messages)} ${messages === 1 ? 'message' : 'messages'}`
  return `${projectName} · ${kept} · last written ${dayOf(new Date(session.lastWrittenAt), now)}`
}

/**
 * The messages cut into groups: a new one on a new day, and a new one on a new state.
 *
 * A group carries one foot, so a message that is not kept is a group on its own: `Saving…` is
 * about one message, and a `Retry` under two of them would write one of the two again. Only
 * what the engine has kept is collected, which is the ordinary thread.
 */
function grouped(messages: ThreadMessage[], now: Date): ThreadGroup[] {
  const groups: ThreadGroup[] = []
  for (const message of messages) {
    const day = dayOf(message.at, now)
    const last = groups.at(-1)
    if (last?.day === day && last.state === 'saved' && message.state === 'saved') {
      last.messages.push(message)
      continue
    }
    groups.push({
      key: message.key,
      day,
      opensDay: last?.day !== day,
      state: message.state,
      messages: [message],
    })
  }
  return groups
}

/** The rail beside the thread: a tall tick for a day, a short one per message. */
function ticksOf(groups: ThreadGroup[]): NavigationTick[] {
  const ticks: NavigationTick[] = []
  for (const group of groups) {
    if (group.opensDay) ticks.push({ key: `day-${group.key}`, kind: 'day' })
    for (const message of group.messages) ticks.push({ key: message.key, kind: 'message' })
  }
  return ticks
}
