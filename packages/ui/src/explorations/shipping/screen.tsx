import { type ReactNode, useState } from 'react'

import type { MissionMarkView } from '../../blocks/mission/vocabulary.ts'
import { AlertDialog } from '../../components/alert-dialog/alert-dialog.tsx'
import { Button } from '../../components/button/button.tsx'
import { Dialog } from '../../components/dialog/dialog.tsx'
import { Tabs } from '../../components/tabs/tabs.tsx'
import {
  IconBook2,
  IconBug,
  IconFileText,
  IconHistory,
  IconMessages,
  IconPackage,
  IconPlayerPlay,
  IconPlayerStop,
} from '../../icons.ts'
import { ContentHeader, type Crumb } from '../../shell/content-header.tsx'
import {
  MissionFrame,
  MissionFrameNeeds,
  type MissionView,
} from '../../surfaces/mission/mission-frame.tsx'
import {
  AT_BASE,
  type MissionFrameState,
  closeView,
  openView,
  showView,
} from '../../surfaces/mission/navigation.ts'
import {
  BRANCH,
  CANCELLED_MOMENTS,
  type CancelledMomentName,
  DONE_MOMENTS,
  type DoneMomentName,
  KEY,
  MOMENTS,
  type ShippingMomentName,
  TITLE,
  lengthen,
  removedUnlessKept,
} from './fixtures.ts'
import { type DeliveryHandlers, DeliveryView, Waves } from './delivery.tsx'
import { CancelledPage, CleanupList, DonePage, History, type OverHandlers } from './over.tsx'
import { FixCard, ForYou, type RailHandlers, ShippingCard } from './rail.tsx'
import type { CancelledMoment, ForgeAction, ShippingMoment } from './types.ts'

/**
 * ACME-12 in Shipping, Done or Cancelled, in its mission frame under the window's header that
 * carries the trail, with the views a story can open over it: a repository's delivery
 * (`ACME-12 › Shipping › api`), the fix's round, the Spec, the Memory. The story's engine holds
 * what a press changes: a stopped delivery, a dismissed comment, a cleanup confirmed.
 */

export interface ShippingScreenProps {
  stage: 'Shipping' | 'Done' | 'Cancelled'
  moment?: ShippingMomentName | undefined
  done?: DoneMomentName | undefined
  cancelled?: CancelledMomentName | undefined
  title?: string | undefined
  loading?: boolean | undefined
  /** Long text in every field: a long repository name, a long forge error, a long step task. */
  long?: boolean | undefined
  /** Open question 49: someone else's ball while a forge holds the delivery (recommended), or the agent's. */
  ball?: 'someone' | 'agent' | undefined
  /** Open question 77: Hemera's face in the stage card only (recommended), or as the header's ball. */
  face?: 'card' | 'ball' | undefined
  /** Open question 76: a repository's delivery as a view over the page (recommended), or a tab. */
  navigation?: 'stack' | 'tabs' | undefined
  /** Open question 84: Done's history on its page (recommended), or in a view of its own. */
  history?: 'page' | 'view' | undefined
  initial?: MissionFrameState | undefined
  onStopDelivery: () => void
  onResumeDelivery: () => void
  onRetry: DeliveryHandlers['onRetry']
  onForge: DeliveryHandlers['onForge']
  onOpenLink: (url: string) => void
  onStartMission: RailHandlers['onStartMission']
  onDismissComment: RailHandlers['onDismissComment']
  onAcceptFix: RailHandlers['onAcceptFix']
  onRefuseFix: RailHandlers['onRefuseFix']
  onKeep: OverHandlers['onKeep']
  onStopLeftover: OverHandlers['onStop']
  onCleanUp: () => void
  onNeed: (id: string, answer: string) => void
}

/** A body for a view whose content is another ticket's: the Spec, the Memory, a round. */
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

function shippingOf(props: ShippingScreenProps): ShippingMoment {
  const moment = MOMENTS[props.moment ?? 'started']()
  const given = props.long === true ? lengthen(moment) : moment
  if (props.ball !== 'agent' || given.ball !== 'someone') return given
  return {
    ...given,
    ball: 'agent',
    ballWords: given.ballWords?.replace(/^Waiting on/, 'Hemera watches'),
  }
}

/** The cleanup of a cancelled mission, confirmed once: what goes, and what the guard keeps. */
function CleanupDialog({
  moment,
  open,
  onOpenChange,
  onConfirm,
}: {
  moment: CancelledMoment
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}): ReactNode {
  const goes = moment.cleanup.filter((one) => one.state !== 'kept')
  const kept = moment.cleanup.filter((one) => one.state === 'kept')
  return (
    <Dialog
      title={`Clean up ${KEY}?`}
      description="The delivered stays delivered. The guard keeps whatever would be lost."
      size="wide"
      open={open}
      onOpenChange={onOpenChange}
      actions={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            Clean up
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section aria-label="Removed" className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium">Removed</h3>
          <CleanupList items={goes} />
        </section>
        {kept.length > 0 && (
          <section aria-label="Kept by the guard" className="flex flex-col gap-1.5">
            <h3 className="text-sm font-medium">Kept by the guard</h3>
            <CleanupList items={kept} />
          </section>
        )}
      </div>
    </Dialog>
  )
}

export function ShippingScreen(props: ShippingScreenProps): ReactNode {
  const { stage, loading = false, title = TITLE, initial = AT_BASE } = props
  const views = useViews(initial)
  const shipping = shippingOf(props)
  const done = DONE_MOMENTS[props.done ?? 'done']()
  const cancelledGiven = CANCELLED_MOMENTS[props.cancelled ?? 'cancelled']()
  const [stopped, setStopped] = useState(shipping.stopped === true)
  const [team, setTeam] = useState(shipping.team)
  const [cleaned, setCleaned] = useState(cancelledGiven.cleaned)
  const [cleaning, setCleaning] = useState(false)
  const [tab, setTab] = useState('waves')
  const cancelled: CancelledMoment = {
    ...cancelledGiven,
    cleaned,
    cleanup:
      cleaned && !cancelledGiven.cleaned
        ? cancelledGiven.cleanup.map(removedUnlessKept)
        : cancelledGiven.cleanup,
  }

  const delivery: DeliveryHandlers = {
    onRetry: props.onRetry,
    onForge: (repository: string, step: string, action: ForgeAction['id']) =>
      props.onForge(repository, step, action),
    onOpenLink: props.onOpenLink,
    onOpenDelivery: (repository) => {
      if (props.navigation === 'tabs') setTab(repository)
      else views.open(`delivery:${repository}`)
    },
  }
  const rail: RailHandlers = {
    onAcceptFix: props.onAcceptFix,
    onRefuseFix: props.onRefuseFix,
    onOpenFixRound: () => views.open('round:3'),
    onStartMission: props.onStartMission,
    onDismissComment: (id) => {
      props.onDismissComment(id)
      setTeam((before) => before.filter((one) => one.id !== id))
    },
  }
  const over: OverHandlers = {
    onOpenLink: props.onOpenLink,
    onKeep: props.onKeep,
    onStop: props.onStopLeftover,
    onOpenRound: (n) => views.open(`round:${String(n)}`),
    onOpenMemory: () => views.open('memory'),
  }

  const repositories = shipping.waves.flatMap((wave) =>
    wave.repositories.map((one) => ({ wave: wave.n, delivery: one })),
  )
  const all: MissionView[] = [
    ...(stage === 'Shipping' ? repositories : []).map(({ wave, delivery: one }): MissionView => ({
      id: `delivery:${one.repository}`,
      title: one.repository,
      icon: <IconPackage size="sm" />,
      width: 'narrow',
      body: <DeliveryView delivery={one} wave={wave} handlers={delivery} />,
    })),
    ...[1, 2, 3].map((n): MissionView => ({
      id: `round:${String(n)}`,
      title: `Round ${String(n)}`,
      icon: n === 3 ? <IconBug size="sm" /> : <IconMessages size="sm" />,
      width: 'wide',
      body: <Elsewhere words="The round, as the round view of the Review page draws it (#254)." />,
    })),
    {
      id: 'spec',
      title: 'Spec',
      icon: <IconFileText size="sm" />,
      width: 'wide',
      body: <Elsewhere words="The frozen Spec, as the Spec page draws it." />,
    },
    {
      id: 'memory',
      title: 'Memory',
      icon: <IconBook2 size="sm" />,
      width: 'wide',
      body: (
        <Elsewhere words="The Memory: Now, the Journal and the Notes, as its view draws them." />
      ),
    },
    {
      id: 'history',
      title: 'History',
      icon: <IconHistory size="sm" />,
      width: 'wide',
      body: (
        <div className="px-6 py-5">
          <History record={done.record} handlers={over} />
        </div>
      ),
    },
  ]

  const crumbs: Crumb[] = [
    { id: 'project', label: 'Acme', onPress: () => {} },
    { id: 'mission', label: KEY, mono: true, onPress: () => views.show(null) },
    { id: 'stage', label: stage, onPress: () => views.show(null) },
    ...views.state.open.map((id) => ({
      id: `view:${id}`,
      label: all.find((view) => view.id === id)?.title ?? id,
      icon: all.find((view) => view.id === id)?.icon,
      onPress: () => views.show(id),
    })),
  ]

  const marks: MissionMarkView[] = stage === 'Shipping' && !loading ? [...shipping.marks] : []

  let action: ReactNode
  if (stage === 'Shipping' && !loading) {
    action = stopped ? (
      <Button
        variant="primary"
        onClick={() => {
          props.onResumeDelivery()
          setStopped(false)
        }}
      >
        <IconPlayerPlay size="sm" />
        Resume delivery
      </Button>
    ) : (
      <AlertDialog
        title={`Stop the delivery of ${KEY}?`}
        description="The running steps stop, their pipelines with them. What is delivered stays delivered; Resume goes on from where it stopped."
        confirmLabel="Stop delivery"
        cancelLabel="Keep delivering"
        trigger={
          <Button variant="secondary">
            <IconPlayerStop size="sm" />
            Stop delivery
          </Button>
        }
        onConfirm={() => {
          props.onStopDelivery()
          setStopped(true)
        }}
      />
    )
  } else if (stage === 'Cancelled' && !cleaned) {
    action = (
      <Button variant="primary" onClick={() => setCleaning(true)}>
        Clean up
      </Button>
    )
  }

  const ball = stage === 'Shipping' ? (loading ? 'agent' : shipping.ball) : 'idle'
  const now =
    stage === 'Shipping' && !loading
      ? (shipping.ballWords ?? (stopped ? 'Stopped by you' : undefined))
      : undefined

  const waves = <Waves waves={shipping.waves} handlers={delivery} />
  const page =
    props.navigation === 'tabs' ? (
      <Tabs
        label="Delivery"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'waves', label: 'Waves', panel: <div className="pt-4">{waves}</div> },
          ...repositories.map(({ wave, delivery: one }) => ({
            value: one.repository,
            label: one.repository,
            panel: <DeliveryView delivery={one} wave={wave} handlers={delivery} />,
          })),
        ]}
      />
    ) : (
      waves
    )

  let base: ReactNode
  if (stage === 'Done') {
    base = (
      <DonePage moment={done} loading={loading} history={props.history ?? 'page'} handlers={over} />
    )
  } else if (stage === 'Cancelled') {
    base = <CancelledPage moment={cancelled} handlers={over} />
  } else {
    base = (
      <div
        className="flex min-w-0 flex-col gap-8 px-8 pt-2 pb-10 lg:flex-row-reverse lg:items-start"
        data-stage="shipping"
      >
        <aside
          aria-label="What happens"
          className="flex w-full min-w-0 shrink-0 flex-col gap-6 lg:w-view-narrow"
        >
          <ShippingCard moment={shipping} loading={loading} />
          {!loading && shipping.fix !== undefined && <FixCard fix={shipping.fix} handlers={rail} />}
          {!loading && <ForYou team={team} handlers={rail} />}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col gap-6">{!loading && page}</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-surface-content">
      <ContentHeader folded={false} onFold={() => {}} crumbs={crumbs} />
      <MissionFrame
        ballFace={props.face === 'ball'}
        missionKey={KEY}
        title={title}
        stage={stage}
        round={stage === 'Cancelled' ? 0 : 2}
        frozen
        type="feature"
        ball={ball}
        now={now}
        marks={marks}
        ticket={{ key: 'acme/shop#41' }}
        branch={stage === 'Shipping' ? BRANCH : undefined}
        spec="frozen 4 days ago at 17:02"
        onOpenSpec={() => views.open('spec')}
        action={action}
        more={[
          { label: 'Memory', icon: <IconBook2 size="sm" />, onSelect: () => views.open('memory') },
          ...(stage === 'Done' && props.history === 'view'
            ? [
                {
                  label: 'History',
                  icon: <IconHistory size="sm" />,
                  onSelect: () => views.open('history'),
                },
              ]
            : []),
        ]}
        onCancel={stage === 'Shipping' ? () => {} : undefined}
        needs={
          stage === 'Shipping' && !loading ? (
            <MissionFrameNeeds
              rows={shipping.needs}
              projects={['Acme']}
              on={(id) => ({
                onChoose: (option) => props.onNeed(id, option),
                onWrite: (answer) => props.onNeed(id, answer),
                onApply: () => props.onNeed(id, 'apply'),
                onRetry: () => props.onNeed(id, 'retry'),
                onSettings: () => props.onNeed(id, 'settings'),
              })}
            />
          ) : undefined
        }
        base={base}
        views={all}
        open={views.state.open}
        shown={views.state.shown}
        onShow={views.show}
        onClose={views.close}
      />
      {stage === 'Cancelled' && (
        <CleanupDialog
          moment={cancelled}
          open={cleaning}
          onOpenChange={setCleaning}
          onConfirm={() => {
            props.onCleanUp()
            setCleaned(true)
          }}
        />
      )}
    </div>
  )
}
