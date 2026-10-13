import { cn } from 'cn'
import type { ReactNode } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Frame, FrameHeader } from '../../components/frame/frame.tsx'
import { StageCard, type StageCardProps } from '../../blocks/mission/stage-card.tsx'
import type { FaceState } from '../../components/face/states.ts'
import { type ModelChoice, ModelPicker } from '../../components/model-picker/model-picker.tsx'
import { StatusMark } from '../../components/status-mark/status-mark.tsx'
import { Legend } from '../../components/tooltip/legend.tsx'
import { IconAlertTriangle, IconFileText, IconGitCompare } from '../../icons.ts'
import { Fold, ID, MissionFolds, QUIET, ROW } from './building-parts.tsx'
import type { Dependency, LaunchCheck, Moved, ReadyMoment } from './building-types.ts'

/**
 * The Ready page as #149 proposes it, in the language of the Planning page's rail (#193): the
 * frozen Spec in summary in the middle, and a rail that says, top to bottom, what happens and what
 * the user decides — the Ready card — then the mission's own things, folded.
 *
 * The Ready card is the whole of the launch: one line that says where it stands, the model the
 * Planner recommends with its reason, the three steps (the check, the preparation, the build), and
 * whatever the check found, one line per thing moved, unfolded on demand to the agent's verdict.
 * When the check needs the user, its choices are in the card and nowhere else; when it does not,
 * nothing is asked and the launch goes on.
 */

export interface ReadyHandlers {
  onLaunchAnyway: () => void
  onBackToPlanning: () => void
  onCheckAgain: () => void
  onModel: (choice: ModelChoice | null) => void
  onFavourite: (agent: string, model: string, favourite: boolean) => void
  onHide: (agent: string, model: string, hidden: boolean) => void
  /** Opens the frozen Spec; left out while there is no view to open it in. */
  onOpenSpec?: (() => void) | undefined
  /** Opens what changed in a file; left out while there is no diff to open it in. */
  onOpenDiff?: ((what: string) => void) | undefined
  onRevoke: (id: string) => void
}

export interface ReadyPageProps extends ReadyHandlers {
  moment: ReadyMoment
}

const COLUMNS = 'flex min-w-0 flex-col gap-8 px-8 pt-2 pb-10 lg:flex-row-reverse lg:items-start'

const MAIN = 'flex min-w-0 flex-1 flex-col gap-6'

const RAIL = 'flex w-full min-w-0 shrink-0 flex-col gap-6 lg:w-view-narrow'

const PROSE = 'max-w-measure text-sm break-words'

/** The dependency that keeps the launch, when one is not Done. */
export function blockerOf(moment: ReadyMoment): Dependency | undefined {
  return moment.mission.dependencies.find((dependency) => dependency.stage !== 'Done')
}

/** Whether Launch is the header's action now: nothing runs, nothing blocks, nothing to decide. */
export function launchable(moment: ReadyMoment): boolean {
  return moment.check.state === 'idle' && blockerOf(moment) === undefined
}

const MOVED_KIND: Record<Moved['kind'], string> = {
  target: 'A file the tasks target',
  proof: 'A proof file',
  living: 'A requirement of the living spec',
  ticket: 'The ticket',
  dirty: 'A file uncommitted at Freeze',
  other: 'A file changed on the base',
}

/** A thing moved since the Freeze: what and how on its line; unfolded, the agent's verdict. */
function MovedLine({
  moved,
  onOpenDiff,
}: {
  moved: Moved
  onOpenDiff: ReadyHandlers['onOpenDiff']
}): ReactNode {
  const breaks = moved.verdict !== undefined && !moved.verdict.holds
  return (
    <li>
      <Fold
        glyph={
          <Legend label={MOVED_KIND[moved.kind]}>
            {breaks ? (
              <span className="flex text-destructive">
                <IconAlertTriangle size="sm" />
              </span>
            ) : (
              <IconGitCompare size="sm" />
            )}
          </Legend>
        }
        detail={moved.what}
      >
        <div className="flex flex-col gap-1.5 px-4 pb-2 pl-10 text-sm">
          <p className="text-xs text-muted-foreground">{`${MOVED_KIND[moved.kind]} · ${moved.how}`}</p>
          {moved.verdict === undefined ? (
            <p className="text-muted-foreground">Not handed to the agent: nothing in it is read.</p>
          ) : (
            <p className="break-words">
              <span className="font-medium">
                {moved.verdict.holds ? 'The Spec still holds. ' : 'The Spec no longer holds. '}
              </span>
              {moved.verdict.why}
            </p>
          )}
          {onOpenDiff !== undefined && moved.kind !== 'living' && moved.kind !== 'ticket' && (
            <span>
              <Button variant="link" size="sm" onClick={() => onOpenDiff(moved.what)}>
                What changed
              </Button>
            </span>
          )}
        </div>
      </Fold>
    </li>
  )
}

/** What moved, one line each: what breaks the Spec first. */
function MovedList({
  moved,
  onOpenDiff,
}: {
  moved: readonly Moved[]
  onOpenDiff: ReadyHandlers['onOpenDiff']
}): ReactNode {
  const sorted = [...moved].sort(
    (a, b) => Number(a.verdict?.holds ?? true) - Number(b.verdict?.holds ?? true),
  )
  return (
    <ul aria-label="What moved since the Freeze" className="flex flex-col border-t border-border">
      {sorted.map((one) => (
        <MovedLine key={one.what} moved={one} onOpenDiff={onOpenDiff} />
      ))}
    </ul>
  )
}

/** Where the launch stands, in words: one line, a quieter one under it, and its tone. */
interface Standing {
  line: string
  under?: string | undefined
  tone: 'quiet' | 'calls' | 'good'
}

/** The words of where the launch stands: one line, and a quieter one under it when needed. */
function standing(check: LaunchCheck, blocker: Dependency | undefined, frozenAt: string): Standing {
  if (blocker !== undefined && check.state === 'idle') {
    return {
      line: `Blocked by ${blocker.key}`,
      under: `${blocker.title} is in ${blocker.stage}${blocker.percent === undefined ? '' : ` at ${String(blocker.percent)}%`}. You are told when it is done; the launch stays yours.`,
      tone: 'calls',
    }
  }
  switch (check.state) {
    case 'idle':
      return {
        line: `Ready to launch · frozen ${frozenAt}`,
        tone: 'quiet',
      }
    case 'checking':
      return { line: 'Checking what moved since the Freeze', under: check.step, tone: 'quiet' }
    case 'clear':
      return { line: 'Nothing moved since the Freeze', tone: 'good' }
    case 'moved':
      return {
        line: `${String(check.moved.length)} things moved; the Spec still holds`,
        tone: 'good',
      }
    case 'outdated': {
      const breaking = check.moved.filter((one) => one.verdict?.holds === false).length
      return {
        line: 'The Spec no longer holds',
        under: `${String(breaking)} of ${String(check.moved.length)} things moved since the Freeze break it.`,
        tone: 'calls',
      }
    }
    case 'unfetched':
      return {
        line: `Not fetched since ${check.since}`,
        under: 'The remote could not be reached: what moved there since is not known.',
        tone: 'calls',
      }
    case 'silent':
      return {
        line: 'The agent did not answer',
        under: 'What moved is listed, but the files handed to it have no verdict.',
        tone: 'calls',
      }
    case 'expired':
      return {
        line: 'Something moved since the check',
        under: 'Its result no longer says how things stand.',
        tone: 'calls',
      }
    case 'failed':
      return { line: 'The check could not finish', under: check.reason, tone: 'calls' }
    case 'dependency':
      return {
        line: `${check.dependency.key} is not done`,
        under: `${check.dependency.title} went back to ${check.dependency.stage}: the launch waits for it.`,
        tone: 'calls',
      }
  }
}

/** Hemera's face for where the launch stands. */
function faceOf(moment: ReadyMoment, blocker: Dependency | undefined): FaceState {
  const { check, preparation } = moment
  if (preparation?.some((step) => step.state === 'failed') === true) return 'error'
  if (preparation !== null) return 'running'
  if (blocker !== undefined && check.state === 'idle') return 'blocked'
  switch (check.state) {
    case 'idle':
      return 'asleep'
    case 'checking':
      return 'checking'
    case 'clear':
    case 'moved':
      return 'running'
    case 'dependency':
      return 'blocked'
    default:
      return 'question'
  }
}

/** The progress line: the launch's step under way, and how far it is. */
function progressOf(moment: ReadyMoment): StageCardProps['progress'] {
  const { check, preparation } = moment
  if (preparation !== null) {
    const done = preparation.filter((step) => step.state === 'done').length
    return {
      step: 'Preparation',
      detail: `${String(done)} of ${String(preparation.length)} steps`,
    }
  }
  if (check.state === 'idle') return { step: 'Launch', detail: 'not checked yet' }
  if (check.state === 'checking') return { step: 'Check', detail: check.step }
  if ('moved' in check) {
    const breaking = check.moved.filter((one) => one.verdict?.holds === false).length
    return {
      step: 'Check',
      detail:
        breaking > 0
          ? `${String(check.moved.length)} moved · ${String(breaking)} breaks the Spec`
          : `${String(check.moved.length)} moved`,
    }
  }
  if (check.state === 'failed') return { step: 'Check', detail: 'stopped' }
  return { step: 'Check', detail: check.state === 'clear' ? 'nothing moved' : 'to run again' }
}

/** What the user decides when the check needs them: in the card, and nowhere else. */
function Choices({ check, handlers }: { check: LaunchCheck; handlers: ReadyHandlers }): ReactNode {
  switch (check.state) {
    case 'outdated':
      return (
        <>
          <Button variant="primary" size="sm" onClick={handlers.onBackToPlanning}>
            Back to Planning
          </Button>
          <Button variant="secondary" size="sm" onClick={handlers.onLaunchAnyway}>
            Launch anyway
          </Button>
        </>
      )
    case 'unfetched':
    case 'silent':
      return (
        <>
          <Button variant="primary" size="sm" onClick={handlers.onCheckAgain}>
            Check again
          </Button>
          <Button variant="secondary" size="sm" onClick={handlers.onLaunchAnyway}>
            Launch anyway
          </Button>
        </>
      )
    case 'expired':
    case 'failed':
      return (
        <Button variant="primary" size="sm" onClick={handlers.onCheckAgain}>
          Check again
        </Button>
      )
    default:
      return null
  }
}

/**
 * Where the launch stands and what the user decides, at the top of the rail: the common stage
 * card (the face, the line, the progress; no chip, since no agent works beside it here), then
 * right under it what the check found with its choices, the model, and the preparation's steps,
 * the one under way marked in its list.
 */
export function ReadyCard({ moment, ...handlers }: ReadyPageProps): ReactNode {
  const blocker = blockerOf(moment)
  const { check, preparation, model } = moment
  const said = standing(check, blocker, moment.frozenAt)
  const moved = 'moved' in check ? check.moved : []
  const choices = <Choices check={check} handlers={handlers} />
  return (
    <>
      <StageCard
        stage="Ready"
        face={faceOf(moment, blocker)}
        line={said.line}
        progress={progressOf(moment)}
      />
      {(said.under !== undefined || moved.length > 0) && (
        <section aria-label="What the check found">
          <Frame>
            {said.under !== undefined && (
              <div className="flex flex-col gap-2 px-4 py-3">
                <p className="text-sm break-words text-muted-foreground">{said.under}</p>
                {choices !== null && <div className="flex flex-wrap gap-2">{choices}</div>}
              </div>
            )}
            {moved.length > 0 && <MovedList moved={moved} onOpenDiff={handlers.onOpenDiff} />}
          </Frame>
        </section>
      )}
      <section aria-label="Model">
        <Frame>
          <div className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                {model.value !== null
                  ? 'Your choice for Building'
                  : model.recommended !== undefined
                    ? 'Recommended for Building'
                    : 'Model for Building'}
              </span>
              <ModelPicker
                label="Model of the Builder"
                agents={model.agents}
                value={model.value}
                fallback={model.fallback}
                onChange={handlers.onModel}
                onFavourite={handlers.onFavourite}
                onHide={handlers.onHide}
              />
            </div>
            {model.recommended !== undefined && (
              <p className="text-xs break-words text-muted-foreground">
                {model.value !== null
                  ? `The Planner recommended ${model.recommended.words}: ${model.recommended.why}`
                  : model.recommended.why}
              </p>
            )}
          </div>
        </Frame>
      </section>
      {preparation !== null && (
        <section aria-label="Preparation steps">
          <Frame>
            <ul aria-label="Preparation" className="flex flex-col py-1">
              {preparation.map((step) => (
                <li key={step.name} className={cn(ROW, 'min-h-control-sm py-0.5')}>
                  <StatusMark state={step.state} size="sm" legend />
                  <span
                    className={cn('shrink-0', step.state === 'todo' && 'text-muted-foreground')}
                  >
                    {step.name}
                  </span>
                  {step.detail !== undefined && (
                    <span
                      className={cn(
                        'ml-auto min-w-0 truncate text-xs',
                        step.state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {step.detail}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Frame>
        </section>
      )}
    </>
  )
}

/** The frozen Spec in summary: its goal at a reading measure, its requirements one line each. */
export function SpecSummary({
  moment,
  onOpenSpec,
}: {
  moment: ReadyMoment
  onOpenSpec: ReadyHandlers['onOpenSpec']
}): ReactNode {
  const scenarios = moment.requirements.reduce((sum, one) => sum + one.scenarios, 0)
  return (
    <section aria-label="Frozen Spec">
      <Frame
        header={
          <FrameHeader
            icon={<IconFileText size="md" />}
            title="The frozen Spec"
            description={`${String(moment.requirements.length)} requirements · ${String(scenarios)} scenarios, each with its proof`}
            action={
              onOpenSpec === undefined ? undefined : (
                <Button variant="link" size="sm" onClick={onOpenSpec}>
                  Open the Spec
                </Button>
              )
            }
          />
        }
      >
        <p className={cn(PROSE, 'px-4 py-3')}>{moment.goal}</p>
        <ul aria-label="Requirements" className="flex flex-col border-t border-border py-1">
          {moment.requirements.map((requirement) => (
            <li key={requirement.id} className={ROW}>
              <span className={ID}>{requirement.id}</span>
              <span className="min-w-0 flex-1 truncate">{requirement.title}</span>
              <span className={QUIET}>
                {requirement.scenarios === 1
                  ? '1 scenario'
                  : `${String(requirement.scenarios)} scenarios`}
              </span>
            </li>
          ))}
        </ul>
      </Frame>
    </section>
  )
}

/** The Ready page: the rail first in reading order, drawn on the right from a laptop's width up. */
export function ReadyPage(props: ReadyPageProps): ReactNode {
  return (
    <div className={COLUMNS} data-stage="ready">
      <aside aria-label="Launch" className={RAIL}>
        <ReadyCard {...props} />
        <MissionFolds mission={props.moment.mission} onRevoke={props.onRevoke} />
      </aside>
      <div className={MAIN}>
        <SpecSummary moment={props.moment} onOpenSpec={props.onOpenSpec} />
      </div>
    </div>
  )
}
