import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import type { SheetView } from '../../components/sheet/sheet.tsx'
import { IconBolt, IconLink, IconListNumbers, IconMessages, IconTestPipe } from '../../icons.ts'
import {
  type Discussion,
  type Opened,
  type PlanningProps,
  type PlanningState,
  type Wave,
  waiting,
} from './model.ts'
import {
  ChangedMark,
  ColdReadReport,
  DependencyRows,
  DiscussionThread,
  FreezeRefusal,
  PlanningFrame,
  ProbeChip,
  ProbeReport,
  QuestionCard,
  SectionMark,
  SpecRead,
  TicketDifference,
  VisionField,
  changedSet,
  railOf,
} from './parts.tsx'

/**
 * A · The Spec with its rail.
 *
 * The Spec leads: the page is the document being written, read in the middle at its measure,
 * its eight sections in a rail on the left, each with its state, and what changed since the last
 * read marked where it changed. What calls for the user stands in the right-hand rail of "Two
 * lines and a rail", beside the text it is about: the waves of questions, newest first, compact;
 * the cold read; the dependencies; the vision, at any time. What goes on — the Probes — rides on
 * the head's third line, after the Planner's Now line. Discuss and a Probe's report open as views
 * over the page, and going back finds it where it was.
 */

const COLUMNS = 'flex min-w-0 items-start gap-8 px-8 pt-2 pb-10'

const NAV = 'sticky top-2 flex w-settings-nav shrink-0 flex-col gap-3 self-start'

const NAV_LINK =
  'flex h-control-md w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const MIDDLE = 'flex min-w-0 flex-1 flex-col gap-6'

const RAIL = 'flex w-view-narrow min-w-0 shrink-0 flex-col gap-6'

const STRIP =
  'flex min-h-control-md items-center gap-2 rounded-md border border-border px-3 text-sm'

function scrollTo(name: string): void {
  document.getElementById(`spec-${name}`)?.scrollIntoView({ block: 'start' })
}

function SectionsNav({ state }: { state: PlanningState }): ReactNode {
  const changed = changedSet(state.changes)
  return (
    <nav aria-label="Spec sections" className={NAV}>
      <ul aria-label="Sections" className="flex flex-col">
        {railOf(state).map((entry) => (
          <li key={entry.name}>
            <button type="button" className={NAV_LINK} onClick={() => scrollTo(entry.name)}>
              <SectionMark state={entry.state} />
              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
              {changed.has(entry.name) && <ChangedMark />}
            </button>
          </li>
        ))}
      </ul>
      {state.tasks.length > 0 && (
        <p className="flex items-center gap-2 border-t border-border px-2 pt-3 text-sm text-muted-foreground">
          <IconListNumbers size="sm" />
          Tasks
          <span className="tabular-nums">{state.tasks.length}</span>
        </p>
      )}
    </nav>
  )
}

function WaveList({
  wave,
  props,
  onDiscuss,
}: {
  wave: Wave
  props: PlanningProps
  onDiscuss: (item: Discussion['item']) => void
}): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        Wave {wave.number}
        <span className="font-normal text-muted-foreground">{wave.askedAt}</span>
      </h3>
      <Frame>
        <ul
          aria-label={`Wave ${String(wave.number)}`}
          className="flex flex-col divide-y divide-border"
        >
          {wave.questions.map((question) => (
            <li key={question.id}>
              <QuestionCard
                question={question}
                compact
                foldAnswered
                discussed={props.state.discussions.some(
                  (discussion) =>
                    discussion.item.kind === 'question' && discussion.item.id === question.id,
                )}
                handlers={{ ...props, onDiscuss }}
              />
            </li>
          ))}
        </ul>
      </Frame>
    </div>
  )
}

function shownOf(opened: Opened | undefined, state: PlanningState): string | null {
  if (opened?.kind === 'probe') return `probe:${opened.id}`
  if (opened?.kind === 'discussion') {
    const discussion = state.discussions.find((candidate) => candidate.id === opened.id)
    return discussion === undefined
      ? null
      : `discussion:${discussion.item.kind}:${discussion.item.id}`
  }
  return null
}

export function PlanningA(props: PlanningProps): ReactNode {
  const { state, opened } = props
  const [shown, setShown] = useState<string | null>(() => shownOf(opened, state))
  const onDiscuss = (item: Discussion['item']): void => {
    props.onDiscuss(item)
    setShown(`discussion:${item.kind}:${item.id}`)
  }
  const openProbe = (id: string): void => setShown(`probe:${id}`)

  const views: SheetView[] = [
    ...state.discussions.map((discussion): SheetView => ({
      id: `discussion:${discussion.item.kind}:${discussion.item.id}`,
      title: `Discussion ${discussion.label} · on ${discussion.item.id}`,
      icon: <IconMessages size="md" />,
      width: 'narrow',
      body: (
        <div className="px-5 py-4">
          <DiscussionThread discussion={discussion} handlers={props} />
        </div>
      ),
    })),
    ...state.probes.map((probe): SheetView => ({
      id: `probe:${probe.id}`,
      title: `Probe ${probe.label}`,
      icon: <IconTestPipe size="md" />,
      width: 'narrow',
      body: <ProbeReport probe={probe} />,
    })),
  ]

  const calling = waiting(state)
  const waves = [...state.waves].reverse()
  const going =
    state.probes.length > 0 ? (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {state.probes.map((probe) => (
          <ProbeChip key={probe.id} probe={probe} onOpen={openProbe} />
        ))}
      </span>
    ) : undefined

  const under =
    state.refused !== undefined || state.outdated !== undefined ? (
      <div className="flex flex-col gap-3 px-8 pb-3">
        {state.outdated !== undefined && <TicketDifference change={state.outdated} />}
        {state.refused !== undefined && <FreezeRefusal reasons={state.refused} />}
      </div>
    ) : undefined

  const base = (
    <div className={COLUMNS}>
      <SectionsNav state={state} />
      <section aria-label="Spec" className={MIDDLE}>
        {state.changes.length > 0 && (
          <div className={STRIP}>
            <ChangedMark />
            <span className="min-w-0 flex-1 truncate">
              {state.changes.length} changes since your last read, marked in the text
            </span>
            <Button variant="link" size="sm" onClick={props.onMarkRead}>
              Mark as read
            </Button>
          </div>
        )}
        <SpecRead state={state} showChanges />
      </section>
      <aside aria-label="What calls for you" className={RAIL}>
        {!state.mission.frozen && state.waves.length > 0 && (
          <section aria-label="Questions" className="flex flex-col gap-3">
            <SectionHead title="Questions" count={calling.length} calls />
            {waves.map((one) => (
              <WaveList key={one.number} wave={one} props={props} onDiscuss={onDiscuss} />
            ))}
          </section>
        )}
        <ColdReadReport
          passes={state.passes}
          freshness={state.freshness}
          onDismiss={props.onDismissFinding}
          onRunAgain={props.onRunColdRead}
        />
        {state.dependencies.some((dependency) => dependency.state !== 'rejected') && (
          <Frame header={<FrameHeader icon={<IconLink size="md" />} title="Dependencies" />}>
            <DependencyRows dependencies={state.dependencies} onDecide={props.onDecideDependency} />
          </Frame>
        )}
        {!state.mission.frozen && (
          <Frame header={<FrameHeader icon={<IconBolt size="md" />} title="Your vision" />}>
            <div className="px-3 py-3">
              <VisionField visions={state.visions} onGive={props.onGiveVision} />
            </div>
          </Frame>
        )}
      </aside>
    </div>
  )

  return (
    <PlanningFrame
      state={state}
      handlers={props}
      going={going}
      under={under}
      base={base}
      views={views}
      shown={shown}
      onShow={setShown}
      onOpenSpec={() => scrollTo('why')}
    />
  )
}
