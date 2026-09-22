import type { ReactNode } from 'react'

import type { EffortProps, EffortVariant } from './agent-model-menu-shared.tsx'
import { EffortDial } from './effort-dial.tsx'
import { EffortRow } from './effort-row.tsx'
import { EffortSlider } from './effort-slider.tsx'

/**
 * The effort, drawn as whichever of the three the panel was told to draw.
 *
 * One door, so a panel never knows there are three: it hands over the props and a word, and the
 * catalogue is where the word is flipped. This is the whole of what variant-picking costs, and
 * it is here rather than in each panel because two panels asking the same question in two
 * different ways is exactly what a comparison must not do.
 */
export function EffortControl({
  variant = 'row',
  ...props
}: EffortProps & { variant?: EffortVariant | undefined }): ReactNode {
  if (variant === 'slider') return <EffortSlider {...props} />
  if (variant === 'dial') return <EffortDial {...props} />
  return <EffortRow {...props} />
}
