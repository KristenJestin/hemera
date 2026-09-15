import { type VariantProps, cva } from 'class-variance-authority'
import { cn } from 'cn'
import type { ReactNode } from 'react'

/**
 * The badge: a word and sometimes an icon, in the colour of what it is saying.
 *
 * Every tone is a soft background and the reading colour that goes with it, both from the
 * theme, so a tone is never a colour a caller picked. The mission tones are the three kinds of
 * work Hemera does; they sit beside the semantic ones because they are read the same way.
 *
 * There is no Base UI primitive underneath because there is no behaviour underneath: a badge
 * is a span that says something.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-muted-foreground',
        primary: 'bg-primary-muted text-primary-muted-foreground',
        success: 'bg-success-muted text-success-muted-foreground',
        warning: 'bg-warning-muted text-warning-muted-foreground',
        destructive: 'bg-destructive-muted text-destructive-muted-foreground',
        info: 'bg-info-muted text-info-muted-foreground',
        define: 'bg-mission-define-muted text-mission-define-muted-foreground',
        build: 'bg-mission-build-muted text-mission-build-muted-foreground',
        free: 'bg-mission-free-muted text-mission-free-muted-foreground',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export interface BadgeProps extends VariantProps<typeof badgeVariants> {
  /** One icon of the catalogue, drawn at the badge's own size. */
  icon?: ReactNode
  children: ReactNode
  /** Where the badge sits; never how it looks. */
  className?: string
}

export function Badge({ tone, icon, children, className }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)}>
      {icon}
      {children}
    </span>
  )
}
