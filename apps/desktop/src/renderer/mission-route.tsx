import type { FreezeReadiness, Mission, Project } from '@hemera/ipc'
import {
  Button,
  MissionFrame,
  MissionFrameBase,
  MissionFrameNeeds,
  type AppSection,
  type MissionFrameState,
  type MissionView,
} from '@hemera/ui'
import { createElement, useEffect, useState, type ReactNode } from 'react'

import type { Link } from './link.ts'
import {
  freezeShown,
  frozenOf,
  headerOf,
  needHandlersOf,
  needRowsOfMission,
  oneAtATime,
  pageOf,
  repositoryNamer,
} from './mission-header-model.ts'
import { lineOf } from './missions.ts'
import type { ShellActions } from './shell.tsx'
import { MISSION_VIEWS, STAGE_PAGES, type MissionViewEntry } from './stage-pages.tsx'
import { useMissions } from './use-missions.ts'

export interface MissionRouteProps {
  link: Link
  engineReady: boolean
  projectId: string
  missionKey: string
  now: Date
  /** The base and the views over it, kept per mission by the navigation. */
  frame: MissionFrameState
  actions: {
    open: (view: string) => void
    show: (view: string | null) => void
    close: (view: string) => void
    goProject: () => void
    answer: ShellActions['answer']
    recheck: ShellActions['recheck']
    openSettings: (section: AppSection) => void
  }
}

export interface MissionPageProps extends Omit<MissionRouteProps, 'projectId' | 'missionKey'> {
  mission: Mission
  /** The Project, once read: its name and the names of its repositories. */
  project: Project | null
  /** What stands between a Planning mission and its Freeze, once the engine said. */
  readiness: FreezeReadiness | null
  /** Why the last Freeze or Cancel did not go through, in words. */
  notice?: string | undefined
  freeze: () => void
  /** Whether a Freeze is in flight: Freeze is then not offered again. */
  freezing?: boolean | undefined
  cancel: () => void
  /** The page of each stage; the registry of `stage-pages.tsx` unless a test says otherwise. */
  pages?: typeof STAGE_PAGES | undefined
  /** The views a mission can open; the registry of `stage-pages.tsx` unless a test says otherwise. */
  views?: Readonly<Record<string, MissionViewEntry>> | undefined
}

/** What the sheet of a view is made of, from the registry: the body is the mission's. */
function viewsOf(
  registry: Readonly<Record<string, MissionViewEntry>>,
  mission: Mission,
): MissionView[] {
  return Object.entries(registry).map(([id, view]) => ({
    id,
    title: view.title,
    icon: view.icon,
    width: view.width,
    body: view.body(mission),
  }))
}

/** A mission's page, drawn: its frame, with the base of its stage and the views over it. */
export function MissionPage({
  link,
  engineReady,
  mission,
  project,
  readiness,
  notice,
  now,
  frame,
  actions,
  freeze,
  freezing = false,
  cancel,
  pages = STAGE_PAGES,
  views = MISSION_VIEWS,
}: MissionPageProps): ReactNode {
  const line = lineOf(mission, repositoryNamer(project))
  const header = headerOf(line, readiness)
  const sheets = viewsOf(views, mission)
  const known = new Set(sheets.map((sheet) => sheet.id))
  const open = frame.open.filter((id) => known.has(id))
  const shown = frame.shown !== null && known.has(frame.shown) ? frame.shown : null
  const Page = pageOf(pages, line.stage)
  const rows = needRowsOfMission(mission, project?.name ?? 'Project', now)
  const ticketUrl = line.ticket?.url ?? null
  return (
    <MissionFrame
      missionKey={line.key}
      title={line.title}
      stage={line.stage}
      round={line.round}
      frozen={frozenOf(line)}
      type={line.type}
      ball={line.ball}
      marks={line.marks}
      onOpenOutdated={'difference' in views ? () => actions.open('difference') : undefined}
      ticket={
        line.ticket === null
          ? null
          : {
              key: line.ticket.key,
              onOpen:
                ticketUrl === null ? undefined : () => window.open(ticketUrl, '_blank', 'noopener'),
            }
      }
      onOpenSpec={'spec' in views ? () => actions.open('spec') : undefined}
      action={
        header.freeze ? (
          <Button
            variant="primary"
            size="sm"
            state={freezing ? 'loading' : 'idle'}
            onClick={freeze}
          >
            Freeze
          </Button>
        ) : undefined
      }
      onCancel={header.cancel ? cancel : undefined}
      notice={notice}
      needs={
        <MissionFrameNeeds
          rows={rows}
          projects={project === null ? undefined : [project.name]}
          on={needHandlersOf(mission, {
            answer: actions.answer,
            recheck: actions.recheck,
            openSettings: actions.openSettings,
          })}
        />
      }
      base={
        Page === undefined ? (
          <MissionFrameBase stage={line.stage} />
        ) : (
          createElement(Page, { link, engineReady, mission, open: actions.open })
        )
      }
      views={sheets}
      open={open}
      shown={shown}
      onShow={actions.show}
      onClose={actions.close}
    />
  )
}

/** A mission's page: read from its Project's missions, followed as they change. */
export function MissionRoute({
  link,
  engineReady,
  projectId,
  missionKey,
  now,
  frame,
  actions,
}: MissionRouteProps): ReactNode {
  const missions = useMissions(link, engineReady, projectId)
  const [project, setProject] = useState<Project | null>(null)
  const [readiness, setReadiness] = useState<FreezeReadiness | null>(null)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [freezing, setFreezing] = useState(false)
  const [once] = useState(() => oneAtATime(setFreezing))
  const mission =
    missions.kind === 'ready' ? missions.missions.find((one) => one.key === missionKey) : undefined
  const id = mission?.id
  const planning = mission?.stage === 'planning'

  useEffect(() => {
    if (!engineReady) return undefined
    let stopped = false
    link.project(projectId).then(
      (read) => {
        if (!stopped) setProject(read)
      },
      // Without its Project, the marks say a repository by its id and the needs by a plain name.
      () => undefined,
    )
    return () => {
      stopped = true
    }
  }, [link, engineReady, projectId])

  // Recent is built from the missions opened: once per mission shown.
  useEffect(() => {
    if (!engineReady || id === undefined) return
    link.missionOpened(id).catch(() => undefined)
  }, [link, engineReady, id])

  useEffect(() => {
    if (!engineReady || id === undefined || !planning) return undefined
    let stopped = false
    const unsubscribe = link.onFreezeReadiness(
      id,
      (heard) => {
        if (!stopped) setReadiness(heard)
      },
      () => undefined,
    )
    link.freezeReadiness(id).then(
      (read) => {
        if (!stopped) setReadiness((heard) => heard ?? read)
      },
      () => undefined,
    )
    return () => {
      stopped = true
      unsubscribe()
      setReadiness(null)
    }
  }, [link, engineReady, id, planning])

  if (missions.kind !== 'ready' || mission === undefined) return null

  // The Spec is frozen at the version the user was shown; the engine refuses one that moved since.
  const freeze = (): void => {
    if (readiness === null) return
    setNotice(undefined)
    once(() => freezeShown(link, mission.id, readiness)).catch((failure: Error) =>
      setNotice(failure.message),
    )
  }
  const cancel = (): void => {
    setNotice(undefined)
    link.cancelMission(mission.id).catch((failure: Error) => setNotice(failure.message))
  }

  return (
    <MissionPage
      link={link}
      engineReady={engineReady}
      mission={mission}
      project={project}
      readiness={readiness}
      notice={notice}
      now={now}
      frame={frame}
      actions={actions}
      freeze={freeze}
      freezing={freezing}
      cancel={cancel}
    />
  )
}
