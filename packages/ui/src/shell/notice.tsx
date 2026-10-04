import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

import { IconButton } from '../components/button/button.tsx'
import { LetterAvatar } from '../components/letter-avatar/letter-avatar.tsx'
import { StatusMark } from '../components/status-mark/status-mark.tsx'
import { IconGitBranch, IconX } from '../icons.ts'
import { VIEW_TRAVEL, arrival, useTransition } from '../motion.ts'

/**
 * A notification while the window has the focus: the system's would be lost behind the window
 * it is about, so Hemera draws its own, in the sheet's bottom corner.
 *
 * A card, and in it the row of a list lifted off the page: the mark of what happened at the
 * start — the status mark of what waits for the user, of what finished, of what failed, or a
 * branch for what moved outside Hemera — then the Project's letter and the mission's key over
 * the title, and a line of detail under them. The mark is the tone; nothing else is coloured.
 *
 * Pressing it goes where the notification leads — the mission, the need, the setting — and takes
 * the notification with it; its × only takes the notification. One arrives from under the edge
 * on `arrival`, pushes the ones already there up, and leaves by fading; asked for less movement
 * it is there at once.
 */
export type NoticeTone = 'you' | 'done' | 'failed' | 'outside'

export interface NoticeItem {
  id: string
  tone: NoticeTone
  /** The Project it belongs to, whose letter is drawn. */
  project: string
  /** The mission's key, when it has one. */
  missionKey?: string | undefined
  title: string
  /** A second line, when the title is not the whole of it: who, what, where. */
  detail?: string | undefined
}

const STACK =
  'pointer-events-none absolute right-4 bottom-4 flex w-notice flex-col items-stretch gap-2'

/** The card: under the hand, a faint tint over the whole of it, inside its radius, and nothing inside. */
const NOTICE =
  'pointer-events-auto flex items-start gap-2 rounded-lg border border-border bg-card p-2 text-left text-card-foreground shadow-lg hover:tinted hover-motion'

/** What the notice says, which is the whole of it apart from its ×: one press, one place. */
const OPEN =
  'flex min-w-0 flex-1 items-start gap-3 rounded-md p-1 text-left outline-none focus-ring'

/** The mark's room: as tall as the first line, so the mark sits on it. */
const MARK = 'flex h-control-text shrink-0 items-center text-muted-foreground'

const WORDS = 'flex min-w-0 flex-1 flex-col gap-0.5'

const ABOUT = 'flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground'

const KEY = 'shrink-0 font-mono'

const TITLE = 'truncate text-sm font-medium text-foreground'

const DETAIL = 'truncate text-xs text-muted-foreground'

/** The mark each tone is said by. */
const MARKS: Record<NoticeTone, ReactNode> = {
  you: <StatusMark state="waiting" size="sm" />,
  done: <StatusMark state="done" size="sm" />,
  failed: <StatusMark state="failed" size="sm" />,
  outside: <IconGitBranch size="sm" />,
}

export interface NoticeStackProps {
  notices: readonly NoticeItem[]
  /** Where the notification leads. */
  onOpen: (id: string) => void
  onDismiss: (id: string) => void
}

export function NoticeStack({ notices, onOpen, onDismiss }: NoticeStackProps): ReactNode {
  const transition = useTransition(arrival)
  return (
    <div role="region" aria-label="Notifications" aria-live="polite" className={STACK}>
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <motion.div
            key={notice.id}
            layout
            className={NOTICE}
            data-notice={notice.tone}
            initial={{ opacity: 0, y: VIEW_TRAVEL }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <button type="button" className={OPEN} onClick={() => onOpen(notice.id)}>
              <span className={MARK} aria-hidden="true">
                {MARKS[notice.tone]}
              </span>
              <span className={WORDS}>
                <span className={TITLE}>{notice.title}</span>
                <span className={ABOUT}>
                  <LetterAvatar name={notice.project} />
                  <span className="truncate">{notice.project}</span>
                  {notice.missionKey !== undefined && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className={KEY}>{notice.missionKey}</span>
                    </>
                  )}
                </span>
                {notice.detail !== undefined && <span className={DETAIL}>{notice.detail}</span>}
              </span>
            </button>
            <IconButton
              variant="ghost"
              size="sm"
              icon={<IconX size="sm" />}
              aria-label={`Dismiss: ${notice.title}`}
              className="shrink-0"
              onClick={() => onDismiss(notice.id)}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
