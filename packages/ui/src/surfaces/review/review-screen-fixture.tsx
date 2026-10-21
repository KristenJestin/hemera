import { type ReactNode, useState } from 'react'

import type { MissionMarkView } from '../../blocks/mission/vocabulary.ts'
import { stageWords } from '../../blocks/mission/vocabulary.ts'
import { Button } from '../../components/button/button.tsx'
import { IconFileText, IconGitCompare, IconMessages, IconRocket } from '../../icons.ts'
import { ContentHeader, type Crumb } from '../../shell/content-header.tsx'
import { MissionFrame, MissionFrameNeeds, type MissionView } from '../mission/mission-frame.tsx'
import {
  AT_BASE,
  type MissionFrameState,
  closeView,
  openView,
  showView,
} from '../mission/navigation.ts'
import {
  BRANCH,
  edit,
  FULL_PREVIEW,
  KEY,
  LOCAL_PREVIEW,
  LONG_PATH,
  LONG_REMARK,
  LONG_REVIEWERS,
  MOMENTS,
  type MomentName,
  TITLE,
} from './review-fixtures.ts'
import type { NewRemark } from './review-feedback.tsx'
import { ReviewPage } from './review-page.tsx'
import type { RailHandlers } from './review-rail.tsx'
import { type PointAction, RoundView } from './round-view.tsx'
import { ShipDialog } from './ship-dialog.tsx'
import type { Remark, ReviewMoment, ShipPreview, TeamComment } from './review-types.ts'

/**
 * The Review page of ACME-12 in its mission frame, under the window's header that carries the
 * trail, with the views a story can open over it: a round (`ACME-12 › Review · round 2 › Round
 * 2`), the Spec, the diff. The story's engine holds the remarks and the team's comments, so that a
 * remark added, edited, withdrawn or resolved shows where it goes, and Ship's confirmation.
 */

export type RemarkWhat = NewRemark | { id: string; text?: string | undefined }

export interface ReviewScreenProps {
  moment: MomentName
  title?: string | undefined
  loading?: boolean | undefined
  /** Long text in every field: a 2,000-character remark, a long path, a long list of reviewers. */
  long?: boolean | undefined
  forge?: 'GitHub' | 'Bitbucket' | undefined
  /** What Ship's confirmation lists: the moment's own, everything, or the Local preset's. */
  preview?: 'plain' | 'full' | 'local' | undefined
  /** The views open as the story starts. */
  initial?: MissionFrameState | undefined
  onShip: () => void
  onService: RailHandlers['onService']
  onRemark: (action: 'add' | 'edit' | 'withdraw' | 'resolve', what: RemarkWhat) => void
  onFix: () => void
  onVerify: RailHandlers['onVerify']
  onTeam: RailHandlers['onTeam']
  onPull: RailHandlers['onPull']
  onOpenDiff: (where: string) => void
  onOpenLink: (url: string) => void
  onCopy: (text: string) => void
  onPoint: (id: string, action: PointAction, note: string) => void
  onOpenBuilding: () => void
}

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

/** The moment as a story asks for it: with long text, or another forge. */
function momentOf(props: ReviewScreenProps): ReviewMoment {
  const moment = MOMENTS[props.moment]()
  const forge = props.forge ?? moment.forge
  if (props.long !== true) return { ...moment, forge }
  const long: Remark = {
    id: 'F10',
    kind: 'remark',
    text: LONG_REMARK,
    state: 'waiting',
    at: '09:58',
    anchor: LONG_PATH,
    images: [
      {
        name: 'export-button-wrapped-at-1024-pixels-wide-in-the-billing-toolbar.png',
        size: '1 MB',
      },
    ],
  }
  return {
    ...moment,
    forge,
    remarks: [...moment.remarks, long],
    pulls: edit(
      moment.pulls,
      (one) => one.repository === 'api',
      () => ({ reviewers: LONG_REVIEWERS }),
    ),
  }
}

function previewOf(moment: ReviewMoment, asked: ReviewScreenProps['preview']): ShipPreview {
  if (asked === 'full') return FULL_PREVIEW
  if (asked === 'local' || moment.forge === null) return LOCAL_PREVIEW
  return moment.preview
}

const noAnswer = async (): Promise<void> => {}

/** The Review page of ACME-12 in its frame, the needs above it, its views over it. */
export function ReviewScreen(props: ReviewScreenProps): ReactNode {
  const given = momentOf(props)
  const { loading = false, title = TITLE, initial = AT_BASE } = props
  const views = useViews(initial)
  const [remarks, setRemarks] = useState<readonly Remark[]>(given.remarks)
  const [team, setTeam] = useState<readonly TeamComment[]>(given.team)
  const [shipping, setShipping] = useState(false)
  // The engine's word on Fix, played here: a remark waits and no round is grilled or built.
  const fixable =
    remarks.some((one) => one.state === 'waiting') &&
    !given.rounds.some((one) => one.state === 'grilling' || one.state === 'building')
  const moment: ReviewMoment = { ...given, remarks, team, fixable }
  const local = moment.forge === null
  const stage = moment.stage ?? 'Review'

  const change = (id: string, to: (remark: Remark) => Remark): void =>
    setRemarks((before) => before.map((one) => (one.id === id ? to(one) : one)))
  const openDiff = (where: string): void => {
    props.onOpenDiff(where)
    views.open('diff')
  }
  const question: RailHandlers['question'] = {
    onAnswer: noAnswer,
    onWaitOnSomeone: noAnswer,
    onCopyDraft: props.onCopy,
    onAcceptProposed: noAnswer,
    onDismissProposed: noAnswer,
    onDiscuss: () => {},
  }
  const rail: RailHandlers = {
    onService: props.onService,
    onVerify: props.onVerify,
    onTeam: (id, action, take) => {
      props.onTeam(id, action, take)
      setTeam((before) =>
        before.map((one) =>
          one.id === id ? { ...one, state: action === 'round' ? 'inRound' : 'dismissed' } : one,
        ),
      )
    },
    onPull: props.onPull,
    onOpenDiff: openDiff,
    onOpenLink: props.onOpenLink,
    onCopy: props.onCopy,
    question,
  }

  const all: MissionView[] = [
    ...moment.rounds.map((round): MissionView => ({
      id: `round:${String(round.n)}`,
      title: `Round ${String(round.n)}`,
      icon: <IconMessages size="sm" />,
      width: 'wide',
      body: (
        <RoundView
          round={round}
          question={question}
          onPoint={props.onPoint}
          onOpenBuilding={props.onOpenBuilding}
        />
      ),
    })),
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
      body: <Elsewhere words="The diff with its comments, as the diff view draws it (#249)." />,
    },
  ]

  const crumbs: Crumb[] = [
    { id: 'project', label: 'Acme', onPress: () => {} },
    { id: 'mission', label: KEY, mono: true, onPress: () => views.show(null) },
    { id: 'stage', label: stageWords(stage, moment.round), onPress: () => views.show(null) },
    ...views.state.open.map((id) => ({
      id: `view:${id}`,
      label: all.find((view) => view.id === id)?.title ?? id,
      icon: all.find((view) => view.id === id)?.icon,
      onPress: () => views.show(id),
    })),
  ]

  const marks: MissionMarkView[] = []
  if (moment.needs.length > 0) marks.push({ kind: 'needsYou' })
  for (const touched of moment.changes) {
    if (touched.outside !== undefined)
      marks.push({ kind: 'outside', repository: touched.repository })
  }

  const canShip =
    !loading && stage === 'Review' && moment.refusals.length === 0 && moment.shipping === undefined
  const action = canShip ? (
    <Button variant="primary" onClick={() => setShipping(true)}>
      {local ? 'Mark as delivered' : 'Ship'}
    </Button>
  ) : undefined
  const note =
    !loading && stage === 'Review' && moment.refusals.length > 0 ? (
      <p className="max-w-view-narrow text-right text-xs break-words text-muted-foreground">
        {`${local ? 'Delivery' : 'Ship'} waits: ${moment.refusals.join(' · ')}`}
      </p>
    ) : undefined

  return (
    <div className="flex h-screen flex-col bg-surface-content">
      <ContentHeader folded={false} onFold={() => {}} crumbs={crumbs} />
      <MissionFrame
        ballFace={false}
        missionKey={KEY}
        title={title}
        stage={stage}
        round={moment.round}
        frozen
        type="feature"
        ball={moment.ball.ball}
        now={moment.ball.words}
        marks={marks}
        ticket={{ key: 'acme/shop#41' }}
        branch={BRANCH}
        spec="frozen 3 days ago at 17:02"
        onOpenSpec={() => views.open('spec')}
        action={action}
        actionNote={note}
        more={[
          { label: 'Diff', icon: <IconGitCompare size="sm" />, onSelect: () => openDiff('') },
          ...moment.rounds.map((round) => ({
            label: `Round ${String(round.n)}`,
            icon: <IconRocket size="sm" />,
            onSelect: () => views.open(`round:${String(round.n)}`),
          })),
        ]}
        onCancel={() => {}}
        needs={
          <MissionFrameNeeds
            rows={moment.needs}
            projects={['Acme']}
            on={() => ({
              onChoose: () => {},
              onWrite: () => {},
              onApply: () => {},
              onRetry: () => {},
              onSettings: () => {},
            })}
          />
        }
        base={
          <ReviewPage
            moment={moment}
            loading={loading}
            rail={rail}
            feedback={{
              onAdd: (added) => {
                props.onRemark('add', added)
                setRemarks((before) => [
                  ...before,
                  {
                    id: `F${String(Math.max(0, ...before.map((one) => Number(one.id.slice(1)))) + 1)}`,
                    kind: added.kind,
                    text: added.text,
                    state: 'waiting',
                    at: 'now',
                    images: added.images.map((name) => ({ name, size: '' })),
                    follows: added.follows,
                  },
                ])
              },
              onEdit: (id, text) => {
                props.onRemark('edit', { id, text })
                change(id, (one) => ({ ...one, text }))
              },
              onWithdraw: (id) => {
                props.onRemark('withdraw', { id })
                change(id, (one) => ({ ...one, state: 'withdrawn' }))
              },
              onResolve: (id) => {
                props.onRemark('resolve', { id })
                change(id, (one) => ({ ...one, state: 'resolved' }))
              },
              onFix: props.onFix,
              onOpenDiff: openDiff,
              onOpenRound: (n) => views.open(`round:${String(n)}`),
            }}
          />
        }
        views={all}
        open={views.state.open}
        shown={views.state.shown}
        onShow={views.show}
        onClose={views.close}
      />
      <ShipDialog
        missionKey={KEY}
        preview={previewOf(moment, props.preview)}
        open={shipping}
        onOpenChange={setShipping}
        onConfirm={props.onShip}
      />
    </div>
  )
}
