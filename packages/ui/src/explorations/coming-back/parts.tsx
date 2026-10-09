import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import type { Ball } from '../../blocks/ball/ball-mark.tsx'
import { AlertDialog } from '../../components/alert-dialog/alert-dialog.tsx'
import { Button } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Kbd } from '../../components/kbd/kbd.tsx'
import { Loading } from '../../components/loading/loading.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import {
  IconBug,
  IconClockPause,
  IconExternalLink,
  IconGitCompare,
  IconHandStop,
  IconListCheck,
  IconLock,
  IconMessages,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconWorld,
} from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'

/**
 * What the screens share: the vocabulary of a mission as these screens show it, its marks, the
 * start field and the confirmation of Cancel. The screens differ in where these sit and how
 * much they say, not in what they are.
 */
export type Stage = 'Planning' | 'Ready' | 'Building' | 'Review' | 'Shipping' | 'Done'

/** The stages in the order the sidebar and the Project page give them, Done last and folded. */
export const STAGE_ORDER: readonly Stage[] = [
  'Shipping',
  'Review',
  'Building',
  'Planning',
  'Ready',
  'Done',
]

/** The stages in the order a mission lives them. */
export const LIFE: readonly Stage[] = [
  'Planning',
  'Ready',
  'Building',
  'Review',
  'Shipping',
  'Done',
]

export type Mark =
  | { kind: 'blocked'; cause: string }
  | { kind: 'waiting'; on: string }
  | { kind: 'needsYou' }
  | { kind: 'outdated' }
  | { kind: 'outside'; repository: string }
  | { kind: 'fixing' }

export interface ExploredMission {
  key: string
  title: string
  type: 'feature' | 'fix' | 'chore'
  stage: Stage
  /** The round of a Review. */
  round?: number | undefined
  /** Whether the Spec is frozen. */
  frozen: boolean
  ball: Ball
  marks: readonly Mark[]
  /** The last thing that happened to it. */
  event: { text: string; when: string }
  ticket?: string | undefined
  branch?: string | undefined
  /** How far Building has gone. */
  percent?: number | undefined
}

/** What the stage action of each stage is called; the stages without one have none. */
export const ACTIONS: Partial<Record<Stage, string>> = {
  Planning: 'Freeze',
  Ready: 'Launch',
  Review: 'Ship',
}

/** A mark in words: the legend on its glyph, and what the spelled form writes. */
export function markWords(mark: Mark): string {
  switch (mark.kind) {
    case 'blocked':
      return `Blocked by ${mark.cause}`
    case 'waiting':
      return `Waiting on ${mark.on}`
    case 'needsYou':
      return 'Needs you'
    case 'outdated':
      return 'Outdated'
    case 'outside':
      return `${mark.repository} changed outside Hemera`
    case 'fixing':
      return 'Fixing'
  }
}

const MARK_TONE: Record<Mark['kind'], string> = {
  blocked: 'flex text-destructive',
  waiting: 'flex text-muted-foreground',
  needsYou: 'flex text-warning',
  outdated: 'flex text-warning',
  outside: 'flex text-info',
  fixing: 'flex text-build',
}

function markIcon(mark: Mark): ReactNode {
  switch (mark.kind) {
    case 'blocked':
      return <IconHandStop size="sm" />
    case 'waiting':
      return <IconClockPause size="sm" />
    case 'needsYou':
      return <IconListCheck size="sm" />
    case 'outdated':
      return <IconRefresh size="sm" />
    case 'outside':
      return <IconGitCompare size="sm" />
    case 'fixing':
      return <IconBug size="sm" />
  }
}

const SPELLED = 'flex min-w-0 items-center gap-1 text-xs'

/**
 * One mark: its glyph with its legend in a tooltip, or — `spelled` — its glyph followed by its
 * words, for a mark whose cause the user must read without pointing at it.
 */
export function MarkGlyph({ mark, spelled = false }: { mark: Mark; spelled?: boolean }) {
  const words = markWords(mark)
  if (spelled) {
    return (
      <span className={SPELLED} data-mark={mark.kind}>
        <span aria-hidden="true" className={MARK_TONE[mark.kind]}>
          {markIcon(mark)}
        </span>
        <span className="truncate">{words}</span>
      </span>
    )
  }
  return (
    <Legend label={words}>
      <span aria-hidden="true" className={MARK_TONE[mark.kind]} data-mark={mark.kind}>
        {markIcon(mark)}
      </span>
    </Legend>
  )
}

/** The stage of a mission as a dot's tone. */
export const STAGE_DOT: Record<Stage, string> = {
  Planning: 'size-2 shrink-0 rounded-full bg-info',
  Ready: 'size-2 shrink-0 rounded-full bg-muted-foreground',
  Building: 'size-2 shrink-0 rounded-full bg-build',
  Review: 'size-2 shrink-0 rounded-full bg-warning',
  Shipping: 'size-2 shrink-0 rounded-full bg-primary',
  Done: 'size-2 shrink-0 rounded-full bg-success',
}

export function stageLabel(mission: ExploredMission): string {
  return mission.round === undefined
    ? mission.stage
    : `${mission.stage} · round ${String(mission.round)}`
}

/** The ticket a mission comes from, as a link: `ACME-12 ↗ acme/shop#41`. */
export function TicketLink({ ticket }: { ticket: string }): ReactNode {
  return (
    <a
      href={`#${ticket}`}
      className="flex min-w-0 items-center gap-1 rounded-sm font-mono outline-none hover:text-foreground focus-ring"
    >
      <IconExternalLink size="sm" />
      <span className="truncate">{ticket}</span>
    </a>
  )
}

/** The frozen Spec, said once, inside the stage chip. */
export function FrozenGlyph(): ReactNode {
  return (
    <Legend label="Spec frozen">
      <span aria-hidden="true" className="flex text-muted-foreground">
        <IconLock size="sm" />
      </span>
    </Legend>
  )
}

/** Cancel, visible at every stage before Done, and the question it asks first. */
export function CancelMission({
  missionKey,
  onCancel,
}: {
  missionKey: string
  onCancel: () => void
}): ReactNode {
  return (
    <AlertDialog
      title={`Cancel ${missionKey}?`}
      description="Hemera stops its sessions, commands, services and delivery steps. The Workspace, the branches and the evidence stay until you confirm the cleanup."
      confirmLabel="Cancel the mission"
      cancelLabel="Keep it going"
      trigger={
        <Button variant="ghost" size="sm">
          Cancel
        </Button>
      }
      onConfirm={onCancel}
    />
  )
}

export type StartResult =
  | { kind: 'mission'; key: string; title: string; done?: boolean | undefined }
  | { kind: 'ticket'; key: string; title: string; linked?: string | undefined }

/** What the agent answers under the field, once it has read what was typed. */
export type Triage =
  | { kind: 'reading' }
  | { kind: 'belongs'; key: string }
  | { kind: 'delivered'; key: string }
  | { kind: 'small' }

const RESULTS = 'flex flex-col py-1'

const RESULT =
  'flex h-control-md w-full min-w-0 items-center gap-3 px-4 text-left text-sm outline-none hover:bg-muted focus-ring hover-motion'

const RESULT_KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const QUIET = 'shrink-0 text-xs text-muted-foreground'

const TRIAGE = 'flex min-w-0 flex-wrap items-center gap-3 px-1 text-sm'

function TriageLine({ triage }: { triage: Triage }): ReactNode {
  switch (triage.kind) {
    case 'reading':
      return (
        <div className={TRIAGE} role="status">
          <Loading size="sm" label="Hemera reads it" />
          <span className="text-muted-foreground">Hemera reads it…</span>
        </div>
      )
    case 'belongs':
      return (
        <div className={TRIAGE} role="status">
          <span>This belongs to {triage.key}</span>
          <Button variant="secondary" size="sm">
            Add it to {triage.key}
          </Button>
          <Button variant="ghost" size="sm">
            Start a mission anyway
          </Button>
        </div>
      )
    case 'delivered':
      return (
        <div className={TRIAGE} role="status">
          <span>Already delivered by {triage.key}</span>
          <Button variant="secondary" size="sm">
            Open {triage.key}
          </Button>
          <Button variant="ghost" size="sm">
            Start a mission anyway
          </Button>
        </div>
      )
    case 'small':
      return (
        <div className={TRIAGE} role="status">
          <span>Too small for a mission</span>
          <Button variant="secondary" size="sm">
            Ask in a Chat
          </Button>
          <Button variant="ghost" size="sm">
            Start a mission anyway
          </Button>
        </div>
      )
  }
}

export interface StartFieldProps {
  project: string
  /** What is typed at first. */
  initial?: string | undefined
  /** Everything the field can find; it shows what matches what is typed. */
  results: readonly StartResult[]
  triage?: Triage | undefined
  onCreate: (text: string) => void
  onOpen: (key: string) => void
}

/**
 * The field that starts a mission: it searches first and creates last. As it is typed, what it
 * finds unfolds under it and pushes the page down: local missions, then tickets, linked or
 * remote, and "Create a mission" always last. The agent's triage answer stands under the field.
 */
export function StartField({
  project,
  initial = '',
  results,
  triage,
  onCreate,
  onOpen,
}: StartFieldProps): ReactNode {
  const [text, setText] = useState(initial)
  const folding = useTransition(fold)
  const typed = text.trim()
  const found =
    typed === ''
      ? []
      : results.filter((result) =>
          `${result.key} ${result.title}`.toLowerCase().includes(typed.toLowerCase()),
        )
  return (
    <div className="flex flex-col gap-2">
      <Input
        label={`Start a mission in ${project}`}
        icon={<IconSearch size="sm" />}
        placeholder="A ticket, an idea…"
        value={text}
        onValueChange={setText}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || typed === '') return
          event.preventDefault()
          onCreate(typed)
        }}
        trailing={<Kbd keys="Ctrl+K" />}
      />
      <AnimatePresence initial={false}>
        {typed !== '' && (
          <motion.div
            key="results"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <Frame>
              <ul aria-label="Found" className={RESULTS}>
                {found.map((result) => (
                  <li key={result.key}>
                    <button type="button" className={RESULT} onClick={() => onOpen(result.key)}>
                      <span aria-hidden="true" className="flex text-muted-foreground">
                        {result.kind === 'mission' ? (
                          <IconListCheck size="sm" />
                        ) : (
                          <IconWorld size="sm" />
                        )}
                      </span>
                      <span className={RESULT_KEY}>{result.key}</span>
                      <span className="min-w-0 flex-1 truncate">{result.title}</span>
                      {result.kind === 'mission' && result.done === true && (
                        <span className={QUIET}>Done</span>
                      )}
                      {result.kind === 'ticket' && result.linked !== undefined && (
                        <span className={QUIET}>{result.linked}</span>
                      )}
                    </button>
                  </li>
                ))}
                <li className={cn(found.length > 0 && 'border-t border-border')}>
                  <button type="button" className={RESULT} onClick={() => onCreate(typed)}>
                    <span aria-hidden="true" className="flex text-primary">
                      <IconPlus size="sm" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">Create a mission “{typed}”</span>
                    <Kbd keys="Enter" />
                  </button>
                </li>
              </ul>
            </Frame>
          </motion.div>
        )}
      </AnimatePresence>
      {triage !== undefined && <TriageLine triage={triage} />}
    </div>
  )
}

/** A Chat of the Project, as a row. */
export function ChatRow({
  title,
  when,
  onOpen,
}: {
  title: string
  when: string
  onOpen: () => void
}): ReactNode {
  return (
    <li className="border-b border-border last:border-b-0">
      <button type="button" className={RESULT} onClick={onOpen}>
        <span aria-hidden="true" className="flex text-muted-foreground">
          <IconMessages size="sm" />
        </span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className={QUIET}>{when}</span>
      </button>
    </li>
  )
}

/** What a night's event is, as a status mark's state. */
export type NightTone = 'failed' | 'done' | 'ticket' | 'lifted'

export interface NightEvent {
  project: string
  key: string
  title: string
  ball: Ball
  events: readonly { tone: NightTone; text: string; when: string }[]
}

/** The page a stage owns, which these screens do not draw: its place, kept as it was. */
export function StageBase({ stage }: { stage: Stage }): ReactNode {
  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-3 px-8 py-6">
      <Frame>
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          The {stage} page, kept as it was left
        </p>
      </Frame>
    </div>
  )
}

/** A night's event as a small mark beside its words, which already say it. */
export function NightMark({ tone }: { tone: NightTone }): ReactNode {
  switch (tone) {
    case 'failed':
      return <StatusMark state="failed" size="sm" />
    case 'done':
      return <StatusMark state="done" size="sm" />
    case 'ticket':
      return (
        <span aria-hidden="true" className="flex text-info">
          <IconWorld size="sm" />
        </span>
      )
    case 'lifted':
      return (
        <span aria-hidden="true" className="flex text-success">
          <IconHandStop size="sm" />
        </span>
      )
  }
}

export interface ProjectProps {
  missions: readonly ExploredMission[]
  done: readonly ExploredMission[]
  chats: readonly { id: string; title: string; when: string }[]
  results: readonly StartResult[]
  /** What the start field holds as the page opens. */
  typed?: string | undefined
  triage?: Triage | undefined
  onOpenMission: (key: string) => void
  onCreate: (text: string) => void
  onOpenChat: (id: string) => void
  onOpenSpec: () => void
  onOpenSettings: () => void
}

export interface MissionProps {
  mission: ExploredMission
  /** What the mission waits on the user for, at the top of every stage. */
  needs: readonly string[]
  onCancel: () => void
  onAction: () => void
  onOpenSpec: () => void
}

/** The needs of a mission, at the top: what it waits on the user for, and the way to answer. */
const NEED = 'flex min-h-control-md min-w-0 items-center gap-3 px-4 py-1.5 text-sm'

export function MissionNeeds({ needs }: { needs: readonly string[] }): ReactNode {
  if (needs.length === 0) return null
  return (
    <div className="px-8 pb-2">
      <Frame>
        <ul aria-label="Needs you" className="flex flex-col">
          {needs.map((need) => (
            <li key={need} className={NEED}>
              <StatusMark state="waiting" size="sm" />
              <span className="min-w-0 flex-1 truncate">{need}</span>
              <Button variant="secondary" size="sm">
                Answer
              </Button>
            </li>
          ))}
        </ul>
      </Frame>
    </div>
  )
}

export interface HomeProps {
  today: string
  needs: readonly { project: string; key: string; title: string; when: string }[]
  questions: readonly { project: string; key: string; title: string; when: string }[]
  night: readonly NightEvent[]
  recent: readonly ExploredMission[]
  onOpen: (key: string) => void
}
