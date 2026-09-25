import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useRef, useState } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { StatusDot } from '../components/status-dot/status-dot.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconChevronRight, IconMessages } from '../icons.ts'
import { CROSSFADE, crossfade, useTransition } from '../motion.ts'
import { MissionPanel } from '../session/mission-panel.tsx'
import type { SpecView } from '../spec/model.ts'
import { BlockerBlock } from './blocker-block.tsx'
import { BuildSpecPanel } from './build-spec-panel.tsx'
import { BuildView, type BuildViewProps, dependantsOf } from './build-view.tsx'
import { openBlockerOf } from './model.ts'
import { YoursBlock } from './yours-block.tsx'

/**
 * A `build` Session's page (D10-12): the define layout turned over. The build view stands at the
 * centre and takes the larger part of the row; the chat stands narrow on its right, folded to a
 * band or unfolded, in the same mission panel the Spec of a `define` Session stands in — the same
 * fold, the same width that pushes, the same rule that the hand's fold holds against the agent.
 *
 * "Spec" in the build view's head opens the frozen Spec beside the view, read only. The views
 * around the build are closable and never open together (core.md, "Session view"): opening the
 * Spec folds the chat to its band, unfolding the chat closes the Spec, and closing the Spec gives
 * the chat back the way it was. The chat is never out of reach: folded, its band stays at the
 * edge of the row, and says when something in it waits for the user.
 *
 * What waits for the user in the build — a task that is theirs, a blocker the agent raised — is
 * said in the view, and as a banner above the chat's composer: the page hands that banner to the
 * chat it is given, which puts it where the composer's own waiting strip goes. The banner's
 * "Open" puts the task on the view's stage.
 */

const ROW = '@container flex h-full min-h-0 bg-background text-foreground'

const CENTRE = 'flex min-h-0 min-w-0 flex-1 flex-col'

const SIDE = 'flex shrink-0'

const CHAT_HEAD = 'flex shrink-0 items-center gap-2 border-b border-border px-4 py-2'

const CHAT_TITLE = 'text-sm font-medium'

const CHAT_STAGE = 'flex min-h-0 min-w-0 flex-1 flex-col'

const BAND = 'flex flex-col items-center gap-3 pt-3 text-muted-foreground'

export interface BuildSessionProps extends Omit<
  BuildViewProps,
  'selected' | 'onSelect' | 'specOpen' | 'onToggleSpec'
> {
  /** The head of the Session, drawn across the top of the page: its title, its details. */
  header?: ReactNode
  /** The frozen revision the build works from, which "Spec" opens read only. */
  spec: SpecView
  /**
   * The chat: the thread and the composer, handed the banner of what waits for the user in the
   * build, to stand above the composer; `null` when nothing does.
   */
  chat: (banner: ReactNode) => ReactNode
  /**
   * What waits for the user in the chat, in a sentence — a permission the agent asks — which the
   * band says while the chat is folded. When it changes to something, the chat unfolds onto it,
   * unless the hand folded it.
   */
  chatWaiting?: string | undefined
  /** Whether the chat opens folded to its band; it opens unfolded unless told otherwise. */
  defaultChatFolded?: boolean | undefined
  /** Whether the frozen Spec opens beside the view, for the story that shows it. */
  defaultSpecOpen?: boolean | undefined
}

export function BuildSession({
  header,
  spec,
  chat,
  chatWaiting,
  defaultChatFolded = false,
  defaultSpecOpen = false,
  ...view
}: BuildSessionProps): ReactNode {
  const { build, now } = view
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [specOpen, setSpecOpen] = useState(defaultSpecOpen)
  // What the page asks of the chat's fold: folded while the Spec is open, and back to how it was
  // once the Spec closes.
  const [chatFolded, setChatFolded] = useState(defaultChatFolded || defaultSpecOpen)
  const before = useRef(defaultChatFolded)
  const page = useRef<HTMLDivElement>(null)
  const fade = useTransition(crossfade)
  const closed = build.phase === 'accepted' || build.phase === 'stopped'

  const openSpec = () => {
    before.current = chatFolded
    setChatFolded(true)
    setSpecOpen(true)
  }

  const closeSpec = () => {
    setSpecOpen(false)
    setChatFolded(before.current)
    // The control that closed it is gone with it: the keyboard goes back to what opened it.
    page.current?.querySelector<HTMLElement>('[data-spec-toggle]')?.focus()
  }

  /** The banner of the first thing in the build that waits for the user, if any. */
  function banner(): ReactNode {
    if (closed) return null
    const yours = build.tasks.find((task) => task.state === 'yours')
    if (yours !== undefined) {
      return (
        <YoursBlock
          variant="banner"
          task={yours}
          dependants={dependantsOf(yours.label, build.tasks)}
          onDone={() => view.onTaskDone(yours.id)}
          onSkip={(reason, unblock) => view.onTaskSkip(yours.id, reason, unblock)}
          onOpen={() => setSelected(yours.id)}
        />
      )
    }
    const blocked = build.tasks.find((task) => openBlockerOf(task, build.blockers) !== undefined)
    const blocker = blocked === undefined ? undefined : openBlockerOf(blocked, build.blockers)
    if (blocked === undefined || blocker === undefined) return null
    return (
      <BlockerBlock
        variant="banner"
        blocker={blocker}
        specKey={build.specKey}
        now={now}
        suspended={dependantsOf(blocked.label, build.tasks)}
        onDismiss={() => view.onDismissBlocker(blocker.id)}
        onStop={view.onStop}
        onOpen={() => setSelected(blocked.id)}
      />
    )
  }

  const said = banner()
  const waiting =
    chatWaiting ?? (said === null ? undefined : 'Something in the build waits for you')

  return (
    <div ref={page} className="flex h-full min-h-0 flex-col">
      {header}
      <div className={ROW}>
        <div className={CENTRE}>
          <BuildView
            {...view}
            selected={selected}
            onSelect={setSelected}
            specOpen={specOpen}
            onToggleSpec={() => (specOpen ? closeSpec() : openSpec())}
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
        <MissionPanel
          label="Chat"
          noun="chat"
          width="narrow"
          defaultFolded={chatFolded}
          folded={chatFolded}
          following={chatWaiting}
          onFoldChange={(folded) => {
            setChatFolded(folded)
            // The chat unfolded by the hand, or by the agent asking: the Spec gives it the room.
            if (!folded) setSpecOpen(false)
          }}
          head={(fold) => (
            <header className={CHAT_HEAD}>
              <IconMessages size="sm" aria-hidden="true" />
              <h2 className={CHAT_TITLE}>Chat</h2>
              <span className="ml-auto flex">
                <Tooltip label="Fold the chat">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<IconChevronRight size="sm" />}
                    aria-label="Fold the chat"
                    data-fold
                    onClick={fold}
                  />
                </Tooltip>
              </span>
            </header>
          )}
          rail={null}
          stage={<div className={CHAT_STAGE}>{chat(said)}</div>}
          band={
            <div className={BAND}>
              <IconMessages size="md" aria-hidden="true" />
              {waiting !== undefined && <StatusDot status="running" label={waiting} />}
            </div>
          }
        />
      </div>
    </div>
  )
}
