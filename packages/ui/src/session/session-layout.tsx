import { cn } from 'cn'
import { motion } from 'motion/react'
import { type ReactNode, useEffect, useRef } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconRobot } from '../icons.ts'
import { morph, useTransition } from '../motion.ts'

/**
 * The page of a Session, whatever its mission (lot 5c, issue #115): the chat at the centre, the
 * mission panel on its right, and the head across the top of both.
 *
 * A `free` Session is the chat alone: no panel, nothing that minimises it, and the chat takes the
 * whole row. A `define` or a `build` Session has its panel — the Spec, the build — beside the
 * chat, foldable, the fold moving the same way both ways, in the same `MissionPanel` the Spec has
 * stood in since lot 19.
 *
 * The chat can also be minimised, and it is the whole of what this layout owns. The panel then
 * grows over it to the whole row: the chat is laid at the width the panel leaves it and is
 * covered, so its text never reflows on the way, and the panel withdraws to uncover it as it was.
 * Nothing unfolds by itself and the chat never moves.
 *
 * The head is across the top and not inside the chat, because the control that brings the chat
 * back stands in it: a head drawn where the chat is would be covered with it, and the chat would
 * be gone with nothing left to press. The control is the Session's own — the `…` menu is gone, its
 * Rename is a click on the title and its Archive is the Session's row in the sidebar — so the
 * head's right end is free for the one control a mission Session needs there.
 *
 * What the states of the chat are is said by the ring of that control, drawn from lot 9's two
 * movements: the arc turns while the agent works, the ring breathes while it waits for the hand,
 * and a state that has settled is a ring that holds still. Under reduced motion none of them
 * move, which is what `motion-safe` and `useTransition` answer between them.
 */

const PAGE = 'flex h-full min-h-0 flex-col bg-background text-foreground'

/** The head across the top, on the column the chat's own thread and box are laid on. */
const HEAD = 'flex shrink-0 px-6 pt-6 pb-4'

/** The head's line: the same width as the thread, with the chat's control at its end. */
const HEAD_LINE = 'mx-auto flex w-full max-w-3xl items-center gap-3'

/** The row: the container the chat's pinned width and the panel's share are both asked of. */
const ROW = '@container relative flex min-h-0 flex-1'

/**
 * Where the chat stands in the row: a box that grows while the chat is open and gives its room
 * back when it is not. It clips what it holds, so the chat inside it keeps its own width while the
 * box closes on it — the panel grows over the chat, and never the chat under the panel.
 */
const CHAT_BOX = 'flex min-w-0 basis-0 overflow-clip'

/** The chat itself: the thread and the composer, at whatever width it is given. */
const CHAT = 'flex h-full min-h-0 flex-col'

/** The button and the ring that says what the chat is doing, at the head's right end. */
const BUTTON = 'relative flex shrink-0'

const RING =
  'pointer-events-none absolute -inset-1 rounded-full border-2 motion-reduce:animate-none'

/**
 * What is happening in a chat, as its control's ring says it.
 *
 * The words are for whoever cannot see a ring move: they are the control's label and its tooltip
 * rather than a line of the page, because the state belongs to the control that stands for the
 * chat and not to the page it is on.
 */
export type ChatState = 'idle' | 'working' | 'waiting' | 'done' | 'failed'

/** Each state's ring: none while nothing goes on, one of lot 9's movements in every other. */
const RINGS: Record<Exclude<ChatState, 'idle'>, string> = {
  // Something goes on and nothing is asked of the hand: the arc turns.
  working: 'border-primary border-r-transparent border-b-transparent motion-safe:animate-turn',
  // The agent waits for an answer: the one state that asks the hand, and it breathes.
  waiting: 'border-warning motion-safe:animate-breathe',
  done: 'border-success',
  failed: 'border-destructive',
}

/** What each state is called, in a few words. */
const WORDS: Record<ChatState, string> = {
  working: 'Working',
  waiting: 'Waits for you',
  done: 'Done',
  failed: 'Stopped on an error',
  idle: 'Chat',
}

export interface ChatButtonProps {
  /** Whether the chat is open, which is what the press is about: closing it, or bringing it back. */
  open: boolean
  state: ChatState
  /** What it is, in a few words, in place of the state's own: `Blocker on S2`. */
  words?: string | undefined
  /** The first line of it, in the tooltip. */
  detail?: string | undefined
  onToggle: () => void
}

/**
 * The chat's button: one round control at the head's right end, standing where the Session's `…`
 * menu stood, wearing the ring of what happens in the chat and stamped with a robot — never a
 * provider's mark, since what it stands for is the chat and not the agent that answers in it.
 *
 * One press closes the chat and the same press brings it back, so the icon is the same either way
 * and what changes is the ring: a ring that turns while the agent works, breathes while it waits
 * for an answer, holds green once it is done, holds red on an error, and is not drawn at all while
 * nothing goes on.
 */
export function ChatButton({ open, state, words, detail, onToggle }: ChatButtonProps): ReactNode {
  const said = words ?? WORDS[state]
  return (
    <span className={BUTTON} data-state={state}>
      {state !== 'idle' && (
        <span aria-hidden className={cn(RING, RINGS[state])} data-ring={state} />
      )}
      <Tooltip
        label={open ? 'Minimise the chat' : detail === undefined ? said : `${said} · ${detail}`}
      >
        <IconButton
          variant="secondary"
          shape="pill"
          size="md"
          icon={<IconRobot size="sm" />}
          aria-label={open ? 'Minimise the chat' : `Open the chat · ${said}`}
          data-chat-control
          {...(open ? { 'data-minimise': true } : { 'data-restore': true })}
          onClick={onToggle}
        />
      </Tooltip>
    </span>
  )
}

export interface SessionLayoutProps {
  /** The Session's head: its title, where it lives, what is done with it. */
  head: ReactNode
  /** The chat: its thread and its composer. */
  chat: ReactNode
  /**
   * The mission panel, handed whether the chat is minimised — which makes the panel the page.
   *
   * Left out by a `free` Session, which has nothing beside its chat and so nothing to minimise it.
   */
  panel?: ((page: boolean) => ReactNode) | undefined
  /** Whether the chat is open. Meaningless without a panel, where the chat is the page. */
  chatOpen?: boolean | undefined
  onChatOpenChange?: ((open: boolean) => void) | undefined
  /** What the control's ring says. */
  chatState?: ChatState | undefined
  chatWords?: string | undefined
  chatDetail?: string | undefined
}

export function SessionLayout({
  head,
  chat,
  panel,
  chatOpen = true,
  onChatOpenChange,
  chatState = 'idle',
  chatWords,
  chatDetail,
}: SessionLayoutProps): ReactNode {
  const open = panel === undefined || chatOpen
  const moving = useTransition(morph)
  const page = useRef<HTMLDivElement>(null)
  // What the keyboard was on when the chat was minimised, so it goes back to it when it returns:
  // the box the caret was in is covered with the chat, and a covered control is not a focus.
  const wasOpen = useRef(open)

  useEffect(() => {
    if (wasOpen.current === open) return
    wasOpen.current = open
    const landing = open
      ? page.current?.querySelector<HTMLElement>(
          '[data-chat] [contenteditable], [data-chat] textarea, [data-chat] input',
        )
      : page.current?.querySelector<HTMLElement>('[data-restore]')
    landing?.focus({ preventScroll: true })
  }, [open])

  return (
    <div ref={page} className={PAGE}>
      <div className={HEAD}>
        <div className={HEAD_LINE}>
          <div className="min-w-0 flex-1">{head}</div>
          {panel !== undefined && (
            <ChatButton
              open={open}
              state={chatState}
              words={chatWords}
              detail={chatDetail}
              onToggle={() => onChatOpenChange?.(!open)}
            />
          )}
        </div>
      </div>
      <div className={ROW}>
        <motion.div
          className={CHAT_BOX}
          data-chat
          initial={false}
          animate={{ flexGrow: open ? 1 : 0 }}
          transition={moving}
          inert={!open}
          aria-hidden={open ? undefined : true}
        >
          {/* Laid at what the panel leaves it whenever there is a panel: the same width the row
              gives it while the chat is open, and the one it keeps under the panel when it is
              not, so that the text under the panel never reflows. */}
          <div
            className={cn(CHAT, panel === undefined ? 'min-w-0 flex-1' : 'shrink-0 chat-pinned')}
          >
            {chat}
          </div>
        </motion.div>
        {panel?.(!open)}
      </div>
    </div>
  )
}
