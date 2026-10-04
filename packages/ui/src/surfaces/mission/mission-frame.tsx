import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { IconButton } from '../../components/button/button.tsx'
import { Menu } from '../../components/menu/menu.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBan,
  IconDots,
  IconFileText,
  IconGitBranch,
  IconX,
} from '../../icons.ts'
import { CROSSFADE, SHEET, crossfade, sheet, useTransition } from '../../motion.ts'
import { type Ball, BallMark } from '../../blocks/ball/ball-mark.tsx'

/**
 * The frame of a mission: its header, a base that keeps its state, and the views opened over it.
 *
 * The header is two lines. The first: the key in the mono face, the title, and at its end what
 * the stage owns — who has the ball, as the ball's glyph (Hemera's face when the agent works);
 * the stage's chip; its marks; the stage's action; and a `…` with the rest, Cancel last. The
 * second, quiet: the branch, and the Spec, which opens from here on every stage because it is
 * what the mission is. The content of the chip, the marks and the action is a later ticket's;
 * here is where each sits.
 *
 * The base — the page of the current stage — is drawn once and never drawn again while a view
 * stands over it: its scroll, its folds and its chosen task are where they were when the view
 * closes. A view opens from the content where it belongs — a task from its row, a round from the
 * rounds, the diff from the changes — and is a sheet of its own: a solid surface slid in from the
 * right edge over the base, with its own line and shadow, at the width it asks for — `narrow` for
 * a task or a round, `wide` for the Spec or the Memory — and every sheet grows to the frame's
 * whole width and back on the expand beside its ×, and none opens grown: the diff included. One
 * sheet, one way in, for every view. Nothing is drawn through the sheet; what shows of
 * the base beside it is the base, at rest and out of reach, under a scrim — the theme's overlay,
 * as behind a dialog. One head for every view: its icon and title, its own actions, the expand
 * and an × at its end, as a modal has. The × and Escape close the sheet on top and show the one
 * under it, or the base; a press on the scrim leaves the views altogether and finds the base; the
 * trail goes down to any view. The focus returns to what opened the first view. A sheet slides in
 * from the right and out the same way on the `sheet` kind, which carries its growing too; its
 * scrim fades on `crossfade`.
 *
 * The views are a stack (open question 76, settled): the crumbs of the window's breadcrumb after
 * the stage — `Acme › ACME-12 › Review · round 1 › Spec` — and a view opened from a view comes on
 * top; Back pops it. The frame draws no strip of its own: the shell's header carries the trail.
 *
 * The focus goes to the view's title as it opens and back to where it was as the last one
 * closes. Asked for less movement, a view is there at once.
 */
export type ViewWidth = 'narrow' | 'wide'

export interface MissionView {
  id: string
  title: string
  icon: ReactNode
  width: ViewWidth
  /** What the view adds to its head while it is shown. */
  actions?: ReactNode
  body: ReactNode
}

/** The tone of a stage, which its chip's dot wears. */
export type StageTone = 'info' | 'build' | 'warning' | 'primary' | 'success' | 'muted'

export interface MissionStage {
  /** The stage as the chip says it: `Review · round 1`. */
  label: string
  tone: StageTone
}

export interface MissionMore {
  label: string
  icon?: ReactNode
  onSelect: () => void
}

export interface MissionFrameProps {
  missionKey: string
  title: string
  stage: MissionStage
  ball: Ball
  /** The mission's branch, on the stages that have one. */
  branch?: string | undefined
  /** What the Spec's link says of it: `frozen yesterday at 17:02`. */
  spec?: string | undefined
  onOpenSpec?: (() => void) | undefined
  /** The marks of the mission after its chip: glyphs, each with its legend. */
  marks?: ReactNode
  /** The stage's action: Freeze, Build, Ship. */
  action?: ReactNode
  /** The rest of what can be done, in the `…`: open the Memory, the diff. */
  more?: readonly MissionMore[] | undefined
  onCancel: () => void
  base: ReactNode
  /** Every view the frame can show, by id. */
  views: readonly MissionView[]
  /** The views open over the base, in the order they were opened. */
  open: readonly string[]
  /** The view on top, or null for the base. */
  shown: string | null
  /** Shows the base, or a view already open: the scrim pressed, a crumb pressed. */
  onShow: (id: string | null) => void
  /** Closes a view and whatever was opened over it: Back, or Escape. */
  onClose: (id: string) => void
}

const FRAME = 'flex min-h-0 flex-1 flex-col'

const HEADER = 'flex shrink-0 flex-col gap-1 px-8 pt-5 pb-3'

const LINE = 'flex min-h-control-md min-w-0 items-center gap-3'

const KEY = 'shrink-0 font-mono text-sm text-muted-foreground'

const TITLE = 'min-w-0 truncate text-xl font-semibold tracking-tight'

const END = 'ml-auto flex shrink-0 items-center gap-2'

const META = 'flex min-w-0 items-center gap-4 text-xs text-muted-foreground'

const META_ITEM = 'flex min-w-0 items-center gap-1'

const META_LINK =
  'flex min-w-0 items-center gap-1 rounded-sm outline-none hover:text-foreground focus-ring'

const CHIP =
  'inline-flex h-control-sm items-center gap-1.5 rounded-md border border-border px-2 text-sm whitespace-nowrap'

const CHIP_DOT: Record<StageTone, string> = {
  info: 'size-2 rounded-full bg-info',
  build: 'size-2 rounded-full bg-build',
  warning: 'size-2 rounded-full bg-warning',
  primary: 'size-2 rounded-full bg-primary',
  success: 'size-2 rounded-full bg-success',
  muted: 'size-2 rounded-full bg-muted-foreground',
}

/** Clipped: a sheet past the right edge, on its way in or out, is not a reason for the page to scroll. */
const BODY = 'relative flex min-h-0 flex-1 flex-col overflow-hidden'

const BASE = 'flex min-h-0 flex-1 flex-col overflow-auto'

/**
 * The scrim over the base while a sheet stands over it: the theme's overlay, as behind a dialog.
 * Under a sheet that covers the base too: it dims what the sheet is settling over, so the two are
 * never read at once.
 */
const SCRIM = 'absolute inset-0 bg-overlay'

/**
 * A sheet: a solid surface of its own over the base, its own line and shadow on the edge it came
 * from. Its width grows and folds on the theme's `sheet-motion`, a transition of the width itself.
 */
const SHEET_BOX =
  'absolute inset-y-0 right-0 flex w-full flex-col border-l border-border bg-surface-content shadow-lg sheet-motion'

/** How wide a sheet is at rest, by what it asked for; grown, the frame's whole width. */
const SHEET_WIDTH: Record<ViewWidth, string> = {
  narrow: 'max-w-view-narrow',
  wide: 'max-w-view-wide',
}

const GROWN = 'max-w-full'

const PANEL_HEAD = 'flex h-control-lg shrink-0 items-center gap-2 border-b border-border px-4'

const PANEL_TITLE = 'flex min-w-0 items-center gap-2 text-base font-semibold outline-none'

const PANEL_BODY = 'flex min-h-0 flex-1 flex-col overflow-auto outline-none focus-ring'

export function MissionFrame({
  missionKey,
  title,
  stage,
  ball,
  branch,
  spec,
  onOpenSpec,
  marks,
  action,
  more = [],
  onCancel,
  base,
  views,
  open,
  shown,
  onShow,
  onClose,
}: MissionFrameProps): ReactNode {
  const sliding = useTransition(sheet)
  const fading = useTransition(crossfade)
  const prefix = useId()
  // The sheets grown to the frame's width, by view: the hand's doing, and nothing else's.
  const [grown, setGrown] = useState<ReadonlySet<string>>(() => new Set())
  const grow = (id: string, on: boolean): void =>
    setGrown((before) => {
      const next = new Set(before)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const byId = new Map(views.map((view) => [view.id, view]))
  const opened = open.flatMap((id) => {
    const view = byId.get(id)
    return view === undefined ? [] : [view]
  })
  const current = shown === null ? null : (byId.get(shown) ?? null)

  // Where the focus was when the first view opened, to put it back when the last one closes.
  const before = useRef<HTMLElement | null>(null)
  const titles = useRef(new Map<string, HTMLElement>())
  const wasShown = useRef<string | null>(null)
  useEffect(() => {
    if (shown === wasShown.current) return
    if (wasShown.current === null && shown !== null) {
      before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
    wasShown.current = shown
    // Without scrolling: the sheet is still past the edge when its title takes the focus.
    if (shown !== null) titles.current.get(shown)?.focus({ preventScroll: true })
    else {
      before.current?.focus({ preventScroll: true })
      before.current = null
    }
  }, [shown])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape' && shown !== null) {
      event.stopPropagation()
      onClose(shown)
    }
  }

  const groups = [
    more.map((item) => ({ label: item.label, icon: item.icon, onSelect: item.onSelect })),
    // Cancel cannot be undone: the destructive item of the menu, with its ban.
    [
      {
        label: 'Cancel mission…',
        icon: <IconBan size="sm" />,
        destructive: true,
        onSelect: onCancel,
      },
    ],
  ].filter((group) => group.length > 0)

  return (
    <div className={FRAME}>
      <div className={HEADER}>
        <div className={LINE}>
          <span className={KEY}>{missionKey}</span>
          <h1 className={TITLE}>{title}</h1>
          <div className={END}>
            <BallMark ball={ball} legend face />
            <span className={CHIP} data-stage={stage.label}>
              <span aria-hidden="true" className={CHIP_DOT[stage.tone]} />
              {stage.label}
            </span>
            {marks}
            {action}
            <Menu label={`More for ${missionKey}`} icon={<IconDots size="md" />} groups={groups} />
          </div>
        </div>
        {(branch !== undefined || spec !== undefined) && (
          <div className={META}>
            {branch !== undefined && (
              <span className={META_ITEM}>
                <IconGitBranch size="sm" />
                <span className="truncate font-mono">{branch}</span>
              </span>
            )}
            {spec !== undefined && (
              <button type="button" className={META_LINK} onClick={onOpenSpec}>
                <IconFileText size="sm" />
                <span className="truncate">Spec · {spec}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div className={BODY} onKeyDown={onKeyDown}>
        <div
          className={BASE}
          data-base=""
          inert={shown !== null ? true : undefined}
          aria-hidden={shown !== null ? true : undefined}
        >
          {base}
        </div>
        <AnimatePresence>
          {current !== null && (
            <motion.button
              key="scrim"
              type="button"
              aria-label="Back to the page"
              tabIndex={-1}
              className={SCRIM}
              data-scrim=""
              initial={CROSSFADE.from}
              animate={CROSSFADE.to}
              exit={CROSSFADE.from}
              transition={fading}
              onClick={() => onShow(null)}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {opened.map((view) => (
            <motion.section
              key={view.id}
              aria-labelledby={`${prefix}${view.id}`}
              className={cn(SHEET_BOX, grown.has(view.id) ? GROWN : SHEET_WIDTH[view.width])}
              data-view={view.id}
              data-grown={grown.has(view.id)}
              // Out of sight while another stands over it; a sheet on its way out stays in
              // sight, or its leaving would be a cut.
              hidden={open.includes(view.id) && shown !== view.id}
              initial={SHEET.from}
              animate={SHEET.to}
              exit={SHEET.from}
              transition={sliding}
            >
              <div className={PANEL_HEAD}>
                <h2
                  id={`${prefix}${view.id}`}
                  tabIndex={-1}
                  ref={(node) => {
                    if (node === null) titles.current.delete(view.id)
                    else titles.current.set(view.id, node)
                  }}
                  className={PANEL_TITLE}
                >
                  <span className="flex text-muted-foreground">{view.icon}</span>
                  <span className="truncate">{view.title}</span>
                </h2>
                <div className={END}>
                  {view.actions}
                  <Tooltip label={grown.has(view.id) ? 'Collapse' : 'Expand'}>
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={
                        grown.has(view.id) ? (
                          <IconArrowsMinimize size="md" />
                        ) : (
                          <IconArrowsMaximize size="md" />
                        )
                      }
                      aria-label={`${grown.has(view.id) ? 'Collapse' : 'Expand'} ${view.title}`}
                      aria-pressed={grown.has(view.id)}
                      onClick={() => grow(view.id, !grown.has(view.id))}
                    />
                  </Tooltip>
                  <Tooltip label="Close" keys="Esc">
                    <IconButton
                      variant="ghost"
                      size="sm"
                      icon={<IconX size="md" />}
                      aria-label={`Close ${view.title}`}
                      onClick={() => onClose(view.id)}
                    />
                  </Tooltip>
                </div>
              </div>
              {/* A scroller the keyboard can take: its wheel is the arrows, once it has the focus. */}
              <div className={PANEL_BODY} tabIndex={0}>
                {view.body}
              </div>
            </motion.section>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}
