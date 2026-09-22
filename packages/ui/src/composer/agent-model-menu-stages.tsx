import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { IconChevronLeft } from '../icons.ts'
import { arrival, useTransition } from '../motion.ts'
import { AgentMark } from './agent-mark.tsx'
import {
  AgentList,
  type AgentModelMenuProps,
  BACK,
  EffortRow,
  HELD,
  ModeList,
  ModelPicker,
  PanelHead,
  RefusalNote,
  STATE,
  triggerLabel,
} from './agent-model-menu-shared.tsx'
import { nameOfCurrent } from './current-name.ts'

/**
 * Variant A of the universal model picker: two stages, one after the other.
 *
 * The four questions are asked in the order they make sense in — which agent, then which of the
 * models *that* agent announced, then how hard it should think and what it may do without
 * asking — so the panel is read as two stages. The agents are the first; picking one takes the
 * panel to the second, where the models, the effort and the modes all live, and the line at the
 * top of it is the way back.
 *
 * **One box, always.** The panel is `h-menu-panel` tall and `w-menu` wide on both stages, while
 * the options are being read and once they have landed. It opens upwards out of the foot of a
 * window: a panel that grew as its answer arrived would be flipped to the other side under the
 * hand that opened it, which is what the trial of 22 September 2026 refused. The agent stage
 * has three rows and does not fill that box — it is drawn at the top of it, and the room left
 * under it is the panel's own surface rather than a void, because the alternative is a box that
 * changes size between one stage and the next.
 *
 * **What moves.** The leaving stage slides out by the width of the panel while the entering one
 * arrives from the other side — right on the way forward, left on the way back — on the
 * `arrival` preset. A transform and nothing else: the two surfaces stay opaque the whole way,
 * because a stage fading through half its opacity is a stage nobody can read mid-flight, and
 * whatever checks the page at that moment is right to call the text unreadable. `useTransition`
 * answers a system asking for less movement with the end state and no journey.
 *
 * **While the agent is being read**, the list that is there stays there and the indicator sits
 * in the header beside the name of what is under it. The panel used to replace the whole list
 * with "Reading what this agent offers…", which is the panel changing under the reader's eye.
 */

/** One height and one width, whatever stage is inside: the whole point of the panel. */
const PANEL = 'flex h-menu-panel w-menu flex-col gap-2'

/** The room the stages cross in, which clips whichever one is on its way out. */
const STAGES = 'relative min-h-0 flex-1 overflow-hidden'

/** A stage, drawn over the other one for as long as the two are both on their way. */
const SURFACE = 'absolute inset-0 flex flex-col gap-2'

/**
 * How far a stage travels: the whole width of the panel, so one surface replaces the other
 * rather than nudging it.
 *
 * Written here rather than in `motion.ts` because the preset has no `slide` kind with a
 * direction yet; the timing is the preset's own, and only the distance is local.
 */
const FROM_THE_RIGHT = '100%'
const TO_THE_LEFT = '-100%'

/** Which of the two lists the panel is on: the agents, or the models of the one that was picked. */
type Stage = 'agent' | 'model'

export function AgentModelMenuStages({
  agents,
  agent,
  onAgentChange,
  models,
  model,
  onModelChange,
  efforts,
  effort,
  onEffortChange,
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
  const [forward, setForward] = useState(true)
  const trigger = useRef<HTMLButtonElement>(null)
  const transition = useTransition(arrival)

  const chosen = agents.find((one) => one.id === agent) ?? null
  /** The stage the panel is on: a Session's agent leaves it only one to be on. */
  const shown: Stage = fixed ? 'model' : stage
  const enter = forward ? FROM_THE_RIGHT : TO_THE_LEFT
  const leave = forward ? TO_THE_LEFT : FROM_THE_RIGHT

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
          setForward(true)
          setOpen(true)
        } else close()
      }}
      side="top"
      align="end"
      keepFocus
      label="Agent, model, effort and mode"
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
        <div className={STAGES}>
          <AnimatePresence initial={false}>
            <motion.div
              key={shown}
              className={SURFACE}
              initial={{ x: enter }}
              animate={{ x: 0 }}
              exit={{ x: leave }}
              transition={transition}
            >
              {shown === 'agent' ? (
                <>
                  <PanelHead title="Agent" loading={loading} />
                  <AgentList
                    agents={agents}
                    agent={agent}
                    autoFocus
                    onChoose={(one) => {
                      onAgentChange(one.id)
                      setForward(true)
                      setStage('model')
                    }}
                  />
                </>
              ) : (
                <>
                  {/* The agent stays in sight while its models are read, and pressing it is the
                      way back: a panel that swapped its whole content with no way out would be
                      a dead end for anyone who picked the wrong agent. A Session's agent cannot
                      be changed, so the same line is drawn and there is nothing to press. */}
                  {fixed ? (
                    <p className={HELD}>
                      {chosen !== null && <AgentMark agent={chosen.name} agentId={chosen.id} />}
                      <span className="min-w-0 flex-1 truncate">{chosen?.name ?? 'Agent'}</span>
                      {loading && <Loading size="sm" label="Loading" />}
                    </p>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        className={cn(BACK, 'min-w-0 flex-1')}
                        onClick={() => {
                          setForward(false)
                          setStage('agent')
                        }}
                      >
                        <IconChevronLeft size="sm" />
                        {chosen !== null && <AgentMark agent={chosen.name} agentId={chosen.id} />}
                        <span className="min-w-0 flex-1 truncate">{chosen?.name ?? 'Agent'}</span>
                        <span className={STATE}>Change</span>
                      </button>
                      {loading && <Loading size="sm" label="Loading" />}
                    </div>
                  )}

                  <ModelPicker
                    models={models}
                    model={model}
                    loading={loading}
                    onChoose={(one) => onModelChange(one.id)}
                    onEscape={close}
                  />

                  {/* The effort and the mode are the agent's own scales, so an agent that
                      announced neither is given no row rather than an empty one. The modes are
                      a list and not a row: five of the agent's own sentences read across a
                      panel are five sentences cut short. */}
                  <EffortRow efforts={efforts} effort={effort} onEffortChange={onEffortChange} />
                  <ModeList modes={modes} mode={mode} onModeChange={onModeChange} />
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Popover>
  )
}
