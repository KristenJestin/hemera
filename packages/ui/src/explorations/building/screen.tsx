import { type ReactNode, useState } from 'react'

import type { MissionMarkView } from '../../blocks/mission/vocabulary.ts'
import { Button } from '../../components/button/button.tsx'
import type { ModelChoice } from '../../components/model-picker/model-picker.tsx'
import { IconFileText, IconGitCompare, IconListCheck } from '../../icons.ts'
import { ContentHeader, type Crumb } from '../../shell/content-header.tsx'
import {
  MissionFrame,
  MissionFrameNeeds,
  type MissionMore,
  type MissionView,
} from '../../surfaces/mission/mission-frame.tsx'
import {
  AT_BASE,
  type MissionFrameState,
  closeView,
  openView,
  showView,
} from '../../surfaces/mission/navigation.ts'
import { stageWords } from '../../blocks/mission/vocabulary.ts'
import { BuildingPage, type BuildingHandlers } from './building.tsx'
import {
  BRANCH,
  KEY,
  MOMENTS,
  type MomentName,
  READY_MOMENTS,
  type ReadyName,
  TASK_DETAILS,
  TITLE,
} from './fixtures.ts'
import { ReadyPage, blockerOf, launchable } from './ready.tsx'
import { TaskView } from './task-view.tsx'
import type { BuildingMoment, Task, TaskDetail } from './types.ts'

/**
 * The Ready and Building pages of ACME-12 in their mission frame, under the window's header that
 * carries the trail, with the views a story can open over them: a task (`ACME-12 › Building ›
 * T8`), the Spec, the diff. The story's engine holds the views and the few changes a press makes:
 * Launch starts the check, a choice moves the check on.
 */

/** A body for a view whose content is another ticket's: the Spec, the diff. */
function Elsewhere({ words }: { words: string }): ReactNode {
  return <p className="max-w-measure px-6 py-5 text-sm text-muted-foreground">{words}</p>
}

function useViews(initial: MissionFrameState) {
  const [state, setState] = useState(initial)
  return {
    state,
    open: (id: string): void => setState((before) => openView(before, id)),
    show: (id: string | null): void => setState((before) => showView(before, id)),
    close: (id: string): void => setState((before) => closeView(before, id)),
  }
}

/** A task with nothing to say yet: its view says where it belongs and that it has not started. */
function detailOf(task: Task, requirement: string): TaskDetail {
  return (
    TASK_DETAILS.get(task.id) ?? {
      task,
      requirement,
      targets: task.repositories.map((repository) => `${repository}/src`),
      tries: [],
      files: [],
      verdicts: [],
      conflicts: [],
    }
  )
}

function taskViews(moment: BuildingMoment, onOpenDiff: (what: string) => void): MissionView[] {
  const groups = [
    ...moment.requirements.map((one) => ({ label: `${one.id} · ${one.title}`, tasks: one.tasks })),
    ...(moment.points ?? []).map((one) => ({
      label: `${one.id} · ${one.title}`,
      tasks: one.tasks,
    })),
    { label: 'Special task · asked by the automatic review', tasks: moment.special },
  ]
  return groups.flatMap((group) =>
    group.tasks.map((task): MissionView => ({
      id: `task:${task.id}`,
      title: `${task.id} · ${task.title}`,
      icon: <IconListCheck size="sm" />,
      width: 'narrow',
      body: <TaskView detail={detailOf(task, group.label)} onOpenDiff={onOpenDiff} />,
    })),
  )
}

function commonViews(): MissionView[] {
  return [
    {
      id: 'spec',
      title: 'Spec',
      icon: <IconFileText size="sm" />,
      width: 'wide',
      body: <Elsewhere words="The frozen Spec, as the Spec page draws it." />,
    },
    {
      id: 'diff',
      title: 'Diff',
      icon: <IconGitCompare size="sm" />,
      width: 'wide',
      body: <Elsewhere words="The diff, as the diff view draws it." />,
    },
  ]
}

const crumbsOf = (
  views: readonly MissionView[],
  state: MissionFrameState,
  stage: string,
  show: (id: string | null) => void,
): Crumb[] => [
  { id: 'project', label: 'Acme', onPress: () => {} },
  { id: 'mission', label: KEY, mono: true, onPress: () => show(null) },
  { id: 'stage', label: stage, onPress: () => show(null) },
  ...state.open.map((id) => ({
    id: `view:${id}`,
    label: views.find((view) => view.id === id)?.title ?? id,
    icon: views.find((view) => view.id === id)?.icon,
    onPress: () => show(id),
  })),
]

export interface BuildingScreenProps extends BuildingHandlers {
  moment: MomentName
  loading?: boolean | undefined
  title?: string | undefined
  /** The views open as the story starts. */
  initial?: MissionFrameState | undefined
}

/** The Building page of ACME-12 in its frame, the needs above it, its views over it. */
export function BuildingScreen({
  moment: name,
  loading = false,
  title = TITLE,
  initial = AT_BASE,
  ...handlers
}: BuildingScreenProps): ReactNode {
  const moment = MOMENTS[name]()
  const views = useViews(initial)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const onOpenDiff = (what: string): void => {
    handlers.onOpenDiff(what)
    views.open('diff')
  }
  const all = [...taskViews(moment, onOpenDiff), ...commonViews()]
  const stage = stageWords('Building', moment.round)
  const marks: MissionMarkView[] = []
  if (moment.needs.length > 0) marks.push({ kind: 'needsYou' })
  if (moment.outside !== undefined) marks.push({ kind: 'outside', repository: moment.outside })
  const more: MissionMore[] = []
  more.push({
    label: 'Diff',
    icon: <IconGitCompare size="sm" />,
    onSelect: () => views.open('diff'),
  })
  return (
    <div className="flex h-screen flex-col bg-surface-content">
      <ContentHeader
        folded={false}
        onFold={() => {}}
        crumbs={crumbsOf(all, views.state, stage, views.show)}
      />
      <MissionFrame
        ballFace={false}
        missionKey={KEY}
        title={title}
        stage="Building"
        round={moment.round}
        frozen
        type="feature"
        ball={moment.needs.length > 0 ? 'you' : 'agent'}
        marks={marks}
        ticket={{ key: 'acme/shop#41' }}
        branch={moment.branch}
        spec="frozen yesterday at 17:02"
        onOpenSpec={() => views.open('spec')}
        more={more}
        onCancel={() => {}}
        needs={
          <MissionFrameNeeds
            rows={moment.needs}
            projects={['Acme']}
            on={() => ({
              onPermission: () => {},
              onChoose: () => {},
              onWrite: () => {},
              onApply: () => {},
              onRetry: () => {},
              onSettings: () => {},
            })}
          />
        }
        base={
          <BuildingPage
            moment={moment}
            chosenTask={chosen}
            loading={loading}
            onOpenTask={(id) => {
              setChosen(id)
              handlers.onOpenTask(id)
              views.open(`task:${id}`)
            }}
            onOpenDiff={onOpenDiff}
            onService={handlers.onService}
            onRevoke={handlers.onRevoke}
          />
        }
        views={all}
        open={views.state.open}
        shown={views.state.shown}
        onShow={views.show}
        onClose={views.close}
      />
    </div>
  )
}

export interface ReadyScreenProps {
  moment: ReadyName
  title?: string | undefined
  onLaunch: () => void
  onLaunchAnyway: () => void
  onBackToPlanning: () => void
  onCheckAgain: () => void
  onModel: (choice: ModelChoice | null) => void
  onRevoke: (id: string) => void
}

/** The Ready page of ACME-12 in its frame: Launch in the header while it can be pressed. */
export function ReadyScreen({
  moment: name,
  title = TITLE,
  ...handlers
}: ReadyScreenProps): ReactNode {
  const [shown, setShown] = useState<ReadyName>(name)
  const moment = READY_MOMENTS[shown]()
  const views = useViews(AT_BASE)
  const all = commonViews()
  const blocker = blockerOf(moment)
  const check = (): void => setShown('checking')
  const marks: MissionMarkView[] = []
  if (blocker !== undefined) marks.push({ kind: 'blocked', cause: blocker.key })
  if (moment.needs.length > 0) marks.push({ kind: 'needsYou' })
  return (
    <div className="flex h-screen flex-col bg-surface-content">
      <ContentHeader
        folded={false}
        onFold={() => {}}
        crumbs={crumbsOf(all, views.state, 'Ready', views.show)}
      />
      <MissionFrame
        ballFace={false}
        missionKey={KEY}
        title={title}
        stage="Ready"
        frozen
        type="feature"
        ball={
          blocker !== undefined
            ? 'blocked'
            : moment.check.state === 'checking' || moment.preparation !== null
              ? 'agent'
              : 'you'
        }
        marks={marks}
        ticket={{ key: 'acme/shop#41' }}
        branch={moment.preparation === null ? undefined : BRANCH}
        spec={`frozen ${moment.frozenAt}`}
        onOpenSpec={() => views.open('spec')}
        action={
          launchable(moment) ? (
            <Button
              variant="primary"
              onClick={() => {
                handlers.onLaunch()
                check()
              }}
            >
              Launch
            </Button>
          ) : undefined
        }
        onCancel={() => {}}
        needs={
          <MissionFrameNeeds
            rows={moment.needs}
            projects={['Acme']}
            open={moment.needs[0]?.id}
            on={() => ({ onRetry: () => {}, onSettings: () => {} })}
          />
        }
        base={
          <ReadyPage
            moment={moment}
            onLaunchAnyway={handlers.onLaunchAnyway}
            onBackToPlanning={handlers.onBackToPlanning}
            onCheckAgain={() => {
              handlers.onCheckAgain()
              check()
            }}
            onModel={handlers.onModel}
            onOpenSpec={() => views.open('spec')}
            onOpenDiff={() => views.open('diff')}
            onRevoke={handlers.onRevoke}
          />
        }
        views={all}
        open={views.state.open}
        shown={views.state.shown}
        onShow={views.show}
        onClose={views.close}
      />
    </div>
  )
}
