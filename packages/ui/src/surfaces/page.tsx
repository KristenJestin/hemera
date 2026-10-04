import { cn } from 'cn'
import type { ReactNode } from 'react'

/**
 * What every page of the sheet shares: its margins, its width, and the line its header sits on.
 *
 * A page is a column no wider than the page measure, with the same room on every side, so two
 * pages opened one after the other keep their title where it was. The header is one line: what
 * the page is, in the largest type the interface uses, and whatever belongs beside it at the
 * end — a Project's settings, a mission's actions. Under it, a short line of what the page is
 * about, in the quiet tone, never a sentence.
 */
const PAGE = 'mx-auto flex w-full max-w-page flex-col gap-6 px-8 py-6'

const HEADER = 'flex min-w-0 flex-col gap-1'

const LINE = 'flex min-h-control-md min-w-0 items-center gap-3'

const TITLE = 'min-w-0 truncate text-2xl font-semibold tracking-tight'

const ABOUT = 'flex min-w-0 items-center gap-2 text-sm text-muted-foreground'

const END = 'ml-auto flex shrink-0 items-center gap-1.5'

export interface PageProps {
  className?: string | undefined
  children: ReactNode
}

export function Page({ className, children }: PageProps): ReactNode {
  return <div className={cn(PAGE, className)}>{children}</div>
}

export interface PageHeaderProps {
  /** What stands before the title: a Project's letter. */
  lead?: ReactNode
  title: string
  /** What the page is about, under the title: repositories, a date. */
  about?: ReactNode
  /** What belongs at the end of the title's line. */
  actions?: ReactNode
}

export function PageHeader({ lead, title, about, actions }: PageHeaderProps): ReactNode {
  return (
    <header className={HEADER}>
      <div className={LINE}>
        {lead}
        <h1 className={TITLE}>{title}</h1>
        {actions !== undefined && <div className={END}>{actions}</div>}
      </div>
      {about !== undefined && <div className={ABOUT}>{about}</div>}
    </header>
  )
}

/** Why a page could not be drawn, in words, where its content would be. */
export function PageError({
  children,
  action,
}: {
  children: string
  action?: ReactNode
}): ReactNode {
  return (
    <div role="alert" className="flex items-center gap-3 text-sm text-destructive-muted-foreground">
      <span className="min-w-0">{children}</span>
      {action}
    </div>
  )
}
