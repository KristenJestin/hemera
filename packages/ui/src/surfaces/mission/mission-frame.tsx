import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { Menu } from '../../components/menu/menu.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { type SheetView, type SheetWidth, SheetStack } from '../../components/sheet/sheet.tsx'
import { IconDots, IconFileText, IconGitBranch } from '../../icons.ts'
import { CROSSFADE, crossfade, useTransition } from '../../motion.ts'
import { type Ball, BALL_LEGENDS, BallMark } from '../../blocks/ball/ball-mark.tsx'
import { TicketLink } from '../../blocks/mission/mission-marks.tsx'
import type { MissionMarkView, MissionStage } from '../../blocks/mission/vocabulary.ts'
import { NeedsYouList, type NeedsYouListProps } from '../../blocks/need/needs-you-list.tsx'
import { CancelMission, HeaderMarks, StageTrack } from './mission-header.tsx'

/**
 * The frame of a mission: its header, the needs at the top, a base that keeps its state, and the
 * views opened over it.
 *
 * The header is three lines. The first: the key in the mono face, the title, and at its end the
 * stage's action, the `…` with the rest when there is one, and Cancel, visible at every stage
 * before Done. The second: the stage as a track of the stages of a mission's life, the current
 * one lit and the lock of the frozen Spec on Planning. The third, quiet: who has the ball (with the
 * Now line of its agent when the stage gives one), the marks with the causes of those that have
 * one written out, the type, the ticket it comes from, the branch when it is known, and the Spec, which opens from here on every stage because it is
 * what the mission is. What the stage's action does is a later ticket's; here is where it sits.
 *
 * The needs of the mission stand under the header, above the base, whatever the stage.
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
/** How wide a view's sheet is: the design system's sheet widths. */
export type ViewWidth = SheetWidth

/** A view over the base: a sheet of the design system's stack. */
export type MissionView = SheetView

export interface MissionMore {
  label: string
  icon?: ReactNode
  onSelect: () => void
}

export interface MissionFrameProps {
  missionKey: string
  title: string
  stage: MissionStage
  /** The last review round, 0 before the first. */
  round?: number | undefined
  /** Whether the Spec is frozen. */
  frozen: boolean
  /** What kind of work it is, as the header says it. */
  type: 'feature' | 'bug' | 'maintenance'
  ball: Ball
  /**
   * What the stage's main agent does now, in words (its Now line), or a turn that ended without a
   * word said in words; the ball's legend when left out.
   */
  now?: string | undefined
  /** The marks of the mission after its ball: a glyph each, the causes written out. */
  marks?: readonly MissionMarkView[] | undefined
  /** Opens what moved, from the outdated mark. */
  onOpenOutdated?: (() => void) | undefined
  /** The ticket the mission comes from, by its key. */
  ticket?: { key: string; onOpen?: (() => void) | undefined } | null | undefined
  /** The mission's branch, on the stages that have one. */
  branch?: string | undefined
  /** What the Spec's link says of it: `frozen yesterday at 17:02`. */
  spec?: string | undefined
  /** The Spec's link is there only when this is: a Spec view is registered. */
  onOpenSpec?: (() => void) | undefined
  /** The stage's action: Freeze, Launch, Ship. */
  action?: ReactNode
  /** The rest of what can be done, in the `…`: open the Memory, the diff. */
  more?: readonly MissionMore[] | undefined
  /** Cancel is there only when this is: not at Done, not at Cancelled. */
  onCancel?: (() => void) | undefined
  /** Why the last thing asked of the header did not go through, in words. */
  notice?: string | undefined
  /** What the mission waits on the user for, at the top of every stage. */
  needs?: ReactNode
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

const HEADER = 'flex shrink-0 flex-col gap-2 px-8 pt-5 pb-3'

const LINE = 'flex min-h-control-md min-w-0 items-center gap-3'

const KEY = 'shrink-0 font-mono text-sm text-muted-foreground'

const TITLE = 'min-w-0 truncate text-xl font-semibold tracking-tight'

const END = 'ml-auto flex shrink-0 items-center gap-2'

const META = 'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'

const META_ITEM = 'flex min-w-0 items-center gap-1'

const META_LINK =
  'flex min-w-0 items-center gap-1 rounded-sm outline-none hover:text-foreground focus-ring'

/** Clipped: a sheet past the right edge, on its way in or out, is not a reason for the page to scroll. */
const BODY = 'relative flex min-h-0 flex-1 flex-col overflow-hidden'

const BASE = 'flex min-h-0 flex-1 flex-col overflow-auto'

export function MissionFrame({
  missionKey,
  title,
  stage,
  round = 0,
  frozen,
  type,
  ball,
  now,
  marks = [],
  onOpenOutdated,
  ticket,
  branch,
  spec,
  onOpenSpec,
  action,
  more = [],
  onCancel,
  notice,
  needs,
  base,
  views,
  open,
  shown,
  onShow,
  onClose,
}: MissionFrameProps): ReactNode {
  return (
    <div className={FRAME}>
      <div className={HEADER}>
        <div className={LINE}>
          <span className={KEY}>{missionKey}</span>
          <h1 className={TITLE}>{title}</h1>
          <div className={END}>
            <StageAction action={action} />
            {onCancel !== undefined && (
              <CancelMission missionKey={missionKey} onCancel={onCancel} />
            )}
            {more.length > 0 && (
              <Menu
                label={`More for ${missionKey}`}
                icon={<IconDots size="md" />}
                groups={[
                  more.map((item) => ({
                    label: item.label,
                    icon: item.icon,
                    onSelect: item.onSelect,
                  })),
                ]}
              />
            )}
          </div>
        </div>
        <StageTrack stage={stage} round={round} frozen={frozen} />
        <div className={META}>
          <span className={META_ITEM}>
            <BallMark ball={ball} legend face />
            <span className="truncate" data-now={now === undefined ? undefined : ''}>
              {now ?? BALL_LEGENDS[ball]}
            </span>
          </span>
          <HeaderMarks marks={marks} onOpenOutdated={onOpenOutdated} />
          <span className="capitalize">{type}</span>
          {ticket !== null && ticket !== undefined && (
            <TicketLink ticket={ticket.key} onOpen={ticket.onOpen} />
          )}
          {branch !== undefined && (
            <span className={META_ITEM}>
              <IconGitBranch size="sm" />
              <span className="truncate font-mono">{branch}</span>
            </span>
          )}
          {onOpenSpec !== undefined && (
            <button type="button" className={META_LINK} onClick={onOpenSpec}>
              <IconFileText size="sm" />
              <span className="truncate">Spec{spec === undefined ? '' : ` · ${spec}`}</span>
            </button>
          )}
        </div>
        {notice !== undefined && (
          <p role="alert" className="text-sm text-destructive">
            {notice}
          </p>
        )}
      </div>
      {needs}

      <div className={BODY}>
        <div
          className={BASE}
          data-base=""
          inert={shown !== null ? true : undefined}
          aria-hidden={shown !== null ? true : undefined}
        >
          {base}
        </div>
        <SheetStack
          views={views}
          open={open}
          shown={shown}
          onShow={onShow}
          onClose={onClose}
          scrimLabel="Back to the page"
        />
      </div>
    </div>
  )
}

/**
 * The stage's action, fading in when the engine offers it — Freeze as Planning settles — and out
 * when it is gone, on `crossfade`: it comes to its place, nothing beside it moves.
 */
function StageAction({ action }: { action: ReactNode }): ReactNode {
  const fade = useTransition(crossfade)
  return (
    <AnimatePresence initial={false}>
      {action !== undefined && action !== null && action !== false && (
        <motion.div
          key="action"
          className="flex"
          initial={CROSSFADE.from}
          animate={CROSSFADE.to}
          exit={CROSSFADE.from}
          transition={fade}
        >
          {action}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** The needs of a mission under its header: Needs you's own list, in a frame of the page's width. */
export function MissionFrameNeeds(props: NeedsYouListProps): ReactNode {
  if (props.rows.length === 0 && props.loading !== true) return null
  return (
    <div className="px-8 pb-2">
      <Frame>
        <NeedsYouList {...props} />
      </Frame>
    </div>
  )
}

/** The base of a stage no page is registered for: its place, with the stage's name. */
export function MissionFrameBase({ stage }: { stage: MissionStage }): ReactNode {
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-3 px-8 py-6">
      <Frame>
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">The {stage} page</p>
      </Frame>
    </div>
  )
}

/** What moved since the Spec was frozen, as the outdated mark keeps it: why, and what differs. */
export function MissionFrameDifference({
  why,
  difference,
}: {
  why: string
  difference: string | null
}): ReactNode {
  return (
    <div className="flex max-w-measure flex-col gap-3 px-6 py-5">
      <p className="text-sm text-muted-foreground">{why}</p>
      <p className="text-base whitespace-pre-line">{difference ?? 'Nothing differs now.'}</p>
    </div>
  )
}
