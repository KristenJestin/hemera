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
 * The square is a state and not a stop. Pressing it does nothing, and the button is disabled
 * for as long as it is drawn: interrupting a write is lot 5's, and a control that looked like it
 * could stop something it cannot would be the one lie in the row.
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
  /** The word on the button: `Start chat` on the Home, `Send` inside a Session. */
  action: string
  onSend: () => void
}

export function ComposerActions({
  workspaces,
  workspace,
  onWorkspaceChange,
  ready,
  sending,
  action,
  onSend,
}: ComposerActionsProps): ReactNode {
  const transition = useTransition(arrival)
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
        <Button variant="primary" size="sm" disabled={!ready} onClick={onSend}>
          <span className={MORPH}>
            <AnimatePresence initial={false} mode="popLayout">
              {sending ? (
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
          {action}
          <Kbd keys="Enter" />
        </Button>
      </span>
    </>
  )
}
