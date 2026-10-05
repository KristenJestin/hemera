import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Face } from '../../components/face/face.tsx'
import { kindOf, MentionBadge } from '../../components/mention-field/mention-field.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import {
  IconAlertCircle,
  IconBan,
  IconCheck,
  IconChevronRight,
  IconClockPause,
  IconFileText,
  IconListCheck,
  IconLock,
  IconPencil,
  IconPlayerStop,
  IconRefresh,
  IconSearch,
  IconTerminal,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'

/**
 * A Chat's thread: what was said, in order, at a reading measure.
 *
 * - Your messages and the agent's are bubbles, yours at the end of the line. A mention (`@…`) is
 *   the badge the composer drew, code (`` `…` ``) is set in the code face.
 * - The agent's actions are folded under its answer, "3 actions", and unfold to their list.
 * - What happened rather than what was said is a faint line with its glyph: a turn stopped, an
 *   agent's error in words, a silent turn, a start past its delay, Hemera restarted under a turn,
 *   a call held then answered, a mission drafted from the Chat.
 */

export type ChatActionKind = 'read' | 'edit' | 'run' | 'search'

export interface ChatAction {
  id: string
  kind: ChatActionKind
  /** The file, the command, the search. */
  label: string
  failed?: boolean | undefined
}

export type ChatLineTone = 'stopped' | 'error' | 'silent' | 'slow' | 'restarted'

export type HeldAnswer = 'waiting' | 'allowed' | 'denied'

export type ChatItem =
  | {
      kind: 'message'
      id: string
      from: 'you' | 'agent'
      text: string
      actions?: readonly ChatAction[] | undefined
    }
  | { kind: 'line'; id: string; tone: ChatLineTone; text?: string | undefined }
  | { kind: 'held'; id: string; command: string; reason: string; answer: HeldAnswer }
  | { kind: 'created'; id: string; missionKey: string; title: string }
  /** The agent was told a mission close to its draft already exists, and drafted none. */
  | { kind: 'close'; id: string; missionKey: string; title: string }

export interface ChatThreadProps {
  items: readonly ChatItem[]
  /** The agent's name: Claude Code. */
  agent: string
  /** Whether a turn runs: the agent's face ends the thread. */
  working: boolean
  onOpenMission: (missionKey: string) => void
  onRetry: () => void
}

const THREAD = 'mx-auto flex w-full max-w-measure flex-col gap-4 px-8 py-6'
const BUBBLE = 'max-w-full rounded-lg px-3 py-2.5 text-sm whitespace-pre-wrap break-words'
const YOURS = 'self-end max-w-view-narrow bg-primary-muted text-foreground'
const THEIRS = 'self-start border border-border bg-card text-card-foreground'
const LINE = 'flex min-w-0 items-center gap-2 text-xs text-muted-foreground'
const CODE = 'rounded-sm bg-muted px-1 font-mono text-xs'
const FOLD =
  'flex h-control-sm items-center gap-1 self-start rounded-md px-1.5 text-xs text-muted-foreground outline-none focus-ring hover-motion hover:tinted'
const CHEVRON = 'flex chevron-motion aria-expanded:rotate-90'

const ACTION_GLYPHS: Record<ChatActionKind, ReactNode> = {
  read: <IconFileText size="sm" />,
  edit: <IconPencil size="sm" />,
  run: <IconTerminal size="sm" />,
  search: <IconSearch size="sm" />,
}

/** A message's words, its mentions and its code in the code face. */
function Words({ text }: { text: string }): ReactNode {
  return text.split(/(@\S+|`[^`]+`)/).map((part, at) =>
    part.startsWith('@') && part.length > 1 ? (
      <MentionBadge key={at} kind={kindOf(part.slice(1))} label={part.slice(1)} />
    ) : part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
      <code key={at} className={CODE}>
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  )
}

function Actions({ actions }: { actions: readonly ChatAction[] }): ReactNode {
  const [open, setOpen] = useState(false)
  const folding = useTransition(fold)
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={FOLD} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={CHEVRON} aria-expanded={open} aria-hidden="true">
          <IconChevronRight size="sm" />
        </span>
        {actions.length === 1 ? '1 action' : `${String(actions.length)} actions`}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            key="actions"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            {actions.map((action) => (
              <li key={action.id} className={cn(LINE, 'h-control-sm pl-2')}>
                <span className="flex shrink-0" aria-hidden="true">
                  {ACTION_GLYPHS[action.kind]}
                </span>
                <span className="min-w-0 truncate font-mono">{action.label}</span>
                {action.failed === true && <StatusMark state="failed" size="sm" legend />}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }): ReactNode {
  return (
    <p className={LINE}>
      <span className="flex shrink-0" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function Happened({
  item,
  agent,
  onRetry,
}: {
  item: Extract<ChatItem, { kind: 'line' }>
  agent: string
  onRetry: () => void
}): ReactNode {
  switch (item.tone) {
    case 'stopped':
      return <Line icon={<IconPlayerStop size="sm" />}>Stopped</Line>
    case 'silent':
      return <Line icon={<IconClockPause size="sm" />}>{agent} ended its turn without a word</Line>
    case 'restarted':
      return (
        <Line icon={<IconRefresh size="sm" />}>
          Hemera restarted; the agent’s turn was interrupted
        </Line>
      )
    case 'error':
      return (
        <p role="alert" className={cn(LINE, 'text-destructive-muted-foreground')}>
          <span className="flex shrink-0" aria-hidden="true">
            <IconAlertCircle size="sm" />
          </span>
          <span className="min-w-0">
            {agent} stopped: {item.text}
          </span>
        </p>
      )
    case 'slow':
      return (
        <div className="flex items-center gap-3">
          <Line icon={<IconClockPause size="sm" />}>{agent} did not start within 30 s</Line>
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )
  }
}

function Item({
  item,
  agent,
  onOpenMission,
  onRetry,
}: { item: ChatItem } & Omit<ChatThreadProps, 'items' | 'working'>): ReactNode {
  switch (item.kind) {
    case 'message':
      return (
        <div
          className={cn(
            'flex min-w-0 flex-col gap-1',
            item.from === 'you' ? 'items-end' : 'items-start',
          )}
        >
          <div className={cn(BUBBLE, item.from === 'you' ? YOURS : THEIRS)}>
            <Words text={item.text} />
          </div>
          {item.actions !== undefined && item.actions.length > 0 && (
            <Actions actions={item.actions} />
          )}
        </div>
      )
    case 'line':
      return <Happened item={item} agent={agent} onRetry={onRetry} />
    case 'held':
      return item.answer === 'waiting' ? (
        <Line icon={<IconLock size="sm" className="text-warning" />}>
          Waiting for you · <span className="font-mono">{item.command}</span>
        </Line>
      ) : (
        <Line icon={item.answer === 'allowed' ? <IconCheck size="sm" /> : <IconBan size="sm" />}>
          <span>{item.answer === 'allowed' ? 'Allowed once' : 'Denied'}</span>
          {' · '}
          <span className="font-mono">{item.command}</span>
        </Line>
      )
    case 'created':
      return (
        <Line icon={<IconListCheck size="sm" />}>
          Drafted{' '}
          <Button
            variant="link"
            className="font-mono"
            onClick={() => onOpenMission(item.missionKey)}
          >
            {item.missionKey}
          </Button>{' '}
          · {item.title}
        </Line>
      )
    case 'close':
      return (
        <Line icon={<IconListCheck size="sm" />}>
          Not drafted: close to{' '}
          <Button
            variant="link"
            className="font-mono"
            onClick={() => onOpenMission(item.missionKey)}
          >
            {item.missionKey}
          </Button>{' '}
          · {item.title}
        </Line>
      )
  }
}

export function ChatThread({ items, agent, working, ...handlers }: ChatThreadProps): ReactNode {
  return (
    <ol aria-label="Conversation" className={THREAD}>
      {items.map((item) => (
        <li key={item.id} className="flex min-w-0 flex-col">
          <Item item={item} agent={agent} {...handlers} />
        </li>
      ))}
      {working && (
        <li className="flex">
          <Face state="thinking" size="sm" legend label={`${agent} is working`} />
        </li>
      )}
    </ol>
  )
}
