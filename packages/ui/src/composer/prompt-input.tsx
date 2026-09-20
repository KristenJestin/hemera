import { cn } from 'cn'
import type { ReactNode } from 'react'

/**
 * The prompt input: the surface a sentence is written on, and the keys that end it (design
 * D4b-08, D4-07).
 *
 * Two shapes, and a shape is a floor and never a height. `hero` is the Home's greeting, where
 * the box is given its tallest floor before anything is typed; `inline` is the foot of a
 * Session, where two lines are enough and the box gives itself its own. Above that floor the box
 * follows the sentence — the browser's `field-sizing` does the growing, the box is the caller's,
 * and nothing here measures anything — and at eight lines of the base size the surface stops
 * growing and scrolls instead. A box that eased its way to a new height would be a box lagging
 * behind the sentence being typed into it.
 *
 * The editable arrives as `children`, because what is inside the box is nobody's business here:
 * the composer puts a `ComposerBox` in it, with its chips and its caret, and this surface
 * neither knows nor cares what it was handed. What it owns is the keyboard, because that is one
 * contract and it belongs in one place. Enter sends, Shift+Enter breaks the line, and an IME
 * mid-word is never interrupted: the Enter that commits a composition belongs to the
 * composition, and sending half a word is the one thing a box of this shape must never do.
 *
 * The keys are read on the row the box sits in, and not on the surface: the row of controls
 * under the box is a sibling of it, and a control that is pressed with Enter must not send a
 * sentence as well. A caller with something to say about a key says it first, by taking the key
 * where the caret is — the mention menu reads the arrows and Enter itself and calls
 * `preventDefault`, which is how this row knows the key is already spoken for.
 *
 * The send itself is the composer's: what is written belongs to the page, and writing it is a
 * Session's business. This surface starts the gesture and says whether there is anything to
 * send; the arrow that becomes a square while the write is in flight is drawn in the frame's
 * own footer, one band below, where the prototype settled it.
 */
const SURFACE = 'flex flex-col gap-1 px-4 pt-3 pb-2'

/** The row of controls under the box: what is done to the prompt, not what is done with it. */
const TOOLS = 'flex items-center gap-1'

/**
 * The floor the box is given, one shape per place a prompt is written.
 *
 * Six rem is the prototype's own hero height, and a step of the scale. The inline shape asks for
 * nothing the box does not already give itself: two lines of the base size. The prototype's
 * third-and-a-half rem for the inline is not a step of the scale, and a step is the whole point
 * of having one.
 */
const SHAPE = {
  hero: 'min-h-24',
  inline: 'min-h-12',
} as const

/**
 * How the box is held: a row, so the editable fills the floor rather than sitting at the top of
 * it — an empty band under the caret is a band that does nothing when it is clicked. `max-h-40`
 * is eight lines of the base size and `overflow-y-auto` is what happens past them: the box stops
 * and the sentence scrolls, which is what a prompt input does.
 *
 * `overflow-wrap: anywhere` is there because `overflow-y-auto` cannot be had without `auto` on
 * the other axis, and a scrollbar along the floor of the box is not a scrollbar anybody wants:
 * a word longer than the line — a pasted path, a chip that will not shorten — wraps instead of
 * pushing the box, and with it the whole composer, sideways.
 */
const FIELD = 'flex max-h-40 min-w-0 overflow-y-auto break-words'

/** Which of the two places a prompt is written: the Home's greeting, or a Session's foot. */
export type PromptShape = keyof typeof SHAPE

export interface PromptInputProps {
  /** The shape: the Home's greeting, or the foot of a Session. */
  variant?: PromptShape | undefined
  /** Whether there is anything to send at all. Enter asks it exactly as the button does. */
  ready: boolean
  /** What Enter does — the send, which the composer owns and this surface only starts. */
  onSend: () => void
  /** The row of controls under the box. */
  tools?: ReactNode
  /** The editable: where the caret lives, and what the sentence is written into. */
  children: ReactNode
}

export function PromptInput({
  variant = 'inline',
  ready,
  onSend,
  tools,
  children,
}: PromptInputProps): ReactNode {
  return (
    <div className={SURFACE}>
      <div
        className={cn(FIELD, SHAPE[variant])}
        onKeyDown={(event) => {
          // A key the caller took is a key already answered: the mention menu, the box's own
          // shortcuts, whatever the editable does with what was typed into it.
          if (event.defaultPrevented) return
          // Shift+Enter is a line break, and the browser already knows how to draw one.
          if (event.key !== 'Enter' || event.shiftKey) return
          // An IME mid-word: this Enter commits the composition, it does not send it.
          if (event.nativeEvent.isComposing) return
          if (!ready) return
          event.preventDefault()
          onSend()
        }}
      >
        {children}
      </div>
      {tools !== undefined && <div className={TOOLS}>{tools}</div>}
    </div>
  )
}
