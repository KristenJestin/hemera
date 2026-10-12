import { type ReactNode, useState } from 'react'

import type { PermissionChoice } from '../../blocks/need/need-card.tsx'
import type {
  DiscussionHandlers,
  DiscussionItem,
  Finding,
  PlanningHandlers,
  Prototype,
  PrototypeVerdict,
  Question,
} from '../../blocks/planning/planning-types.ts'
import { FreezeButton, FreezeNote } from '../../blocks/planning/freeze.tsx'
import { freezeOf, planningNow } from '../../blocks/planning/planning-progress.ts'
import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import { MissionFrame } from '../mission/mission-frame.tsx'
import { AT_BASE, closeView, openView, showView } from '../mission/navigation.ts'
import * as forYou from './for-you-fixtures.ts'
import * as moments from './planning-fixtures.ts'
import { PlanningPage, discussionViewId, probeViewId } from './planning-page.tsx'
import { planningViews } from './planning-views.tsx'

/** The moments of the journey a story can show, by name. */
const MOMENTS = {
  reading: forYou.reading,
  questionsWaiting: forYou.questionsWaiting,
  takingAnswers: forYou.takingAnswers,
  coldReadFindings: forYou.coldReadFindings,
  probesWithPermissions: forYou.probesWithPermissions,
  readyToFreeze: forYou.readyToFreeze,
  writing: moments.writing,
  asked: moments.asked,
  threeToAnswer: moments.threeToAnswer,
  firstQuestions: moments.firstQuestions,
  plannerFailed: moments.plannerFailed,
  plannerSilent: moments.plannerSilent,
  discussing: moments.discussing,
  probing: moments.probing,
  prototyping: moments.prototyping,
  prototypeToLookAt: moments.prototypeToLookAt,
  readyWithUnjudgedPrototype: moments.readyWithUnjudgedPrototype,
  coldReadRunning: moments.coldReadRunning,
  coldReadFailed: moments.coldReadFailed,
  dependencyProposed: moments.dependencyProposed,
  changed: moments.changed,
  vision: moments.vision,
  almostReady: moments.almostReady,
  settled: moments.readyToFreeze,
  mootByDiscussion: moments.mootByDiscussion,
  freezeRefused: moments.freezeRefused,
  frozen: moments.frozen,
  outdated: moments.outdated,
  triaged: moments.triaged,
  proposedAnswer: moments.proposedAnswer,
  restarted: moments.restarted,
  long: moments.long,
} as const

export type MomentName = keyof typeof MOMENTS | 'loading' | 'error'

export interface PlanningScreenProps extends PlanningHandlers, DiscussionHandlers {
  moment: MomentName
  /** A view open over the page as the story starts. */
  opened?: string | undefined
  /** Why the page stopped following the engine after it was drawn. */
  failure?: string | undefined
  onPermission: (id: string, choice: PermissionChoice) => void
  onFreeze: () => void
  onRetry: () => void
}

type Given = { optionId: string } | { text: string }

type Judged = { verdict: PrototypeVerdict; note: string | null }

/**
 * A moment as the story's engine left it: each answer it took sent and not yet read by the
 * Planner, each question put on hold waiting, each permission answered gone, each finding
 * dismissed settled, each prototype judged with its verdict.
 */
function played(
  moment: moments.PlanningMoment,
  taken: ReadonlyMap<string, Given>,
  held: ReadonlyMap<string, string | null>,
  allowed: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
  judged: ReadonlyMap<string, Judged>,
): moments.PlanningMoment {
  const answer = (question: Question): Question => {
    const given = taken.get(question.id)
    if (given === undefined) {
      return held.has(question.id)
        ? Object.assign({}, question, {
            state: 'waiting' as const,
            waitingNote: held.get(question.id) ?? null,
          })
        : question
    }
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
  }
  const dismiss = (finding: Finding): Finding =>
    dismissed.has(finding.id) ? Object.assign({}, finding, { fate: 'dismissed' as const }) : finding
  const judge = (prototype: Prototype): Prototype => {
    const given = judged.get(prototype.id)
    return given === undefined
      ? prototype
      : Object.assign({}, prototype, { verdict: given.verdict, verdictNote: given.note })
  }
  return Object.assign({}, moment, {
    needs: moment.needs.filter((one) => !allowed.has(one.id)),
    data: Object.assign({}, moment.data, {
      questions: moment.data.questions.map(answer),
      passes: moment.data.passes.map((pass) =>
        Object.assign({}, pass, { findings: pass.findings.map(dismiss) }),
      ),
      prototypes: moment.data.prototypes.map(judge),
    }),
  })
}

/**
 * The Planning page of ACME-12 in its mission frame, at one moment of the journey: the head the
 * renderer draws above it (the ball without the face, no Now line: the stage card says it), the
 * page as its base, and the views it opens over it — a discussion, a Probe's report. The story's
 * engine takes the answers, the permissions, the dismissals and the verdicts.
 */
export function PlanningScreen({
  moment,
  opened,
  failure,
  onFreeze,
  onRetry,
  onPermission,
  onSay,
  onAccept,
  onClose,
  ...handlers
}: PlanningScreenProps): ReactNode {
  const [taken, setTaken] = useState<ReadonlyMap<string, Given>>(new Map())
  const [held, setHeld] = useState<ReadonlyMap<string, string | null>>(new Map())
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(new Set())
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [judged, setJudged] = useState<ReadonlyMap<string, Judged>>(new Map())
  const shown =
    moment === 'loading' || moment === 'error'
      ? null
      : played(MOMENTS[moment](), taken, held, allowed, dismissed, judged)
  const answer: PlanningHandlers['onAnswer'] = (questionId, given) =>
    handlers.onAnswer(questionId, given).then(() => {
      setTaken((before) => new Map(before).set(questionId, given))
    })
  const waitOnSomeone: PlanningHandlers['onWaitOnSomeone'] = (questionId, note) =>
    handlers.onWaitOnSomeone(questionId, note).then(() => {
      setHeld((before) => new Map(before).set(questionId, note))
    })
  const dismissFinding: PlanningHandlers['onDismissFinding'] = (findingId) =>
    handlers.onDismissFinding(findingId).then(() => {
      setDismissed((before) => new Set(before).add(findingId))
    })
  const judgePrototype: PlanningHandlers['onJudgePrototype'] = (id, verdict, note) =>
    handlers.onJudgePrototype(id, verdict, note).then(() => {
      setJudged((before) => new Map(before).set(id, { verdict, note }))
    })
  const [frame, setFrame] = useState(() =>
    opened === undefined ? AT_BASE : openView(AT_BASE, opened),
  )
  const [starting, setStarting] = useState<DiscussionItem | null>(null)
  const data = shown?.data ?? null
  const head = shown?.head ?? { now: null, frozen: false }
  const line = shown === null ? null : planningNow(shown)
  const freeze = shown === null ? { shown: false as const } : freezeOf(shown)

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
      ball={(shown?.needs.length ?? 0) > 0 ? 'you' : (line?.ball ?? 'idle')}
      ballFace={false}
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
          needs={shown?.needs}
          onNeed={(id) => ({
            onPermission: (choice) => {
              onPermission(id, choice)
              setAllowed((before) => new Set(before).add(id))
            },
          })}
          mentionables={MENTIONABLES}
          onRetry={onRetry}
          {...handlers}
          onAnswer={answer}
          onWaitOnSomeone={waitOnSomeone}
          onDismissFinding={dismissFinding}
          onJudgePrototype={judgePrototype}
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
