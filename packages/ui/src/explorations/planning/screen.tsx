import { type ReactNode, useState } from 'react'

import { FreezeButton, FreezeNote } from '../../blocks/planning/freeze.tsx'
import { freezeOf, planningNow } from '../../blocks/planning/planning-progress.ts'
import { type Finding, type Question, openBySection } from '../../blocks/planning/planning-types.ts'
import { SectionsNav, SpecRead } from '../../blocks/planning/spec-read.tsx'
import type { PermissionChoice } from '../../blocks/need/need-card.tsx'
import { MENTIONABLES } from '../../components/mention-field/mention-field-fixtures.ts'
import { MissionFrame } from '../../surfaces/mission/mission-frame.tsx'
import { attentionOf } from './attention.ts'
import { type AttentionMoment, MOMENTS, type MomentName } from './fixtures.ts'
import { EverythingElse, ForYou, PlanningCard, type RailHandlers } from './rail.tsx'

export interface PlanningExplorationProps extends RailHandlers {
  moment: MomentName
  onFreeze: () => void
}

type Given = { optionId: string } | { text: string }

/** The moment as the story's engine left it: answers sent, permissions answered, findings dismissed. */
function played(
  moment: AttentionMoment,
  taken: ReadonlyMap<string, Given>,
  answeredPermissions: ReadonlySet<string>,
  dismissed: ReadonlySet<string>,
): AttentionMoment {
  const answer = (question: Question): Question => {
    const given = taken.get(question.id)
    if (given === undefined) return question
    return {
      ...question,
      state: 'answered',
      answers: [
        {
          version: 1,
          optionId: 'optionId' in given ? given.optionId : null,
          text: 'text' in given ? given.text : null,
          at: '11:50',
          inputState: 'received',
        },
      ],
    }
  }
  const dismiss = (finding: Finding): Finding =>
    dismissed.has(finding.id) ? { ...finding, fate: 'dismissed' } : finding
  return {
    ...moment,
    permissions: moment.permissions.filter((one) => !answeredPermissions.has(one.id)),
    data: {
      ...moment.data,
      waves: moment.data.waves.map((wave) => ({ ...wave, questions: wave.questions.map(answer) })),
      passes: moment.data.passes.map((pass) => ({ ...pass, findings: pass.findings.map(dismiss) })),
    },
  }
}

const COLUMNS = 'flex min-w-0 items-start gap-8 px-8 pt-2 pb-10'

const NAV = 'sticky top-2 w-settings-nav shrink-0 self-start'

const MIDDLE = 'flex min-w-0 flex-1 flex-col gap-6'

const RAIL = 'flex w-view-narrow min-w-0 shrink-0 flex-col gap-6'

/**
 * The Planning page of ACME-12 as #193 proposes it, in its mission frame: the header without a Now
 * line (it is in the stage card now), the Spec in the middle with its sections down the left,
 * and the rail — what happens, what waits for the user, and the rest folded. The story's engine
 * takes the answers, the permissions and the dismissals.
 */
export function PlanningExploration({
  moment,
  onFreeze,
  ...handlers
}: PlanningExplorationProps): ReactNode {
  const [taken, setTaken] = useState<ReadonlyMap<string, Given>>(new Map())
  const [allowed, setAllowed] = useState<ReadonlySet<string>>(new Set())
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const shown = played(MOMENTS[moment](), taken, allowed, dismissed)
  const { data } = shown
  const attention = attentionOf(shown)
  const freeze = freezeOf(shown)
  const line = planningNow(shown)
  const engine: RailHandlers = {
    ...handlers,
    onAnswer: (id, given) =>
      handlers.onAnswer(id, given).then(() => {
        setTaken((before) => new Map(before).set(id, given))
      }),
    onPermission: (id: string, choice: PermissionChoice) => {
      handlers.onPermission(id, choice)
      setAllowed((before) => new Set(before).add(id))
    },
    onDismissFinding: (id) =>
      handlers.onDismissFinding(id).then(() => {
        setDismissed((before) => new Set(before).add(id))
      }),
  }
  const open = openBySection(data.waves)
  return (
    <MissionFrame
      missionKey="ACME-12"
      title="Export notes as Markdown"
      stage="Planning"
      frozen={false}
      type="feature"
      ball={shown.permissions.length > 0 ? 'you' : line.ball}
      ballFace={false}
      ticket={{ key: 'acme/shop#41' }}
      action={freeze.shown ? <FreezeButton offer={freeze} onFreeze={onFreeze} /> : undefined}
      actionNote={<FreezeNote offer={freeze} />}
      onCancel={() => undefined}
      base={
        <div className={COLUMNS}>
          <div className={NAV}>
            <SectionsNav
              sections={data.sections}
              requirementsState={data.requirementsState}
              changes={data.changes}
              tasks={data.tasks}
              open={open}
            />
          </div>
          <section aria-label="Spec" className={MIDDLE}>
            <SpecRead
              sections={data.sections}
              requirementsState={data.requirementsState}
              requirements={data.requirements}
              tasks={data.tasks}
              changes={data.changes}
              open={open}
            />
          </section>
          <aside aria-label="What calls for you" className={RAIL}>
            <PlanningCard attention={attention} data={data} onOpenProbe={handlers.onOpenProbe} />
            <ForYou
              key={moment}
              attention={attention}
              permissions={shown.permissions}
              data={data}
              mentionables={MENTIONABLES}
              handlers={engine}
            />
            <EverythingElse data={data} mentionables={MENTIONABLES} handlers={engine} />
          </aside>
        </div>
      }
      views={[]}
      open={[]}
      shown={null}
      onShow={() => undefined}
      onClose={() => undefined}
    />
  )
}
