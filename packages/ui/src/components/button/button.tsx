import { Button as BaseButton } from '@base-ui/react/button'
import { type VariantProps, cva } from 'class-variance-authority'
import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { IconAlertTriangle, IconCheck } from '../../icons.ts'
import {
  HOVERED,
  MARK_TRAVEL,
  PRESSED,
  PRESSED_COMPACT,
  press,
  useTransition,
} from '../../motion.ts'
import { Loading } from '../loading/loading.tsx'

/**
 * The button, and the same button reduced to an icon (design D1-04).
 *
 * Three layers, in this order. Base UI is underneath and owns the behaviour: the disabled
 * state, the keyboard, the focus. `cva` carries the variants as classes of tokens, so an
 * appearance is a prop and never a class the caller writes. motion animates, through Base UI's
 * `render` prop, which merges the ref, the class and the handlers into the element it is given.
 *
 * Everything it does answers the hand, so everything it does is on the `press` preset: the
 * hover, the press, the width following what the button now says, and going quiet when it is
 * disabled. A button that is working says so where its label was and keeps its focus while it
 * does — `focusableWhenDisabled` is what stops the keyboard from falling back to the top of
 * the page under the user's hands.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 overflow-hidden border font-medium whitespace-nowrap outline-none focus-ring',
  {
    variants: {
      variant: {
        primary:
          'border-primary bg-primary text-primary-foreground hover:border-primary-strong hover:bg-primary-strong',
        secondary: 'border-input bg-card text-foreground hover:bg-muted',
        ghost: 'border-transparent bg-transparent text-foreground hover:bg-accent',
        // What a frame's header and a panel's corner offer: the accent colour and nothing
        // else. A control that is a place to go rather than a thing to press reads as text.
        link: 'border-transparent bg-transparent text-primary-muted-foreground hover:bg-transparent hover:text-primary',
        destructive:
          'border-destructive bg-destructive text-destructive-foreground hover:brightness-95',
      },
      /**
       * The radius, which is a shape and not a size: a control that floats over what it is
       * about — the pill that takes the reader back to the live edge of a thread — is round,
       * and everything else is the corner of the theme.
       */
      shape: {
        default: 'rounded-md',
        pill: 'rounded-full',
      },
      size: {
        sm: 'h-control-sm px-2 text-sm',
        md: 'h-control-md px-3 text-base',
        lg: 'h-control-lg px-4 text-lg',
      },
    },
    compoundVariants: [
      // A link reads as text, so it is drawn to the height of a line and not of a control.
      // A control's height is room around a surface, and a link has no surface to give room
      // to: carrying one is what made the Activity header stand eight pixels taller than the
      // title it sits beside, for nothing anyone can see.
      { variant: 'link', class: 'h-control-text' },
    ],
    defaultVariants: { variant: 'secondary', shape: 'default', size: 'md' },
  },
)

/** A square of the same height, for a button that is an icon and nothing else. */
const ICON_ONLY = {
  sm: 'size-control-sm p-0',
  md: 'size-control-md p-0',
  lg: 'size-control-lg p-0',
} as const

/** What the button is doing, which is what it shows instead of its label. */
export type ButtonState = 'idle' | 'loading' | 'success' | 'error'

export interface ButtonProps
  extends
    Omit<BaseButton.Props, 'render' | 'className' | 'style' | 'children'>,
    VariantProps<typeof buttonVariants> {
  state?: ButtonState | undefined
  /** How deep the press goes. Square controls set it themselves; nobody else needs to. */
  pressScale?: number | undefined
  children?: ReactNode
  /** Where the button sits; never how it looks. */
  className?: string | undefined
}

export function Button({
  variant,
  shape,
  size,
  state = 'idle',
  disabled = false,
  pressScale = PRESSED,
  children,
  className,
  ...rest
}: ButtonProps) {
  const transition = useTransition(press)
  const working = state === 'loading'
  return (
    <BaseButton
      {...rest}
      className={cn(buttonVariants({ variant, shape, size }), className)}
      disabled={disabled || working}
      focusableWhenDisabled={working}
      render={
        <motion.button
          // The width and the press are on the same element: `layout` and `whileTap` both project
          // a transform onto whatever carries them, and nesting one inside the other leaves the
          // inner one spending the press correcting for the outer one.
          layout
          whileHover={{ scale: HOVERED }}
          whileTap={{ scale: pressScale }}
          // Going quiet is a change like any other: it fades rather than switching off, which
          // is why the opacity lives here and not in a class the browser applies at once.
          animate={{ opacity: disabled || working ? 0.5 : 1 }}
          transition={transition}
        />
      }
    >
      <Content state={state}>{children}</Content>
    </BaseButton>
  )
}

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  /** One icon of the catalogue, already sized by the scale. */
  icon: ReactNode
  /** What the button is called, since nothing in it is readable. Required on purpose. */
  'aria-label': string
}

export function IconButton({ variant, size = 'md', icon, className, ...rest }: IconButtonProps) {
  return (
    <Button
      {...rest}
      variant={variant}
      size={size}
      pressScale={PRESSED_COMPACT}
      className={cn(ICON_ONLY[size ?? 'md'], className)}
    >
      {icon}
    </Button>
  )
}

/**
 * What the button shows right now.
 *
 * The mark of the state arrives from under the edge rather than fading in place, so the swap
 * reads as one thing replacing another; `popLayout` takes the leaving one out of the flow so
 * the label closes the gap instead of waiting for it. The width itself is animated by the
 * button, one element up: a width is a layout change, and a layout change belongs on the
 * element that is already being transformed, not on a child of it.
 */
function Content({ state, children }: { state: ButtonState; children: ReactNode }) {
  const transition = useTransition(press)
  const mark = MARKS[state]
  return (
    <>
      <AnimatePresence mode="popLayout" initial={false}>
        {mark !== null && (
          <motion.span
            key={state}
            className="inline-flex"
            initial={{ opacity: 0, y: MARK_TRAVEL, scale: 0.7 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -MARK_TRAVEL, scale: 0.7 }}
            transition={transition}
          >
            {mark}
          </motion.span>
        )}
      </AnimatePresence>
      {children}
    </>
  )
}

/** What each state puts in front of the label; idle puts nothing, and takes no room. */
const MARKS: Record<ButtonState, ReactNode> = {
  idle: null,
  loading: <Loading size="sm" label="Working" />,
  success: <IconCheck size="sm" />,
  error: <IconAlertTriangle size="sm" />,
}
