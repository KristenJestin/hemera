import { type ReactNode, useState } from 'react'

import type {
  DiscussionHandlers,
  DiscussionItem,
  PlanningHandlers,
  Question,
} from '../../blocks/planning/planning-types.ts'
import { FreezeButton, FreezeNote } from '../../blocks/planning/freeze.tsx'
import { LiveChip } from '../../components/live-chip/live-chip.tsx'
import { freezeOf, planningNow } from '../../blocks/planning/planning-progress.ts'
import { IconEye } from '../../icons.ts'
import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import { MissionFrame } from '../mission/mission-frame.tsx'
import { AT_BASE, closeView, openView, showView } from '../mission/navigation.ts'
import * as moments from './planning-fixtures.ts'
import { PlanningPage, discussionViewId, focusTarget, probeViewId } from './planning-page.tsx'
import { planningViews } from './planning-views.tsx'

/** The moments of the journey a story can show, by name. */
const MOMENTS = {
  starting: moments.starting,
  writing: moments.writing,
  waveToAnswer: moments.waveToAnswer,
  plannerFailed: moments.plannerFailed,
  plannerSilent: moments.plannerSilent,
  firstWave: moments.firstWave,
  wave: moments.wave,
  discussing: moments.discussing,
  probing: moments.probing,
  coldReadRunning: moments.coldReadRunning,
  findings: moments.findings,
  coldReadFailed: moments.coldReadFailed,
  dependencyProposed: moments.dependencyProposed,
  changed: moments.changed,
  vision: moments.vision,
  almostReady: moments.almostReady,
  readyToFreeze: moments.readyToFreeze,
  freezeRefused: moments.freezeRefused,
  frozen: moments.frozen,
  outdated: moments.outdated,
  triaged: moments.triaged,
  proposedAnswer: moments.proposedAnswer,
  restarted: moments.restarted,
  answerReceived: moments.answerReceived,
  answerDelivered: moments.answerDelivered,
  answerIntegrated: moments.answerIntegrated,
  long: moments.long,
} as const

export type MomentName = keyof typeof MOMENTS | 'loading' | 'error'

export interface PlanningScreenProps extends PlanningHandlers, DiscussionHandlers {
  moment: MomentName
  /** A view open over the page as the story starts. */
  opened?: string | undefined
  /** Why the page stopped following the engine after it was drawn. */
  failure?: string | undefined
  onFreeze: () => void
  onRetry: () => void
}

/** A moment with the answers the story's engine took, each sent and not yet read by the Planner. */
function withAnswers(
  moment: moments.PlanningMoment,
  taken: ReadonlyMap<string, { optionId: string } | { text: string }>,
): moments.PlanningMoment {
  if (taken.size === 0) return moment
  const waves = moment.data.waves.map((wave) =>
    Object.assign({}, wave, {
      questions: wave.questions.map((question): Question => {
        const given = taken.get(question.id)
        if (given === undefined) return question
        return Object.assign({}, question, {
          state: 'answered' as const,
          answers: [
            ...question.answers.map((version) =>
              Object.assign({}, version, { inputState: 'superseded' as const }),
            ),
            {
              version: question.answers.length + 1,
              optionId: 'optionId' in given ? given.optionId : null,
              text: 'text' in given ? given.text : null,
              at: '11:50',
              inputState: 'received' as const,
            },
          ],
        })
      }),
    }),
  )
  return Object.assign({}, moment, { data: Object.assign({}, moment.data, { waves }) })
}

/**
 * The Planning page of ACME-12 in its mission frame, at one moment of the journey: the head the
 * renderer draws above it, the page as its base, and the views it opens over it — a discussion, a
 * Probe's report. What the window does with the page, played on the fixtures.
 */
export function PlanningScreen({
  moment,
  opened,
  failure,
  onFreeze,
  onRetry,
  onSay,
  onAccept,
  onClose,
  ...handlers
}: PlanningScreenProps): ReactNode {
  // The story's engine: an answer it takes is sent, as the page reads it next.
  const [taken, setTaken] = useState<ReadonlyMap<string, { optionId: string } | { text: string }>>(
    new Map(),
  )
  const shown =
    moment === 'loading' || moment === 'error' ? null : withAnswers(MOMENTS[moment](), taken)
  const answer: PlanningHandlers['onAnswer'] = (questionId, given) =>
    handlers.onAnswer(questionId, given).then(() => {
      setTaken((before) => new Map(before).set(questionId, given))
    })
  const [frame, setFrame] = useState(() =>
    opened === undefined ? AT_BASE : openView(AT_BASE, opened),
  )
  const [starting, setStarting] = useState<DiscussionItem | null>(null)
  const data = shown?.data ?? null
  const head = shown?.head ?? { now: null, frozen: false }
  const line = shown === null ? null : planningNow(shown)
  const freeze = shown === null ? { shown: false as const } : freezeOf(shown)
  const reading = line?.coldRead ?? null

  const discuss = (item: DiscussionItem): void => {
    handlers.onDiscuss(item)
    if (!data?.discussions.some((one) => one.item.kind === item.kind && one.item.id === item.id)) {
      setStarting(item)
    }
    setFrame((now) => openView(now, discussionViewId(item)))
  }
  const openProbe = (id: string): void => {
    handlers.onOpenProbe(id)
    setFrame((now) => openView(now, probeViewId(id)))
  }

  const views = planningViews({
    discussions: data?.discussions ?? [],
    starting: starting === null ? [] : [starting],
    probes: data?.probes ?? [],
    reports: new Map((data?.probes ?? []).map((probe) => [probe.id, moments.probeById(probe.id)])),
    mentionables: MENTIONABLES,
    onSay: (_item, text) => onSay(text),
    onAccept: () => onAccept(),
    onClose: (_item, decision) => onClose(decision),
  })

  return (
    <MissionFrame
      missionKey="ACME-12"
      title="Export notes as Markdown"
      stage={head.frozen ? 'Ready' : 'Planning'}
      frozen={head.frozen}
      type="feature"
      ball={line?.ball ?? 'idle'}
      now={line?.text}
      onNow={
        line?.target === null || line?.target === undefined
          ? undefined
          : () => {
              if (line.target !== null) focusTarget(line.target)
            }
      }
      nowChip={
        reading === null ? undefined : (
          <LiveChip
            name={`Cold read ${reading.label}`}
            icon={<IconEye size="sm" />}
            state="running"
            startedAt={reading.startedAt}
            endedAt={null}
            onPress={() => focusTarget({ kind: 'coldRead' })}
          />
        )
      }
      marks={head.outdated === true ? [{ kind: 'outdated' }] : []}
      ticket={{ key: 'acme/shop#41' }}
      action={
        freeze.shown ? (
          <FreezeButton offer={freeze} refused={head.refused} onFreeze={onFreeze} />
        ) : undefined
      }
      actionNote={<FreezeNote offer={freeze} refused={head.refused} />}
      onCancel={head.frozen ? undefined : () => undefined}
      base={
        <PlanningPage
          data={data}
          error={moment === 'error' ? 'The engine did not answer in time.' : failure}
          planner={shown?.planner}
          declaredComplete={shown?.declaredComplete}
          mentionables={MENTIONABLES}
          onRetry={onRetry}
          {...handlers}
          onAnswer={answer}
          onDiscuss={discuss}
          onOpenProbe={openProbe}
        />
      }
      views={views}
      open={frame.open}
      shown={frame.shown}
      onShow={(id) => setFrame((now) => showView(now, id))}
      onClose={(id) => setFrame((now) => closeView(now, id))}
    />
  )
}
