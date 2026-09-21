import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { Kbd } from '../components/kbd/kbd.tsx'
import { IconArrowUp, IconPencil, IconPlayerStop } from '../icons.ts'
import { PRESSED_COMPACT, arrival, useTransition } from '../motion.ts'
import { WorkspacePill } from './workspace-pill.tsx'

/**
 * The foot of the composer: which Workspace is being written about, and what sending does.
 *
 * Sending is the one live control of the row, and the only one that writes: `onSend` hands the
 * sentence to the page, which records it and answers with the reason it could not, or with
 * nothing when it did. `New Spec` stays disabled — a Spec is lot 6 — and the arrow becomes a
 * square while the write is in flight: two icons crossing in opacity and scale, a morph a
 * compositor carries, and never a swap that flickers.
 *
 * The square is two states that share a glyph. A write in flight cannot be interrupted — that
 * is lot 5's, and the button is disabled while it is drawn. A turn running can be: the square is
 * then the Stop of design D17-13, it says so, and pressing it cancels the turn. One glyph, two
 * meanings, told apart by the word beside it and by whether it can be pressed at all.
 */
const MORPH = 'relative flex size-icon-md items-center justify-center'

export interface ComposerActionsProps {
  /** The Workspaces on offer; this lot has one, and lot 7 brings the others. */
  workspaces: string[]
  workspace: string
  onWorkspaceChange: (workspace: string) => void
  /** Whether there is anything to send at all. */
  ready: boolean
  /** Whether a send is in flight, which is what the arrow morphs into. */
  sending: boolean
  /** Whether an agent turn is running, which is what the square stops. */
  running?: boolean | undefined
  /** The word on the button: `Start chat` on the Home, `Send` inside a Session. */
  action: string
  onSend: () => void
  /** Cancels the running turn, when there is one to cancel. */
  onStop?: (() => void) | undefined
}

export function ComposerActions({
  workspaces,
  workspace,
  onWorkspaceChange,
  ready,
  sending,
  running = false,
  action,
  onSend,
  onStop,
}: ComposerActionsProps): ReactNode {
  const transition = useTransition(arrival)
  const morphs = sending || running
  return (
    <>
      <WorkspacePill
        workspaces={workspaces}
        workspace={workspace}
        onWorkspaceChange={onWorkspaceChange}
      />
      <span className="ml-auto flex items-center gap-2">
        <Button variant="secondary" size="sm" disabled title="A Spec comes with lot 6">
          <IconPencil size="sm" />
          New Spec
        </Button>
        <Button
          variant={running ? 'secondary' : 'primary'}
          size="sm"
          disabled={running ? false : !ready}
          onClick={running ? onStop : onSend}
        >
          <span className={MORPH}>
            <AnimatePresence initial={false} mode="popLayout">
              {morphs ? (
                <motion.span
                  key="stop"
                  initial={{ opacity: 0, scale: PRESSED_COMPACT }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: PRESSED_COMPACT }}
                  transition={transition}
                >
                  <IconPlayerStop size="sm" />
                </motion.span>
              ) : (
                <motion.span
                  key="send"
                  initial={{ opacity: 0, scale: PRESSED_COMPACT }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: PRESSED_COMPACT }}
                  transition={transition}
                >
                  <IconArrowUp size="sm" />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          {running ? 'Stop' : action}
          {running ? null : <Kbd keys="Enter" />}
        </Button>
      </span>
    </>
  )
}
