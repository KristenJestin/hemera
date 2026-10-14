import type { ReactNode } from 'react'

import { IconArrowUp, IconPlayerStop } from '../../icons.ts'
import { IconButton } from '../button/button.tsx'
import { Tooltip } from '../tooltip/tooltip.tsx'

import {
  type MentionKind,
  type Mentionable,
  type MentionRef,
  GLYPHS,
  shortName,
} from './mention-model.tsx'

export interface MentionFieldProps {
  /** What the field is called. */
  label: string
  placeholder?: string | undefined
  /** The text, a mention written `@` and its label. */
  value: string
  /** The text, and the mentions it holds in their order, as structured data. */
  onValueChange: (value: string, mentions: readonly MentionRef[]) => void
  /**
   * The mentions the value holds, when they are known: each is drawn as its badge even when no
   * source lists it any longer.
   */
  mentions?: readonly MentionRef[] | undefined
  /** What can be mentioned without asking: the recent ones carry their rank. */
  mentionables: readonly Mentionable[]
  /**
   * A source searched as one types (the files of a large checkout, say): what it finds is ranked
   * with `mentionables`. Rows of a mention's shape stand in while it answers, and a failure is
   * said in the menu, in its own words.
   */
  search?: ((query: string, signal: AbortSignal) => Promise<readonly Mentionable[]>) | undefined
  /**
   * What Enter and the Send in the box's corner do; left out, Enter starts a new line and there
   * is no Send.
   */
  onSubmit?: (() => void) | undefined
  /** Whether what was sent is being worked on: Send is then Stop, and Enter sends nothing. */
  working?: boolean | undefined
  /** What Stop does, while `working`. */
  onStop?: (() => void) | undefined
  /** What stands at the start of the box's foot: the composer's model picker. */
  leading?: ReactNode
  /** What stands at its end, before Send. */
  trailing?: ReactNode
  disabled?: boolean | undefined
  /** Whether it takes the focus when it appears: a new Chat's composer. */
  autoFocus?: boolean | undefined
}

const BOX =
  'flex h-composer w-full min-w-0 flex-col rounded-lg border border-input bg-input-fill focus-within:border-ring data-disabled:opacity-50'
export const AREA = 'min-h-0 w-full flex-1 overflow-y-auto px-3 pt-2.5 text-sm text-foreground'
const FOOT = 'flex min-h-control-sm shrink-0 items-center gap-1 px-2 pb-2'
/**
 * A badge sits in the line like a word: its name is text in the flow, on the baseline of the text
 * around it, at its size, and the badge is a line of its own no taller than the line it stands in
 * (`leading-4` inside the text's `leading` of eighteen), so it never moves a line, in one line or
 * in several. The glyph is set beside the name, out of the flow, so it has no baseline to bring.
 */
const BADGE =
  'relative mx-0.5 inline-block rounded-sm bg-primary-muted pr-1 pl-5 align-baseline leading-4 font-medium whitespace-nowrap text-primary-muted-foreground outline-none'
const BADGE_GLYPH = 'absolute inset-y-0 left-0.5 flex items-center'

/** A mention as a badge: its glyph and its short name, its whole label in the tooltip. */
export function MentionBadge({ kind, label }: { kind: MentionKind; label: string }): ReactNode {
  return (
    <Tooltip label={label}>
      <button type="button" tabIndex={-1} aria-label={label} className={BADGE}>
        <span className={BADGE_GLYPH} aria-hidden="true">
          {GLYPHS[kind]}
        </span>
        {shortName(kind, label)}
      </button>
    </Tooltip>
  )
}

export interface FieldBoxProps {
  disabled: boolean
  /** Whether nothing is written yet: Send is then quiet. */
  empty: boolean
  /** What Send does; left out, there is no Send. */
  submit: (() => void) | undefined
  working: boolean
  onStop: (() => void) | undefined
  leading: ReactNode
  trailing: ReactNode
  /** The writing area. */
  children: ReactNode
}

/** The field's box: the writing area, then its foot — the caller's controls, then Send or Stop. */
export function FieldBox({
  disabled,
  empty,
  submit,
  working,
  onStop,
  leading,
  trailing,
  children,
}: FieldBoxProps): ReactNode {
  return (
    <div className={BOX} data-field-box="" data-disabled={disabled ? '' : undefined}>
      {children}
      {(leading !== undefined || trailing !== undefined || submit !== undefined) && (
        <div className={FOOT}>
          {leading}
          <span className="ml-auto flex items-center gap-1">
            {trailing}
            {submit !== undefined &&
              (working ? (
                <Tooltip label="Stop">
                  <IconButton
                    variant="primary"
                    size="sm"
                    icon={<IconPlayerStop size="sm" weight="filled" />}
                    aria-label="Stop"
                    onClick={onStop}
                  />
                </Tooltip>
              ) : (
                <Tooltip label="Send" keys="Enter" disabled={empty}>
                  <IconButton
                    variant="primary"
                    size="sm"
                    icon={<IconArrowUp size="sm" />}
                    aria-label="Send"
                    disabled={empty || disabled}
                    onClick={submit}
                  />
                </Tooltip>
              ))}
          </span>
        </div>
      )}
    </div>
  )
}
