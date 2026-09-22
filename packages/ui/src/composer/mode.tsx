import type { ReactNode } from 'react'

import type { ModeProps, ModeVariant } from './agent-model-menu-shared.tsx'
import { ModeColumn } from './mode-column.tsx'
import { ModeList } from './mode-list.tsx'
import { ModeSelect } from './mode-select.tsx'

/**
 * The mode, drawn as whichever of the three the panel was told to draw.
 *
 * One door, for the reason the effort's is one: a panel hands over the props and a word, and
 * the catalogue is where the word is flipped. Where `column` is asked for, the panel also has
 * to give it a column to stand in — that is the one variant that changes the panel around it,
 * and each panel says so where it lays itself out.
 */
export function ModeControl({
  variant = 'list',
  ...props
}: ModeProps & { variant?: ModeVariant | undefined }): ReactNode {
  if (variant === 'column') return <ModeColumn {...props} />
  if (variant === 'select') return <ModeSelect {...props} />
  return <ModeList {...props} />
}
