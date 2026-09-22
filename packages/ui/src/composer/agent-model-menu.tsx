import { cn } from 'cn'
import { type ReactNode, useId, useRef, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { IconCheck, IconChevronLeft, IconSearch } from '../icons.ts'
import { AgentMark } from './agent-mark.tsx'

/**
 * One control for the agent, its model and its effort (design D17-11, D17-14).
 *
 * Three questions that only make sense in that order — which agent, then which of the models
 * *that* agent announced, then how hard it should think — used to be three selectors side by
 * side in the foot of the composer, and a fourth for the agent at the far end of the row. They
 * wrapped onto a second line as soon as a model had a long name, and the box grew a band the
 * moment an agent was picked: the frame changed height while it was being read. One trigger, one
 * panel, and the panel is where the depth goes.
 *
 * The trigger says what is set, in the order a reader asks it: the agent's mark, the model's
 * name, the effort behind a middle dot. Nothing is set yet, so it says what to do instead —
 * "Choose an agent" — because the model of an agent nobody picked is not a question.
 *
 * The panel does not take the focus when it opens: what opened it is the trigger, and the
 * trigger is where the focus goes back to when it closes. The search field of the model stage
 * is focused on purpose, because a field nobody can type into is a field that lies about being
 * one, and it is the field that reads the arrows — the list beside it only says which entry
 * Enter would land on, exactly as the mention menu does.
 *
 * Changing the agent clears the model and the effort: a model id belongs to the agent that
 * announced it, and carrying one across would ask an agent for a model it never published.
 */
const PANEL = 'flex w-menu flex-col gap-2'

const HEAD = 'px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase'

const NOTE = 'rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground'

const LIST = 'scroll-quiet flex max-h-64 flex-col gap-0.5 overflow-y-auto'

const ITEM =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-ring hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent'

/**
 * Where the keys are, which is the one entry Enter would take.
 *
 * The pointer moves it rather than lighting a second one: a list with a filled row under the
 * hand and another filled row somewhere else is a list saying two different things about what
 * Enter does.
 */
const ITEM_ACTIVE = 'bg-accent text-accent-foreground'

const STATE = 'text-xs text-muted-foreground'

/** One provider's models, held together so the group is read as one. */
const GROUP = 'flex flex-col gap-0.5'

/** The way back to the agents, which carries the agent it is leaving so the eye keeps its place. */
const BACK =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-ring hover:bg-accent'

/** The search field: the panel's own line, so it carries no box of its own. */
const SEARCH = 'flex items-center gap-2 rounded-md border border-input bg-muted px-2'

const QUERY =
  'min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground'

const EMPTY = 'px-2 py-3 text-xs text-muted-foreground'

const WAITING = 'flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground'

/** The effort, as one row of a few: a scale is read across, not down a list. */
const SEGMENT = 'flex items-center gap-1 rounded-md border border-border bg-muted p-0.5'

const SEGMENT_ITEM =
  'flex-1 rounded-sm px-2 py-1 text-xs text-muted-foreground outline-none focus-ring hover:bg-accent'

const SEGMENT_ON = 'bg-card text-foreground shadow-sm'

/** What the trigger puts between the model and the effort. */
const SEPARATOR = ' · '

/** One agent on offer, as the engine offered it. */
export interface OfferedAgent {
  /** What goes back over the wire when this agent is picked. */
  id: string
  /** What the reader sees, in the registry's own words. */
  name: string
  /** Whether this machine has it. One that is not there is drawn and cannot be picked. */
  available: boolean
  /** Whether it is signed in. One that is not is drawn and cannot be picked either. */
  signedIn: boolean
  /** A word of its own about why, in the engine's words. */
  hint?: string | undefined
}

/** One model the agent announced, under the provider group the agent put it in. */
export interface ModelChoice {
  id: string
  label: string
  /** The provider label the agent announced, or nothing when it announced one group. */
  group?: string | undefined
}

/** One level of effort the agent announced. */
export interface EffortChoice {
  id: string
  label: string
}

export interface AgentModelMenuProps {
  /** The agents the engine offered, in the order it offered them. */
  agents: OfferedAgent[]
  agent: string | null
  onAgentChange: (id: string) => void
  /** The models of the chosen agent; empty while none is known. */
  models: ModelChoice[]
  model: string | null
  onModelChange: (id: string) => void
  /** The efforts of the chosen agent; empty when it announced none, and then no row at all. */
  efforts: EffortChoice[]
  effort: string | null
  onEffortChange: (id: string) => void
  /** Whether the agent's options are being read. */
  loading?: boolean | undefined
  /** A sentence from the engine when the agent could not be offered. */
  refusal?: string | null | undefined
  disabled?: boolean | undefined
  /** Where the control sits; never how it looks. */
  className?: string | undefined
}

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
  loading = false,
  refusal = null,
  disabled = false,
  className,
}: AgentModelMenuProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>('agent')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const list = useId()

  const chosen = agents.find((one) => one.id === agent) ?? null
  const modelLabel = models.find((one) => one.id === model)?.label
  const effortLabel = efforts.find((one) => one.id === effort)?.label

  const asked = query.trim().toLowerCase()
  const matching = models.filter((one) => asked === '' || one.label.toLowerCase().includes(asked))
  const sections = sectionsOf(matching)
  // Numbered against the list as it stands now: an index kept across a narrowing query is a
  // highlight on whatever happens to have moved into that place.
  const selected = Math.min(active, Math.max(matching.length - 1, 0))
  /**
   * Whether there is a list at all, which is what the field may point at.
   *
   * `aria-controls` and `aria-activedescendant` name an element by its id, and a name that
   * resolves to nothing is a broken reference the accessibility pass is right to report: while
   * the options are being read, and when nothing matches, the field points at nothing.
   */
  const listed = !loading && matching.length > 0

  /** Closes the panel and hands the focus back to what opened it. */
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }

  const takeAgent = (one: OfferedAgent) => {
    onAgentChange(one.id)
    setQuery('')
    setActive(0)
    setStage('model')
  }

  const takeModel = (one: ModelChoice) => {
    onModelChange(one.id)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setStage(agent === null ? 'agent' : 'model')
          setQuery('')
          setActive(0)
          setOpen(true)
        } else close()
      }}
      side="top"
      align="end"
      keepFocus
      label="Agent, model and effort"
      trigger={
        <Button ref={trigger} variant="ghost" size="sm" disabled={disabled} className={className}>
          {chosen !== null && <AgentMark agent={chosen.name} />}
          {triggerLabel(chosen, modelLabel, effortLabel)}
          {loading && <Loading size="sm" label="Reading what the agent offers" />}
        </Button>
      }
    >
      <div className={PANEL}>
        {refusal !== null && refusal !== undefined && (
          <p role="alert" className={NOTE}>
            {refusal}
          </p>
        )}

        {stage === 'agent' ? (
          <>
            <p className={HEAD}>Agent</p>
            <div className={LIST} role="listbox" aria-label="Agents">
              {agents.map((one) => {
                const offered = one.available && one.signedIn
                const said = stateOf(one)
                return (
                  <button
                    key={one.id}
                    type="button"
                    role="option"
                    aria-selected={one.id === agent}
                    disabled={!offered}
                    className={cn(ITEM, one.id === agent && ITEM_ACTIVE)}
                    onClick={() => takeAgent(one)}
                  >
                    <AgentMark agent={one.name} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{one.name}</span>
                      {said !== null && <span className={STATE}>{said}</span>}
                    </span>
                    {one.id === agent && <IconCheck size="sm" />}
                  </button>
                )
              })}
            </div>
          </>
        ) : (
          <>
            {/* The agent stays in sight while its models are read, and pressing it is the way
                back: a panel that swapped its whole content with no way out would be a dead end
                for anyone who picked the wrong agent. */}
            <button type="button" className={BACK} onClick={() => setStage('agent')}>
              <IconChevronLeft size="sm" />
              {chosen !== null && <AgentMark agent={chosen.name} />}
              <span className="min-w-0 flex-1 truncate">{chosen?.name ?? 'Agent'}</span>
              <span className={STATE}>Change</span>
            </button>

            <div className={SEARCH}>
              <IconSearch size="sm" className="shrink-0 text-muted-foreground" />
              {/* The field takes the focus, and it is the only thing in the panel that does:
                  the panel is opened by the trigger and hands the focus back to it on the way
                  out. `autoFocus` and not an effect of our own — the popup is mounted a render
                  after the panel is told to open, so an effect keyed on "open" runs while there
                  is still nothing to focus. */}
              <input
                ref={field}
                autoFocus
                className={QUERY}
                type="text"
                role="combobox"
                aria-expanded={listed}
                aria-controls={listed ? list : undefined}
                aria-activedescendant={
                  listed && matching[selected] !== undefined
                    ? `${list}-${matching[selected].id}`
                    : undefined
                }
                aria-label="Search the models of this agent"
                placeholder="Search a model…"
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
                      matching.length === 0
                        ? 0
                        : (selected - 1 + matching.length) % matching.length,
                    )
                    return
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const one = matching[selected]
                    if (one !== undefined) takeModel(one)
                    return
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    close()
                  }
                }}
              />
            </div>

            {loading ? (
              <p className={WAITING}>
                <Loading size="sm" label="Reading what the agent offers" />
                Reading what this agent offers…
              </p>
            ) : matching.length === 0 ? (
              <p className={EMPTY}>No model of this agent matches.</p>
            ) : (
              <div className={LIST} id={list} role="listbox" aria-label="Models of this agent">
                {sections.map((section) => (
                  <Section
                    key={section.label}
                    section={section}
                    idPrefix={list}
                    chosen={model}
                    activeId={matching[selected]?.id ?? null}
                    onActivate={(one) => setActive(matching.indexOf(one))}
                    onChoose={takeModel}
                  />
                ))}
              </div>
            )}

            {/* The effort is the agent's own scale, so an agent that announced none is given no
                row at all rather than an empty one. */}
            {efforts.length > 0 && (
              <div className={SEGMENT} role="group" aria-label="Effort">
                {efforts.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    aria-pressed={one.id === effort}
                    className={cn(SEGMENT_ITEM, one.id === effort && SEGMENT_ON)}
                    onClick={() => onEffortChange(one.id)}
                  >
                    {one.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Popover>
  )
}

/** What the trigger reads, which is what is set and never what could be. */
function triggerLabel(
  chosen: OfferedAgent | null,
  modelLabel: string | undefined,
  effortLabel: string | undefined,
): string {
  if (chosen === null) return 'Choose an agent'
  if (modelLabel === undefined) return chosen.name
  if (effortLabel === undefined) return modelLabel
  return `${modelLabel}${SEPARATOR}${effortLabel}`
}

/**
 * What is said about an agent that cannot be picked, and about one that can.
 *
 * Its own words come first where the engine gave any: "not installed" is Hemera's summary of a
 * state, and the engine's sentence is the part that says what to do about it.
 */
function stateOf(one: OfferedAgent): string | null {
  if (one.hint !== undefined) return one.hint
  if (!one.available) return 'Not installed on this machine'
  if (!one.signedIn) return 'Not signed in'
  return null
}

/** One provider group of the model list, named or not. An unnamed group is just the list. */
interface ModelSection {
  label: string
  models: ModelChoice[]
}

function Section({
  section,
  idPrefix,
  chosen,
  activeId,
  onActivate,
  onChoose,
}: {
  section: ModelSection
  idPrefix: string
  chosen: string | null
  activeId: string | null
  onActivate: (one: ModelChoice) => void
  onChoose: (one: ModelChoice) => void
}): ReactNode {
  const heading = useId()
  const options = section.models.map((one) => (
    <button
      key={one.id}
      type="button"
      role="option"
      id={`${idPrefix}-${one.id}`}
      aria-selected={one.id === chosen}
      className={cn(ITEM, one.id === activeId && ITEM_ACTIVE)}
      onPointerEnter={() => onActivate(one)}
      onClick={() => onChoose(one)}
    >
      <span className="min-w-0 flex-1 truncate">{one.label}</span>
      {one.id === chosen && <IconCheck size="sm" />}
    </button>
  ))

  // An unnamed group is the list itself: an agent that publishes one provider hands over models
  // with no group, and a header over every entry of a list is a header that says nothing.
  if (section.label === '') return options
  // A named group is declared as one, because the only children a listbox may own are options
  // and groups: a heading dropped straight into the list is a violation, and the group is what
  // carries the provider's name to whatever reads the page.
  return (
    <div role="group" aria-labelledby={heading} className={GROUP}>
      <p id={heading} className={HEAD}>
        {section.label}
      </p>
      {options}
    </div>
  )
}

/**
 * The models under the groups the agent announced, in the order it announced them.
 *
 * An agent that publishes one group — Claude Code, Codex — hands over models with no group at
 * all, and the list is then drawn without a single header: a header over every entry of a list
 * is a header that says nothing.
 */
function sectionsOf(models: readonly ModelChoice[]): ModelSection[] {
  const sections: ModelSection[] = []
  for (const model of models) {
    const label = model.group ?? ''
    const already = sections.find((section) => section.label === label)
    if (already === undefined) sections.push({ label, models: [model] })
    else already.models.push(model)
  }
  return sections
}
