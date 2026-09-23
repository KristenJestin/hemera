import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react'

/**
 * A text of the Spec, edited where it is read (lot 19, the brief).
 *
 * It is a plain text area that looks like the rendered text until it has the focus: no Edit
 * button to find, no Save button to forget. The reader points at a sentence, the caret is in it;
 * the caret leaves, the text is handed over once — never a version per keystroke, which is what
 * the engine would refuse as stale anyway (D7-12). Escape puts back what was there and leaves.
 *
 * What it was handed is followed while nobody types in it: an agent that rewrites a section the
 * reader is only looking at is seen rewriting it. While the caret is inside, what is typed wins
 * on the screen, and the conflict rule is the section's to apply when the text is handed over.
 */

/**
 * The area at rest reads as text: no border, no fill, the text's own size and leading. The hand
 * over it finds a surface; the caret in it finds the field, recessed onto the body surface with
 * the halo of the focus. The box follows the text (`field-sizing`), so nothing scrolls inside a
 * section and nothing is measured from JavaScript.
 */
const AREA =
  'block w-full resize-none field-sizing-content rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground hover:bg-accent focus:border-input focus:bg-surface-body focus:halo'

/** The room the area gives back on both sides, so its text lines up with the heading above it. */
const BLEED = '-mx-2'

export interface InPlaceTextProps {
  /** What the area is called, since it wears no visible label: `Scope`, `Criterion 2 of S1`. */
  label: string
  /** The text as it stands. */
  value: string
  /** The text, once, when the caret leaves it changed. */
  onCommit: (text: string) => void
  placeholder?: string | undefined
  /** How many lines it shows while it is empty. */
  rows?: number | undefined
  /** Takes the caret when it appears: an answer field opened by a click. */
  autoFocus?: boolean | undefined
  ref?: Ref<HTMLTextAreaElement> | undefined
}

export function InPlaceText({
  label,
  value,
  onCommit,
  placeholder,
  rows = 1,
  autoFocus = false,
  ref,
}: InPlaceTextProps): ReactNode {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)
  // Escape leaves through the same blur as a click elsewhere, and this is what tells the two
  // apart: the blur that follows an Escape hands nothing over.
  const dropping = useRef(false)
  // A text rewritten from outside is shown as it now stands, unless the reader is typing in it.
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value])
  return (
    <div className={BLEED}>
      <textarea
        ref={ref}
        aria-label={label}
        className={AREA}
        rows={rows}
        placeholder={placeholder}
        // Opened by a click on purpose — the answer field of a question — and taking the caret
        // is the whole of what the click asked for.
        autoFocus={autoFocus}
        value={draft}
        onFocus={() => {
          editing.current = true
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          editing.current = false
          if (dropping.current) {
            dropping.current = false
            setDraft(value)
            return
          }
          if (draft !== value) onCommit(draft)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          dropping.current = true
          event.currentTarget.blur()
        }}
      />
    </div>
  )
}
