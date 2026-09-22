import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { arrival, slide, useTransition } from '../motion.ts'
import { AgentMark } from './agent-mark.tsx'
import {
  AgentList,
  type AgentModelMenuProps,
  EffortRow,
  INSTEAD,
  ModeList,
  ModelPicker,
  PanelHead,
  RefusalNote,
  triggerLabel,
} from './agent-model-menu-shared.tsx'
import { nameOfCurrent } from './current-name.ts'

/**
 * Variant B of the universal model picker: one panel, two columns, and a band under them.
 *
 * Nothing is hidden behind a stage. The agents stand on the left with their marks and what is
 * the matter with any of them; the models of whichever one is picked stand on the right under
 * their own search field; the effort and the modes are a band across the foot, because they are
 * the two questions that follow whatever was picked above. There is no back arrow: the way back
 * to the agents is to look left.
 *
 * **One box, always.** `h-menu-panel` tall and `w-menu-panel` wide, whatever is in it: the
 * columns take what is left after the band, and each of them scrolls inside its own column. The
 * panel opens upwards out of the foot of a window, so its size is decided before the agent
 * answers and never after.
 *
 * **What moves.** Only the right column: picking another agent swaps it for that agent's models
 * with a crossfade and the `slide` kind of the preset at its `nudge` distance, a short travel
 * in from the side on the `arrival` timing — a column that changed contents with no movement at
 * all reads as a list that was there all along. The column is replaced in place, so it is a
 * nudge and not a stage swap. `useTransition` answers a system asking for less movement with no
 * journey.
 *
 * **While the agent is being read**, the models already on the right stay on the right, and the
 * indicator sits in that column's header.
 *
 * The modes are folded two to a line rather than listed one per line: the band is as wide as
 * the whole panel, and two of the agent's own sentences are read whole on one line there.
 */

/** One height and one width, whatever is inside, and wide enough to carry two columns. */
const PANEL = 'flex h-menu-panel w-menu-panel flex-col gap-2'

/** The two columns, which take whatever the band under them left. */
const COLUMNS = 'flex min-h-0 flex-1 gap-2'

/** The agents, which are a shorter list than the models and are given the narrower column. */
const LEFT = 'flex w-menu-agents min-w-0 flex-col gap-2'

/** The room the models cross in, which clips the column on its way out. */
const RIGHT = 'relative min-w-0 flex-1 border-l border-border pl-2'

/** One agent's models, drawn over the outgoing ones for as long as the two are on their way. */
const SURFACE = 'absolute inset-0 flex flex-col gap-2'

/** The effort and the modes, across the foot of both columns. */
const BAND = 'flex shrink-0 flex-col gap-2 border-t border-border pt-2'

export function AgentModelMenuPanes({
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
  const trigger = useRef<HTMLButtonElement>(null)
  const transition = useTransition(arrival)

  /** The column is replaced where it stands, so the models travel a nudge and not a width. */
  const { enter, leave } = slide('nudge')

  const chosen = agents.find((one) => one.id === agent) ?? null

  /** Closes the panel and hands the focus back to what opened it. */
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true)
        else close()
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
        <div className={COLUMNS}>
          {/* A Session runs the agent it was made with: there is no column of agents to leave
              it by, and the models take the whole width instead of leaving a dead one behind. */}
          {!fixed && (
            <div className={LEFT}>
              <PanelHead title="Agent" />
              <AgentList
                agents={agents}
                agent={agent}
                autoFocus
                onChoose={(one) => onAgentChange(one.id)}
              />
            </div>
          )}
          <div className={RIGHT}>
            <AnimatePresence initial={false}>
              <motion.div
                key={agent ?? 'none'}
                className={SURFACE}
                initial={{ opacity: 0, x: enter }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: leave }}
                transition={transition}
              >
                <PanelHead title={chosen?.name ?? 'Model'} loading={loading} />
                {agent === null ? (
                  <div className={INSTEAD}>
                    <span>Choose an agent to see the models it announced.</span>
                  </div>
                ) : (
                  <ModelPicker
                    models={models}
                    model={model}
                    loading={loading}
                    onChoose={(one) => onModelChange(one.id)}
                    onEscape={close}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
        {/* The effort and the mode are the agent's own scales, so an agent that announced
            neither is given no row rather than an empty one, and the band closes up. */}
        {(efforts.length > 0 || modes.length > 0) && (
          <div className={BAND}>
            <EffortRow efforts={efforts} effort={effort} onEffortChange={onEffortChange} />
            <ModeList modes={modes} mode={mode} onModeChange={onModeChange} across />
          </div>
        )}
      </div>
    </Popover>
  )
}
