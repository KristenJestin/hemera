import { cn } from 'cn'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { useId, useState } from 'react'

import { Loading } from '../components/loading/loading.tsx'
import { IconCheck, IconSearch } from '../icons.ts'
import { AgentMark } from './agent-mark.tsx'

/**
 * What the agent menu is made of: the shape of its four answers, and its two lists
 * (design D17-11, D17-14).
 *
 * The agent, its model, its effort and its mode are one control of the application. The panel
 * that asks for them is `agent-model-menu.tsx`, its effort is `effort-slider.tsx` and its modes
 * are `mode-list.tsx`: what those three have to agree on — the types the engine's answer
 * arrives in, the list of agents, and the searched list of models — is written here once rather
 * than three times. Three panels and six controls were drawn side by side in the catalogue and
 * compared on 22 September 2026; these are the ones the maintainer kept, and the variant props
 * went out with the ones that were not.
 *
 * Two rules the panel is held to, and they are the reason this file exists:
 *
 * **Nothing jumps.** The panel's box is the same while the agent's options are being read and
 * once they have landed, and the same on both of its stages. It opens upwards out of the
 * foot of a window, so a panel that grew as its answer arrived would push past the top of the
 * screen and be flipped to the other side under the hand that opened it. While `loading`, a
 * list that is already there stays where it is: a panel that replaced its list with a sentence
 * is a panel that changed under the reader. Where there is no list yet — an agent just picked,
 * whose models are still being asked for — the room the list will take says so, in its middle.
 *
 * **A mode is read whole.** "Ask before edits" and "Bypass permissions" are the agent's own
 * words; five of them across a row truncates every one into a guess. They are a list, one per
 * line, marked and checked.
 */

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
  /** What the agent said this model is, where it said anything about it at all. */
  description?: string | undefined
  /** Whether the agent named this model as the one it advises. See `EffortChoice`. */
  recommended?: boolean | undefined
}

/** One level of effort the agent announced. */
export interface EffortChoice {
  id: string
  label: string
  /**
   * What the agent said this level is, where it said anything at all.
   *
   * `Default` is the case it exists for: the agent announces it as a value like the others and
   * ACP says nothing about which level it stands for, so the agent's own sentence is the only
   * thing that can — and Hemera inventing one would be inventing a level. The control draws it
   * where there is one and draws nothing where there is not.
   */
  description?: string | undefined
  /**
   * Whether the agent named this level as the one it advises (decision of 22 September 2026).
   *
   * The two halves of one rule, and never both at once. An agent that says which level its
   * `Default` stands for has that level marked here and no `Default` entry in the list at all;
   * an agent that says nothing keeps its `Default` entry and marks nothing. A list holding a
   * `Default` beside the level it names would be offering the same thing twice.
   *
   * It is the level the scale draws its rule at, handed over as `defaultId`: the level the agent
   * announces it is on is whatever its own settings put every model on, and says nothing of what
   * any of them defaults to (trial of 23 September 2026).
   */
  recommended?: boolean | undefined
}

/** One thing the agent says it may be told to do without asking. */
export interface ModeChoice {
  id: string
  label: string
  /** An independent agent setting, such as planning, remains available under Hemera Auto. */
  permission?: boolean | undefined
}

export interface MenuClassifier {
  mode: 'agent-default' | 'hemera-auto'
  status: 'ready' | 'unavailable' | 'transitioning'
  onOpenSettings: () => void
}

/** What the effort slider is handed: the agent's levels, the one that is set, and the answer. */
export interface EffortProps {
  /** The efforts of the chosen agent; empty when it announced none, and then no control at all. */
  efforts: readonly EffortChoice[]
  effort: string | null
  onEffortChange: (id: string) => void
  /**
   * The level the agent recommends: where the rule is drawn and where the scale opens while
   * nothing is set. Null where the agent recommends none — no rule, then.
   */
  defaultId?: string | null | undefined
  disabled?: boolean | undefined
}

/** And what the mode list is handed, which is the same three things about the other question. */
export interface ModeProps {
  /** The modes of the chosen agent; empty when it announced none, and then no control at all. */
  modes: readonly ModeChoice[]
  mode: string | null
  onModeChange: (id: string) => void
  disabled?: boolean | undefined
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
  /** The level the agent recommends, which the scale marks (`EffortProps.defaultId`). */
  effortDefault?: string | null | undefined
  /** The modes of the chosen agent; empty when it announced none, and then no row at all. */
  modes: ModeChoice[]
  mode: string | null
  onModeChange: (id: string) => void
  /** The effective application policy. Omitted until the phase-0 UI is wired into the app. */
  classifier?: MenuClassifier | undefined
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

/** What the trigger puts between one answer and the next. */
const SEPARATOR = ' · '

/**
 * What a value the agent advises is called, in one place so the model list and the effort agree.
 *
 * The agent's recommendation replaces the `Default` entry it used to be announced as, so this
 * word stands exactly where that entry stood — beside the value it named, and never as a value
 * of its own (decision of 22 September 2026).
 */
export const ADVISED_SAID = 'recommended'

/** What the level the agent recommends is called, on the scale. */
export const DEFAULT_SAID = 'default'

/** The same word beside a level's name, which is how a scale writes it. */
export const DEFAULT_BESIDE = ` ${SEPARATOR.trim()} ${DEFAULT_SAID}`

/**
 * What a scale says it stands on: the agent's word for the level, its sentence, and whether it
 * is the default — read as one phrase by whoever cannot see the rule.
 */
export function levelSaid(level: EffortChoice | undefined, defaultId?: string | null): string {
  if (level === undefined) return 'Not set'
  const said = [level.label]
  if (level.description !== undefined) said.push(level.description)
  if (level.id === defaultId) said.push(DEFAULT_SAID)
  return said.join(', ')
}

/** A head of a column or of a group, which names what is under it and is never read as a row. */
export const HEAD = 'px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase'

/** The header line of a panel or of a column: a name, and the indicator when one is due. */
const HEAD_ROW = 'flex shrink-0 items-center gap-2'

export const NOTE = 'shrink-0 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground'

/**
 * The part that scrolls, which is the only part that may change size.
 *
 * `flex-1` and `min-h-0`: it takes whatever the rows above and below it left, and a flex child
 * allowed to shrink below its own content is what makes a scroller of it rather than a column
 * that pushes the panel taller.
 */
export const LIST = 'scroll-quiet flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto'

export const ITEM =
  'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-ring hover:bg-accent aria-disabled:opacity-50 aria-disabled:hover:bg-transparent'

/**
 * Where the keys are, which is the one entry Enter would take.
 *
 * The pointer moves it rather than lighting a second one: a list with a filled row under the
 * hand and another filled row somewhere else is a list saying two different things about what
 * Enter does.
 */
export const ITEM_ACTIVE = 'bg-accent text-accent-foreground'

export const STATE = 'text-xs text-muted-foreground'

/** Where a row's check stands, held open whether the row is chosen or not. */
const CHECK_SLOT = 'flex size-icon-sm shrink-0 items-center justify-center'

/** One provider's models, held together so the group is read as one. */
const GROUP = 'flex flex-col gap-0.5'

/** The way back to the agents, which carries the agent it is leaving so the eye keeps its place. */
export const BACK =
  'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none focus-ring hover:bg-accent'

/** The agent of a Session that cannot change it: the same line, with nothing to press. */
export const HELD = 'flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm'

/** The search field: the panel's own line, so it carries no box of its own. */
export const SEARCH =
  'flex shrink-0 items-center gap-2 rounded-md border border-input bg-muted px-2'

export const QUERY =
  'min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50'

/** What the room of the model list says while the models are being asked for. */
const WAITING = 'Loading models…'

/** What stands where a list would be when there is none: the room, kept, and a word in it. */
export const INSTEAD =
  'flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-2 text-center text-xs text-muted-foreground'

/** What the trigger reads, which is what is set and never what could be. */
export function triggerLabel(chosen: OfferedAgent | null, said: (string | undefined)[]): string {
  if (chosen === null) return 'Choose an agent'
  const answered = said.filter((one) => one !== undefined)
  if (answered.length === 0) return chosen.name
  return answered.join(SEPARATOR)
}

/**
 * What is said about an agent that cannot be picked, and about one that can.
 *
 * Its own words come first where the engine gave any: "not installed" is Hemera's summary of a
 * state, and the engine's sentence is the part that says what to do about it.
 */
export function stateOf(one: OfferedAgent): string | null {
  if (one.hint !== undefined) return one.hint
  if (!one.available) return 'Not installed on this machine'
  if (!one.signedIn) return 'Not signed in'
  return null
}

/** Whether an agent is one this machine can actually be told to run. */
export function offered(one: OfferedAgent): boolean {
  return one.available && one.signedIn
}

/** One provider group of the model list, named or not. An unnamed group is just the list. */
export interface ModelSection {
  label: string
  models: ModelChoice[]
}

/**
 * The models under the groups the agent announced, in the order it announced them.
 *
 * An agent that publishes one group — Claude Code, Codex — hands over models with no group at
 * all, and the list is then drawn without a single header: a header over every entry of a list
 * is a header that says nothing.
 */
export function sectionsOf(models: readonly ModelChoice[]): ModelSection[] {
  const sections: ModelSection[] = []
  for (const model of models) {
    const label = model.group ?? ''
    const already = sections.find((section) => section.label === label)
    if (already === undefined) sections.push({ label, models: [model] })
    else already.models.push(model)
  }
  return sections
}

/** Whether a label answers what was typed, which is the one way anything here is narrowed. */
export function matches(label: string, asked: string): boolean {
  return asked === '' || label.toLowerCase().includes(asked)
}

/**
 * The sentence the engine sent when it could not offer the agent.
 *
 * An alert, because a sentence about the agent that never reaches whatever reads the page is a
 * sentence half the readers never get.
 */
export function RefusalNote({ refusal }: { refusal: string | null | undefined }): ReactNode {
  if (refusal === null || refusal === undefined) return null
  return (
    <p role="alert" className={NOTE}>
      {refusal}
    </p>
  )
}

/**
 * A header of the panel: what is under it, and the indicator while the agent is being read.
 *
 * This is where `loading` shows, and the whole reason it shows here: the list under it stays
 * exactly where it was, so nothing the reader was looking at moves or is taken away.
 */
export function PanelHead({
  title,
  loading = false,
}: {
  title: string
  loading?: boolean | undefined
}): ReactNode {
  return (
    <p className={HEAD_ROW}>
      <span className={cn(HEAD, 'min-w-0 flex-1')}>{title}</span>
      {loading && <Loading size="sm" label="Loading" />}
    </p>
  )
}

/**
 * The arrows walking a list of rows that hold the focus themselves.
 *
 * The model list is read by the search field and only says where Enter would land; this one has
 * no field over it, so the rows are the focus and the arrows move it — which is what a listbox
 * is expected to do by anybody who navigates without a pointer.
 */
function walkWithArrows(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const rows = [...event.currentTarget.querySelectorAll('button')]
  if (rows.length === 0) return
  const here = rows.findIndex((row) => row === document.activeElement)
  const step = event.key === 'ArrowDown' ? 1 : -1
  const next = here === -1 ? 0 : (here + step + rows.length) % rows.length
  rows[next]?.focus()
}

/**
 * The agents, as a list that can be walked with the arrows.
 *
 * An agent that cannot be picked is `aria-disabled` and not `disabled`: it is still an entry of
 * the list, and what it says — not installed, not signed in, and the command that fixes either —
 * is the reason it is off. A disabled button is skipped by the keyboard and by whatever reads
 * the page, which is the one reader who cannot see the sentence beside it.
 */
export function AgentList({
  agents,
  agent,
  onChoose,
  autoFocus = false,
}: {
  agents: readonly OfferedAgent[]
  agent: string | null
  onChoose: (one: OfferedAgent) => void
  autoFocus?: boolean | undefined
}): ReactNode {
  const first = agents.findIndex(offered)
  return (
    <div className={LIST} role="listbox" aria-label="Agents" onKeyDown={walkWithArrows}>
      {agents.map((one, index) => {
        const said = stateOf(one)
        return (
          <button
            key={one.id}
            type="button"
            role="option"
            aria-selected={one.id === agent}
            aria-disabled={offered(one) ? undefined : true}
            autoFocus={autoFocus && index === first}
            className={cn(ITEM, one.id === agent && ITEM_ACTIVE)}
            onClick={() => {
              if (offered(one)) onChoose(one)
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
  )
}

/**
 * The search field over a list of models, and the list itself.
 *
 * The field takes the focus and the list beside it only says which entry Enter would land on —
 * the same contract as the composer's mention menu, and for the same reason: a list that took
 * the caret would stop the typing that is narrowing it.
 *
 * `aria-controls` and `aria-activedescendant` name an element by its id, and a name that
 * resolves to nothing is a broken reference: where nothing matches, the field points at nothing.
 *
 * While the models are being asked for and none has arrived yet (third review of #18), the room
 * of the list holds the indicator and says what it is waiting on, in the middle of it rather than
 * as a dot in a corner beside the name of the agent: the list is where the eye goes, and an empty
 * list with a dot somewhere else read as an agent that has no model. The field is off meanwhile —
 * there is nothing yet to search.
 */
export function ModelPicker({
  models,
  model,
  onChoose,
  onEscape,
  loading = false,
  autoFocus = true,
  fieldRef,
  label = 'Search the models of this agent',
  placeholder = 'Search a model…',
  listLabel = 'Models of this agent',
  empty = 'No model of this agent matches.',
}: {
  models: readonly ModelChoice[]
  model: string | null
  onChoose: (one: ModelChoice) => void
  onEscape: () => void
  loading?: boolean | undefined
  /**
   * Whether the field takes the caret as it mounts.
   *
   * On by default, which is every panel that draws this on the stage it opens on. The stages
   * panel keeps both of its stages mounted since the trial of 22 September 2026, so a field
   * that always took the caret would take it off the list of agents: it is handed `false`
   * there, and the caret is given to the field once the rail has finished moving.
   */
  autoFocus?: boolean | undefined
  /** A hold on the field, for a panel that hands it the caret itself. */
  fieldRef?: Ref<HTMLInputElement> | undefined
  label?: string | undefined
  placeholder?: string | undefined
  listLabel?: string | undefined
  empty?: string | undefined
}): ReactNode {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const list = useId()

  const asked = query.trim().toLowerCase()
  const matching = models.filter((one) => matches(one.label, asked))
  // Numbered against the list as it stands now: an index kept across a narrowing query is a
  // highlight on whatever happens to have moved into that place.
  const selected = Math.min(active, Math.max(matching.length - 1, 0))
  const listed = matching.length > 0
  const waiting = loading && models.length === 0

  return (
    <>
      <div className={SEARCH}>
        <IconSearch size="sm" className="shrink-0 text-muted-foreground" />
        {/* `autoFocus` and not an effect of our own — the popup is mounted a render after the
            panel is told to open, so an effect keyed on "open" runs while there is still
            nothing to focus. */}
        <input
          autoFocus={autoFocus}
          ref={fieldRef}
          disabled={waiting}
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
          aria-label={label}
          placeholder={placeholder}
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
              if (one !== undefined) onChoose(one)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              onEscape()
            }
          }}
        />
      </div>
      {matching.length === 0 ? (
        // The room the list had, kept: while there is no model yet it is what is being waited
        // on, and the sentence only stands where the reader's own query is what emptied it.
        <div className={INSTEAD}>
          {waiting ? (
            <>
              <Loading size="md" label={WAITING} />
              {/* Said once: the indicator already carries it to whatever reads the page. */}
              <span aria-hidden="true">{WAITING}</span>
            </>
          ) : (
            <span>{empty}</span>
          )}
        </div>
      ) : (
        <div className={LIST} id={list} role="listbox" aria-label={listLabel}>
          {sectionsOf(matching).map((section) => (
            <ModelGroup
              key={section.label}
              section={section}
              idPrefix={list}
              chosen={model}
              activeId={matching[selected]?.id ?? null}
              onActivate={(one) => setActive(matching.indexOf(one))}
              onChoose={onChoose}
            />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * One group of a model list.
 *
 * An unnamed group is the list itself: an agent that publishes one provider hands over models
 * with no group, and a header over every entry of a list is a header that says nothing. A named
 * one is declared as a group, because the only children a listbox may own are options and
 * groups.
 */
export function ModelGroup({
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
      {/* The model the agent itself advises, said beside it and quietly: it is the one the
          `Default` entry used to stand for, and it is a word about this row rather than a row. */}
      {one.recommended === true && <span className={STATE}>{ADVISED_SAID}</span>}
      {/* The check has its slot on every row, empty or not: a mark that only took room once
          its row was chosen pushed the word before it aside under the hand. */}
      <span className={CHECK_SLOT}>{one.id === chosen && <IconCheck size="sm" />}</span>
    </button>
  ))

  if (section.label === '') return options
  return (
    <div role="group" aria-labelledby={heading} className={GROUP}>
      <p id={heading} className={HEAD}>
        {section.label}
      </p>
      {options}
    </div>
  )
}
