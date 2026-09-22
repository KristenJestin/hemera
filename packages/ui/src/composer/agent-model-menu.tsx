import { cn } from 'cn'
import { type ReactNode, useId, useRef, useState } from 'react'

import { Button } from '../components/button/button.tsx'
import { Loading } from '../components/loading/loading.tsx'
import { Popover } from '../components/popover/popover.tsx'
import { IconCheck, IconChevronLeft, IconSearch } from '../icons.ts'
import { AgentMark } from './agent-mark.tsx'
import { nameOfCurrent } from './current-name.ts'
import { modeMark } from './mode-selector.tsx'

/**
 * One control for the agent, its model, its effort and its mode (design D17-11, D17-14).
 *
 * Four questions that only make sense in that order — which agent, then which of the models
 * *that* agent announced, then how hard it should think and what it may do without asking — used
 * to be four selectors side by side in the foot of the composer. They wrapped onto a second line
 * as soon as a model had a long name, and the box grew a band the moment an agent was picked:
 * the frame changed height while it was being read. One trigger, one panel, and the panel is
 * where the depth goes.
 *
 * The trigger says what is set, in the order a reader asks it: the agent's mark, the model's
 * name, the effort and the mode behind middle dots. Nothing is set yet, so it says what to do
 * instead — "Choose an agent" — because the model of an agent nobody picked is not a question.
 *
 * **The panel is one size, always.** The same width and the same height on the agent stage and
 * on the model stage, while the options are being read, when nothing matches, and when the
 * engine refused; what changes is only what scrolls inside it. It opens upwards out of the foot
 * of a window, so a panel that grew as its answer arrived would push past the top of the screen
 * and be flipped to the other side under the hand that opened it — which is what it did, and
 * what the trial of 22 September 2026 refused. The loading state is the panel it will be: the
 * same search field, the same list area, with the indicator standing in it.
 *
 * The panel does not take the focus when it opens: what opened it is the trigger, and the
 * trigger is where the focus goes back to when it closes. The search field of the model stage
 * is focused on purpose, because a field nobody can type into is a field that lies about being
 * one, and it is the field that reads the arrows — the list beside it only says which entry
 * Enter would land on, exactly as the mention menu does.
 *
 * Changing the agent clears the model and the effort: a model id belongs to the agent that
 * announced it, and carrying one across would ask an agent for a model it never published.
 *
 * A Session runs the agent it was made with, and `fixed` is that fact: no agent stage at all, no
 * way back to one, and the panel opens on the models. Offering to change an agent a Session
 * cannot change is offering something that would be refused after the fact.
 */

/** One height and one width, whatever is inside: the whole point of the panel. */
const PANEL = 'flex h-menu-panel w-menu flex-col gap-2'

const HEAD = 'px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase'

const NOTE = 'shrink-0 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground'

/**
 * The part that scrolls, which is the only part that may change size.
 *
 * `flex-1` and `min-h-0`: it takes whatever the rows above and below it left, and a flex child
 * allowed to shrink below its own content is what makes a scroller of it rather than a column
 * that pushes the panel taller.
 */
const LIST = 'scroll-quiet flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto'

const ITEM =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-ring hover:bg-accent aria-disabled:opacity-50 aria-disabled:hover:bg-transparent'

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
  'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-ring hover:bg-accent'

/** The agent of a Session that cannot change it: the same line, with nothing to press. */
const HELD = 'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm'

/** The search field: the panel's own line, so it carries no box of its own. */
const SEARCH = 'flex shrink-0 items-center gap-2 rounded-md border border-input bg-muted px-2'

const QUERY =
  'min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground'

/** What stands in the list area when there is no list: the indicator, or a word, centred in it. */
const INSTEAD =
  'flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-2 text-center text-xs text-muted-foreground'

/** A scale read across and not down a list: the effort, and the mode under it. */
const SEGMENT = 'flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted p-0.5'

const SEGMENT_ITEM =
  'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-sm px-2 py-1 text-xs text-muted-foreground outline-none focus-ring hover:bg-accent'

const SEGMENT_ON = 'bg-card text-foreground shadow-sm'

/** What the trigger puts between one answer and the next. */
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

/** One thing the agent says it may be told to do without asking. */
export interface ModeChoice {
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
  /** The modes of the chosen agent; empty when it announced none, and then no row at all. */
  modes: ModeChoice[]
  mode: string | null
  onModeChange: (id: string) => void
  /**
   * Whether the agent is the Session's own and cannot be changed.
   *
   * A Session runs the agent it was made with: there is no agent stage, no way back to one, and
   * the panel opens on the models.
   */
  fixed?: boolean | undefined
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
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const trigger = useRef<HTMLButtonElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const list = useId()

  const chosen = agents.find((one) => one.id === agent) ?? null
  const modelLabel = nameOfCurrent(models, model)
  const effortLabel = nameOfCurrent(efforts, effort)
  const modeLabel = nameOfCurrent(modes, mode)

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
  /** The stage the panel is on: a Session's agent leaves it only one to be on. */
  const shown: Stage = fixed ? 'model' : stage

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
          setStage(fixed || agent !== null ? 'model' : 'agent')
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
          {triggerLabel(chosen, modelLabel, effortLabel, modeLabel)}
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

        {shown === 'agent' ? (
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
                    // `aria-disabled` and not `disabled`: an agent that cannot be picked is still
                    // an entry of the list, and what it says — not installed, not signed in, and
                    // the command that fixes either — is the reason it is off. A disabled button
                    // is skipped by the keyboard and by whatever reads the page, which is the one
                    // reader who cannot see the sentence beside it.
                    aria-disabled={offered ? undefined : true}
                    className={cn(ITEM, one.id === agent && ITEM_ACTIVE)}
                    onClick={() => {
                      if (offered) takeAgent(one)
                    }}
                  >
                    <AgentMark agent={one.name} agentId={one.id} />
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
                for anyone who picked the wrong agent. A Session's agent cannot be changed, so
                the same line is drawn and there is nothing on it to press. */}
            {fixed ? (
              <p className={HELD}>
                {chosen !== null && <AgentMark agent={chosen.name} agentId={chosen.id} />}
                <span className="min-w-0 flex-1 truncate">{chosen?.name ?? 'Agent'}</span>
              </p>
            ) : (
              <button type="button" className={BACK} onClick={() => setStage('agent')}>
                <IconChevronLeft size="sm" />
                {chosen !== null && <AgentMark agent={chosen.name} agentId={chosen.id} />}
                <span className="min-w-0 flex-1 truncate">{chosen?.name ?? 'Agent'}</span>
                <span className={STATE}>Change</span>
              </button>
            )}

            <div className={SEARCH}>
              <IconSearch size="sm" className="shrink-0 text-muted-foreground" />
              {/* The field takes the focus, and it is the only thing in the panel that does:
                  the panel is opened by the trigger and hands the focus back to it on the way
                  out. `autoFocus` and not an effect of our own — the popup is mounted a render
                  after the panel is told to open, so an effect keyed on "open" runs while there
                  is still nothing to focus.

                  Drawn while the options are being read as well as after them, because the
                  panel is one shape: a field that appeared when the answer landed would be the
                  panel changing under the hand that opened it. */}
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

            {/* The list area, which is the one part of the panel that changes: the models, the
                indicator while they are being read, or the word that says none matched. It takes
                the same room in all three. */}
            {loading ? (
              <p className={INSTEAD}>
                <Loading size="md" label="Reading what the agent offers" />
                Reading what this agent offers…
              </p>
            ) : matching.length === 0 ? (
              <p className={INSTEAD}>No model of this agent matches.</p>
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

            {/* The effort and the mode are the agent's own scales, so an agent that announced
                neither is given no row rather than an empty one. Rows and not lists: a handful
                of steps read across is a scale, and a scale down a menu is a list of unrelated
                things. */}
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

            {modes.length > 0 && (
              <div className={SEGMENT} role="group" aria-label="Mode">
                {modes.map((one) => (
                  <button
                    key={one.id}
                    type="button"
                    aria-pressed={one.id === mode}
                    className={cn(SEGMENT_ITEM, one.id === mode && SEGMENT_ON)}
                    onClick={() => onModeChange(one.id)}
                  >
                    {/* The mark is read off the words the agent used, exactly as the selector
                        reads them: asking, editing, planning, and a setting for the rest. */}
                    {modeMark(one.label)}
                    <span className="truncate">{one.label}</span>
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
  modeLabel: string | undefined,
): string {
  if (chosen === null) return 'Choose an agent'
  const said = [modelLabel, effortLabel, modeLabel].filter((one) => one !== undefined)
  if (said.length === 0) return chosen.name
  return said.join(SEPARATOR)
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
