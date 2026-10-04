import type { HTMLAttributes, ReactNode, Ref } from 'react'

import { Tooltip } from './tooltip.tsx'

/**
 * A mark that says what it means: its legend is a tooltip on the glyph itself, never a panel
 * beside it.
 *
 * A tooltip only hangs on something the keyboard can reach, and a glyph is not a control: it is
 * made reachable here, named for a screen reader by the same words the tooltip shows, and given
 * the focus ring. Nothing happens when it is pressed — there is nothing to do with a legend but
 * read it.
 */
const GLYPH = 'inline-flex shrink-0 rounded-full outline-none focus-ring'

export interface LegendProps {
  /** What the mark means, in words. */
  label: string
  /** The glyph. */
  children: ReactNode
}

export function Legend({ label, children }: LegendProps): ReactNode {
  return (
    <Tooltip label={label}>
      <Glyph label={label}>{children}</Glyph>
    </Tooltip>
  )
}

type GlyphProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  label: string
  children: ReactNode
  ref?: Ref<HTMLSpanElement> | undefined
}

/**
 * The glyph as the tooltip's trigger: a component and not a `<span>` written in place, because
 * the tooltip refuses a bare `<span>` — this one says for itself that it is focusable.
 */
function Glyph({ label, children, ref, ...handed }: GlyphProps): ReactNode {
  return (
    <span {...handed} ref={ref} role="img" aria-label={label} tabIndex={0} className={GLYPH}>
      {children}
    </span>
  )
}
