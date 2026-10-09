import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import type { SheetView } from '../../components/sheet/sheet.tsx'
import { IconBolt, IconFileText, IconLink, IconListNumbers, IconTestPipe } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import {
  type Discussion,
  type Opened,
  type PlanningProps,
  type PlanningState,
  type Wave,
  discussionOn,
  openFindings,
  waiting,
} from './model.ts'
import {
  ChangesList,
  ColdReadReport,
  DependencyRows,
  DiscussionThread,
  FreezeRefusal,
  InputDot,
  PlanningFrame,
  ProbeChip,
  ProbeReport,
  QuestionCard,
  SectionMark,
  SpecRead,
  TicketDifference,
  VisionField,
  railOf,
} from './parts.tsx'

/**
 * B · What to settle first.
 *
 * What calls for the user leads: the main column is the list of what is to settle — the
 * refusal or the ticket's difference first, what changed since the last read, the waves of
 * questions at full width with their options' details, a discussion unfolding in place under its
 * question, the cold read's findings, the dependencies to decide. A wave whose questions are all
 * settled folds to one line. When nothing calls — the first draft being written, a frozen Spec —
 * the Spec itself takes the column. The right-hand rail of "Two lines and a rail" holds the Spec
 * as an outline (its eight sections and their state, each opening the Spec as a view at that
 * section), what goes on (the Probes), and the vision.
 */

const COLUMNS = 'grid w-full grid-cols-1 items-start gap-8 px-8 pt-2 pb-10 lg:grid-cols-3'

const MAIN = 'flex min-w-0 flex-col gap-6 lg:col-span-2'

const RAIL = 'flex min-w-0 flex-col gap-6'

const OUTLINE_LINK =
  'flex h-control-md w-full min-w-0 items-center gap-2 px-3 text-left text-sm outline-none hover:tinted focus-ring hover-motion'

const FOLD =
  'flex h-control-sm w-fit items-center gap-2 rounded-md text-sm font-semibold outline-none hover:tinted focus-ring hover-motion'

function settled(wave: Wave): boolean {
  return wave.questions.every(
    (question) => question.state !== 'open' && question.state !== 'waiting',
  )
}

function WaveBlock({
  wave,
  props,
  threads,
  onDiscuss,
}: {
  wave: Wave
  props: PlanningProps
  threads: ReadonlySet<string>
  onDiscuss: (item: Discussion['item']) => void
}): ReactNode {
  const folding = useTransition(fold)
  const [open, setOpen] = useState(!settled(wave))
  const count = wave.questions.length
  return (
    <div className="flex flex-col gap-2">
      <button type="button" className={FOLD} aria-expanded={open} onClick={() => setOpen(!open)}>
        Wave {wave.number}
        <span className="font-normal text-muted-foreground">
          {wave.askedAt} · {count} {count === 1 ? 'question' : 'questions'}
          {settled(wave) ? ', settled' : ''}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="wave"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <ul aria-label={`Wave ${String(wave.number)}`} className="flex flex-col gap-3">
              {wave.questions.map((question) => {
                const discussion = discussionOn(props.state, question.id)
                const shown = discussion !== undefined && threads.has(question.id)
                return (
                  <li key={question.id}>
                    <Frame animated>
                      <QuestionCard
                        question={question}
                        discussed={discussion !== undefined}
                        handlers={{ ...props, onDiscuss }}
                        thread={
                          shown ? (
                            <div className="border-t border-border pt-3">
                              <DiscussionThread discussion={discussion} handlers={props} />
                            </div>
                          ) : undefined
                        }
                      />
                    </Frame>
                  </li>
                )
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SpecOutline({ state, onOpen }: { state: PlanningState; onOpen: () => void }): ReactNode {
  return (
    <Frame
      header={
        <FrameHeader
          icon={<IconFileText size="md" />}
          title="Spec"
          action={
            <Button variant="link" size="sm" onClick={onOpen}>
              Read
            </Button>
          }
        />
      }
    >
      <ul aria-label="Sections" className="flex flex-col py-1">
        {railOf(state).map((entry) => (
          <li key={entry.name}>
            <button type="button" className={OUTLINE_LINK} onClick={onOpen}>
              <SectionMark state={entry.state} />
              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {state.tasks.length > 0 && (
        <p className="flex items-center gap-2 border-t border-border px-3 py-2 text-sm text-muted-foreground">
          <IconListNumbers size="sm" />
          Tasks
          <span className="tabular-nums">{state.tasks.length}</span>
        </p>
      )}
    </Frame>
  )
}

/** The view a story opens over the page; a discussion opens in place, not over it. */
function viewOf(opened: Opened | undefined): string | null {
  if (opened === undefined || opened.kind === 'discussion') return null
  if (opened.kind === 'probe') return `probe:${opened.id}`
  return opened.kind
}

export function PlanningB(props: PlanningProps): ReactNode {
  const { state, opened } = props
  const [shown, setShown] = useState<string | null>(() => viewOf(opened))
  const [threads, setThreads] = useState<ReadonlySet<string>>(() => {
    if (opened?.kind !== 'discussion') return new Set()
    const discussion = state.discussions.find((candidate) => candidate.id === opened.id)
    return new Set(discussion === undefined ? [] : [discussion.item.id])
  })
  const onDiscuss = (item: Discussion['item']): void => {
    props.onDiscuss(item)
    setThreads((before) => {
      const next = new Set(before)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }

  const views: SheetView[] = [
    {
      id: 'spec',
      title: `Spec of ${state.mission.key}`,
      icon: <IconFileText size="md" />,
      width: 'wide',
      body: (
        <div className="px-6 py-5">
          <SpecRead state={state} showChanges />
        </div>
      ),
    },
    {
      id: 'vision',
      title: 'Your vision',
      icon: <IconBolt size="md" />,
      width: 'narrow',
      body: (
        <div className="px-5 py-4">
          <VisionField visions={state.visions} onGive={props.onGiveVision} />
        </div>
      ),
    },
    ...state.probes.map((probe): SheetView => ({
      id: `probe:${probe.id}`,
      title: `Probe ${probe.label}`,
      icon: <IconTestPipe size="md" />,
      width: 'narrow',
      body: <ProbeReport probe={probe} />,
    })),
  ]

  const calling = waiting(state)
  const toSettle =
    calling.length +
    openFindings(state).length +
    state.dependencies.filter((dependency) => dependency.state === 'proposed').length
  // When nothing calls and nothing has been asked, the Spec takes the column: the draft, or frozen.
  const specLeads = state.mission.frozen || state.waves.length === 0
  const lastVision = state.visions.at(-1)

  const main = (
    <div className={MAIN}>
      {state.outdated !== undefined && <TicketDifference change={state.outdated} />}
      {state.refused !== undefined && <FreezeRefusal reasons={state.refused} />}
      {specLeads ? (
        <section aria-label="Spec" className="flex flex-col gap-6">
          {state.waves.length === 0 && !state.mission.frozen && (
            <Empty
              face="writing"
              title="Hemera writes the first draft"
              description="Its questions will come here, in waves, as soon as it has read enough."
            />
          )}
          <SpecRead state={state} showChanges={false} />
        </section>
      ) : (
        <>
          <SectionHead title="To settle" count={toSettle} calls />
          {state.readiness.ready && (
            <Frame>
              <p className="px-4 py-3 text-sm text-muted-foreground">
                Everything is settled: Freeze is in the head.
              </p>
            </Frame>
          )}
          {state.changes.length > 0 && (
            <ChangesList changes={state.changes} onMarkRead={props.onMarkRead} />
          )}
          <section aria-label="Questions" className="flex flex-col gap-4">
            {[...state.waves].reverse().map((one) => (
              <WaveBlock
                key={one.number}
                wave={one}
                props={props}
                threads={threads}
                onDiscuss={onDiscuss}
              />
            ))}
          </section>
        </>
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
    </div>
  )

  const base = (
    <div className={COLUMNS}>
      {main}
      <aside aria-label={`About ${state.mission.key}`} className={RAIL}>
        <SpecOutline state={state} onOpen={() => setShown('spec')} />
        {state.probes.length > 0 && (
          <Frame header={<FrameHeader icon={<IconTestPipe size="md" />} title="Probes" />}>
            <div className="flex flex-wrap gap-1.5 px-3 py-3">
              {state.probes.map((probe) => (
                <ProbeChip key={probe.id} probe={probe} onOpen={(id) => setShown(`probe:${id}`)} />
              ))}
            </div>
          </Frame>
        )}
        {!state.mission.frozen && (
          <Frame
            header={
              <FrameHeader
                icon={<IconBolt size="md" />}
                title="Your vision"
                action={
                  <Button variant="link" size="sm" onClick={() => setShown('vision')}>
                    Give it
                  </Button>
                }
              />
            }
          >
            {lastVision === undefined ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                Optional, at any time: what you see for it.
              </p>
            ) : (
              <p className="flex items-start gap-2 px-3 py-3 text-sm">
                <span className="flex pt-0.5">
                  <InputDot state={lastVision.inputState} />
                </span>
                <span className="line-clamp-3">{lastVision.text}</span>
              </p>
            )}
          </Frame>
        )}
      </aside>
    </div>
  )

  return (
    <PlanningFrame
      state={state}
      handlers={props}
      base={base}
      views={views}
      shown={shown}
      onShow={setShown}
      onOpenSpec={() => setShown('spec')}
    />
  )
}
