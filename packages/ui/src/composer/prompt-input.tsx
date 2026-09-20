import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { Frame, FrameFooter } from '../components/frame/frame.tsx'
import { IconArrowUp, IconPlayerStop } from '../icons.ts'
import { PRESSED_COMPACT, arrival, useTransition } from '../motion.ts'
import { answerTo } from './keystroke.ts'
import { promptRows } from './lines.ts'

/**
 * The box a message is written in, and the one control that sends it (design D4b-08).
 *
 * The composer of the Home is the whole panel — files named in the sentence, files attached,
 * the Workspace, the actions. Inside a Session the question is shorter: write, and send. So
 * this is the same frame with one thing in it, and the parts that have to behave identically
 * in both — Enter, Shift+Enter, an input method composing a word — are the same decision read
 * from `keystroke.ts` rather than two branches written twice.
 *
 * It grows with what is written, from two lines to eight, and stops there. That is the
 * browser's own `field-sizing` and not an animation: a box that eased its way to a new height
 * would be a box lagging behind the sentence being typed into it. `rows` is the floor it grows
 * from, and `lines.ts` is what decides it.
 *
 * The send morphs while it is in flight: the arrow becomes a square, two icons crossing in
 * opacity and scale, which a compositor carries. The square does not stop anything — nothing
 * runs in this lot — and says so by being disabled; lot 5 gives it something to interrupt.
 */
const BOX =
  'field-sizing-content max-h-40 w-full resize-none bg-transparent px-3 py-2.5 text-base text-foreground outline-none placeholder:text-muted-foreground'

const MORPH = 'relative flex size-icon-md items-center justify-center'

export interface PromptInputProps {
  /** What is written, held by the caller so a page can keep it across a refusal. */
  value: string
  onValueChange: (value: string) => void
  /** What is done with the text. The box never clears itself: the page decides when it is kept. */
  onSend: (text: string) => void
  placeholder?: string | undefined
  /** Whether a send is in flight, which is what the arrow morphs into. */
  sending?: boolean | undefined
}

export function PromptInput({
  value,
  onValueChange,
  onSend,
  placeholder = 'Write in this Session…',
  sending = false,
}: PromptInputProps): ReactNode {
  const ready = value.trim() !== '' && !sending
  const send = (): void => {
    if (ready) onSend(value)
  }
  return (
    <Frame
      focusable
      footer={
        <FrameFooter>
          <span className="ml-auto flex items-center">
            <IconButton
              variant="primary"
              size="sm"
              disabled={!ready}
              onClick={send}
              aria-label={sending ? 'Sending' : 'Send'}
              icon={<SendMorph sending={sending} />}
            />
          </span>
        </FrameFooter>
      }
    >
      <textarea
        className={BOX}
        rows={promptRows(value)}
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          // Shift+Enter and a key an input method owns are the browser's to handle: the box
          // leaves them alone and the newline is typed the way every other character is.
          if (
            answerTo({
              key: event.key,
              shiftKey: event.shiftKey,
              isComposing: event.nativeEvent.isComposing,
              keyCode: event.nativeEvent.keyCode,
            }) !== 'send'
          ) {
            return
          }
          event.preventDefault()
          send()
        }}
      />
    </Frame>
  )
}

/** The arrow and the square, crossing rather than swapping. */
function SendMorph({ sending }: { sending: boolean }): ReactNode {
  const transition = useTransition(arrival)
  return (
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
  )
}
