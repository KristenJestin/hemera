import { AnimatePresence, motion } from 'motion/react'
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { Button } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { Tabs } from '../../components/tabs/tabs.tsx'
import { IconHammer, IconMessages } from '../../icons.ts'
import { collapse, expand, fold, morph, useTransition } from '../../motion.ts'
import { RESTATEMENTS, type SessionFixture } from './fixtures.tsx'
import { ChatBubble, ChatDock } from './minimised-chat.tsx'
import { Restatements } from './restatements.tsx'
import { ChatPane, MissionContent, PageHead, PanelBand } from './session-parts.tsx'

/**
 * The variants of the Session layout, one component each (design exploration of 25 September
 * 2026). Every one lays out the same parts — the head of the Session, the chat, the mission panel —
 * and differs only in where the chat stands and how it gives the build its room.
 */

const PAGE = 'flex h-full min-h-0 flex-col bg-background text-foreground'

/** The row under the head, the container every share of it is asked of. */
const ROW = '@container relative flex min-h-0 flex-1'

/** Nothing to hand back. */
function nothing(): void {}

// ---------------------------------------------------------------------------------------------
// V1 · chat always left, the panel on the right at a width the user drags

/** The share of the row the panel takes, and the bounds the hand can drag it between. */
const SHARES = { define: 0.45, build: 0.67, min: 0.25, max: 0.8, step: 0.05 } as const

const HANDLE =
  'relative w-1 shrink-0 cursor-col-resize bg-border outline-none hover:bg-primary focus-ring'

function SplitLayout({ session }: { session: SessionFixture }): ReactNode {
  const panel = useRef<HTMLDivElement>(null)
  const [share, setShare] = useState<number>(
    session.mission === 'build' ? SHARES.build : SHARES.define,
  )

  // The width follows the hand on every frame: a value that changes that often cannot be a class,
  // so it is written on the panel's own box, as the shell writes the sidebar's.
  useLayoutEffect(() => {
    panel.current?.style.setProperty('flex-basis', `${String(Math.round(share * 1000) / 10)}%`)
  }, [share])

  const bound = (next: number) => Math.min(SHARES.max, Math.max(SHARES.min, next))

  // The row reaches the right edge of the window, so where the hand is says the panel's share
  // without measuring anything, as the shell's gutter reads the sidebar's width off the pointer.
  function drag(event: PointerEvent<HTMLDivElement>): void {
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (at: globalThis.PointerEvent) =>
      setShare(bound((window.innerWidth - at.clientX) / window.innerWidth))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function keys(event: KeyboardEvent<HTMLDivElement>): void {
    const moves = new Map([
      ['ArrowLeft', share + SHARES.step],
      ['ArrowRight', share - SHARES.step],
    ])
    const next = moves.get(event.key)
    if (next === undefined) return
    event.preventDefault()
    setShare(bound(next))
  }

  return (
    <div className={PAGE}>
      <PageHead session={session} />
      <div className={ROW}>
        <div className="flex min-w-0 flex-1">
          <ChatPane thread={session.thread} running={session.running} />
        </div>
        {session.mission !== 'free' && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Width of the mission panel"
              aria-valuemin={SHARES.min * 100}
              aria-valuemax={SHARES.max * 100}
              aria-valuenow={Math.round(share * 100)}
              tabIndex={0}
              className={HANDLE}
              onPointerDown={drag}
              onKeyDown={keys}
            />
            <div ref={panel} className="flex min-w-0 shrink-0">
              <MissionContent session={session} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// V2, V3, V5 · chat at the centre, the panel on the right; the chat minimises

/** How the chat minimised stands: a bar in a strip (V2), a bubble (V3), a bar one answers in (V5). */
type Minimised = 'bar' | 'bubble' | 'answer'

const STRIP = 'flex shrink-0 justify-end overflow-hidden border-t border-border bg-surface-content'

function CentreLayout({
  session,
  minimised,
}: {
  session: SessionFixture
  minimised: Minimised
}): ReactNode {
  const [chatOpen, setChatOpen] = useState(session.mission !== 'build')
  const [folded, setFolded] = useState(false)
  const moving = useTransition(morph)
  const opening = useTransition(fold)
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

  const restore =
    minimised === 'bubble' ? (
      <ChatBubble agent={session.agent} attention={session.attention} onOpen={open} />
    ) : (
      <ChatDock
        agent={session.agent}
        attention={session.attention}
        answer={minimised === 'answer' ? <DockAnswer session={session} /> : undefined}
        onOpen={open}
      />
    )

  return (
    <div ref={page} className={PAGE}>
      <PageHead session={session} />
      <div className={ROW}>
        {/* The chat: its share of the row grows from nothing to all the panel leaves, and back. */}
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
          />
        </motion.div>
        {hasPanel && folded && <PanelBand session={session} onUnfold={() => setFolded(false)} />}
        {hasPanel &&
          !folded && (
            // The panel: its share of the row, and all of it once the chat is minimised.
            <motion.div
              className="flex min-w-0 shrink-0 basis-mission-panel border-l border-border"
              initial={false}
              animate={{ flexGrow: chatOpen ? 0 : 1 }}
              transition={moving}
            >
              <MissionContent
                session={session}
                onFold={chatOpen ? () => setFolded(true) : undefined}
              />
            </motion.div>
          )}
        {minimised === 'bubble' && !chatOpen && restore}
      </div>
      {minimised !== 'bubble' && (
        <AnimatePresence initial={false}>
          {!chatOpen && (
            // The strip the page keeps for the minimised chat: under the content, never over it.
            <motion.div
              key="strip"
              className={STRIP}
              initial={collapse}
              animate={expand}
              exit={collapse}
              transition={opening}
            >
              <div className="flex w-full justify-end px-4 py-2">{restore}</div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}

/** What V5's dock lets the user answer without opening the chat. */
function DockAnswer({ session }: { session: SessionFixture }): ReactNode {
  const [reply, setReply] = useState('')
  if (session.asks === 'restatements') {
    return <Restatements restatements={RESTATEMENTS} compact onAnswer={nothing} />
  }
  if (session.asks === 'blocker') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">{session.attention?.preview}</p>
        <Input
          label="Reply to the agent"
          placeholder="Which one, or something else…"
          value={reply}
          onValueChange={setReply}
          action={
            <Button variant="secondary" size="sm" onClick={() => setReply('')}>
              Reply
            </Button>
          }
        />
        <span className="flex">
          <Button variant="secondary" size="sm" onClick={nothing}>
            The Spec stands
          </Button>
        </span>
      </div>
    )
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------
// V4 · no chat in build: the build full width, the thread in a Conversation tab

function TabbedLayout({ session }: { session: SessionFixture }): ReactNode {
  if (session.mission !== 'build') {
    return (
      <div className={PAGE}>
        <PageHead session={session} />
        <div className={ROW}>
          <div className="flex min-w-0 flex-1">
            <ChatPane thread={session.thread} running={session.running} />
          </div>
          {session.mission === 'define' && (
            <div className="flex min-w-0 shrink-0 basis-mission-panel border-l border-border">
              <MissionContent session={session} />
            </div>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className={PAGE}>
      <PageHead session={session} />
      <Tabs
        label="Views of the build"
        className="flex min-h-0 flex-1 flex-col *:not-first:min-h-0 *:not-first:flex-1"
        defaultValue="build"
        items={[
          {
            value: 'build',
            label: 'Build',
            icon: <IconHammer size="sm" />,
            panel: <MissionContent session={session} inPlace reviewIn="the Conversation tab" />,
          },
          {
            value: 'conversation',
            label: session.attention === undefined ? 'Conversation' : 'Conversation · 1 new',
            icon: <IconMessages size="sm" />,
            panel: <ChatPane thread={session.thread} running={session.running} />,
          },
        ]}
      />
    </div>
  )
}

/** A variant, by name, for the stories. */
export function Variant({
  variant,
  session,
}: {
  variant: 'v1' | 'v2' | 'v3' | 'v4' | 'v5'
  session: SessionFixture
}): ReactNode {
  if (variant === 'v1') return <SplitLayout session={session} />
  if (variant === 'v4') return <TabbedLayout session={session} />
  const minimised = ({ v2: 'bar', v3: 'bubble', v5: 'answer' } as const)[variant]
  return <CentreLayout session={session} minimised={minimised} />
}
