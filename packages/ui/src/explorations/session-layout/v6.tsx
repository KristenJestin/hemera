import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useRef, useState } from 'react'

import { StopBuild } from '../../build/stop-build.tsx'
import { AgentMark } from '../../composer/agent-mark.tsx'
import { Badge } from '../../components/badge/badge.tsx'
import { Button, IconButton } from '../../components/button/button.tsx'
import { Card } from '../../components/card/card.tsx'
import { StatusDot } from '../../components/status-dot/status-dot.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconCheck, IconCircleCheck, IconHandStop, IconPlayerPause } from '../../icons.ts'
import { CROSSFADE, crossfade, morph, useTransition } from '../../motion.ts'
import { ProgressStory, storiesDone } from './build-progress.tsx'
import type { SessionFixture } from './fixtures.tsx'
import type {
  AgentState,
  Attention,
  BlockerProgress,
  BuildProgressView,
  Restatement,
  RestatementAnswer,
} from './model.ts'
import { RestatementPoint } from './restatements.tsx'
import { ChatPane, MissionContent, PageHead, PanelBand } from './session-parts.tsx'

/**
 * V6 (second round of the Session layout exploration): V2's layout without its footer strip, the
 * chat minimised to a bubble on the side it opens from, and the decisions in the panel.
 *
 * The chat stands at the centre and the mission panel on its right, foldable, the fold moving the
 * same way both ways. Minimised — by default in build — the chat is a bubble at the bottom left
 * and the panel takes the page. The panel keeps the room the bubble and its preview take on its
 * left while the chat is minimised, so neither ever stands over anything of the build.
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
    requestAnimationFrame(() => page.current?.querySelector<HTMLElement>('[data-restore]')?.focus())
  }
  const open = () => {
    setChatOpen(true)
    requestAnimationFrame(() =>
      page.current?.querySelector<HTMLElement>('[aria-label="Chat"] [contenteditable]')?.focus(),
    )
  }

  return (
    <div ref={page} className={PAGE}>
      <PageHead session={session} />
      <div className={ROW}>
        <motion.div
          className="flex min-w-0 basis-0 overflow-hidden"
          initial={false}
          animate={{ flexGrow: chatOpen ? 1 : 0 }}
          transition={moving}
          inert={!chatOpen}
          aria-hidden={chatOpen ? undefined : true}
        >
          <ChatPane
            thread={session.thread}
            running={session.running}
            onMinimise={hasPanel ? minimise : undefined}
            workspaces={session.workspaces}
            workspaceBound={session.mission !== 'free'}
          />
        </motion.div>
        {hasPanel && (
          <PanelSlot
            folded={folded}
            page={!chatOpen}
            // The Spec's rail stands at the panel's left edge, so the room is kept around the whole
            // panel; the build keeps it inside, under a head whose rule still crosses the page.
            room={!chatOpen && session.build === undefined}
            band={<PanelBand session={session} onUnfold={() => setFolded(false)} />}
          >
            {session.build === undefined ? (
              <MissionContent
                session={session}
                onFold={chatOpen ? () => setFolded(true) : undefined}
              />
            ) : (
              <BuildPanel build={session.build} room={!chatOpen} />
            )}
          </PanelSlot>
        )}
        <AnimatePresence initial={false}>
          {!chatOpen && (
            <Bubble
              key="bubble"
              agent={session.agent}
              attention={session.attention}
              onOpen={open}
            />
          )}
        </AnimatePresence>
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
  room,
  band,
  children,
}: {
  folded: boolean
  /** Whether the chat is minimised: the panel is the page. */
  page: boolean
  /** Whether the slot keeps the bubble's room on its left, for a panel that cannot keep it inside. */
  room: boolean
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
        // The bubble's room, kept while the chat is minimised, so it never stands over the panel.
        className={cn('flex min-w-mission-panel flex-1 bg-surface-content', room && 'pl-chat-room')}
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

function BuildPanel({
  build,
  room,
}: {
  build: BuildProgressView
  /** Whether the chat is minimised: the bubble's room is kept on the left of the head and body. */
  room: boolean
}): ReactNode {
  const stage = STATE_WORDS[build.stage]
  return (
    <section
      aria-label={`Build of ${build.specKey}`}
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className={cn('border-b border-border', room && 'pl-chat-room')}>
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
        className={cn(
          'min-h-0 flex-1 overflow-y-auto outline-none focus-ring',
          room && 'pl-chat-room',
        )}
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
// The minimised chat: a bubble at the bottom left, the side the chat opens from

/**
 * The bubble, at the bottom left of the row: the agent's mark and the dot of its state. When the
 * agent needs the user, a small preview stands beside it with "Open"; nothing unfolds by itself.
 * Both stand in the room the panel keeps on its left while the chat is minimised.
 */
function Bubble({
  agent,
  attention,
  onOpen,
}: {
  agent: AgentState
  attention: Attention | undefined
  onOpen: () => void
}): ReactNode {
  const fade = useTransition(crossfade)
  return (
    <motion.div
      data-bubble
      className="absolute bottom-6 left-6 z-10 flex items-end gap-3"
      initial={CROSSFADE.from}
      animate={CROSSFADE.to}
      exit={CROSSFADE.from}
      transition={fade}
    >
      <span className="relative flex rounded-full shadow-lg">
        <Tooltip label={`${agent.name} · ${agent.says}`} side="right">
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
        <StatusDot status={agent.tone} size="md" className="absolute top-0 right-0" />
      </span>
      {attention !== undefined && (
        <section
          aria-label="The agent needs you"
          className="flex w-chat-preview flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
        >
          <p className="text-sm font-medium">{attention.title}</p>
          <p className="line-clamp-2 text-sm">{attention.preview}</p>
          <span className="flex justify-end">
            <Button variant="primary" size="sm" onClick={onOpen}>
              Open
            </Button>
          </span>
        </section>
      )}
    </motion.div>
  )
}
