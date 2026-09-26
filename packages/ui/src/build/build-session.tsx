import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useRef, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { StatusDot } from '../components/status-dot/status-dot.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconChevronRight, IconHammer } from '../icons.ts'
import { CROSSFADE, crossfade, useTransition } from '../motion.ts'
import { MissionPanel } from '../session/mission-panel.tsx'
import { type ChatState, SessionLayout } from '../session/session-layout.tsx'
import type { SpecView } from '../spec/model.ts'
import { BuildSpecPanel } from './build-spec-panel.tsx'
import { type BuildViewProps, BuildView } from './build-view.tsx'
import { openBlockerOf, waitingOf } from './model.ts'

/**
 * A `build` Session's page (D10-12, lot 5c of issue #115): the layout every Session has — the chat
 * at the centre, the mission panel on its right — with the build standing in the panel.
 *
 * The `build` used to stand at the centre with the chat folded into a mission panel of its own;
 * since lot 5c the chat is the centre of every mission, and the build is what the panel holds. Its
 * default is still its own: a build opens with the chat minimised, so the build view is the page,
 * and the chat is the button at the end of the head until it is asked for.
 *
 * "Spec" in the build view's head opens the frozen Spec beside the view, read only, inside the same
 * panel: the two are never open together (core.md, "Session view") — opening the Spec folds
 * nothing, and closing it gives the view the whole panel back.
 *
 * What waits for the user in the build — a task that is theirs, a blocker the agent raised — is
 * said by the band when the panel is folded, and above the chat's composer by whoever arranges the
 * chat (`build-banner.tsx`), which the page hands the same build.
 */

const PANEL_HEAD = 'flex shrink-0 items-center gap-2 border-b border-border px-4 py-2'

const PANEL_TITLE = 'text-sm font-medium'

/** The build view and the frozen Spec, side by side inside the panel. */
const ROW = 'flex min-h-0 min-w-0 flex-1'

const CENTRE = 'flex min-h-0 min-w-0 flex-1 flex-col'

const SIDE = 'flex shrink-0'

const BAND = 'flex flex-col items-center gap-3 pt-3 text-muted-foreground'

export interface BuildSessionProps extends Omit<BuildViewProps, 'specOpen' | 'onToggleSpec'> {
  /** The Session's head, drawn across the top of the page: its title, and the chat's button. */
  head?: ReactNode | undefined
  /** The frozen revision the build works from, which "Spec" opens read only. */
  spec: SpecView
  /** The chat: the thread and the composer, with what waits for the user above it. */
  chat: ReactNode
  /** Whether the chat is open. The page holds it, since it remembers it per Session. */
  chatOpen?: boolean | undefined
  onChatOpenChange?: ((open: boolean) => void) | undefined
  /** What the chat's button says: the state of the chat, in a ring and in words. */
  chatState?: ChatState | undefined
  chatWords?: string | undefined
  chatDetail?: string | undefined
  /** Whether the frozen Spec opens beside the view, for the story that shows it. */
  defaultSpecOpen?: boolean | undefined
}

export function BuildSession({
  head,
  build,
  now,
  selected,
  onSelect,
  spec,
  chat,
  chatOpen = true,
  onChatOpenChange,
  chatState = 'idle',
  chatWords,
  chatDetail,
  defaultSpecOpen = false,
  onPause,
  onResume,
  onAccept,
  onStop,
  onTaskDone,
  onTaskSkip,
  onDismissBlocker,
  onOpenChat,
}: BuildSessionProps): ReactNode {
  const [specOpen, setSpecOpen] = useState(defaultSpecOpen)
  const panel = useRef<HTMLDivElement>(null)
  const fade = useTransition(crossfade)
  const closed = build.phase === 'accepted' || build.phase === 'stopped'

  /** Closes the frozen Spec and gives the keyboard back the control that opened it. */
  function closeSpec(): void {
    setSpecOpen(false)
    // The control that closed it is gone with it: the keyboard goes back to what opened it.
    panel.current?.querySelector<HTMLElement>('[data-spec-toggle]')?.focus()
  }

  // What waits for the user, said by the band while the panel is folded, and by the chat's
  // button while the chat is minimised: the rail is not drawn, and a build nothing can be done
  // with is a build to come back to.
  const waiting = waitingOf(build)
  const waits = waiting !== undefined && !closed
  const wait = waiting === undefined ? undefined : openBlockerOf(waiting, build.blockers)
  // What it is called, in the words of the build: the blocker on the task, or the task itself.
  const words =
    waiting === undefined
      ? undefined
      : wait === undefined
        ? `${waiting.label} is yours`
        : `Blocker on ${waiting.label}`

  /** The panel of a `build` Session: the build view, and the frozen Spec beside it. */
  function mission(page: boolean): ReactNode {
    return (
      <MissionPanel
        label={`Build ${build.specKey}`}
        noun="build"
        // The panel is the page while the chat is minimised, which is where a build starts.
        page={page}
        width="wide"
        defaultFolded={false}
        head={(fold) => (
          <header className={PANEL_HEAD}>
            <IconHammer size="sm" aria-hidden="true" />
            <h2 className={PANEL_TITLE}>Build</h2>
            {
              // While the chat is minimised the panel is the page and nothing is folded: the
              // control that folds it belongs to the head, and this head is drawn without one.
              page ? null : (
                <span className="ml-auto flex">
                  <Tooltip label="Fold the build">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={<IconChevronRight size="sm" />}
                      aria-label="Fold the build"
                      data-fold
                      onClick={fold}
                    />
                  </Tooltip>
                </span>
              )
            }
          </header>
        )}
        rail={null}
        stage={
          <div ref={panel} className={ROW}>
            <div className={CENTRE}>
              <BuildView
                build={build}
                now={now}
                stories={spec.stories}
                selected={selected}
                onSelect={onSelect}
                specOpen={specOpen}
                onToggleSpec={() => (specOpen ? closeSpec() : setSpecOpen(true))}
                onPause={onPause}
                onResume={onResume}
                onAccept={onAccept}
                onStop={onStop}
                onTaskDone={onTaskDone}
                onTaskSkip={onTaskSkip}
                onDismissBlocker={onDismissBlocker}
                onOpenChat={onOpenChat}
              />
            </div>
            <AnimatePresence initial={false}>
              {specOpen && (
                <motion.div
                  key="spec"
                  className={SIDE}
                  initial={CROSSFADE.from}
                  animate={CROSSFADE.to}
                  exit={CROSSFADE.from}
                  transition={fade}
                >
                  <BuildSpecPanel spec={spec} onClose={closeSpec} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        }
        band={
          <div className={BAND}>
            <IconHammer size="md" aria-hidden="true" />
            {!closed && waits && (
              <StatusDot status="running" label="Something in the build waits for you" />
            )}
          </div>
        }
      />
    )
  }

  return (
    <SessionLayout
      head={head}
      chat={chat}
      panel={mission}
      chatOpen={chatOpen}
      onChatOpenChange={onChatOpenChange}
      // What waits for the user in the build comes before the turn's own state: a ring that
      // breathes is the one thing a minimised chat has to say about it (issue #115).
      chatState={waits ? 'waiting' : chatState}
      chatWords={waits ? words : chatWords}
      chatDetail={chatDetail}
    />
  )
}
