import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button, IconButton } from '../../components/button/button.tsx'
import {
  LETTER_TONES,
  type LetterTone,
  letterToneOf,
} from '../../components/letter-avatar/letter-avatar.tsx'
import {
  type Identity,
  MARK_ICONS,
  MARK_ICON_WORDS,
  type MarkIcon,
  ProjectMark,
  markIcon,
} from '../../components/project-mark/project-mark.tsx'
import { Select } from '../../components/select/select.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconPhoto, IconX } from '../../icons.ts'

/**
 * How a Project is marked wherever it is named — the sidebar, its header: a colour among the
 * theme's tones, then the letter or an icon of the short set, or a small image of the user's own.
 * What it gives is drawn at its head, beside the name, as the sidebar will draw it. Nothing chosen
 * is the letter in the tone of the name, which is what the colour shows ticked to begin with.
 */
export interface IdentityFieldProps {
  name: string
  identity: Identity
  onChange: (identity: Identity) => void
  /** Opens the system's picker for an image; what it gives comes back through `onChange`. */
  onChooseImage: () => void
}

const TONE_WORDS: Record<LetterTone, string> = {
  primary: 'Fuchsia',
  info: 'Blue',
  success: 'Green',
  warning: 'Amber',
  build: 'Cyan',
}

/** A swatch: the tone's solid colour, round, the ring of the focus and a ring when chosen. */
const SWATCH: Record<LetterTone, string> = {
  primary: 'size-icon-md rounded-full bg-primary',
  info: 'size-icon-md rounded-full bg-info',
  success: 'size-icon-md rounded-full bg-success',
  warning: 'size-icon-md rounded-full bg-warning',
  build: 'size-icon-md rounded-full bg-build',
}

const CHOICE =
  'flex size-control-sm items-center justify-center rounded-full border-2 border-transparent outline-none focus-ring hover-motion aria-checked:border-foreground'

/** The value the icon select holds for the letter. */
const LETTER = 'letter'

const LABEL = 'text-sm font-medium'

export function IdentityField({
  name,
  identity,
  onChange,
  onChooseImage,
}: IdentityFieldProps): ReactNode {
  const tone = identity.tone ?? letterToneOf(name)
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={cn(LABEL, 'pb-2')}>Mark</legend>
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2 text-sm" data-mark-preview="">
          <ProjectMark name={name === '' ? 'Project' : name} identity={identity} />
          <span className="font-medium">{name === '' ? 'Project' : name}</span>
        </span>
        <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1">
          {LETTER_TONES.map((one) => (
            <button
              key={one}
              type="button"
              role="radio"
              aria-checked={one === tone}
              aria-label={TONE_WORDS[one]}
              // One stop for the group: the chosen tone takes the tab, the arrows walk the rest.
              tabIndex={one === tone ? 0 : -1}
              className={CHOICE}
              onClick={() => onChange({ ...identity, tone: one })}
              onKeyDown={(event) => {
                const by =
                  event.key === 'ArrowRight' || event.key === 'ArrowDown'
                    ? 1
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                      ? -1
                      : 0
                if (by === 0) return
                event.preventDefault()
                const at =
                  (LETTER_TONES.indexOf(one) + by + LETTER_TONES.length) % LETTER_TONES.length
                const next = LETTER_TONES[at] ?? one
                onChange({ ...identity, tone: next })
                const group = event.currentTarget.parentElement
                group?.querySelector<HTMLButtonElement>(`[data-tone="${next}"]`)?.focus()
              }}
              data-tone={one}
            >
              <span aria-hidden="true" className={SWATCH[one]} />
            </button>
          ))}
        </div>
        <Select<MarkIcon | typeof LETTER>
          label="Icon"
          value={identity.icon ?? LETTER}
          onValueChange={(value) =>
            onChange({ ...identity, icon: value === LETTER ? undefined : value })
          }
          items={[
            { value: LETTER, label: 'Letter' },
            ...MARK_ICONS.map((icon) => ({
              value: icon,
              label: MARK_ICON_WORDS[icon],
              icon: <span className="flex text-muted-foreground">{markIcon(icon)}</span>,
            })),
          ]}
        />
        {identity.image === undefined ? (
          <Button onClick={onChooseImage}>
            <IconPhoto size="sm" />
            Choose an image…
          </Button>
        ) : (
          <Tooltip label="Remove the image">
            <IconButton
              variant="ghost"
              icon={<IconX size="sm" />}
              aria-label="Remove the image"
              onClick={() => onChange({ ...identity, image: undefined })}
            />
          </Tooltip>
        )}
      </div>
    </fieldset>
  )
}
