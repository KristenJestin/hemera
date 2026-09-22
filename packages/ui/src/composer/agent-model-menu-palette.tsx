import { cn } from 'cn'
import type { ReactNode } from 'react'
import { useId, useRef, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { IconSearch } from '../icons.ts'
import { AgentMark } from './agent-mark.tsx'
import {
  type AgentModelMenuProps,
  HEAD,
  INSTEAD,
  ITEM,
  ITEM_ACTIVE,
  LIST,
  type ModelChoice,
  type OfferedAgent,
  PanelHead,
  QUERY,
  RefusalNote,
  SEARCH,
  STATE,
  matches,
  offered,
  stateOf,
  triggerLabel,
} from './agent-model-menu-shared.tsx'
import { EffortRow } from './effort-row.tsx'
import { ModeList } from './mode-list.tsx'
import { nameOfCurrent } from './current-name.ts'

/**
 * Variant C of the universal model picker: no stages at all, one field over everything.
 *
 * Every row is an agent and a model at once — "Claude Code › Opus 4.5" — grouped under the
 * agent that announced it, with the agent's mark on the group's header. Typing narrows across
 * all of them, so a reader who knows the name of the model goes straight to it without ever
 * choosing an agent first; one who does not read the groups instead. The effort and the modes
 * are under the list, exactly where the other two variants put them.
 *
 * **What an agent that is not the current one can offer.** The props carry the models of the
 * chosen agent and of nobody else — that is what the engine answers, one agent at a time — so
 * the other agents are one row each: picking it is what asks the engine, and its models join
 * the list when they land. The list is honest about what is known rather than inventing rows.
 *
 * **One box, always.** `h-menu-panel` tall and `w-menu` wide, whatever is in it. There is no
 * stage to cross and so nothing slides: the one thing that ever changes is the list, which
 * scrolls inside a box that does not move. While the agent is being read the list stays as it
 * is and the indicator sits in the header.
 *
 * The keys are read by the field and the list beside it only says where Enter would land — the
 * same contract as the composer's mention menu, and for the same reason: a list that took the
 * caret would stop the typing that is narrowing it.
 */

/** One height and one width, whatever is inside: the whole point of the panel. */
const PANEL = 'flex h-menu-panel w-menu flex-col gap-2'

/** One agent's rows, held together so the group is read as one. */
const GROUP = 'flex flex-col gap-0.5'

/** The header of a group: the agent's mark and its name, which no row repeats. */
const GROUP_ROW = 'flex items-center gap-2 px-1 py-0.5'

/** One row of the list: the agent it belongs to is the header over it, so it says the model. */
interface Entry {
  /** What tells this row from every other, and what the active row is remembered by. */
  key: string
  agent: OfferedAgent
  /** The model, or nothing for the row that stands for an agent nobody has asked yet. */
  model: ModelChoice | null
  label: string
}

export function AgentModelMenuPalette({
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
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useId()

  const chosen = agents.find((one) => one.id === agent) ?? null
  // A Session runs the agent it was made with, so the palette is that agent's models and
  // nothing else: offering to change an agent a Session cannot change is offering something
  // that would be refused after the fact.
  const offeredAgents = fixed && chosen !== null ? [chosen] : agents

  const asked = query.trim().toLowerCase()
  const groups = offeredAgents.map((one) => ({
    agent: one,
    entries: entriesOf(one, one.id === agent ? models : []).filter((entry) =>
      matches(`${entry.agent.name} ${entry.label}`, asked),
    ),
  }))
  const matching = groups.flatMap((group) => group.entries)
  const selected = Math.min(active, Math.max(matching.length - 1, 0))
  const listed = matching.length > 0

  /** Closes the panel and hands the focus back to what opened it. */
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  /** What a row does: name the model, or ask the engine for that agent's models. */
  const take = (entry: Entry) => {
    if (entry.model !== null) {
      onModelChange(entry.model.id)
      return
    }
    if (offered(entry.agent)) onAgentChange(entry.agent.id)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setQuery('')
          setActive(0)
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
        <PanelHead title="Agent and model" loading={loading} />

        <div className={SEARCH}>
          <IconSearch size="sm" className="shrink-0 text-muted-foreground" />
          {/* `autoFocus` and not an effect of our own — the popup is mounted a render after the
              panel is told to open, so an effect keyed on "open" runs while there is still
              nothing to focus. */}
          <input
            autoFocus
            className={QUERY}
            type="text"
            role="combobox"
            aria-expanded={listed}
            aria-controls={listed ? list : undefined}
            aria-activedescendant={
              listed && matching[selected] !== undefined
                ? `${list}-${matching[selected].key}`
                : undefined
            }
            aria-label="Search every agent and model"
            placeholder="Search an agent or a model…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive(matching.length === 0 ? 0 : (selected + 1) % matching.length)
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive(
                  matching.length === 0 ? 0 : (selected - 1 + matching.length) % matching.length,
                )
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const one = matching[selected]
                if (one !== undefined) take(one)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
          />
        </div>

        {matching.length === 0 ? (
          // The room the list had, kept: while the agents are being read there is nothing to
          // say, and the sentence only stands where the reader's own query is what emptied it.
          <div className={INSTEAD}>
            {loading ? null : <span>Nothing matches what you typed.</span>}
          </div>
        ) : (
          <div className={LIST} id={list} role="listbox" aria-label="Agents and their models">
            {groups
              .filter((group) => group.entries.length > 0)
              .map((group) => (
                <PaletteGroup
                  key={group.agent.id}
                  agent={group.agent}
                  entries={group.entries}
                  idPrefix={list}
                  chosen={model}
                  activeKey={matching[selected]?.key ?? null}
                  onActivate={(entry) => setActive(matching.indexOf(entry))}
                  onChoose={take}
                />
              ))}
          </div>
        )}

        {/* The effort and the mode are the agent's own scales, so an agent that announced
            neither is given no row rather than an empty one. */}
        <EffortRow efforts={efforts} effort={effort} onEffortChange={onEffortChange} />
        <ModeList modes={modes} mode={mode} onModeChange={onModeChange} />
      </div>
    </Popover>
  )
}

/**
 * The rows one agent puts into the list.
 *
 * Its models where they are known, and one row standing for the agent itself where they are
 * not: that row is how the engine is asked, and it says so rather than pretending to be a
 * model.
 */
function entriesOf(agent: OfferedAgent, models: readonly ModelChoice[]): Entry[] {
  if (models.length === 0) {
    return [{ key: agent.id, agent, model: null, label: agent.name }]
  }
  return models.map((one) => ({
    key: `${agent.id}-${one.id}`,
    agent,
    model: one,
    label: one.label,
  }))
}

/** One agent's rows, under a header that carries its mark, its name and its state. */
function PaletteGroup({
  agent,
  entries,
  idPrefix,
  chosen,
  activeKey,
  onActivate,
  onChoose,
}: {
  agent: OfferedAgent
  entries: readonly Entry[]
  idPrefix: string
  chosen: string | null
  activeKey: string | null
  onActivate: (entry: Entry) => void
  onChoose: (entry: Entry) => void
}): ReactNode {
  const heading = useId()
  const said = stateOf(agent)
  return (
    <div role="group" aria-labelledby={heading} className={GROUP}>
      <p id={heading} className={GROUP_ROW}>
        <AgentMark agent={agent.name} agentId={agent.id} />
        <span className={cn(HEAD, 'min-w-0 flex-1 truncate')}>{agent.name}</span>
      </p>
      {entries.map((entry) => (
        <button
          key={entry.key}
          type="button"
          role="option"
          id={`${idPrefix}-${entry.key}`}
          aria-selected={entry.model !== null && entry.model.id === chosen}
          aria-disabled={entry.model === null && !offered(agent) ? true : undefined}
          className={cn(ITEM, entry.key === activeKey && ITEM_ACTIVE)}
          onPointerEnter={() => onActivate(entry)}
          onClick={() => onChoose(entry)}
        >
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          {entry.model === null && (
            <span className={STATE}>{said ?? 'Read the models it offers'}</span>
          )}
        </button>
      ))}
    </div>
  )
}
