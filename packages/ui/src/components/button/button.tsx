import { Button as BaseButton } from '@base-ui/react/button'
import { type VariantProps, cva } from 'class-variance-authority'
import { cn } from 'cn'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import type { ReactNode } from 'react'

import { IconAlertTriangle, IconCheck } from '../../icons.ts'
import { MARK_TRAVEL, press, useHand, useTransition } from '../../motion.ts'
import { Loading } from '../loading/loading.tsx'

/**
 * The button, and the same button reduced to an icon.
 *
 * Three layers, in this order. Base UI is underneath and owns the behaviour: the disabled
 * state, the keyboard, the focus. `cva` carries the variants as classes of tokens, so an
 * appearance is a prop and never a class the caller writes. motion animates, through Base UI's
 * `render` prop, which merges the ref, the class and the handlers into the element it is given.
 *
 * Everything it does answers the hand, so everything it does is on the `press` preset: the
 * hover, the press, the width following what the button now says, and going quiet when it is
 * disabled. The hover and the press move its edges by the same pixels whatever its size is,
 * which is what `useHand` works out from the box the button took. A button that is working says
 * so where its label was and keeps its focus while it does — `focusableWhenDisabled` is what
 * stops the keyboard from falling back to the top of the page under the user's hands.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 overflow-hidden border font-medium whitespace-nowrap outline-none focus-ring hover-motion',
  {
    variants: {
      variant: {
        primary: 'border-primary-strong primary-fill text-primary-foreground hover:brightness-95',
        secondary: 'border-input bg-card text-foreground hover:tinted',
        // A ghost that is the current place draws no fill under the hand: it is drawn over its
        // list's mark, which is its fill already.
        ghost:
          'border-transparent bg-transparent text-foreground hover:tinted aria-[current=true]:hover:shadow-none',
        // What a frame's header and a panel's corner offer: the accent colour and nothing
        // else. A control that is a place to go rather than a thing to press reads as text.
        link: 'border-transparent bg-transparent text-primary-muted-foreground hover:bg-transparent hover:text-primary',
        destructive:
          'border-destructive-fill bg-destructive-fill text-destructive-foreground hover:brightness-95',
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
        sm: 'h-control-sm px-2.5 text-sm',
        md: 'h-control-md px-2.5 text-base',
        lg: 'h-control-lg px-2.5 text-base',
      },
    },
    compoundVariants: [
      // A link reads as text, so it is drawn to the height of a line and not of a control: a
      // control's height is room around a surface, and a link has no surface to give room to.
      // Carrying one makes a header stand taller than the title it sits beside.
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
  children?: ReactNode
  /** Where the button sits; never how it looks. */
  className?: string | undefined
}

export function Button(props: ButtonProps) {
  return <Pressable {...props} follows />
}

/**
 * The button under both buttons. `follows` is whether its width follows what it shows, as a
 * layout animation: a button with a label does, a square icon button never, and a button that
 * is a layout node for nothing is still one — inside a card that slides, motion draws it at its
 * destination before the card has arrived.
 */
function Pressable({
  variant,
  shape,
  size,
  state = 'idle',
  disabled = false,
  children,
  className,
  follows,
  ...rest
}: ButtonProps & { follows: boolean }) {
  const transition = useTransition(press)
  const hand = useHand()
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
          ref={hand.element}
          // Its size and nothing else: what is animated is the width following what
          // it says. A button carried to wherever its row put it replayed its old place each time
          // it was drawn again after something beside it changed, and popped where it stood.
          layout={follows ? 'size' : false}
          whileHover={hand.hover}
          whileTap={hand.tap}
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
    <Pressable
      {...rest}
      variant={variant}
      size={size}
      className={cn(ICON_ONLY[size ?? 'md'], className)}
      follows={false}
    >
      {icon}
    </Pressable>
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
          <Mark key={state} transition={transition}>
            {mark}
          </Mark>
        )}
      </AnimatePresence>
      {children}
    </>
  )
}

/**
 * The mark of a state, in front of the label. The moment it starts leaving it is hidden from
 * assistive technology: the state it said is over, and a loader still read while it fades out
 * named the button `Working Create` once the work was done.
 */
function Mark({
  transition,
  children,
}: {
  transition: ReturnType<typeof useTransition>
  children: ReactNode
}) {
  const present = useIsPresent()
  return (
    <motion.span
      className="inline-flex"
      aria-hidden={present ? undefined : true}
      initial={{ opacity: 0, y: MARK_TRAVEL, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -MARK_TRAVEL, scale: 0.7 }}
      transition={transition}
    >
      {children}
    </motion.span>
  )
}

/** What each state puts in front of the label; idle puts nothing, and takes no room. */
const MARKS: Record<ButtonState, ReactNode> = {
  idle: null,
  loading: <Loading size="sm" label="Working" />,
  success: <IconCheck size="sm" />,
  error: <IconAlertTriangle size="sm" />,
}
