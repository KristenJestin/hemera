import { Button as BaseButton } from '@base-ui/react/button'
import { type VariantProps, cva } from 'class-variance-authority'
import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { IconAlertTriangle, IconCheck } from '../../icons.ts'
import { useTransition } from '../../motion.ts'
import { Loading } from '../loading/loading.tsx'

/**
 * The button, and the same button reduced to an icon (design D1-04).
 *
 * Three layers, in this order. Base UI is underneath and owns the behaviour: the disabled
 * state, the keyboard, the focus. `cva` carries the variants as classes of tokens, so an
 * appearance is a prop and never a class the caller writes. motion animates, through Base UI's
 * `render` prop, which merges the ref, the class and the handlers into the element it is given.
 *
 * The press is `whileTap`, on the one spring of the application. A button that is working says
 * so where its label was, and keeps its focus while it does: `focusableWhenDisabled` is what
 * stops the keyboard from falling back to the top of the page under the user's hands.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'border-primary bg-primary text-primary-foreground hover:border-primary-strong hover:bg-primary-strong',
        secondary: 'border-input bg-card text-foreground hover:bg-muted',
        ghost: 'border-transparent bg-transparent text-foreground hover:bg-accent',
        destructive:
          'border-destructive bg-destructive text-destructive-foreground hover:brightness-95',
      },
      size: {
        sm: 'h-6 px-2 text-xs',
        md: 'h-8 px-3 text-sm',
        lg: 'h-10 px-4 text-base',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

/** A square of the same height, for a button that is an icon and nothing else. */
const ICON_ONLY = { sm: 'size-6 p-0', md: 'size-8 p-0', lg: 'size-10 p-0' } as const

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

export function Button({
  variant,
  size,
  state = 'idle',
  disabled = false,
  children,
  className,
  ...rest
}: ButtonProps) {
  const transition = useTransition()
  const working = state === 'loading'
  return (
    <BaseButton
      {...rest}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || working}
      // A button that is working is not a button that has gone away: keep it reachable, so the
      // keyboard stays where the user left it and the label change is announced in place.
      focusableWhenDisabled={working}
      render={<motion.button whileTap={{ scale: 0.97 }} transition={transition} />}
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
      className={cn(ICON_ONLY[size ?? 'md'], className)}
    >
      {icon}
    </Button>
  )
}

/**
 * What the button shows right now. One child at a time, so the button is as wide as what it
 * says; the swap is an opacity and a scale, which is what a compositor animates on its own.
 */
function Content({ state, children }: { state: ButtonState; children: ReactNode }) {
  const transition = useTransition()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={state}
        className="inline-flex items-center gap-1.5"
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={transition}
      >
        {state === 'loading' && <Loading size="sm" label="Working" />}
        {state === 'success' && <IconCheck size="sm" />}
        {state === 'error' && <IconAlertTriangle size="sm" />}
        {children}
      </motion.span>
    </AnimatePresence>
  )
}
