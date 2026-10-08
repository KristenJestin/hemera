import { Field } from '@base-ui/react/field'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import type { ReactNode } from 'react'

import { IconPhoto, IconX } from '../../icons.ts'
import { Button } from '../button/button.tsx'
import { LETTER_TONES, type LetterTone, letterToneOf } from '../letter-avatar/letter-avatar.tsx'
import { Popover } from '../popover/popover.tsx'
import {
  type Identity,
  MARK_ICONS,
  MARK_ICON_WORDS,
  type MarkIcon,
  ProjectMark,
} from './project-mark.tsx'

/**
 * The Project's mark, chosen where its name is typed. The mark itself is the control, drawn as the
 * sidebar will draw it, and it opens one panel: the symbols — the letter, the icons of the set, the
 * image when there is one — each drawn in the colour chosen, so the panel shows the marks it gives;
 * then the colours; then an image of the user's own, a logo. One mark at a time: a symbol chosen
 * drops the image. Nothing chosen is the letter in the tone of the name.
 */
export interface MarkPickerProps {
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

const SWATCH: Record<LetterTone, string> = {
  primary: 'size-icon-md rounded-full bg-primary-fill',
  info: 'size-icon-md rounded-full bg-info',
  success: 'size-icon-md rounded-full bg-success',
  warning: 'size-icon-md rounded-full bg-warning',
  build: 'size-icon-md rounded-full bg-build',
}

const TRIGGER =
  'flex size-control-md shrink-0 items-center justify-center rounded-md border border-input bg-input-fill outline-none focus-ring hover-motion hover:tinted'

const SYMBOL =
  'flex size-control-sm items-center justify-center rounded-md outline-none focus-ring hover-motion hover:tinted data-checked:bg-muted data-checked:ring-1 data-checked:ring-border'

const COLOUR =
  'flex size-control-sm items-center justify-center rounded-full border-2 border-transparent outline-none focus-ring hover-motion data-checked:border-foreground'

const GROUP_LABEL = 'text-xs text-muted-foreground'

/** The symbol of the letter, and of the image, among the icons. */
const LETTER = 'letter'
const IMAGE = 'image'

type Symbol = MarkIcon | typeof LETTER | typeof IMAGE

function symbolOf(identity: Identity): Symbol {
  if (identity.image !== undefined) return IMAGE
  return identity.icon ?? LETTER
}

function wordOf(symbol: Symbol): string {
  if (symbol === LETTER) return 'Letter'
  if (symbol === IMAGE) return 'Image'
  return MARK_ICON_WORDS[symbol]
}

export function MarkPicker({
  name,
  identity,
  onChange,
  onChooseImage,
}: MarkPickerProps): ReactNode {
  const shown = name === '' ? 'Project' : name
  const said = name === '' ? 'the Project' : name
  const tone = identity.tone ?? letterToneOf(shown)
  const symbols: readonly Symbol[] =
    identity.image === undefined ? [LETTER, ...MARK_ICONS] : [LETTER, ...MARK_ICONS, IMAGE]
  return (
    <Popover
      align="start"
      label={`Mark of ${said}`}
      trigger={
        <button type="button" aria-label={`Mark of ${said}`} className={TRIGGER}>
          <ProjectMark name={shown} identity={identity} />
        </button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* A field of its own around each group: the picker sits in the name's field, and the
            name's label would otherwise name every radio of the panel "Name". */}
        <Field.Root className="flex flex-col gap-1.5">
          <span className={GROUP_LABEL} aria-hidden="true">
            Symbol
          </span>
          <RadioGroup
            aria-label="Symbol"
            value={symbolOf(identity)}
            onValueChange={(value) => {
              if (value === IMAGE) return
              onChange({ tone: identity.tone, icon: value === LETTER ? undefined : value })
            }}
            className="grid grid-cols-5 gap-1"
          >
            {symbols.map((symbol) => (
              <Radio.Root
                key={symbol}
                value={symbol}
                aria-label={wordOf(symbol)}
                className={SYMBOL}
                data-tone={tone}
              >
                <ProjectMark
                  name={shown}
                  identity={
                    symbol === IMAGE
                      ? identity
                      : { tone, icon: symbol === LETTER ? undefined : symbol }
                  }
                />
              </Radio.Root>
            ))}
          </RadioGroup>
        </Field.Root>
        <Field.Root className="flex flex-col gap-1.5">
          <span className={GROUP_LABEL} aria-hidden="true">
            Colour
          </span>
          <RadioGroup
            aria-label="Colour"
            value={tone}
            onValueChange={(value) => onChange({ ...identity, tone: value })}
            className="flex items-center gap-1"
          >
            {LETTER_TONES.map((one) => (
              <Radio.Root
                key={one}
                value={one}
                aria-label={TONE_WORDS[one]}
                className={COLOUR}
                data-tone={one}
              >
                <span aria-hidden="true" className={SWATCH[one]} />
              </Radio.Root>
            ))}
          </RadioGroup>
        </Field.Root>
        <div className="flex items-center gap-1 border-t border-border pt-3">
          <Button size="sm" variant="ghost" onClick={onChooseImage}>
            <IconPhoto size="sm" />
            Upload an image…
          </Button>
          {identity.image !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ ...identity, image: undefined })}
            >
              <IconX size="sm" />
              Remove the image
            </Button>
          )}
        </div>
      </div>
    </Popover>
  )
}
