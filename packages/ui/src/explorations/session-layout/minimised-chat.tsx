import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { AgentMark } from '../../composer/agent-mark.tsx'
import { Badge } from '../../components/badge/badge.tsx'
import { Button, IconButton } from '../../components/button/button.tsx'
import { StatusDot } from '../../components/status-dot/status-dot.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconMessages } from '../../icons.ts'
import { CROSSFADE, crossfade, useTransition } from '../../motion.ts'
import type { AgentState, Attention } from './model.ts'

/**
 * The chat, minimised — two shapes of it for the exploration.
 *
 * The dock (V2, and V5 with `answer`): a bar docked at the bottom right of a strip the page keeps
 * for it, never over the content. It says the agent and its state; when the agent needs the user
 * it previews what it asks and offers "Open". It never unfolds by itself. In V5 it also holds the
 * answer, so the common exchange — confirm a point, answer a blocker — needs no layout change.
 *
 * The bubble (V3): a round mark floating at the bottom right of the page, over it; the preview
 * floats above it the same way.
 */

const DOCK =
  'flex w-full max-w-lg flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg'

const DOCK_LINE = 'flex min-w-0 items-center gap-2 text-sm'

const AGENT = 'shrink-0 font-medium'

const SAYS = 'flex min-w-0 flex-1 items-center gap-1.5 truncate text-muted-foreground'

const PREVIEW = 'line-clamp-2 text-sm text-foreground'

const ANSWER = 'max-h-96 overflow-y-auto border-t border-border pt-2 outline-none focus-ring'

export interface MinimisedChatProps {
  agent: AgentState
  attention?: Attention | undefined
  onOpen: () => void
}

export function ChatDock({
  agent,
  attention,
  answer,
  onOpen,
}: MinimisedChatProps & {
  /** What the user can answer from the dock itself (V5). */
  answer?: ReactNode
}): ReactNode {
  return (
    <section aria-label="Chat, minimised" className={DOCK}>
      <div className={DOCK_LINE}>
        <AgentMark agent={agent.name} agentId={agent.agentId} />
        <span className={AGENT}>{agent.name}</span>
        <span className={SAYS}>
          <StatusDot status={agent.tone} />
          <span className="truncate">{agent.says}</span>
        </span>
        {attention !== undefined && <Badge tone="warning">{attention.title}</Badge>}
        <Button
          variant={attention === undefined ? 'ghost' : 'primary'}
          size="sm"
          data-restore
          onClick={onOpen}
        >
          <IconMessages size="sm" />
          Open
        </Button>
      </div>
      {attention !== undefined && answer === undefined && (
        <p className={PREVIEW}>{attention.preview}</p>
      )}
      {answer !== undefined && (
        // A scroll of its own when what is asked is long, and so a stop of the keyboard.
        <div role="region" aria-label="What the agent asks" tabIndex={0} className={ANSWER}>
          {answer}
        </div>
      )}
    </section>
  )
}

const BUBBLE = 'absolute right-6 bottom-6 z-10 flex flex-col items-end gap-3'

const CALLOUT =
  'flex max-w-sm flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3 shadow-lg'

const MARK = 'relative flex rounded-full shadow-lg'

const MARK_DOT = 'absolute top-0 right-0'

export function ChatBubble({ agent, attention, onOpen }: MinimisedChatProps): ReactNode {
  const fade = useTransition(crossfade)
  return (
    <div className={BUBBLE}>
      <AnimatePresence initial={false}>
        {attention !== undefined && (
          <motion.section
            key="callout"
            aria-label="The agent needs you"
            className={CALLOUT}
            initial={CROSSFADE.from}
            animate={CROSSFADE.to}
            exit={CROSSFADE.from}
            transition={fade}
          >
            <p className="flex items-center gap-2 text-sm font-medium">
              <AgentMark agent={agent.name} agentId={agent.agentId} />
              {attention.title}
            </p>
            <p className={PREVIEW}>{attention.preview}</p>
            <span className="flex justify-end">
              <Button variant="primary" size="sm" onClick={onOpen}>
                Open
              </Button>
            </span>
          </motion.section>
        )}
      </AnimatePresence>
      <span className={MARK}>
        <Tooltip label={`${agent.name} · ${agent.says}`} side="left">
          <IconButton
            variant="secondary"
            shape="pill"
            size="lg"
            icon={<AgentMark agent={agent.name} agentId={agent.agentId} />}
            aria-label={`Open the chat · ${agent.name} · ${agent.says}`}
            data-restore
            onClick={onOpen}
          />
        </Tooltip>
        <StatusDot status={agent.tone} size="md" className={MARK_DOT} />
      </span>
    </div>
  )
}
