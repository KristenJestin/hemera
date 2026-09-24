import { cn } from 'cn'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { IconChevronLeft } from '../icons.ts'
import { arrival, slide, useTransition } from '../motion.ts'
import { AgentMark } from './agent-mark.tsx'
import {
  AgentList,
  type AgentModelMenuProps,
  BACK,
  HELD,
  ModelPicker,
  PanelHead,
  RefusalNote,
  STATE,
  triggerLabel,
} from './agent-model-menu-shared.tsx'
import { nameOfCurrent } from './current-name.ts'
import { EffortSlider } from './effort-slider.tsx'
import { ModeList } from './mode-list.tsx'

/**
 * One control for the agent, its model, its effort and its mode (design D17-11, D17-14).
 *
 * Four questions that only make sense in that order — which agent, then which of the models
 * *that* agent announced, then how hard it should think and what it may do without asking —
 * used to be four selectors side by side in the foot of the composer. They wrapped onto a
 * second line as soon as a model had a long name, and the box grew a band the moment an agent
 * was picked: the frame changed height while it was being read. One trigger, one panel, and the
 * panel is where the depth goes.
 *
 * **Two stages, and the second is two columns.** The agents are the first stage; picking one
 * takes the panel to the second, where the models are searched on the left and the effort and
 * the modes stand in a column of their own on the right, under the line that names the agent
 * and is the way back to the list of them. Three panels were drawn and compared in the
 * catalogue on 22 September 2026 — these stages, a two-pane browser and a command palette —
 * and this is the one the maintainer kept.
 *
 * **One box, always.** The panel is `h-menu-panel` tall and `w-menu-wide` wide on both stages,
 * while the options are being read and once they have landed. It opens upwards out of the foot
 * of a window: a panel that grew as its answer arrived would be flipped to the other side under
 * the hand that opened it, which is what the trial of 22 September 2026 refused. The agent
 * stage has four rows and does not fill that box — it is drawn at the top of it, and the room
 * left under it is the panel's own surface rather than a void, because the alternative is a box
 * that changes size between one stage and the next.
 *
 * **What moves: a carousel, not a swap.** The two stages sit side by side on one rail twice the
 * panel's width, inside a box exactly one panel wide that clips it. Going on, the rail travels
 * one panel to the left, so the models visibly push the agents out of the way; coming back it
 * travels the same distance the other way, and the agents push the models back. The distance is
 * the `slide` kind at its `stage` distance, read on the rail itself — whose own width is the
 * panel's, so one panel is `100%` of it — and the timing is `arrival`, because a stage putting
 * itself in place is what `arrival` is for.
 *
 * Both stages stay mounted throughout, and that is the correction of 22 September 2026:
 * `AnimatePresence` made this two surfaces crossing in the same place, each opaque, neither
 * pushing the other, which the maintainer read as a swap rather than as travel. Nothing is
 * unmounted now, so nothing has to be drawn twice, and the one thing that moves is a transform
 * on the rail. `useTransition` answers a system asking for less movement with the end state and
 * no journey.
 *
 * **The caret follows the rail.** The agent stage is opened with the first agent focused, the
 * model stage with its search field focused, and a stage arrived at by travelling takes the
 * caret once the travelling is over — not while the panel is still crossing under it, which is
 * what typing into a field halfway across a box reads as.
 *
 * **While the agent is being read**, a list that is there stays there. An agent just picked has
 * none yet, and its models are waited on in the middle of the room they will take, the search
 * field off until they arrive — and handed the caret then, if nothing else took it meanwhile.
 * The agent stage keeps its indicator in its header, beside the name of what is under it.
 *
 * The types, and the two lists this is built out of, live in `agent-model-menu-shared.tsx`.
 */

/**
 * The shape of the four answers, handed out from the control that asks for them: a page that
 * draws this menu types its own state against it and has no business knowing which file the
 * panel is built out of.
 */
export type {
  AgentModelMenuProps,
  EffortChoice,
  ModeChoice,
  ModelChoice,
  OfferedAgent,
} from './agent-model-menu-shared.tsx'

/** One height and one width, whatever stage is inside: the whole point of the panel. */
const PANEL = 'flex h-menu-panel w-menu-wide flex-col gap-2'

/** The room the rail runs in, exactly one panel wide, which clips whatever is off to the side. */
const BOX = 'relative min-h-0 flex-1 overflow-hidden'

/**
 * The rail, one panel wide and carrying two of them: the second overflows to the right, which
 * is what the box clips, and the rail's own width is what a slide of `100%` is measured
 * against — so one step of it is exactly one panel and never a guess.
 */
const RAIL = 'absolute inset-0 flex'

/** One stage of the rail, which is a whole panel's width of it. */
const BLOCK = 'flex w-full shrink-0 flex-col gap-2'

/** The model stage: the models on one side, what is set about them on the other. */
const COLUMNS = 'flex min-h-0 flex-1 gap-2'

/** The models, which are the list that scrolls, and so the column that is given the room. */
const MODELS = 'flex min-w-0 flex-1 flex-col gap-2'

/** What is set beside the models rather than under them: the effort, then the mode. */
const ASIDE =
  'scroll-quiet flex w-menu-side shrink-0 flex-col gap-3 overflow-y-auto border-l border-border pl-2'

/** Where the rail rests: at the agents, and one whole panel to the left for the models. */
const AT_AGENTS = 0
const AT_MODELS = slide('stage', 'forward').leave

/** Which of the two lists the panel is on: the agents, or the models of the one that was picked. */
type Stage = 'agent' | 'model'

export function AgentModelMenu({
  agents,
  agent,
  onAgentChange,
  models,
  model,
  onModelChange,
  efforts,
  effort,
  onEffortChange,
  effortDefault = null,
  modes,
  mode,
  onModeChange,
  fixed = false,
  loading = false,
  refusal = null,
  disabled = false,
  className,
}: AgentModelMenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>(fixed ? 'model' : 'agent')
  const trigger = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const transition = useTransition(arrival)

  const chosen = agents.find((one) => one.id === agent) ?? null
  /** The stage the panel is on: a Session's agent leaves it only one to be on. */
  const shown: Stage = fixed ? 'model' : stage
  /** The stage the panel opens on, which is the one whose control is handed the caret. */
  const opened: Stage = fixed || agent !== null ? 'model' : 'agent'

  /**
   * Whether the models are still being asked for, with none to show yet: the field is off, so the
   * caret it would have taken on arriving is handed to it when they land — unless the reader put
   * it on another control of the same stage meanwhile.
   */
  const waiting = loading && models.length === 0
  const waited = useRef(waiting)
  const modelStage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const was = waited.current
    waited.current = waiting
    if (!was || waiting || !open || shown !== 'model') return
    if (modelStage.current?.contains(document.activeElement) === true) return
    field.current?.focus()
  }, [waiting])

  /** Closes the panel and hands the focus back to what opened it. */
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setStage(fixed || agent !== null ? 'model' : 'agent')
          setOpen(true)
        } else close()
      }}
      side="top"
      align="end"
      keepFocus
      // What the panel is called, which is what it holds: a Session runs the agent it was made
      // with, so its menu has no agent stage to announce.
      label={fixed ? 'Model, effort and mode' : 'Agent, model, effort and mode'}
      trigger={
        <Button ref={trigger} variant="ghost" size="sm" disabled={disabled} className={className}>
          {chosen !== null && <AgentMark agent={chosen.name} agentId={chosen.id} />}
          {triggerLabel(chosen, [
            nameOfCurrent(models, model),
            nameOfCurrent(efforts, effort),
            nameOfCurrent(modes, mode),
          ])}
          {loading && <Loading size="sm" label="Reading what the agent offers" />}
        </Button>
      }
    >
      <div className={PANEL}>
        <RefusalNote refusal={refusal} />
        <div className={BOX}>
          <motion.div
            data-testid="stage-rail"
            className={RAIL}
            animate={{ x: shown === 'model' && !fixed ? AT_MODELS : AT_AGENTS }}
            transition={transition}
            // The caret is given to the stage that arrived, once it has arrived: a field taking
            // what is typed while the panel it sits in is still crossing the box is a field the
            // reader is aiming at rather than reading.
            onAnimationComplete={() => {
              if (shown === 'model') field.current?.focus()
            }}
          >
            {/* A Session runs the agent it was made with: there is no agent stage on the rail
                at all, and so nothing for the rail to travel to. */}
            {!fixed && (
              <div className={BLOCK}>
                {/* The indicator belongs to the stage that is being looked at. Both stages are
                    on the rail at once, and two of them at once would be one machine reported
                    twice. */}
                <PanelHead title="Agent" loading={loading && shown === 'agent'} />
                <AgentList
                  agents={agents}
                  agent={agent}
                  autoFocus={opened === 'agent'}
                  onChoose={(one) => {
                    onAgentChange(one.id)
                    setStage('model')
                  }}
                />
              </div>
            )}

            <div ref={modelStage} className={BLOCK}>
              {/* The agent stays in sight while its models are read, and pressing it is the way
                  back: a panel that swapped its whole content with no way out would be a dead
                  end for anyone who picked the wrong agent. A Session's agent cannot be
                  changed, so the same line is drawn and there is nothing to press. */}
              {fixed ? (
                <p className={HELD}>
                  {chosen !== null && <AgentMark agent={chosen.name} agentId={chosen.id} />}
                  <span className="min-w-0 flex-1 truncate">{chosen?.name ?? 'Agent'}</span>
                </p>
              ) : (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className={cn(BACK, 'min-w-0 flex-1')}
                    onClick={() => setStage('agent')}
                  >
                    <IconChevronLeft size="sm" />
                    {chosen !== null && <AgentMark agent={chosen.name} agentId={chosen.id} />}
                    <span className="min-w-0 flex-1 truncate">{chosen?.name ?? 'Agent'}</span>
                    <span className={STATE}>Change</span>
                  </button>
                </div>
              )}

              <div className={COLUMNS}>
                <div className={MODELS}>
                  <ModelPicker
                    models={models}
                    model={model}
                    // The wait is said on the stage being looked at, and only there: both stages
                    // are on the rail at once, and one machine is not reported twice.
                    loading={loading && shown === 'model'}
                    autoFocus={opened === 'model'}
                    fieldRef={field}
                    onChoose={(one) => onModelChange(one.id)}
                    onEscape={close}
                  />
                </div>
                {/* What the agent announced about itself, beside its models. An agent that
                    announced neither — Codex has no effort at all — is given no column rather
                    than an empty one with a rule down its side, and its models take the room. */}
                {(efforts.length > 0 || modes.length > 0) && (
                  <div className={ASIDE}>
                    <EffortSlider
                      efforts={efforts}
                      effort={effort}
                      onEffortChange={onEffortChange}
                      defaultId={effortDefault}
                    />
                    <ModeList modes={modes} mode={mode} onModeChange={onModeChange} />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </Popover>
  )
}
