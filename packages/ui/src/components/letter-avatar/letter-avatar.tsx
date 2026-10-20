import type { ReactNode } from 'react'

import { Legend } from '../tooltip/legend.tsx'
import { type LetterTone, letterToneOf, initialsOf } from './letter-names.ts'

const AVATAR: Record<LetterTone, string> = {
  primary:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-primary-muted text-xs font-semibold tracking-tighter text-primary-muted-foreground',
  info: 'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-info-muted text-xs font-semibold tracking-tighter text-info-muted-foreground',
  success:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-success-muted text-xs font-semibold tracking-tighter text-success-muted-foreground',
  warning:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-warning-muted text-xs font-semibold tracking-tighter text-warning-muted-foreground',
  build:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-build-muted text-xs font-semibold tracking-tighter text-build-muted-foreground',
}

export interface LetterAvatarProps {
  name: string
  /** The other names of the same set, which decide whether one letter is enough. */
  others?: readonly string[] | undefined
  /** The tone its definition gives it, worn instead of the one read from its name. */
  tone?: LetterTone | undefined
  /** Whether it is drawn without its name beside it, and says it in a tooltip on itself. */
  legend?: boolean | undefined
}

export function LetterAvatar({
  name,
  others = [],
  tone,
  legend = false,
}: LetterAvatarProps): ReactNode {
  const avatar = (
    <span aria-hidden="true" className={AVATAR[tone ?? letterToneOf(name)]} data-avatar="">
      {initialsOf(name, others)}
    </span>
  )
  if (!legend) return avatar
  return <Legend label={name}>{avatar}</Legend>
}
