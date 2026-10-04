import { cn } from 'cn'
import { type ReactNode, useState } from 'react'

import { ErrorState } from '../../components/error-state/error-state.tsx'
import { type Identity, ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { Dialog } from '../../components/dialog/dialog.tsx'
import { OVER_MARK, SlidingMark } from '../../components/sliding-mark/sliding-mark.tsx'
import { IconAlertTriangle, IconFolder } from '../../icons.ts'
import { Page, PageHeader } from '../page.tsx'

/**
 * A Project's settings: one page, the list of its sections down the left, the section chosen
 * beside it, and a dialog over both where one thing of a section is written: a form opens in the
 * design system's dialog, centred, its buttons at its foot — a dialog is for reading, not writing.
 *
 * The header is the Project's own, as on its page — its letter and its name — and under them the
 * folder of its main checkout, the one fact of a Project no section owns. The sections are a list
 * and not a long scroll: a dozen of them will stand here once every slice has added its own, and a
 * page twelve sections long is a page nobody finds anything on. The list stays where it is while
 * the section scrolls; the chosen one wears the list's mark, which travels to the next on
 * `arrival`. A section with something wrong in it says so with its glyph in the list, so the
 * problem is found from any section.
 *
 * A section is the caller's: the page draws the frame, and what is chosen goes in the room beside
 * the list. A Project that cannot be read is said there, in words, with Try again.
 */
export interface SettingsSection {
  id: string
  label: string
  icon: ReactNode
  /** What is wrong in the section, in words: its glyph in the list, and its name to a reader. */
  problem?: string | undefined
}

/** A form of a section, as its dialog shows it. */
export interface SettingsForm {
  /** What the form writes: `api`, `New command`. */
  title: string
  /** What stands before the title: the icon of what is written. */
  icon: ReactNode
  body: ReactNode
  /** Its buttons — Remove at the start, Cancel and Save at the end — and a refusal above them. */
  footer: ReactNode
}

export interface ProjectSettingsProps {
  name: string
  /** What the user chose to mark it with; nothing chosen is its letter. */
  identity?: Identity | undefined
  /** The folder of the user's own clones, as it is written on this machine. */
  mainCheckout: string
  sections: readonly SettingsSection[]
  /** The section shown, by id. */
  current: string
  onSection: (id: string) => void
  /** Why the Project could not be read, in words. */
  error?: string | undefined
  onRetry: () => void
  /** The form open over the page, in a dialog, or null. */
  form?: SettingsForm | null | undefined
  onCloseForm: () => void
  /** The section chosen. */
  children: ReactNode
}

/** The room the page takes under the window's header. */
const ROOM = 'relative flex min-h-0 flex-1 flex-col overflow-hidden'

const SCROLL = 'flex min-h-0 flex-1 flex-col overflow-auto'

const CHECKOUT = 'flex min-w-0 items-center gap-1.5 font-mono text-xs'

const SPLIT = 'flex min-w-0 items-start gap-8'

/** The list of sections: it stays in sight while the section beside it scrolls. */
const NAV = 'sticky top-0 isolate flex w-settings-nav shrink-0 flex-col gap-0.5'

/**
 * A section's entry: faint under the hand — a tint and the text's own colour — and, chosen, clearly
 * apart: the primary's quiet fill under it, its words in the primary's ink and heavier.
 */
const ITEM =
  'flex h-control-sm w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground outline-none select-none hover:tinted hover:text-foreground focus-ring hover-motion aria-[current=page]:font-medium aria-[current=page]:text-primary-muted-foreground aria-[current=page]:hover:shadow-none'

const ITEM_ICON = 'flex size-icon-md shrink-0 items-center justify-center'

/** The mark under the chosen entry: the primary's quiet fill. */
const MARK = 'absolute inset-0 rounded-md bg-primary-muted'

const PROBLEM = 'ml-auto flex shrink-0 text-destructive'

const BODY = 'flex min-w-0 flex-1 flex-col gap-8'

export function ProjectSettings({
  name,
  identity,
  mainCheckout,
  sections,
  current,
  onSection,
  error,
  onRetry,
  form = null,
  onCloseForm,
  children,
}: ProjectSettingsProps): ReactNode {
  // What the dialog showed last, kept while it closes: its content leaves with it, not before.
  const [shown, setShown] = useState<SettingsForm | null>(form)
  if (form !== null && form !== shown) setShown(form)
  return (
    <div className={ROOM}>
      <div className={SCROLL} data-settings-page="">
        <Page>
          <PageHeader
            lead={<ProjectMark name={name} identity={identity} />}
            title={name}
            about={
              <span className={CHECKOUT}>
                <IconFolder size="sm" aria-hidden="true" />
                <span className="sr-only">Main checkout:</span>
                <span className="truncate">{mainCheckout}</span>
              </span>
            }
          />
          <div className={SPLIT}>
            <nav aria-label="Settings of the Project" className={NAV}>
              {sections.map((section) => {
                const chosen = section.id === current
                return (
                  <button
                    key={section.id}
                    type="button"
                    data-mark={section.id}
                    aria-current={chosen ? 'page' : undefined}
                    aria-label={
                      section.problem === undefined
                        ? undefined
                        : `${section.label}, ${section.problem}`
                    }
                    className={cn(ITEM, chosen && OVER_MARK)}
                    onClick={() => onSection(section.id)}
                  >
                    <span className={cn(OVER_MARK, ITEM_ICON)}>{section.icon}</span>
                    <span className={cn(OVER_MARK, 'min-w-0 truncate')}>{section.label}</span>
                    {section.problem !== undefined && (
                      <span className={cn(OVER_MARK, PROBLEM)} data-problem="">
                        <IconAlertTriangle size="sm" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                )
              })}
              <SlidingMark target={current} shape={MARK} />
            </nav>
            <div className={BODY}>
              {error === undefined ? (
                children
              ) : (
                <ErrorState
                  title={`Hemera could not read ${name}`}
                  description={error}
                  onRetry={onRetry}
                />
              )}
            </div>
          </div>
        </Page>
      </div>
      <Dialog
        title={shown?.title ?? ''}
        lead={<span className="flex text-muted-foreground">{shown?.icon}</span>}
        open={form !== null}
        onOpenChange={(open) => {
          if (!open) onCloseForm()
        }}
        actions={shown?.footer}
      >
        <div className="flex flex-col gap-5">{shown?.body}</div>
      </Dialog>
    </div>
  )
}
