import { cn } from 'cn'
import type { ReactNode } from 'react'

import { ErrorState } from '../../components/error-state/error-state.tsx'
import { type Identity, ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { type SheetView, SheetStack } from '../../components/sheet/sheet.tsx'
import { OVER_MARK, SlidingMark } from '../../components/sliding-mark/sliding-mark.tsx'
import { IconAlertTriangle, IconFolder } from '../../icons.ts'
import { Page, PageHeader } from '../page.tsx'

/**
 * A Project's settings: one page, the list of its sections down the left, the section chosen
 * beside it, and a sheet over both where one thing of a section is written — the design system's sheet,
 * as a mission's views are.
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
  /** The sheet standing over the page, or null: the design system's sheet, holding a form. */
  sheet?: SheetView | null | undefined
  onCloseSheet: () => void
  /** The section chosen. */
  children: ReactNode
}

/** The room the page and its sheet share: the sheet is placed against it. */
const ROOM = 'relative flex min-h-0 flex-1 flex-col overflow-hidden'

const SCROLL = 'flex min-h-0 flex-1 flex-col overflow-auto'

const CHECKOUT = 'flex min-w-0 items-center gap-1.5 font-mono text-xs'

const SPLIT = 'flex min-w-0 items-start gap-8'

/** The list of sections: it stays in sight while the section beside it scrolls. */
const NAV = 'sticky top-0 isolate flex w-settings-nav shrink-0 flex-col gap-0.5'

/**
 * A section's entry: faint under the hand — a tint and the text's own colour — and, chosen, clearly
 * apart: the primary's quiet fill under it, a bar of the primary on its edge, its words in the
 * primary's ink and heavier.
 */
const ITEM =
  'flex h-control-sm w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground outline-none select-none hover:tinted hover:text-foreground focus-ring hover-motion aria-[current=page]:font-medium aria-[current=page]:text-primary-muted-foreground aria-[current=page]:hover:shadow-none'

const ITEM_ICON = 'flex size-icon-md shrink-0 items-center justify-center'

/** The mark under the chosen entry: the primary's quiet fill, and its bar on the leading edge. */
const MARK = 'absolute inset-0 rounded-md border-l-2 border-primary bg-primary-muted'

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
  sheet = null,
  onCloseSheet,
  children,
}: ProjectSettingsProps): ReactNode {
  const covered = sheet !== null
  return (
    <div className={ROOM}>
      <div
        className={SCROLL}
        data-settings-page=""
        inert={covered ? true : undefined}
        aria-hidden={covered ? true : undefined}
      >
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
      <SheetStack
        views={sheet === null ? [] : [sheet]}
        open={sheet === null ? [] : [sheet.id]}
        shown={sheet === null ? null : sheet.id}
        onShow={onCloseSheet}
        onClose={onCloseSheet}
        scrimLabel="Back to the settings"
      />
    </div>
  )
}
