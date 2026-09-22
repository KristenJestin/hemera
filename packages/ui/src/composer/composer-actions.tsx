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
 * nothing when it did. `New Spec` is the Home's alone and stays disabled there — a Spec is made
 * from the question that starts a Session, and the Spec itself is lot 6 — and the arrow becomes a
 * square while the write is in flight: two icons crossing in opacity and scale, a morph a
 * compositor carries, and never a swap that flickers.
 *
 * The square is two states that share a glyph. A write in flight cannot be interrupted — that
 * is lot 5's, and the button is disabled while it is drawn. A turn running can be: the square is
 * then the Stop of design D17-13, it says so, and pressing it cancels the turn. One glyph, two
 * meanings, told apart by the word beside it and by whether it can be pressed at all.
 *
 * A write in flight changes nothing of the control: the same square, in the same place, and the
 * same word. It adds the indicator the button draws in front of its label, and takes the press
 * away until the engine has answered — the row does not move under the hand that pressed it.
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
  /**
   * Whether the row offers to turn what is written into a Spec (design D4b-02).
   *
   * The Home does and a Session does not: a Session is a conversation already under way, and a
   * Spec is made from the question that starts one. Off unless the page asks for it — a control
   * drawn and disabled in every place it appears is a control that says nothing about where it
   * belongs.
   */
  spec?: boolean | undefined
  /** The word on the button: `Start chat` on the Home, `Send` inside a Session. */
  action: string
  onSend: () => void
  /** Cancels the running turn, when there is one to cancel. */
  onStop?: (() => void) | undefined
  /**
   * Why the send cannot be pressed, said on the control itself (design D4b-02).
   *
   * A control that is off and says nothing is a control the reader is left to guess about. The
   * reason rides the button — `aria-disabled`, so whatever reads the page says it is off rather
   * than passing over it, and `title`, so the reason itself is there to be asked for — instead
   * of a paragraph above the frame, which moved the whole box the moment it appeared.
   */
  sendDisabledReason?: string | undefined
}

export function ComposerActions({
  workspaces,
  workspace,
  onWorkspaceChange,
  ready,
  sending,
  running = false,
  spec = false,
  action,
  onSend,
  onStop,
  sendDisabledReason,
}: ComposerActionsProps): ReactNode {
  const transition = useTransition(arrival)
  const morphs = sending || running
  // A write in flight is a wait, and a wait that only took the press away would look like a
  // control that stopped working. The indicator the button draws is what says so; the word and
  // the glyph stay as they are.
  const busy = sending && !running
  /** Whether the send is off for a reason the caller gave, which is a reason worth saying. */
  const blocked = !running && sendDisabledReason !== undefined
  return (
    <>
      <WorkspacePill
        workspaces={workspaces}
        workspace={workspace}
        onWorkspaceChange={onWorkspaceChange}
      />
      <span className="ml-auto flex items-center gap-2">
        {spec && (
          <Button variant="secondary" size="sm" disabled title="A Spec comes with lot 6">
            <IconPencil size="sm" />
            New Spec
          </Button>
        )}
        <Button
          variant={running ? 'secondary' : 'primary'}
          size="sm"
          state={busy ? 'loading' : 'idle'}
          disabled={running ? false : busy || !ready}
          // Said when the control is off for a reason it can give: a write in flight, which the
          // button already says it is waiting on, or a Session with no agent behind it. Not when
          // there is simply nothing typed yet — the empty box is its own explanation. It is
          // written here rather than left to Base UI because a value handed to a component wins
          // over the one the component computes, and `undefined` handed over is a value.
          aria-disabled={busy || blocked ? true : undefined}
          title={running ? undefined : sendDisabledReason}
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
