import { cn } from 'cn'
import type { KeyboardEvent, ReactNode, Ref } from 'react'
import { useId, useState } from 'react'

import { Loading } from '../components/loading/loading.tsx'
import { IconCheck, IconSearch } from '../icons.ts'
import { AgentMark } from './agent-mark.tsx'

/**
 * What the three ways of asking the same four questions have in common (design D17-11, D17-14).
 *
 * The agent, its model, its effort and its mode are one control of the application, and the
 * maintainer is choosing between three panels that ask for them: stages, panes and a palette.
 * The three take the same props, so the shape of the answer — the types below — and the pieces
 * every panel is built out of live here rather than three times over.
 *
 * Two rules bind all three, and they are the reason this file exists:
 *
 * **Nothing jumps.** The panel's box is the same while the agent's options are being read and
 * once they have landed, and the same on every stage a variant has. It opens upwards out of the
 * foot of a window, so a panel that grew as its answer arrived would push past the top of the
 * screen and be flipped to the other side under the hand that opened it. While `loading`, the
 * list that is already there stays where it is and a small indicator sits in the header: a
 * panel that replaced its list with a sentence is a panel that changed under the reader.
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
   * thing that can — and Hemera inventing one would be inventing a level. The options of ACP
   * carry no description today (`ConfigOption`), so nothing fills it yet: the control draws it
   * where there is one and draws nothing where there is not.
   */
  description?: string | undefined
}

/** One thing the agent says it may be told to do without asking. */
export interface ModeChoice {
  id: string
  label: string
}

/**
 * What every way of asking for the effort is handed, whichever shape it is drawn in.
 *
 * Three of them are being compared — a row of steps, a vertical slider and a horizontal dial —
 * and they are interchangeable or they are not comparable: one set of props, one set of
 * answers, and the menu is what decides which one is drawn.
 *
 * `caption` is the one thing only the dial has the room to say: what the effort is being set
 * for, which is the model's name. The other two take it and draw nothing with it rather than
 * the dial carrying a prop of its own, because a variant whose props the others lack is a
 * variant the menu cannot swap for another.
 */
export interface EffortProps {
  /** The efforts of the chosen agent; empty when it announced none, and then no control at all. */
  efforts: readonly EffortChoice[]
  effort: string | null
  onEffortChange: (id: string) => void
  disabled?: boolean | undefined
  /** What the effort is being set for, for the one variant that has room to say it. */
  caption?: string | undefined
}

/** Which of the three ways the effort is drawn. */
export type EffortVariant = 'row' | 'slider' | 'dial'

/**
 * What every way of asking for the mode is handed.
 *
 * `across` is the list folded two to a line, for the panel wide enough to read two of the
 * agent's own sentences side by side; the other two draw nothing with it, for the reason the
 * effort's `caption` gives.
 */
export interface ModeProps {
  /** The modes of the chosen agent; empty when it announced none, and then no control at all. */
  modes: readonly ModeChoice[]
  mode: string | null
  onModeChange: (id: string) => void
  disabled?: boolean | undefined
  /** Whether the modes are folded two to a line, where the panel is wide enough for it. */
  across?: boolean | undefined
}

/** Which of the three ways the mode is drawn. */
export type ModeVariant = 'list' | 'column' | 'select'

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

/**
 * The same panel, with the effort and the mode drawn as one of three each.
 *
 * The maintainer is choosing between three effort controls and three mode controls as well as
 * between three panels, and a comparison where each panel shows a different one of them is not
 * a comparison. So the two are a prop, the defaults are what the application ships — the row
 * and the list — and the `Compare` story is a grid the choices are flipped in.
 */
export interface AgentModelMenuVariantProps extends AgentModelMenuProps {
  /** How the effort is asked for. `row` unless the catalogue says otherwise. */
  effortVariant?: EffortVariant | undefined
  /** How the mode is asked for. `list` unless the catalogue says otherwise. */
  modeVariant?: ModeVariant | undefined
}

/** What the trigger puts between one answer and the next. */
const SEPARATOR = ' · '

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
  'min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground'

/** What stands where a list would be when there is none: the room, kept, and a word in it. */
export const INSTEAD =
  'flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-2 text-center text-xs text-muted-foreground'

/** A scale read across and not down a list: the effort. */
export const SEGMENT =
  'flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted p-0.5'

export const SEGMENT_ITEM =
  'flex min-w-0 flex-1 items-center justify-center gap-1 rounded-sm px-2 py-1 text-xs text-muted-foreground outline-none focus-ring hover:bg-accent'

export const SEGMENT_ON = 'bg-card text-foreground shadow-sm'

/** The modes, one per line, because a mode is a sentence and not a step of a scale. */
export const MODES_DOWN = 'flex shrink-0 flex-col gap-0.5'

/** The same modes where the panel is wide enough to read two of them across. */
export const MODES_ACROSS = 'grid shrink-0 grid-cols-2 gap-0.5'

/**
 * How far a page key goes: a third of the scale, and never less than an arrow's own step.
 *
 * A page has to be more than an arrow and less than End, and a fixed number of steps would be
 * one or the other depending on how many levels the agent announced — two steps is a page of
 * Claude's six and the whole of OpenCode's three.
 */
function pageOf(last: number): number {
  return Math.max(1, Math.round(last / 3))
}

/**
 * Where an arrow, a page key, Home or End take a scale, and `null` for a key that is none of
 * them.
 *
 * Shared by the slider and the dial, which are the same scale drawn down and across: up and
 * right go on, down and left come back, the page keys go the same way by more than one, and
 * Home and End are the two ends of it. One place, so a reader who learned one of them has
 * learned the other.
 */
export function steppedBy(key: string, here: number, last: number): number | null {
  if (key === 'ArrowUp' || key === 'ArrowRight') return Math.min(here + 1, last)
  if (key === 'ArrowDown' || key === 'ArrowLeft') return Math.max(here - 1, 0)
  if (key === 'PageUp') return Math.min(here + pageOf(last), last)
  if (key === 'PageDown') return Math.max(here - pageOf(last), 0)
  if (key === 'Home') return 0
  if (key === 'End') return last
  return null
}

/**
 * The step a press landed on, read off the element it landed in.
 *
 * The scale itself is what answers the pointer, not its notches: a notch is a mark, and a mark
 * that took the focus would be a second control inside a control that already has a role.
 */
export function stepUnder(target: EventTarget): string | null {
  if (!(target instanceof Element)) return null
  return target.closest('[data-step]')?.getAttribute('data-step') ?? null
}

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
        // The room the list had, kept: while the agent is being read there is nothing to say,
        // and the sentence only stands where the reader's own query is what emptied it.
        <div className={INSTEAD}>{loading ? null : <span>{empty}</span>}</div>
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
      {one.id === chosen && <IconCheck size="sm" />}
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
