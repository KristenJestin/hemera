import { type ReactNode, useEffect, useRef, useState } from 'react'

import { stageWords } from '../../blocks/mission/vocabulary.ts'
import { Button } from '../../components/button/button.tsx'
import { IconGitCompare, IconHistory, IconMessages } from '../../icons.ts'
import { ContentHeader, type Crumb } from '../../shell/content-header.tsx'
import { MissionFrame, type MissionView } from '../../surfaces/mission/mission-frame.tsx'
import {
  AT_BASE,
  type MissionFrameState,
  closeView,
  openView,
  showView,
} from '../../surfaces/mission/navigation.ts'
import { BRANCH, KEY, MOMENTS, ROUND_TWO_BUILDING, TITLE } from '../review/fixtures.ts'
import type { RailHandlers } from '../review/rail.tsx'
import { ReviewPage } from '../review/review.tsx'
import { RoundView } from '../review/round-view.tsx'
import type { Remark } from '../review/types.ts'
import type { CommentAction, NewComment } from './comments.tsx'
import { CommentedVersion, DiffActions, DiffView } from './diff-view.tsx'
import { F13_VERSION, LIVE_STEPS } from './fixtures.ts'
import type { DiffLayout, StageTarget } from './stage.tsx'
import { idOf } from './tree.tsx'
import type { DiffComment, DiffMoment } from './types.ts'

/**
 * ACME-12 in its mission frame with the diff view opened over its base, under the window's header
 * that carries the trail: `ACME-12 › Review · round 1 › Diff`. The base is the Review page of
 * #254, the round view over it when the diff was opened from a round, and the stage is Building
 * while a round writes.
 *
 * Open question 33, as recommended: one list. A comment written in the diff is a remark of the
 * Review page with a place; the Review page's remark opens the diff at its lines, lit; Back (the
 * ×, Escape, or the trail) finds the Review page as it was. The story's engine holds the comments,
 * so that one added, withdrawn or resolved shows on both.
 */

export interface DiffScreenProps {
  moment: DiffMoment
  /** Where the diff was opened from: the Review page, a round's view, or Building · round 2. */
  from?: 'review' | 'round' | 'building' | undefined
  /** Whether the diff is open as the story starts, or waits to be opened from the base. */
  opened?: boolean | undefined
  /** The comment the diff was opened at, from its remark on the Review page. */
  at?: string | undefined
  layout?: DiffLayout | undefined
  loading?: boolean | undefined
  /** Round 2 writes while the user reads: the steps of `LIVE_STEPS`, one after the other. */
  live?: boolean | undefined
  /** Open question 33's alternative: the comments listed again in a column of the view. */
  column?: boolean | undefined
  onComment: (comment: NewComment) => void
  onAction: (id: string, action: CommentAction) => void
  onOpenForge: (url: string) => void
  onOpenVersion: (id: string) => void
}

/** A remark of the Review page made of a comment written in the diff: the same thing, listed. */
function remarkOf(comment: DiffComment): Remark {
  const lines = comment.place.lines
  const where = lines === null ? '' : `:${String(lines.start)}`
  return {
    id: comment.id,
    kind: comment.kind,
    text: comment.text,
    state: comment.state,
    at: comment.at,
    anchor: `${idOf(comment.place.repository, comment.place.path)}${where}`,
  }
}

const noAnswer = async (): Promise<void> => {}

const QUESTION: RailHandlers['question'] = {
  onAnswer: noAnswer,
  onWaitOnSomeone: noAnswer,
  onCopyDraft: () => {},
  onAcceptProposed: noAnswer,
  onDismissProposed: noAnswer,
  onDiscuss: () => {},
}

const LIVE_EVERY = 1_600

export function DiffScreen(props: DiffScreenProps): ReactNode {
  const { moment, from = 'review', opened = true, loading = false } = props
  const [comments, setComments] = useState<readonly DiffComment[]>(moment.comments)
  const [layout, setLayout] = useState<DiffLayout>(props.layout ?? 'stacked')
  const [step, setStep] = useState(props.live === true ? 0 : -1)
  const nonce = useRef(0)
  const [target, setTarget] = useState<StageTarget | null>(() =>
    props.at === undefined ? null : { kind: 'comment', id: props.at, nonce: 0 },
  )
  const [lit, setLit] = useState<string | null>(props.at ?? null)
  const initial: MissionFrameState = !opened
    ? AT_BASE
    : from === 'round'
      ? { open: ['round:2', 'diff'], shown: 'diff' }
      : { open: ['diff'], shown: 'diff' }
  const [views, setViews] = useState(initial)

  // The round writing: one step more at each beat, until the last.
  useEffect(() => {
    if (step < 0 || step >= LIVE_STEPS.length - 1) return
    const timer = setTimeout(() => setStep((before) => before + 1), LIVE_EVERY)
    return () => clearTimeout(timer)
  }, [step])

  const repositories = step >= 0 ? (LIVE_STEPS[step] ?? moment.repositories) : moment.repositories
  const source = props.live === true ? { kind: 'live' as const, round: 2 } : moment.source
  const stage = from === 'review' && props.live !== true ? 'Review' : 'Building'
  const round = stage === 'Building' ? 2 : 1

  const go = (id: string): void => {
    nonce.current += 1
    setLit(id)
    setTarget({ kind: 'comment', id, nonce: nonce.current })
  }

  /** The Review page's remark opened its place: the diff, at that comment's lines. */
  const openAt = (where: string): void => {
    const path = where.replace(/:\d+(–\d+)?$/, '')
    const comment = comments.find((one) => idOf(one.place.repository, one.place.path) === path)
    setViews((before) => openView(before, 'diff'))
    if (comment !== undefined) go(comment.id)
  }

  const act = (id: string, action: CommentAction): void => {
    props.onAction(id, action)
    if (action !== 'withdraw' && action !== 'resolve') return
    setComments((before) =>
      before.map((one) =>
        one.id === id ? { ...one, state: action === 'withdraw' ? 'withdrawn' : 'resolved' } : one,
      ),
    )
  }

  const add = (added: NewComment): void => {
    props.onComment(added)
    setComments((before) => {
      const next = Math.max(0, ...before.map((one) => Number(one.id.slice(1)) || 0)) + 1
      return [
        ...before,
        {
          id: `F${String(next)}`,
          kind: added.kind,
          text: added.text,
          state: 'waiting',
          place: added.place,
          at: 'now',
        },
      ]
    })
  }

  const outdated = comments.find((one) => one.outdated !== undefined)
  const base = MOMENTS.feedback()
  const mine = comments.filter(
    (one) => one.team === undefined && !base.remarks.some((had) => had.id === one.id),
  )
  const remarks: readonly Remark[] = [
    ...base.remarks,
    ...mine.filter((one) => one.state === 'waiting').map(remarkOf),
  ]

  const all: MissionView[] = [
    {
      id: 'round:2',
      title: 'Round 2',
      icon: <IconMessages size="sm" />,
      width: 'wide',
      body: (
        <RoundView
          round={ROUND_TWO_BUILDING}
          question={QUESTION}
          onPoint={() => {}}
          onOpenBuilding={() => {}}
        />
      ),
    },
    {
      id: 'diff',
      title: 'Diff',
      icon: <IconGitCompare size="sm" />,
      width: 'wide',
      // Nothing to lay out yet, nothing to toggle.
      actions: repositories.some((one) => one.files.length > 0) ? (
        <DiffActions source={source} layout={layout} onLayout={setLayout} />
      ) : undefined,
      body: (
        <DiffView
          repositories={repositories}
          comments={comments}
          source={source}
          layout={layout}
          loading={loading}
          target={target}
          lit={lit}
          column={props.column}
          onAdd={add}
          onAction={act}
          onOpenForge={props.onOpenForge}
          onOpenVersion={(id) => {
            props.onOpenVersion(id)
            setViews((before) => openView(before, 'version'))
          }}
          onFile={(id) => {
            nonce.current += 1
            setTarget({ kind: 'file', id, nonce: nonce.current })
          }}
          onGo={go}
        />
      ),
    },
    {
      id: 'version',
      title: 'time-zone.ts · round 1',
      icon: <IconHistory size="sm" />,
      width: 'wide',
      body:
        outdated === undefined ? null : (
          <CommentedVersion
            comment={outdated}
            contents={F13_VERSION.contents}
            onOpenForge={props.onOpenForge}
          />
        ),
    },
  ]

  const crumbs: Crumb[] = [
    { id: 'project', label: 'Acme', onPress: () => {} },
    { id: 'mission', label: KEY, mono: true, onPress: () => setViews(AT_BASE) },
    { id: 'stage', label: stageWords(stage, round), onPress: () => setViews(AT_BASE) },
    ...views.open.map((id) => ({
      id: `view:${id}`,
      label: all.find((view) => view.id === id)?.title ?? id,
      icon: all.find((view) => view.id === id)?.icon,
      onPress: () => setViews((before) => showView(before, id)),
    })),
  ]

  const rail: RailHandlers = {
    onService: () => {},
    onVerify: () => {},
    onTeam: () => {},
    onPull: () => {},
    onOpenDiff: openAt,
    onOpenLink: () => {},
    onCopy: () => {},
    question: QUESTION,
  }

  return (
    <div className="flex h-screen flex-col bg-surface-content">
      <ContentHeader folded={false} onFold={() => {}} crumbs={crumbs} />
      <MissionFrame
        ballFace={false}
        missionKey={KEY}
        title={TITLE}
        stage={stage}
        round={round}
        frozen
        type="feature"
        ball={stage === 'Building' ? 'agent' : 'you'}
        marks={[]}
        ticket={{ key: 'acme/shop#41' }}
        branch={BRANCH}
        spec="frozen 3 days ago at 17:02"
        onOpenSpec={() => {}}
        more={[
          {
            label: 'Diff',
            icon: <IconGitCompare size="sm" />,
            onSelect: () => setViews((before) => openView(before, 'diff')),
          },
        ]}
        onCancel={() => {}}
        base={
          <ReviewPage
            moment={{ ...base, remarks }}
            loading={false}
            model="rounds"
            rail={rail}
            feedback={{
              onAdd: () => {},
              onEdit: () => {},
              onWithdraw: (id) => act(id, 'withdraw'),
              onResolve: (id) => act(id, 'resolve'),
              onFix: () => {},
              onOpenDiff: openAt,
              onOpenRound: (n) => setViews((before) => openView(before, `round:${String(n)}`)),
            }}
          />
        }
        views={all}
        open={views.open}
        shown={views.shown}
        onShow={(id) => setViews((before) => showView(before, id))}
        onClose={(id) => setViews((before) => closeView(before, id))}
      />
      {props.live === true && step === LIVE_STEPS.length - 1 && (
        <div className="fixed bottom-4 left-4">
          <Button variant="secondary" size="sm" onClick={() => setStep(0)}>
            Play the round again
          </Button>
        </div>
      )}
    </div>
  )
}
