import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import {
  IconBook2,
  IconFileText,
  IconGitCompare,
  IconListCheck,
  IconMessages,
} from '../../icons.ts'
import { ACME, MISSION, STAGE } from '../../shell/shell-cast.ts'
import { ContentHeader, type Crumb } from '../../shell/content-header.tsx'
import { MissionFrame, type MissionView } from './mission-frame.tsx'
import { AT_BASE, type MissionFrameState, closeView, openView, showView } from './navigation.ts'
import { ReviewStage, type ReviewStageProps } from './review-stage.tsx'

/** A minute and a half ago, for the services that run. */
const AGO = Date.now() - 84_000

/** What the Review stage of ACME-12 shows: the data of its page, without its callbacks. */
export const REVIEW: Omit<
  ReviewStageProps,
  'onAddRemark' | 'onFix' | 'onOpenTask' | 'onService' | 'onOpenRound' | 'onOpenDiff' | 'chosenTask'
> = {
  remarks: [
    {
      id: 'F1',
      text: 'The date column follows the browser, not the customer.',
      state: 'addressed',
      round: 1,
    },
    {
      id: 'F2',
      text: 'The file name keeps the filters, but not the date range.',
      state: 'resolved',
      round: 1,
    },
    {
      id: 'F3',
      text: 'The empty state of the billing page lost its icon.',
      state: 'resolved',
      round: 1,
    },
    { id: 'F4', text: 'Two exports at once give the same file name.', state: 'inRound', round: 1 },
    { id: 'F5', text: 'A long export shows no progress at all.', state: 'pending' },
  ],
  nextRound: 2,
  requirements: [
    {
      id: 'R1',
      title: 'Export the invoices of the current filters as CSV',
      proven: true,
      tasks: [
        { id: 'T1', title: 'Add the export endpoint', state: 'done', repositories: ['api'] },
        { id: 'T2', title: 'Stream the rows', state: 'done', repositories: ['api'] },
        {
          id: 'T3',
          title: 'The export button on the billing page',
          state: 'done',
          repositories: ['web'],
        },
      ],
    },
    {
      id: 'R2',
      title: 'Name the file after the filters',
      proven: true,
      tasks: [{ id: 'T4', title: 'Build the file name', state: 'done', repositories: ['shared'] }],
    },
    {
      id: 'R3',
      title: 'Show a progress for long exports',
      proven: false,
      tasks: [
        { id: 'T5', title: 'Count the rows first', state: 'running', repositories: ['api'] },
        { id: 'T6', title: 'A progress on the button', state: 'todo', repositories: ['web'] },
      ],
    },
  ],
  proofs: [
    { id: 'S1', test: 'api/tests/invoices-export.test.ts', state: 'green' },
    { id: 'S2', test: 'web/e2e/billing-export.spec.ts', state: 'green' },
    { id: 'S3', test: 'api/tests/invoices-export-progress.test.ts', state: 'red' },
  ],
  services: [
    {
      name: 'api',
      state: 'running',
      startedAt: AGO,
      endedAt: null,
      url: 'http://localhost:3012',
      line: 'pnpm --filter api dev',
    },
    {
      name: 'web',
      state: 'running',
      startedAt: AGO,
      endedAt: null,
      url: 'http://localhost:4212',
      line: 'pnpm --filter web dev',
    },
  ],
  rounds: [{ n: 1, points: 4, state: 'closed' }],
  checks: [
    { repository: 'api', name: 'test', state: 'done', after: 'final' },
    { repository: 'api', name: 'typecheck', state: 'done', after: 'final' },
    { repository: 'web', name: 'test', state: 'done', after: 'final' },
    { repository: 'web', name: 'lint', state: 'failed', after: 'after R3' },
  ],
  changes: [
    { repository: 'api', files: 14, added: 412, deleted: 38 },
    { repository: 'web', files: 3, added: 96, deleted: 12, outside: true },
    { repository: 'shared', files: 1, added: 18, deleted: 0 },
  ],
}

/** A body for a view, with the lines a story needs to scroll. */
function Prose({ title, lines, wide = false }: { title: string; lines: number; wide?: boolean }) {
  return (
    <div
      className={
        wide ? 'flex flex-col gap-3 px-6 py-5' : 'flex max-w-measure flex-col gap-3 px-6 py-5'
      }
    >
      <p className="text-sm text-muted-foreground">{title}</p>
      {Array.from({ length: lines }, (_, index) => (
        <p key={index} className="text-base">
          Line {index + 1} of the view, written by the agent and read here; what it says is a later
          ticket's, its width and its scroll are this one's.
        </p>
      ))}
    </div>
  )
}

/** The views ACME-12 can open over its Review page, by id; a task's id is `task:T2`. */
export function viewsOf(openSpec: () => void): readonly MissionView[] {
  const tasks = REVIEW.requirements.flatMap((requirement) => requirement.tasks)
  return [
    {
      id: 'spec',
      title: 'Spec',
      icon: <IconFileText size="sm" />,
      width: 'wide',
      actions: (
        <Button variant="ghost" size="sm">
          Copy as Markdown
        </Button>
      ),
      body: <Prose title="Frozen yesterday at 17:02" lines={30} />,
    },
    ...tasks.map((task): MissionView => ({
      id: `task:${task.id}`,
      title: `${task.id} · ${task.title}`,
      icon: <IconListCheck size="sm" />,
      width: 'narrow',
      body: <Prose title={`${task.repositories.join(', ')} · ${task.state}`} lines={12} />,
    })),
    {
      id: 'round:1',
      title: 'Round 1',
      icon: <IconMessages size="sm" />,
      width: 'narrow',
      actions: (
        <Button variant="secondary" size="sm" onClick={openSpec}>
          Open the Spec
        </Button>
      ),
      body: <Prose title="Four points, all addressed" lines={10} />,
    },
    {
      id: 'diff',
      title: 'Diff',
      icon: <IconGitCompare size="sm" />,
      width: 'wide',
      body: <Prose title="14 files in api, 3 in web, 1 in shared" lines={60} wide />,
    },
    {
      id: 'memory',
      title: 'Memory',
      icon: <IconBook2 size="sm" />,
      width: 'wide',
      body: <Prose title="Now, Journal, Notes" lines={20} />,
    },
  ]
}

/** The title a view's crumb or tab carries. */
function titleOf(views: readonly MissionView[], id: string): string {
  return views.find((view) => view.id === id)?.title ?? id
}

export interface MissionMachine {
  state: MissionFrameState
  views: readonly MissionView[]
  open: (id: string) => void
  show: (id: string | null) => void
  close: (id: string) => void
  /** The crumbs of the window's trail after the stage: the open views. */
  crumbs: readonly Crumb[]
}

/** The state of a mission's views, as the renderer's hook will hold it. */
export function useMissionMachine(initial: MissionFrameState = AT_BASE): MissionMachine {
  const [state, setState] = useState(initial)
  const open = (id: string): void => setState((before) => openView(before, id))
  const views = viewsOf(() => open('spec'))
  const show = (id: string | null): void => setState((before) => showView(before, id))
  const close = (id: string): void => setState((before) => closeView(before, id))
  const crumbs: Crumb[] = state.open.map((id) => ({
    id: `view:${id}`,
    label: titleOf(views, id),
    icon: views.find((view) => view.id === id)?.icon,
    onPress: () => show(id),
  }))
  return { state, views, open, show, close, crumbs }
}

/** The mission frame of ACME-12 on its Review page, driven by a machine. */
export function MissionBody({
  machine,
  title = MISSION.title,
}: {
  machine: MissionMachine
  title?: string | undefined
}): ReactNode {
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  return (
    <MissionFrame
      missionKey={MISSION.key}
      title={title}
      stage={STAGE}
      ball="you"
      branch={MISSION.branch}
      spec={MISSION.spec}
      onOpenSpec={() => machine.open('spec')}
      action={<Button variant="primary">Ship</Button>}
      more={[
        { label: 'Memory', icon: <IconBook2 size="sm" />, onSelect: () => machine.open('memory') },
        { label: 'Diff', icon: <IconGitCompare size="sm" />, onSelect: () => machine.open('diff') },
      ]}
      onCancel={() => {}}
      base={
        <ReviewStage
          {...REVIEW}
          chosenTask={chosen}
          onAddRemark={() => {}}
          onFix={() => {}}
          onOpenTask={(id) => {
            setChosen(id)
            machine.open(`task:${id}`)
          }}
          onService={() => {}}
          onOpenRound={(n) => machine.open(`round:${String(n)}`)}
          onOpenDiff={() => machine.open('diff')}
        />
      }
      views={machine.views}
      open={machine.state.open}
      shown={machine.state.shown}
      onShow={machine.show}
      onClose={machine.close}
    />
  )
}

/** The mission frame alone, under the header that carries its trail: for the mission's stories. */
export function MissionFixture({
  title,
  initial,
}: {
  title?: string | undefined
  initial?: MissionFrameState | undefined
}): ReactNode {
  const machine = useMissionMachine(initial)
  const crumbs: Crumb[] = [
    { id: 'project', label: ACME.name, onPress: () => {} },
    { id: 'mission', label: MISSION.key, mono: true, onPress: () => machine.show(null) },
    { id: 'stage', label: STAGE.label, onPress: () => machine.show(null) },
    ...machine.crumbs,
  ]
  return (
    <div className="flex h-screen flex-col bg-surface-content">
      <ContentHeader folded={false} onFold={() => {}} crumbs={crumbs} />
      <MissionBody machine={machine} title={title} />
    </div>
  )
}
