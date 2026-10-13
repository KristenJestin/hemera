import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, use, useEffect, useState } from 'react'

import { Prose } from '../../blocks/planning/prose.tsx'
import { Button } from '../../components/button/button.tsx'
import { Dialog } from '../../components/dialog/dialog.tsx'
import { durationOf, useNow } from '../../components/live-chip/live-chip.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { IconCheck, IconChevronDown, IconChevronRight, IconClockPause } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { MissionField } from '../project/project-page.tsx'
import {
  AgentMark,
  type ProjectSetupProps,
  SetupBody,
  type SetupBodyProps,
  type SetupCardEntry,
  shownCards,
} from './project-setup.tsx'

/**
 * The Project's tasks, on its page under the field that starts a mission: what Hemera does for
 * the Project rather than for one of its missions, as a row of chips and nothing else. A chip opens
 * its menu (its glance): what it is, its time, its last lines or messages, its actions, and ⓘ for
 * its details. Shown only while a task runs or waits.
 */
export function ProjectTasks({ children }: { children: ReactNode }): ReactNode {
  return (
    <div role="region" aria-label="Tasks" className={ROW}>
      {children}
    </div>
  )
}

const ROW = 'flex min-w-0 flex-wrap items-center gap-2'

/** "1 of 3 proposals answered": one mark per proposal on a track that shows, filled once answered. */
function Progress({ cards }: { cards: readonly SetupCardEntry[] }): ReactNode {
  const answered = new Set(
    cards.filter((card) => card.status.state === 'accepted' || card.status.state === 'declined'),
  )
  if (cards.length === 0) return null
  return (
    <span
      role="img"
      aria-label={`${String(answered.size)} of ${String(cards.length)} proposals answered`}
      className="flex h-1 w-full max-w-60 min-w-0 gap-1"
    >
      {cards.map((card) => (
        <span
          key={card.kind}
          data-segment=""
          className={cn(
            'h-full min-w-0 flex-1 rounded-full bg-border',
            answered.has(card) && 'primary-fill',
          )}
        />
      ))}
    </span>
  )
}

/**
 * The setup as a task: its chip in the tasks' row, and its details. The chip wears the dot of
 * what waits for the user while a proposal waits or the agent stopped. Its menu says who runs it
 * ("Agent · Claude Code · opus"), its last messages, and asks what the user is to do: "Review 2
 * proposals", which opens the details as ⓘ does, or Try again once it stopped. The details hold
 * the proposals, answered there, then what the agent said. Once every proposal is answered, the
 * page no longer shows it.
 */
export interface SetupTaskProps
  extends
    Pick<ProjectSetupProps, 'agent' | 'startedAt' | 'endedAt' | 'glance' | 'onAcceptAll'>,
    SetupBodyProps {
  project: string
  /** Who runs it, as its menu says: "Agent · Claude Code · opus". */
  about?: string | undefined
  /** What the agent said last, oldest first. */
  messages?: readonly string[] | undefined
  /** Whether its details are open. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Nothing is left to answer and the task leaves the page: its details close, and the focus goes
   * to the field that starts a mission rather than to the chip that goes with it.
   */
  leaving?: boolean | undefined
  /** Once its details have closed, their exit played: a task leaving may then go. */
  onClosed?: (() => void) | undefined
}

/**
 * The agent at work, as the chip says it: its step and how long, over the proposals as they come.
 * Not read out as it ticks: the seconds are for the eye.
 */
function AgentAtWork({
  agent,
  step,
  startedAt,
}: Pick<SetupTaskProps, 'agent' | 'startedAt'> & { step: string | undefined }): ReactNode {
  const now = useNow(true)
  return (
    <div
      role="group"
      aria-label="Setup agent at work"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      {agent === 'waiting' ? (
        <IconClockPause size="sm" aria-hidden="true" />
      ) : (
        <StatusMark state="running" size="sm" />
      )}
      <span className="min-w-0 flex-1 truncate text-foreground">{step ?? 'Setup agent'}</span>
      <span className="shrink-0 font-mono tabular-nums">{durationOf(now - startedAt)}</span>
    </div>
  )
}

/** A message on one plain line, for the chip's menu: its first line, without Markdown marks. */
const plainLine = (message: string): string =>
  (message.split('\n').find((line) => line.trim() !== '') ?? '')
    .replace(/^\s*(#{1,6}|[-*]|\d+[.)])\s+/, '')
    .replaceAll('**', '')
    .replaceAll('`', '')

/**
 * What the agent said: its last message is the summary, folded to its first line; the control
 * unfolds it in place, read as Markdown, with the messages it wrote while it read folded inside.
 */
function AgentSaid({ messages }: { messages: readonly string[] }): ReactNode {
  const folding = useTransition(fold)
  const [open, setOpen] = useState(false)
  const [earlierOpen, setEarlierOpen] = useState(false)
  const summary = messages.at(-1)
  const earlier = messages.slice(0, -1)
  if (summary === undefined) return null
  return (
    <section aria-label="What the agent said" className="flex flex-col gap-3">
      <SectionHead title="What the agent said" />
      <div className="flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-3">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-left text-sm outline-none focus-ring hover-motion"
          aria-label={open ? 'Fold the summary' : 'Unfold the summary'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="flex shrink-0 text-muted-foreground" aria-hidden="true">
            {open ? <IconChevronDown size="sm" /> : <IconChevronRight size="sm" />}
          </span>
          <span className="min-w-0 flex-1 truncate" aria-hidden={open || undefined}>
            {plainLine(summary)}
          </span>
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="summary"
              className="flex flex-col gap-3 overflow-hidden"
              initial={collapse}
              animate={expand}
              exit={collapse}
              transition={folding}
            >
              <Prose body={summary} />
              {earlier.length > 0 && (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    className="flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-ring hover-motion"
                    aria-expanded={earlierOpen}
                    onClick={() => setEarlierOpen(!earlierOpen)}
                  >
                    <span className="flex" aria-hidden="true">
                      {earlierOpen ? <IconChevronDown size="sm" /> : <IconChevronRight size="sm" />}
                    </span>
                    Earlier messages
                    <span className="tabular-nums">{earlier.length}</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {earlierOpen && (
                      <motion.ol
                        key="earlier"
                        aria-label="Earlier messages"
                        className="flex flex-col gap-3 overflow-hidden pl-5 text-muted-foreground"
                        initial={collapse}
                        animate={expand}
                        exit={collapse}
                        transition={folding}
                      >
                        {earlier.map((message, at) => (
                          // Messages repeat; where they stand is what tells them apart.
                          // oxlint-disable-next-line react/no-array-index-key -- the order is the identity
                          <li key={at}>
                            <Prose body={message} />
                          </li>
                        ))}
                      </motion.ol>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}

/** What the setup holds: how many proposals answered, Accept all, the cards, what the agent said. */
export function SetupProposals(props: SetupTaskProps): ReactNode {
  const { agent, cards, messages = [] } = props
  const shown = shownCards(agent, cards).filter((card) => card.status.state !== 'reading')
  const waiting = shown.filter((card) => card.status.state === 'proposed').length
  return (
    <div className="flex flex-col gap-5">
      {(agent === 'working' || agent === 'waiting') && (
        <AgentAtWork agent={agent} step={props.glance?.step} startedAt={props.startedAt} />
      )}
      {shown.length > 0 && (
        <div className="flex items-center justify-between gap-3">
          <Progress cards={shown} />
          {waiting > 0 && (
            <Button onClick={props.onAcceptAll}>
              <IconCheck size="sm" aria-hidden="true" />
              Accept all
            </Button>
          )}
        </div>
      )}
      <SetupBody {...props} narrow />
      {shown.length === 0 && agent === 'done' && (
        <p className="text-sm text-muted-foreground">No proposal yet.</p>
      )}
      {messages.length > 0 && <AgentSaid messages={messages} />}
    </div>
  )
}

export function SetupTask(props: SetupTaskProps): ReactNode {
  const {
    project,
    agent,
    startedAt,
    endedAt,
    glance,
    cards,
    failure,
    about,
    open,
    onOpenChange,
    leaving = false,
    onClosed,
  } = props
  const missionField = use(MissionField)
  // The last answer given in the details: they close before the task leaves.
  useEffect(() => {
    if (leaving && open) onOpenChange(false)
  }, [leaving, open, onOpenChange])
  const shown = shownCards(agent, cards)
  const waiting = shown.filter((card) => card.status.state === 'proposed').length
  const proposals = `${String(waiting)} ${waiting === 1 ? 'proposal' : 'proposals'}`
  const details = (): void => onOpenChange(true)
  return (
    <>
      <AgentMark
        agent={agent}
        startedAt={startedAt}
        endedAt={endedAt}
        calls={waiting > 0 || agent === 'failed'}
        glance={{
          kind: 'helper',
          type: about ?? glance?.type ?? 'Setup agent',
          step: agent === 'failed' ? (failure ?? 'The setup agent stopped') : glance?.step,
          output: props.messages?.slice(-3).map(plainLine),
          ask:
            agent === 'failed'
              ? { label: 'Try again', onPress: props.onRetry }
              : waiting > 0
                ? { label: `Review ${proposals}`, onPress: details }
                : undefined,
          onDetails: details,
        }}
      />
      <Dialog
        title={`Setup of ${project}`}
        size="wide"
        open={open}
        onOpenChange={onOpenChange}
        finalFocus={leaving ? (missionField ?? undefined) : undefined}
        onClosed={onClosed}
      >
        <SetupProposals {...props} />
      </Dialog>
    </>
  )
}
