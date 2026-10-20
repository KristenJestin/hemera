import type { BuildingView, Spec } from '@hemera/ipc'
import { BuildingPage, ErrorState, TaskView, type Building, type MissionView } from '@hemera/ui'
import { IconListCheck } from '@hemera/ui/icons'
import { useState, type ReactNode } from 'react'

import { budgetOf, taskDetailOf } from './building-model.ts'
import type { StagePageProps } from './stage-pages.tsx'
import { useBuilding } from './use-building.ts'

/** What the page draws while its first read is on its way: rows of their shape, nothing else. */
const READING: Building.BuildingMoment = {
  now: '',
  elapsed: '',
  workspace: '',
  branch: '',
  round: 0,
  requirements: [],
  special: [],
  phases: [],
  checks: [],
  changes: [],
  services: [],
  idle: [],
  catalogue: [],
  helpers: [],
  journal: [],
  needs: [],
  mission: { dependencies: [], grants: [], budget: budgetOf(null) },
}

/** The id of a task's view over the Building page. */
export const taskViewId = (taskId: string): string => `task:${taskId}`

/** A task opened over the Building page; its diff link opens the mission's diff (#497). */
export function taskViewsOf(
  building: BuildingView,
  spec: Spec | null,
  open: (view: string) => void,
  now: Date,
): MissionView[] {
  return building.tasks.map((task) => ({
    id: taskViewId(task.id),
    title: `${task.id} · ${task.title}`,
    icon: <IconListCheck size="sm" />,
    width: 'narrow',
    body: (
      <TaskView detail={taskDetailOf(building, task, spec, now)} onOpenDiff={() => open('diff')} />
    ),
  }))
}

/**
 * The page of a Building mission (#151): the spine of requirements with their tasks and proofs in
 * the middle; the rail with the stage card (what happens, the chips of the agents beside the
 * Builder, and of an agent kept from before a restart), the services, the checks, the changes,
 * the journal and the mission's own things; a task opened as a view over it
 * (`ACME-12 › Building › T8`). The mission's needs stand above the page; the head draws the ball
 * without the face, the page's stage card drawing it.
 */
export function BuildingStage({
  link,
  engineReady,
  mission,
  open,
  kept,
  frame,
}: StagePageProps): ReactNode {
  const [view, act] = useBuilding(link, engineReady, mission)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const { moment, building, spec } = view
  const shown = moment ?? READING
  const service = (id: string, action: Parameters<typeof act.service>[1]): void => {
    const url = shown.services.find((one) => one.id === id)?.url
    if (action === 'open') {
      if (url !== undefined) window.open(url, '_blank', 'noopener')
      return
    }
    if (action === 'copy') {
      if (url !== undefined) navigator.clipboard.writeText(url).catch(() => undefined)
      return
    }
    void act.service(id, action)
  }
  const views = building === null ? [] : taskViewsOf(building, spec, open, new Date())
  const base =
    moment === null && view.error !== undefined ? (
      <div className="px-8 py-6">
        <ErrorState
          title="The Building page could not be read"
          description={view.error}
          onRetry={act.retry}
        />
      </div>
    ) : (
      <BuildingPage
        moment={shown}
        loading={moment === null}
        chosenTask={chosen}
        kept={kept}
        onOpenDiff={() => open('diff')}
        onOpenTask={(id) => {
          setChosen(id)
          open(taskViewId(id))
        }}
        onService={service}
        onRevoke={(id) => void act.revoke(id)}
        onJournalMore={() => void act.journalMore()}
      />
    )
  return frame({ base, views, ballFace: false, notice: view.refused })
}
