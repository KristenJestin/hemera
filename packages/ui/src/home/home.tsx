import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import { Button } from '../components/button/button.tsx'
import { Frame, FrameHeader } from '../components/frame/frame.tsx'
import { List, ListItem } from '../components/list/list.tsx'
import { Timeline, TimelineStop } from '../components/timeline/timeline.tsx'
import { Kbd } from '../components/kbd/kbd.tsx'
import {
  IconActivity,
  IconFolderPlus,
  IconMessage,
  IconMessages,
  IconTimelineEvent,
} from '../icons.ts'
import type { JournalLine } from '../journal/journal.tsx'
import { LABEL_DELAY, MARK_TRAVEL, arrival, useTransition } from '../motion.ts'
import { HemeraMark } from '../shell/mark.tsx'

/**
 * The pieces the Home of a Project is made of, and the page a window with no Project shows
 * instead (design D4-07).
 *
 * The Home is the composer and what surrounds it: who is being written to, one or two things
 * worth doing, and the last entries of the Journal. There is no "Needs you" and no "Running":
 * nothing runs before lot 5, and a frame of invented work would be the first lie the page told.
 *
 * The greeting and the quick actions arrive in a short cascade — opacity and a few pixels,
 * each one a moment after the last — which is the prototype's own entrance.
 */
const GREETING = 'flex flex-col items-center gap-1 text-center'

const EMPTY = 'flex flex-col items-center gap-2 py-10 text-center'

const LAUNCH = 'mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center'

/** What a Project is greeted with: its name, and what writing here does. */
export function Greeting({ projectName, note }: { projectName: string; note: string }): ReactNode {
  const transition = useTransition(arrival)
  return (
    <motion.div
      className={GREETING}
      initial={{ opacity: 0, y: MARK_TRAVEL }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
    >
      <h1 className="text-3xl font-medium">What are we doing in {projectName}?</h1>
      <p className="text-sm text-muted-foreground">{note}</p>
    </motion.div>
  )
}

export interface QuickAction {
  id: string
  label: string
  icon?: ReactNode
  onSelect: () => void
}

/**
 * The one or two things worth one press from here, `Resume` among them.
 *
 * `Resume` opens the last Session written in the Project — or the Home with its composer when
 * there is none, and never the archives: a Session that was put away is not the work being
 * picked up. Which one that is belongs to the page, which is why it arrives as an action.
 *
 * It lands a moment after the greeting, which is the cascade of the prototype: the same
 * arrival, taken one step later, so the eye reads the page in the order it was written.
 */
export function QuickActions({ actions }: { actions: QuickAction[] }): ReactNode {
  const transition = useTransition(arrival)
  const delayed = transition === arrival ? { ...transition, delay: LABEL_DELAY } : transition
  return (
    <motion.div
      className="flex flex-wrap items-center justify-center gap-2"
      initial={{ opacity: 0, y: MARK_TRAVEL }}
      animate={{ opacity: 1, y: 0 }}
      transition={delayed}
    >
      {actions.map((action) => (
        <Button key={action.id} variant="secondary" size="sm" onClick={action.onSelect}>
          {action.icon}
          {action.label}
        </Button>
      ))}
    </motion.div>
  )
}

export interface SessionsFrameProps {
  /** The last Sessions of this Project, most recently written first. */
  sessions: HomeSession[]
  onOpenSession: (id: string) => void
  /** Opens the whole list, the archived ones included. */
  onOpenAll?: (() => void) | undefined
}

/** One Session as the Home says it: its name, and what has happened to it. */
export interface HomeSession {
  id: string
  title: string
  /** The line under the name, already written: `5 messages · last written 2 weeks ago`. */
  meta: string
}

/**
 * The last Sessions of the Project, and one way to the rest.
 *
 * Three of them, because the Home is what is picked up next and not a list: the fourth is the
 * Journal's business, and a Home that grew with the Project would stop being a greeting. The
 * order is the engine's — most recently written first — so the one at the top is the one
 * `Resume` opens.
 */
export function SessionsFrame({
  sessions,
  onOpenSession,
  onOpenAll,
}: SessionsFrameProps): ReactNode {
  return (
    <Frame
      header={
        <FrameHeader
          icon={<IconMessages size="sm" />}
          title="Sessions"
          action={
            onOpenAll === undefined ? undefined : (
              <Button variant="link" size="sm" onClick={onOpenAll}>
                All
              </Button>
            )
          }
        />
      }
    >
      {sessions.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Nothing written yet. What you start from the composer will be listed here.
        </p>
      ) : (
        <div className="px-4 py-2">
          <List label="The last Sessions of this Project">
            {sessions.map((session) => (
              <ListItem
                key={session.id}
                icon={<IconMessages size="sm" />}
                title={session.title}
                description={session.meta}
                onSelect={() => onOpenSession(session.id)}
              />
            ))}
          </List>
        </div>
      )}
    </Frame>
  )
}

export interface ActivityFrameProps {
  /** The last entries of the Journal of this Project, newest first. */
  entries: JournalLine[]
  onOpenJournal: () => void
}

/** The last few things that happened here, and one way to the whole Journal. */
export function ActivityFrame({ entries, onOpenJournal }: ActivityFrameProps): ReactNode {
  return (
    <Frame
      header={
        <FrameHeader
          icon={<IconActivity size="sm" />}
          title="Activity"
          action={
            <Button variant="link" size="sm" onClick={onOpenJournal}>
              Journal
            </Button>
          }
        />
      }
    >
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Nothing has happened here yet. Every change will be written down.
        </p>
      ) : (
        <div className="px-4 py-2">
          <Timeline label="The last of what happened">
            {entries.map((entry) => (
              <TimelineStop
                key={entry.sequence}
                quiet={entry.author === 'hemera'}
                meta={`${entry.day} · ${entry.time}`}
              >
                {entry.label}
              </TimelineStop>
            ))}
          </Timeline>
        </div>
      )}
    </Frame>
  )
}

/** What a Project with no Session says, which is that it has none. */
export function EmptyProject({
  projectName,
  onOpenJournal,
}: {
  projectName: string
  onOpenJournal: () => void
}): ReactNode {
  return (
    <div className={EMPTY}>
      <IconMessage size="lg" />
      <p className="font-medium">No Session in {projectName}</p>
      <p className="max-w-md text-sm text-muted-foreground">
        The sidebar will list them as they are created. The Journal already holds the creation of
        the Project.
      </p>
      <Button variant="secondary" size="sm" onClick={onOpenJournal}>
        <IconTimelineEvent size="sm" />
        Open the Journal
      </Button>
    </div>
  )
}

export interface FirstLaunchProps {
  onCreateProject: () => void
  /** The keystroke that opens the palette, already written for the platform. */
  commandShortcut: string
}

/** The whole window before there is a Project: one thing to do, and the palette. */
export function FirstLaunch({ onCreateProject, commandShortcut }: FirstLaunchProps): ReactNode {
  const transition = useTransition(arrival)
  return (
    <motion.div
      className={LAUNCH}
      initial={{ opacity: 0, y: MARK_TRAVEL }}
      animate={{ opacity: 1, y: 0 }}
      transition={transition}
    >
      <HemeraMark />
      <h1 className="text-3xl font-medium">Welcome to Hemera</h1>
      <p className="text-sm text-muted-foreground">
        A Project holds your Sessions, your Journal and, later, your Specs and Workspaces. Start
        with one, even before its sources exist.
      </p>
      <Button variant="primary" onClick={onCreateProject}>
        <IconFolderPlus size="sm" />
        Create your first Project
      </Button>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Kbd keys={commandShortcut} /> opens the command palette from anywhere, even here.
      </p>
    </motion.div>
  )
}

/**
 * There is no `Home` component, and that is on purpose.
 *
 * A component of this package is something drawn in more than one place; the Home of a Project
 * is drawn in exactly one, and what it is made of is above. The page that assembles them lives
 * in the application, beside the composer it hands over — which is also where the data it needs
 * comes from.
 */
