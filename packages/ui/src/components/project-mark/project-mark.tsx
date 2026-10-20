import type { ReactNode } from 'react'

import { LetterAvatar } from '../letter-avatar/letter-avatar.tsx'
import { type LetterTone, letterToneOf } from '../letter-avatar/letter-names.ts'
import { Legend } from '../tooltip/legend.tsx'
import { type MarkIcon, markIcon } from './mark-icons.tsx'

/** What the user chose for a mark; nothing chosen is the letter in the tone of its name. */
export interface Identity {
  tone?: LetterTone | undefined
  icon?: MarkIcon | undefined
  /** A small image of their own, as an address the renderer can draw: a logo. */
  image?: string | undefined
}

const ICON: Record<LetterTone, string> = {
  primary:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-primary-muted text-primary-muted-foreground',
  info: 'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-info-muted text-info-muted-foreground',
  success:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-success-muted text-success-muted-foreground',
  warning:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-warning-muted text-warning-muted-foreground',
  build:
    'inline-flex size-icon-sm shrink-0 items-center justify-center rounded-full bg-build-muted text-build-muted-foreground',
}

const IMAGE = 'size-icon-sm shrink-0 rounded-full border border-border object-cover'

export interface ProjectMarkProps {
  name: string
  /** The other names of the same set, which decide whether one letter is enough. */
  others?: readonly string[] | undefined
  identity?: Identity | undefined
  /** Whether it says its name in a tooltip on itself. */
  legend?: boolean | undefined
}

export function ProjectMark({
  name,
  others,
  identity = {},
  legend = false,
}: ProjectMarkProps): ReactNode {
  const tone = identity.tone ?? letterToneOf(name)
  if (identity.image === undefined && identity.icon === undefined) {
    return <LetterAvatar name={name} others={others} tone={tone} legend={legend} />
  }
  const mark =
    identity.image === undefined ? (
      <span aria-hidden="true" className={ICON[tone]} data-mark-icon={identity.icon}>
        {identity.icon !== undefined && markIcon(identity.icon, 'mark')}
      </span>
    ) : (
      <img aria-hidden="true" alt="" src={identity.image} className={IMAGE} data-mark-image="" />
    )
  if (!legend) return mark
  return <Legend label={name}>{mark}</Legend>
}
