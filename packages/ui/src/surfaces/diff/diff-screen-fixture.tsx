import { type ReactNode, useEffect, useRef, useState } from 'react'

import { stageWords } from '../../blocks/mission/vocabulary.ts'
import { Button } from '../../components/button/button.tsx'
import { IconGitCompare, IconHistory } from '../../icons.ts'
import { ContentHeader, type Crumb } from '../../shell/content-header.tsx'
import { MissionFrame, MissionFrameBase, type MissionView } from '../mission/mission-frame.tsx'
import {
  AT_BASE,
  type MissionFrameState,
  closeView,
  openView,
  showView,
} from '../mission/navigation.ts'
import type { CommentAction, NewComment } from './diff-comments.tsx'
import { F13_VERSION, LARGE_SIDES, LIVE_STEPS } from './diff-fixtures.ts'
import type { DiffLayout, StageTarget } from './diff-stage.tsx'
import type { DiffComment, DiffMoment, DiffRepository } from './diff-types.ts'
import { CommentedVersion, DiffActions, DiffView } from './diff-view.tsx'

/**
 * ACME-12 in its mission frame with the diff view opened over its base, under the window's header
 * that carries the trail: `ACME-12 › Review · round 1 › Diff`. The base is the stage's page —
 * Review, or Building while round 2 writes — drawn here as its place only. The fixture holds the
 * comments, as the engine does, so that one added, edited, withdrawn or resolved shows at once.
 */

export interface DiffScreenProps {
  moment: DiffMoment
  /** Where the diff was opened from: the Review page, or Building · round 2. */
  from?: 'review' | 'building' | undefined
  /** Whether the diff is open as the story starts, or waits to be opened from the base. */
  opened?: boolean | undefined
  /** The comment the diff was opened at, from its remark on the Review page. */
  at?: string | undefined
  layout?: DiffLayout | undefined
  loading?: boolean | undefined
  error?: string | undefined
  /** Why the last gesture did not go through, in words. */
  notice?: string | undefined
  /** Round 2 writes while the user reads: the steps of `LIVE_STEPS`, one after the other. */
  live?: boolean | undefined
  onComment: (comment: NewComment) => void
  onAction: (id: string, action: CommentAction) => void
  onEdit: (id: string, text: string) => void
  onFollowUp: (id: string, text: string) => void
  onShow: (id: string) => void
  onOpenForge: (url: string) => void
  onOpenVersion: (id: string) => void
}

const LIVE_EVERY = 1_600

const LARGE = 'web/src/billing/fixtures/invoices.csv'

/** The repositories with the large file's sides read, once its Show was pressed. */
function withLarge(repositories: readonly DiffRepository[]): readonly DiffRepository[] {
  return repositories.map((repository) => ({
    ...repository,
    files: repository.files.map((file) =>
      `${repository.name}/${file.path}` === LARGE ? { ...file, sides: LARGE_SIDES } : file,
    ),
  }))
}

export function DiffScreen(props: DiffScreenProps): ReactNode {
  const { moment, from = 'review', opened = true, loading = false } = props
  const [comments, setComments] = useState<readonly DiffComment[]>(moment.comments)
  const [layout, setLayout] = useState<DiffLayout>(props.layout ?? 'stacked')
  const [step, setStep] = useState(props.live === true ? 0 : -1)
  const [shown, setShown] = useState(false)
  const nonce = useRef(0)
  const [target, setTarget] = useState<StageTarget | null>(() =>
    props.at === undefined ? null : { kind: 'comment', id: props.at, nonce: 0 },
  )
  const [views, setViews] = useState<MissionFrameState>(
    opened ? { open: ['diff'], shown: 'diff' } : AT_BASE,
  )

  // The round writing: one step more at each beat, until the last.
  useEffect(() => {
    if (step < 0 || step >= LIVE_STEPS.length - 1) return
    const timer = setTimeout(() => setStep((before) => before + 1), LIVE_EVERY)
    return () => clearTimeout(timer)
  }, [step])

  const written = step >= 0 ? (LIVE_STEPS[step] ?? moment.repositories) : moment.repositories
  const repositories = shown ? withLarge(written) : written
  const source = props.live === true ? { kind: 'live' as const, round: 2 } : moment.source
  const stage = from === 'review' && props.live !== true ? 'Review' : 'Building'
  const round = stage === 'Building' ? 2 : 1

  const change = (id: string, next: (comment: DiffComment) => DiffComment): void =>
    setComments((before) => before.map((one) => (one.id === id ? next(one) : one)))

  const act = (id: string, action: CommentAction): void => {
    props.onAction(id, action)
    change(id, (one) => ({ ...one, state: action === 'withdraw' ? 'withdrawn' : 'resolved' }))
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
  const filled = repositories.some((one) => one.files.length > 0)

  const all: MissionView[] = [
    {
      id: 'diff',
      title: 'Diff',
      icon: <IconGitCompare size="sm" />,
      width: 'wide',
      // Nothing to lay out yet, nothing to toggle.
      actions: filled ? (
        <DiffActions source={source} layout={layout} onLayout={setLayout} />
      ) : undefined,
      body: (
        <DiffView
          repositories={repositories}
          comments={comments}
          source={source}
          layout={layout}
          loading={loading}
          error={props.error === undefined ? undefined : { words: props.error, onRetry: () => {} }}
          notice={props.notice}
          target={target}
          lit={props.at ?? null}
          onAdd={add}
          onAction={act}
          onEdit={(id, text) => {
            props.onEdit(id, text)
            change(id, (one) => ({ ...one, text }))
          }}
          onFollowUp={(id, text) => {
            props.onFollowUp(id, text)
            change(id, (one) => ({
              ...one,
              thread: [...(one.thread ?? []), { who: 'you', text, at: 'now' }],
            }))
          }}
          onShow={(id) => {
            props.onShow(id)
            setShown(true)
          }}
          onOpenForge={props.onOpenForge}
          onOpenVersion={(id) => {
            props.onOpenVersion(id)
            setViews((before) => openView(before, 'version'))
          }}
          onFile={(id) => {
            nonce.current += 1
            setTarget({ kind: 'file', id, nonce: nonce.current })
          }}
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
    { id: 'mission', label: 'ACME-12', mono: true, onPress: () => setViews(AT_BASE) },
    { id: 'stage', label: stageWords(stage, round), onPress: () => setViews(AT_BASE) },
    ...views.open.map((id) => ({
      id: `view:${id}`,
      label: all.find((view) => view.id === id)?.title ?? id,
      icon: all.find((view) => view.id === id)?.icon,
      onPress: () => setViews((before) => showView(before, id)),
    })),
  ]

  return (
    <div className="flex h-screen flex-col bg-surface-content">
      <ContentHeader folded={false} onFold={() => {}} crumbs={crumbs} />
      <MissionFrame
        missionKey="ACME-12"
        title="Export invoices as CSV"
        stage={stage}
        round={round}
        frozen
        type="feature"
        ball={stage === 'Building' ? 'agent' : 'you'}
        ticket={{ key: 'acme/shop#41' }}
        branch="acme-12-export-invoices"
        spec="frozen 3 days ago at 17:02"
        more={[
          {
            label: 'Diff',
            icon: <IconGitCompare size="sm" />,
            onSelect: () => setViews((before) => openView(before, 'diff')),
          },
        ]}
        onCancel={() => {}}
        base={<MissionFrameBase stage={stage} />}
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
