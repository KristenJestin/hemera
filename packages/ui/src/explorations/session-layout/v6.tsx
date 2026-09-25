import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useRef, useState } from 'react'

import { StopBuild } from '../../build/stop-build.tsx'
import { Badge } from '../../components/badge/badge.tsx'
import { Button, IconButton } from '../../components/button/button.tsx'
import { Card } from '../../components/card/card.tsx'
import { StatusDot } from '../../components/status-dot/status-dot.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconCheck,
  IconChevronDown,
  IconCircleCheck,
  IconHandStop,
  IconRobot,
  IconPlayerPause,
} from '../../icons.ts'
import { CROSSFADE, crossfade, morph, useTransition } from '../../motion.ts'
import { ProgressStory, storiesDone } from './build-progress.tsx'
import type { SessionFixture } from './fixtures.tsx'
import type { BlockerProgress, BuildProgressView, Restatement, RestatementAnswer } from './model.ts'
import { RestatementPoint } from './restatements.tsx'
import { SessionHeader } from '../../session/session.tsx'
import { ChatPane, MissionContent, PanelBand } from './session-parts.tsx'

/**
 * V6 (second round of the Session layout exploration): V2's layout without its footer strip, the
 * chat minimised to its control in the head, and the decisions in the panel.
 *
 * The chat stands at the centre and the mission panel on its right, foldable, the fold moving the
 * same way both ways. Minimised — by default in build — the chat is its control at the top right
 * of the head, where the Session's "…" stood, and the panel takes the page. The content stays
 * centred and never moves for it: nothing of the chat stands over the page.
 *
 * Decisions live in the panel and words in the chat: Accept and the user's review restated point
 * by point, and the ways out of a blocker, are answered in the build panel; the review itself is
 * written in the chat, where the agent answers in a line and points at the panel.
 */

const PAGE = 'flex h-full min-h-0 flex-col bg-background text-foreground'

const ROW = '@container relative flex min-h-0 flex-1'

/** Nothing to hand back. */
function nothing(): void {}

export function V6Layout({ session }: { session: SessionFixture }): ReactNode {
  const [chatOpen, setChatOpen] = useState(session.mission !== 'build')
  const [folded, setFolded] = useState(false)
  const moving = useTransition(morph)
  const hasPanel = session.mission !== 'free'
  const page = useRef<HTMLDivElement>(null)

  const minimise = () => {
    // With the chat minimised the panel is the page: it cannot be folded as well.
    setFolded(false)
    setChatOpen(false)
    requestAnimationFrame(() =>
      page.current?.querySelector<HTMLElement>('[data-restore]')?.focus({ preventScroll: true }),
    )
  }
  const open = () => {
    setChatOpen(true)
    requestAnimationFrame(() =>
      page.current
        ?.querySelector<HTMLElement>('[aria-label="Chat"] [contenteditable]')
        ?.focus({ preventScroll: true }),
    )
  }

  return (
    <div ref={page} className={PAGE}>
      <V6Head
        session={session}
        chatOpen={chatOpen}
        onMinimise={hasPanel ? minimise : undefined}
        onOpen={open}
      />
      <div className={ROW}>
        <motion.div
          className="flex min-w-0 basis-0 overflow-clip"
          initial={false}
          animate={{ flexGrow: chatOpen ? 1 : 0 }}
          transition={moving}
          inert={!chatOpen}
          aria-hidden={chatOpen ? undefined : true}
        >
          {/* Laid at its open width whenever the panel is at its share or growing past it, so the
              panel covers the chat on its way to the page and the text under it never reflows. */}
          <div
            className={cn('flex min-w-0 shrink-0', hasPanel && !folded ? 'chat-pinned' : 'flex-1')}
          >
            <ChatPane
              thread={session.thread}
              running={session.running}
              workspaces={session.workspaces}
              workspaceBound={session.mission !== 'free'}
            />
          </div>
        </motion.div>
        {hasPanel && (
          <PanelSlot
            folded={folded}
            page={!chatOpen}
            band={<PanelBand session={session} onUnfold={() => setFolded(false)} />}
          >
            {session.build === undefined ? (
              <MissionContent
                session={session}
                onFold={chatOpen ? () => setFolded(true) : undefined}
              />
            ) : (
              <BuildPanel build={session.build} />
            )}
          </PanelSlot>
        )}
      </div>
    </div>
  )
}

/**
 * The mission panel's slot in the row: its share, the band it folds to, and the whole page while
 * the chat is minimised.
 *
 * The fold moves how far open the slot is, from the band (0) to its share (1), on `morph` both
 * ways — the same `mission-panel-slot` width the lot-19 panel draws — and what it holds stays laid
 * at the share and is clipped, so only the chat reflows on the way. The page grows the slot over
 * the rest of the row on the same spring.
 */
function PanelSlot({
  folded,
  page,
  band,
  children,
}: {
  folded: boolean
  /** Whether the chat is minimised: the panel is the page. */
  page: boolean
  band: ReactNode
  children: ReactNode
}): ReactNode {
  const moving = useTransition(morph)
  const fade = useTransition(crossfade)
  return (
    <motion.div
      data-panel
      className="relative flex min-w-0 shrink-0 overflow-hidden border-l border-border mission-panel-slot"
      initial={false}
      animate={{ '--mission-panel-open': folded ? 0 : 1, flexGrow: page ? 1 : 0 }}
      transition={moving}
    >
      <div
        inert={folded}
        aria-hidden={folded ? true : undefined}
        className="flex min-w-mission-panel flex-1 bg-surface-content"
      >
        {children}
      </div>
      <AnimatePresence initial={false}>
        {folded && (
          <motion.div
            key="band"
            className="absolute inset-y-0 left-0 z-10 flex"
            initial={CROSSFADE.from}
            animate={CROSSFADE.to}
            exit={CROSSFADE.from}
            transition={fade}
          >
            {band}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------------------------
// The build panel: V1's display of the Spec's progress, and the decisions

const COLUMN = 'mx-auto flex w-full max-w-3xl flex-col'

const STATE_WORDS = {
  building: { word: 'Building', tone: 'running' },
  review: { word: 'Waiting for your review', tone: 'pending' },
} as const

function BuildPanel({ build }: { build: BuildProgressView }): ReactNode {
  const stage = STATE_WORDS[build.stage]
  return (
    <section
      aria-label={`Build of ${build.specKey}`}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="border-b border-border">
        <div className={cn(COLUMN, 'gap-2 px-8 pt-5 pb-4')}>
          <div className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {build.specKey}
            </span>
            <h2 className="min-w-0 truncate text-xl font-medium">{build.specTitle}</h2>
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {build.stage === 'building' && (
                <Button variant="secondary" size="sm" onClick={nothing}>
                  <IconPlayerPause size="sm" />
                  Pause
                </Button>
              )}
              <StopBuild specKey={build.specKey} onStop={nothing} />
            </span>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="flex items-center gap-1.5 font-medium">
              <StatusDot status={stage.tone} />
              {stage.word}
            </span>
            <span className="text-muted-foreground">{storiesDone(build)}</span>
            {build.stage === 'review' && (
              <span className="text-muted-foreground">final checks green</span>
            )}
          </p>
        </div>
      </header>
      <div
        role="region"
        aria-label={`Progress of ${build.specKey}`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto outline-none focus-ring"
      >
        <div className={cn(COLUMN, 'gap-8 px-8 py-6')}>
          {build.stage === 'review' && <ReviewCard review={build.review ?? []} />}
          {build.stories.map((story) => (
            <ProgressStory
              key={story.id}
              story={story}
              blocked={build.blocker?.criterionId}
              blocker={build.blocker !== undefined && <BlockerDecision blocker={build.blocker} />}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

/**
 * The review, as a decision: Accept, and beside it the user's review restated one row per point,
 * each OK or "No, it is…". The review itself is written in the chat; what lands here is what the
 * agent understood of it. Once every point is confirmed, the build goes back to work on them and
 * Accept goes: there is something new to accept.
 */
function ReviewCard({ review }: { review: Restatement[] }): ReactNode {
  const [answers, setAnswers] = useState<Partial<Record<string, RestatementAnswer>>>({})
  const confirmed = review.filter((one) => answers[one.id]?.ok === true).length
  const all = review.length > 0 && confirmed === review.length
  return (
    <Card
      title="Your review"
      description={
        review.length === 0
          ? 'Write what to change in the chat: bullets, screenshots. Nothing to change? Accept.'
          : `The agent restated what you wrote in the chat: ${String(confirmed)} of ${String(review.length)} confirmed.`
      }
      actions={
        all ? undefined : (
          <Button variant="primary" size="sm" onClick={nothing}>
            <IconCheck size="sm" />
            Accept
          </Button>
        )
      }
    >
      {review.length === 0 && (
        <p className="py-2 text-sm text-muted-foreground">
          The agent restates each point of your review here, one row per point, for you to confirm.
        </p>
      )}
      {review.length > 0 && (
        <ol aria-label="Your review, restated" className="flex flex-col divide-y divide-border">
          {review.map((one) => (
            <RestatementPoint
              key={one.id}
              row
              restatement={one}
              answer={answers[one.id]}
              onAnswer={(given) => setAnswers((before) => ({ ...before, [one.id]: given }))}
            />
          ))}
        </ol>
      )}
      {all && (
        <p role="status" className="flex items-center gap-1.5 text-sm font-medium">
          <IconCircleCheck size="sm" className="text-success" aria-hidden="true" />
          All confirmed. The build goes back to work on them.
        </p>
      )}
    </Card>
  )
}

/**
 * A blocker, as a decision: the agent's reason, the ways out it offers — each saying when it
 * changes the Spec — and "The Spec stands". Anything more to say is said in the chat.
 */
function BlockerDecision({ blocker }: { blocker: BlockerProgress }): ReactNode {
  const [chosen, setChosen] = useState<string | null>(null)
  const options = blocker.options ?? []
  const picked =
    chosen === 'stands' ? 'The Spec stands' : options.find((one) => one.id === chosen)?.label
  return (
    <div
      role="group"
      aria-label="Blocker"
      className="ml-6 flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive-muted px-4 py-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-destructive-muted-foreground">
        <IconHandStop size="sm" aria-hidden="true" />
        The agent says the Spec cannot be met here
        <span className="font-normal text-muted-foreground">{blocker.raised}</span>
      </p>
      <blockquote className="border-l-2 border-destructive/40 pl-3 text-sm text-foreground">
        {blocker.reason}
      </blockquote>
      {picked === undefined ? (
        <div className="flex flex-col items-start gap-2">
          {options.map((one) => (
            <span key={one.id} className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setChosen(one.id)}>
                {one.label}
              </Button>
              {one.changesSpec === true && (
                <Badge tone="warning">This changes the Spec: rework?</Badge>
              )}
            </span>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setChosen('stands')}>
            The Spec stands
          </Button>
          <p className="text-xs text-muted-foreground">Anything more to say goes in the chat.</p>
        </div>
      ) : (
        <p role="status" className="flex items-center gap-1.5 text-sm">
          <IconCircleCheck size="sm" className="text-success" aria-hidden="true" />
          {`${picked}. The agent goes on with S2.`}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// The chat's control: at the top right of the head, where the Session's "…" stood

/**
 * The Session's head, with the chat's control at its right end, in place of the "…" menu: the
 * title renames on a click, and archiving is the sidebar's (its Session row), so the head's right
 * end is free for the one control a mission Session needs there.
 *
 * Open, the control minimises the chat. Minimised, it is the chat's chip: it says what happens in
 * the chat in words, not in a dot, and brings the chat back. Nothing unfolds by itself, and the
 * content never moves.
 */
function V6Head({
  session,
  chatOpen,
  onMinimise,
  onOpen,
}: {
  session: SessionFixture
  chatOpen: boolean
  /** Minimises the chat; left out in a free Session, where the chat is the page. */
  onMinimise: (() => void) | undefined
  onOpen: () => void
}): ReactNode {
  const agent = session.agent
  const attention = chatOpen ? undefined : session.attention
  return (
    <div
      data-head
      className="flex shrink-0 items-start gap-3 border-b border-border px-6 pt-4 pb-3"
    >
      <div className="min-w-0 flex-1">
        <SessionHeader
          title={session.title}
          projectName="Atlas"
          meta={session.meta}
          onRename={nothing}
          onStartEditing={undefined}
        />
      </div>
      {onMinimise !== undefined && (
        <span data-chat-control className="relative flex shrink-0 self-center">
          {chatOpen ? (
            <Tooltip label="Minimise the chat">
              <IconButton
                variant="ghost"
                size="sm"
                icon={<IconChevronDown size="sm" />}
                aria-label="Minimise the chat"
                data-minimise
                onClick={onMinimise}
              />
            </Tooltip>
          ) : (
            <ChatChip
              state={chatStateOf(session)}
              words={attention?.title ?? (agent.tone === 'running' ? agent.says : undefined)}
              detail={attention?.preview}
              onOpen={onOpen}
            />
          )}
        </span>
      )}
    </div>
  )
}

/** What happens in a chat, as its minimised button says it. */
export type ChatState = 'working' | 'waiting' | 'done' | 'failed' | 'idle'

/** Each state's ring around the button: none for idle, the same ring in every other. */
const RING: Record<Exclude<ChatState, 'idle'>, string> = {
  // Something happens and nothing is asked: the arc turns.
  working: 'border-primary border-r-transparent border-b-transparent motion-safe:animate-turn',
  // The agent waits for an answer: the one state that asks the hand, and it breathes.
  waiting: 'border-warning motion-safe:animate-breathe',
  done: 'border-success',
  failed: 'border-destructive',
}

const CHAT_WORDS: Record<ChatState, string> = {
  working: 'Working',
  waiting: 'Waits for you',
  done: 'Done',
  failed: 'Stopped on an error',
  idle: 'Chat',
}

/** The state of a fixture's chat: what it waits for first, then what its agent does. */
export function chatStateOf(session: SessionFixture): ChatState {
  if (session.attention !== undefined) return 'waiting'
  switch (session.agent.tone) {
    case 'running':
      return 'working'
    case 'success':
      return 'done'
    case 'failure':
      return 'failed'
    default:
      return 'idle'
  }
}

/**
 * The minimised chat: one round button at the head's right end, the robot of the chat — never the
 * provider's mark — and what happens in the chat said by a ring around it, not by a dot: an arc
 * that turns while the agent works, a ring that breathes while it waits for an answer, a still
 * ring once it is done or stopped on an error, nothing when nothing goes on. The button itself
 * stays the same button in every state. The words are the tooltip's and the label's.
 */
export function ChatChip({
  state,
  words,
  detail,
  onOpen,
}: {
  state: ChatState
  /** What it is, in a few words: `Blocker on S2`, `Working on S1 · the column order`. */
  words?: string | undefined
  /** The first line of it, in the tooltip. */
  detail?: string | undefined
  onOpen: () => void
}): ReactNode {
  const said = words ?? CHAT_WORDS[state]
  return (
    <span className="relative flex" data-state={state}>
      {state !== 'idle' && (
        <span
          aria-hidden
          className={cn('pointer-events-none absolute -inset-1 rounded-full border-2', RING[state])}
        />
      )}
      <Tooltip label={detail === undefined ? said : `${said} · ${detail}`} side="bottom">
        <IconButton
          variant="secondary"
          shape="pill"
          size="md"
          icon={<IconRobot size="sm" />}
          aria-label={`Open the chat · ${said}`}
          data-restore
          onClick={onOpen}
        />
      </Tooltip>
    </span>
  )
}
