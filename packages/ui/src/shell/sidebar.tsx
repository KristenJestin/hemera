import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { Face } from '../components/face/face.tsx'
import { LetterAvatar } from '../components/letter-avatar/letter-avatar.tsx'
import { type Identity, ProjectMark } from '../components/project-mark/project-mark.tsx'
import { Skeleton } from '../components/loading/loading.tsx'
import { OVER_MARK, SlidingMark } from '../components/sliding-mark/sliding-mark.tsx'
import { Tooltip } from '../components/tooltip/tooltip.tsx'
import { IconChevronRight, IconHome, IconMessages, IconPlus, IconSettings } from '../icons.ts'
import { collapse, expand, fold, useTransition } from '../motion.ts'

/**
 * The sidebar: Hemera's own head, Home, the Projects, Settings at the bottom.
 *
 * Its head is the window's identity — the face and the name — and the window's drag zone on this
 * side. Under it, one column of places and one mark for the current one, which travels
 * (`SlidingMark`) rather than lighting up here and going out there. Home carries the count of
 * what waits for the user, a dot in the tone that calls and the number. A Project is its letter
 * and its name, and a chevron at its end opens and closes the missions under it (`under`, the
 * room a later ticket fills); opening a Project is not entering it — its name is what enters it.
 * Settings is the last stop, apart from the rest.
 *
 * Folded, it is a rail of the same places as icons — the letters of the Projects — each named in
 * a tooltip beside it. The rows keep their layout on the way: the width travels on the theme's
 * curve, the names fade on the `hover` beat, and what the rail cannot hold is clipped at its
 * edge rather than wrapped, so nothing jumps. The missions under a Project grow and fold away on
 * the `fold` kind, pushing what stands under them.
 *
 * A Project added or removed while the window is open grows into the list or folds out of it on
 * the same `fold` kind, pushing what stands after it. Opened while it grows in, its row and what
 * stands under it each grow on their own journey, and its row is never scrolled inside its box.
 *
 * Every place is a button in the tab order, Home first and Settings last. The current one says so
 * (`aria-current`). Nothing here knows where a place leads: it says which was chosen.
 */
const SIDEBAR = 'flex shrink-0 flex-col overflow-hidden pb-2 sidebar-motion'

const OPEN = 'w-sidebar'

const RAIL = 'w-rail'

/** The identity: the face and the name, on the window's top edge. */
const HEAD = 'flex h-titlebar shrink-0 items-center gap-2 pl-4 drag-zone'

const WORDMARK = 'truncate text-sm font-semibold tracking-tight'

const PLACES =
  'relative isolate flex min-h-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto px-2 pt-2'

const FOOT = 'relative isolate flex flex-col px-2 pt-2'

/**
 * A place's row: the place itself, and beside it the control a Project carries, its chevron. The
 * row is what the mark is drawn under and what the hand colours; the place is what is pressed.
 * The same row open and folded, so the fold clips it rather than redrawing it.
 */
const PLACE_ROW =
  'flex h-control-sm w-full min-w-0 items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground hover-motion has-[[aria-current=page]]:text-foreground'

const PLACE =
  'flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-base whitespace-nowrap outline-none select-none focus-ring'

const ICON_ROOM = 'relative flex size-icon-md shrink-0 items-center justify-center'

/** What the rail cannot show: it fades on the hover beat as the width travels. */
const FADES = 'fade-motion'

const NAME = 'min-w-0 flex-1 truncate'

const COUNT = 'ml-auto flex shrink-0 items-center gap-1.5 text-xs font-medium tabular-nums'

const COUNT_TONE = 'size-1.5 rounded-full bg-warning'

/** The count on the rail: a dot in the corner of the icon, the number in the tooltip. */
const COUNT_DOT = 'absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-warning'

const HEADING =
  'flex h-control-sm items-center px-2 pt-2 text-xs font-medium whitespace-nowrap text-muted-foreground'

const MARK = 'absolute inset-0 rounded-md bg-accent'

/** The chevron at the end of a Project's row: turns down when its missions are shown. */
const CHEVRON =
  'mr-1 flex size-icon-lg shrink-0 items-center justify-center rounded-sm outline-none hover:text-foreground focus-ring chevron-motion aria-expanded:rotate-90'

/**
 * The room under a Project, one step in: clipped while it grows and folds, and over the mark as
 * a whole — the fade it travels on is a filter, which makes it a stacking context of its own, and
 * a row raised inside it would still be under the mark drawn after the list.
 */
const UNDER = 'relative z-1 flex flex-col gap-0.5 overflow-clip pl-2'

/**
 * A Project's place and what stands under it, clipped while it folds out, and over the mark as a
 * whole, for the reason `UNDER` gives: the fade it travels on is a filter.
 *
 * Clipped, never scrollable (`overflow-clip`, not `hidden`): a box that hides its overflow can
 * still be scrolled by whatever brings a control of it into view — a focus, a click from a
 * driver — and the row would then slide up inside its box and stay drawn by half.
 */
const PROJECT = 'relative z-1 flex shrink-0 flex-col gap-0.5 overflow-clip'

/**
 * A Project's row as it grows into the list: the row alone, so what opens under it while it grows
 * grows on its own journey rather than inside a height measured before it was there.
 */
const ENTERING = 'flex shrink-0 flex-col overflow-clip'

const ROW =
  'flex h-control-sm w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm whitespace-nowrap text-muted-foreground outline-none select-none hover:bg-accent hover:text-foreground focus-ring hover-motion aria-[current=page]:text-foreground'

const ROW_KEY = 'shrink-0 font-mono text-xs'

/** Where the user is, as the sidebar tells it. */
export type SidebarPlace =
  | { readonly kind: 'home' }
  | { readonly kind: 'project'; readonly id: string }
  | { readonly kind: 'mission'; readonly key: string }
  | { readonly kind: 'chat'; readonly id: string }
  | { readonly kind: 'settings' }
  | { readonly kind: 'elsewhere' }

export interface SidebarProject {
  id: string
  name: string
  /** What the user chose to mark it with; nothing chosen is its letter. */
  identity?: Identity | undefined
  /** What stands under the Project when it is open: its missions by stage, its Chats. */
  under?: ReactNode
}

export interface SidebarProps {
  folded: boolean
  /** How many things wait for the user, across every Project. */
  waiting: number
  projects: readonly SidebarProject[]
  /** The Projects whose missions are shown. */
  opened: ReadonlySet<string>
  onOpen: (id: string, open: boolean) => void
  /** Whether the Projects are on their way: their rows are drawn as skeletons. */
  loading?: boolean | undefined
  /** Why the Projects could not be read, in words; the sidebar says it where they would be. */
  error?: string | undefined
  current: SidebarPlace
  onHome: () => void
  onProject: (id: string) => void
  onAddProject: () => void
  onSettings: () => void
}

/** The key the mark finds a place by. */
function markOf(place: SidebarPlace): string | null {
  if (place.kind === 'home') return 'home'
  if (place.kind === 'settings') return 'settings'
  if (place.kind === 'project') return `project:${place.id}`
  if (place.kind === 'mission') return `mission:${place.key}`
  if (place.kind === 'chat') return `chat:${place.id}`
  return null
}

export function Sidebar({
  folded,
  waiting,
  projects,
  opened,
  onOpen,
  loading = false,
  error,
  current,
  onHome,
  onProject,
  onAddProject,
  onSettings,
}: SidebarProps): ReactNode {
  const folding = useTransition(fold)
  const mark = markOf(current)
  const names = projects.map((project) => project.name)
  return (
    <nav aria-label="Places" className={cn(SIDEBAR, folded ? RAIL : OPEN)} data-folded={folded}>
      <div className={HEAD}>
        <span className={ICON_ROOM}>
          <Face state="asleep" size="icon" label="Hemera" />
        </span>
        <span className={cn(WORDMARK, FADES, folded && 'opacity-0')} aria-hidden={folded}>
          Hemera
        </span>
      </div>
      <div className={PLACES} aria-busy={loading}>
        <Place
          folded={folded}
          mark="home"
          current={current.kind === 'home'}
          name="Home"
          detail={waiting > 0 ? `${String(waiting)} waiting` : undefined}
          icon={
            <>
              <IconHome size="md" />
              {waiting > 0 && folded && <span aria-hidden="true" className={COUNT_DOT} />}
            </>
          }
          onPress={onHome}
          trailing={
            waiting > 0 ? (
              <span className={COUNT}>
                <span aria-hidden="true" className={COUNT_TONE} />
                {waiting}
              </span>
            ) : undefined
          }
        />
        <h2 className={cn(HEADING, FADES, folded && 'opacity-0')} aria-hidden={folded}>
          Projects
        </h2>
        {loading && (
          <>
            <ProjectSkeleton name="Acme" />
            <ProjectSkeleton name="Hemera" />
            <ProjectSkeleton name="Data pipeline" />
          </>
        )}
        {error !== undefined && !folded && (
          <p role="alert" className="px-2 py-1 text-sm text-destructive-muted-foreground">
            {error}
          </p>
        )}
        <AnimatePresence initial={false}>
          {projects.map((project) => {
            const open = opened.has(project.id) && !folded
            return (
              <motion.div
                key={project.id}
                className={PROJECT}
                initial={false}
                animate={expand}
                exit={collapse}
                transition={folding}
              >
                <motion.div
                  className={ENTERING}
                  initial={collapse}
                  animate={expand}
                  transition={folding}
                >
                  <Place
                    folded={folded}
                    mark={`project:${project.id}`}
                    current={current.kind === 'project' && current.id === project.id}
                    name={project.name}
                    icon={
                      <ProjectMark name={project.name} others={names} identity={project.identity} />
                    }
                    onPress={() => onProject(project.id)}
                    control={
                      project.under === undefined ? undefined : (
                        <button
                          type="button"
                          className={CHEVRON}
                          aria-expanded={open}
                          aria-label={`${open ? 'Fold' : 'Open'} the missions of ${project.name}`}
                          tabIndex={folded ? -1 : 0}
                          onClick={(event) => {
                            event.stopPropagation()
                            onOpen(project.id, !open)
                          }}
                        >
                          <IconChevronRight size="sm" />
                        </button>
                      )
                    }
                  />
                </motion.div>
                <AnimatePresence initial={false}>
                  {open && project.under !== undefined && (
                    <motion.div
                      key="under"
                      className={UNDER}
                      initial={collapse}
                      animate={expand}
                      exit={collapse}
                      transition={folding}
                    >
                      {project.under}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </AnimatePresence>
        {!loading && error === undefined && (
          <Place
            folded={folded}
            mark="add"
            current={false}
            name="Add a Project"
            icon={<IconPlus size="md" />}
            onPress={onAddProject}
          />
        )}
        <SlidingMark target={mark === 'settings' ? null : mark} shape={MARK} />
      </div>
      <div className={FOOT}>
        <Place
          folded={folded}
          mark="settings"
          current={current.kind === 'settings'}
          name="Settings"
          icon={<IconSettings size="md" />}
          onPress={onSettings}
        />
        <SlidingMark target={mark === 'settings' ? mark : null} shape={MARK} />
      </div>
    </nav>
  )
}

interface PlaceProps {
  folded: boolean
  mark: string
  current: boolean
  name: string
  /** A word after the name in the rail's tooltip: the count of what waits. */
  detail?: string | undefined
  icon: ReactNode
  /** What stands at the end of the place, in it: a count. Hidden on the rail. */
  trailing?: ReactNode
  /** A control of its own beside the place: a Project's chevron. Hidden on the rail. */
  control?: ReactNode | undefined
  onPress: () => void
}

/**
 * A place, drawn the same way open and folded: the icon in the room the rail shows, the name and
 * the end fading out as the rail closes over them. The place is a button; a control beside it is
 * its own, outside the button, so nothing pressable holds something pressable.
 */
function Place({
  folded,
  mark,
  current,
  name,
  detail,
  icon,
  trailing,
  control,
  onPress,
}: PlaceProps): ReactNode {
  const label = detail === undefined ? name : `${name}, ${detail}`
  const place = (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      aria-label={folded || detail !== undefined ? label : undefined}
      className={cn(OVER_MARK, PLACE)}
      onClick={onPress}
    >
      <span className={ICON_ROOM}>{icon}</span>
      <span className={cn(NAME, FADES, folded && 'opacity-0')} aria-hidden={folded}>
        {name}
      </span>
      {trailing !== undefined && (
        <span
          className={cn('ml-auto flex shrink-0 items-center', FADES, folded && 'opacity-0')}
          aria-hidden={folded}
        >
          {trailing}
        </span>
      )}
    </button>
  )
  return (
    <div data-mark={mark} className={cn(PLACE_ROW, current && OVER_MARK)}>
      {folded ? (
        <Tooltip label={label} side="right">
          {place}
        </Tooltip>
      ) : (
        place
      )}
      {control !== undefined && (
        <span
          className={cn(OVER_MARK, 'flex shrink-0 items-center', FADES, folded && 'opacity-0')}
          aria-hidden={folded}
        >
          {control}
        </span>
      )}
    </div>
  )
}

export interface SidebarRowProps {
  /** The mission's key, `ACME-12`. */
  missionKey: string
  title: string
  /** Who has the ball, drawn at the end: the ball's glyph. */
  trailing?: ReactNode
  current?: boolean | undefined
  onPress: () => void
}

/** A mission's row under its Project: the key, the title, and who has the ball at the end. */
export function SidebarRow({
  missionKey,
  title,
  trailing,
  current = false,
  onPress,
}: SidebarRowProps): ReactNode {
  return (
    <button
      type="button"
      data-mark={`mission:${missionKey}`}
      aria-current={current ? 'page' : undefined}
      className={cn(ROW, current && OVER_MARK)}
      onClick={onPress}
    >
      <span className={cn(OVER_MARK, ROW_KEY)}>{missionKey}</span>
      <span className={cn(OVER_MARK, NAME)}>{title}</span>
      {trailing !== undefined && <span className={cn(OVER_MARK, 'ml-auto flex')}>{trailing}</span>}
    </button>
  )
}

export interface SidebarChatRowProps {
  id: string
  title: string
  current?: boolean | undefined
  onPress: () => void
}

/** A Chat's row under its Project: the Chat's glyph where a mission has its key, and its title. */
export function SidebarChatRow({
  id,
  title,
  current = false,
  onPress,
}: SidebarChatRowProps): ReactNode {
  return (
    <button
      type="button"
      data-mark={`chat:${id}`}
      aria-current={current ? 'page' : undefined}
      className={cn(ROW, current && OVER_MARK)}
      onClick={onPress}
    >
      <span className={cn(OVER_MARK, 'flex shrink-0')} aria-hidden="true">
        <IconMessages size="sm" />
      </span>
      <span className={cn(OVER_MARK, NAME)}>{title}</span>
    </button>
  )
}

/**
 * The shape of a Project's row while the Projects are on their way: the row itself in its loading
 * mode — its height, the room of its mark, a bar for its name — and nothing that grows beyond it.
 */
const SKELETON_ROW = 'flex h-control-sm w-full min-w-0 shrink-0 items-center gap-2 rounded-md px-2'

function ProjectSkeleton({ name }: { name: string }): ReactNode {
  return (
    <span aria-hidden="true" className={SKELETON_ROW} data-project-skeleton="">
      <span className={ICON_ROOM}>
        <Skeleton shape="block">
          <LetterAvatar name="A" />
        </Skeleton>
      </span>
      <span className="min-w-0 text-base">
        <Skeleton>{name}</Skeleton>
      </span>
    </span>
  )
}
