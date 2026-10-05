import { cn } from 'cn'
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconEyeOff,
  IconPencil,
  IconSearch,
  IconShieldCheck,
  IconStar,
} from '../../icons.ts'
import { Button, IconButton } from '../button/button.tsx'
import { Popover } from '../popover/popover.tsx'
import { Tabs } from '../tabs/tabs.tsx'
import { Tooltip } from '../tooltip/tooltip.tsx'

/**
 * The model picker: one popover, the same wherever a model is chosen — the app's settings, a
 * Project's, a mission's override, the check before a launch, the Chat.
 *
 * - The trigger says the agent and the model, then compact marks for what is not the default: a
 *   gauge for the effort, a dot for a mode that is not the agent's own, a shield when Hemera Auto
 *   judges permissions. The marks are drawn, their words are the trigger's tooltip and its name.
 *   A default shows nothing.
 * - The popover opens with the focus in the search. Agents are tabs; each one's models are a list
 *   the search filters, favourites first, hidden ones left out; Up and Down walk it, Enter picks.
 *   Then the effort, then the mode, each a row of radios. It stays open and updates in place: the
 *   list keeps one height whatever it holds, so nothing below it moves while typing.
 * - Where a level inherits a model (a Project, a mission), "Use the default" heads the list.
 * - An agent not installed is a tab whose pane is its install command. A model the agent no
 *   longer offers stays the trigger's words, with a warning glyph.
 * - Favourites and hidden models are chosen in the list's edit mode: every model, with its two
 *   toggles.
 */

export const EFFORTS = ['low', 'medium', 'high', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export interface PickerModel {
  id: string
  name: string
  /** The efforts the model accepts, lowest first; none when it takes no effort. */
  efforts?: readonly Effort[] | undefined
  favourite?: boolean | undefined
  hidden?: boolean | undefined
}

export interface PickerMode {
  id: string
  label: string
}

export type PickerAgent =
  | {
      id: string
      name: string
      installed: true
      models: readonly PickerModel[]
      /** The agent's modes, its own default first. */
      modes?: readonly PickerMode[] | undefined
    }
  | { id: string; name: string; installed: false; install: string }

export interface ModelChoice {
  agent: string
  model: string
  /** Left out: the model's own default. */
  effort?: Effort | undefined
  /** Left out: the agent's own default mode. */
  mode?: string | undefined
}

/** Who answers the permissions an agent asks for: the user, or Hemera Auto. */
export type Judge = 'you' | 'auto'

export interface ModelPickerProps {
  /** What is being chosen: `Model of the Builder`. The trigger's name starts with it. */
  label: string
  agents: readonly PickerAgent[]
  /** The choice; null when the level uses the default (or nothing is chosen yet). */
  value: ModelChoice | null
  /** What this level inherits, when it inherits one: "Use the default" is then offered. */
  fallback?: ModelChoice | undefined
  judge?: Judge | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
  /** A new choice, or null for the default. */
  onChange: (choice: ModelChoice | null) => void
  onFavourite: (agent: string, model: string, favourite: boolean) => void
  onHide: (agent: string, model: string, hidden: boolean) => void
}

const TRIGGER_WORDS = 'min-w-0 truncate'
const MARKS = 'flex shrink-0 items-center gap-1.5 text-muted-foreground'
const PANE = 'flex w-picker flex-col gap-3'
const LIST =
  'flex h-picker-list flex-col gap-0.5 overflow-y-auto scrollbar-stable rounded-md outline-none'
const OPTION =
  'flex min-h-control-md min-w-0 items-center gap-2 rounded-md px-2 text-sm select-none hover-motion hover:tinted data-[active=true]:tinted'
const GROUP_LABEL = 'px-2 pt-2 pb-1 text-xs text-muted-foreground'
const ROW = 'flex min-h-control-md items-center gap-3'
const ROW_LABEL = 'w-16 shrink-0 text-xs text-muted-foreground'
const RADIO =
  'inline-flex h-control-sm items-center rounded-md px-2 text-xs outline-none focus-ring hover-motion hover:tinted aria-checked:bg-primary-muted aria-checked:text-primary-muted-foreground'
const BAR =
  'inline-flex h-control-sm w-4 items-center justify-center rounded-md outline-none focus-ring hover-motion hover:tinted'
const QUIET = 'px-2 py-3 text-sm text-muted-foreground'

/** The words of a choice, as the trigger's name and tooltip say them. */
export function choiceWords(
  agents: readonly PickerAgent[],
  choice: ModelChoice,
  judge: Judge = 'you',
): string {
  const agent = agents.find((one) => one.id === choice.agent)
  const model =
    agent?.installed === true ? agent.models.find((one) => one.id === choice.model) : undefined
  const mode =
    agent?.installed === true && choice.mode !== undefined && choice.mode !== agent.modes?.[0]?.id
      ? agent.modes?.find((one) => one.id === choice.mode)
      : undefined
  return [
    agent?.name ?? choice.agent,
    model?.name ?? choice.model,
    choice.effort === undefined ? null : `effort ${choice.effort}`,
    mode === undefined ? null : `mode ${mode.label}`,
    judge === 'auto' ? 'Hemera Auto judges permissions' : null,
    agent?.installed === true && model === undefined
      ? `${agent.name} no longer offers this model`
      : null,
  ]
    .filter((word) => word !== null)
    .join(' · ')
}

/** The effort as a gauge of four bars, the ones up to it filled. */
export function EffortGauge({ effort }: { effort: Effort }): ReactNode {
  const level = EFFORTS.indexOf(effort)
  return (
    <span className="inline-flex h-icon-sm items-end gap-0.5" aria-hidden="true">
      {EFFORTS.map((step, at) => (
        <span
          key={step}
          className={cn(
            'w-1 rounded-full',
            ['h-1', 'h-2', 'h-3', 'h-4'][at],
            at <= level ? 'bg-current' : 'bg-border',
          )}
        />
      ))}
    </span>
  )
}

function Marks({
  agents,
  choice,
  judge,
}: {
  agents: readonly PickerAgent[]
  choice: ModelChoice
  judge: Judge
}): ReactNode {
  const agent = agents.find((one) => one.id === choice.agent)
  const offered = agent?.installed !== true || agent.models.some((one) => one.id === choice.model)
  const otherMode =
    agent?.installed === true && choice.mode !== undefined && choice.mode !== agent.modes?.[0]?.id
  return (
    <span className={MARKS} aria-hidden="true">
      {!offered && <IconAlertTriangle size="sm" className="text-warning" />}
      {choice.effort !== undefined && <EffortGauge effort={choice.effort} />}
      {otherMode && <span className="size-2 rounded-full bg-info" />}
      {judge === 'auto' && <IconShieldCheck size="sm" />}
    </span>
  )
}

interface Entry {
  key: string
  /** Null for "Use the default". */
  model: PickerModel | null
  group: 'default' | 'favourites' | 'models'
}

const matches = (name: string, query: string): boolean =>
  name.toLowerCase().includes(query.trim().toLowerCase())

function entriesOf(models: readonly PickerModel[], query: string, withDefault: boolean): Entry[] {
  const shown = models.filter((model) => model.hidden !== true && matches(model.name, query))
  const entry =
    (group: Entry['group']) =>
    (model: PickerModel): Entry => ({ key: model.id, model, group })
  return [
    ...(withDefault && query.trim() === ''
      ? [{ key: 'default', model: null, group: 'default' } satisfies Entry]
      : []),
    ...shown.filter((model) => model.favourite === true).map(entry('favourites')),
    ...shown.filter((model) => model.favourite !== true).map(entry('models')),
  ]
}

/** A row of radios walked by the arrows, the checked one the only stop of the tab order. */
function RadioRow<Value extends string>({
  label,
  items,
  value,
  onChoose,
  render,
}: {
  label: string
  items: readonly { value: Value; label: string }[]
  value: Value
  onChoose: (value: Value) => void
  /** The glyph an item is drawn as, its words then its tooltip; null keeps it in words. */
  render?: ((item: { value: Value; label: string }) => ReactNode) | undefined
}): ReactNode {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  )
  const step = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (delta === undefined) return
    event.preventDefault()
    const next = (at + delta + items.length) % items.length
    const item = items[next]
    if (item === undefined) return
    onChoose(item.value)
    refs.current[next]?.focus()
  }
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
        {items.map((item, index) => {
          const checked = index === at
          const glyph = render?.(item) ?? null
          const radio = (
            <button
              key={item.value}
              ref={(node) => {
                refs.current[index] = node
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={glyph === null ? undefined : item.label}
              tabIndex={checked ? 0 : -1}
              className={glyph === null ? RADIO : BAR}
              onClick={() => onChoose(item.value)}
              onKeyDown={step}
            >
              {glyph ?? item.label}
            </button>
          )
          return glyph === null ? (
            radio
          ) : (
            <Tooltip key={item.value} label={item.label}>
              {radio}
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

const EFFORT_BARS = ['h-1', 'h-2', 'h-3', 'h-4']

function AgentPane({
  agent,
  value,
  fallback,
  query,
  onQuery,
  editing,
  onEditing,
  search,
  onChange,
  onFavourite,
  onHide,
}: {
  agent: Extract<PickerAgent, { installed: true }>
  value: ModelChoice | null
  fallback: ModelChoice | undefined
  query: string
  onQuery: (query: string) => void
  editing: boolean
  onEditing: (editing: boolean) => void
  search: RefObject<HTMLInputElement | null>
  onChange: (choice: ModelChoice | null) => void
  onFavourite: (agent: string, model: string, favourite: boolean) => void
  onHide: (agent: string, model: string, hidden: boolean) => void
}): ReactNode {
  const id = useId()
  const entries = useMemo(
    () => entriesOf(agent.models, query, fallback !== undefined),
    [agent.models, query, fallback],
  )
  const [active, setActive] = useState(0)
  const current = Math.min(active, Math.max(0, entries.length - 1))
  const mine = value?.agent === agent.id ? value : null
  const model = agent.models.find((one) => one.id === mine?.model)
  const efforts = model?.efforts ?? []
  const modes = agent.modes ?? []

  const pick = (entry: Entry | undefined) => {
    if (entry === undefined) return
    onChange(entry.model === null ? null : { agent: agent.id, model: entry.model.id })
  }
  const walk = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActive(Math.min(Math.max(current + delta, 0), Math.max(0, entries.length - 1)))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      pick(entries[current])
    }
  }
  const optionId = (entry: Entry) => `${id}-${entry.key}`

  return (
    <div className={PANE}>
      <div className="flex items-center gap-2">
        <label className="flex h-control-md min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-input-fill px-2.5 focus-ring">
          <IconSearch size="sm" aria-hidden="true" className="text-muted-foreground" />
          <input
            ref={search}
            role="combobox"
            aria-label="Search models"
            aria-expanded={!editing}
            aria-controls={`${id}-list`}
            aria-activedescendant={
              editing || entries[current] === undefined ? undefined : optionId(entries[current])
            }
            aria-autocomplete="list"
            placeholder="Search models"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(event) => {
              onQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={editing ? undefined : walk}
          />
        </label>
      </div>

      {editing ? (
        <ul id={`${id}-list`} aria-label={`Models of ${agent.name}`} className={LIST}>
          {agent.models
            .filter((one) => matches(one.name, query))
            .map((one) => (
              <li key={one.id} className={cn(ROW, 'px-2')}>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-sm',
                    one.hidden === true && 'text-muted-foreground',
                  )}
                >
                  {one.name}
                </span>
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={
                    <IconStar size="sm" weight={one.favourite === true ? 'filled' : 'outline'} />
                  }
                  aria-label={`Favourite ${one.name}`}
                  aria-pressed={one.favourite === true}
                  onClick={() => onFavourite(agent.id, one.id, one.favourite !== true)}
                />
                <IconButton
                  variant="ghost"
                  size="sm"
                  icon={<IconEyeOff size="sm" />}
                  aria-label={`Hide ${one.name}`}
                  aria-pressed={one.hidden === true}
                  onClick={() => onHide(agent.id, one.id, one.hidden !== true)}
                />
              </li>
            ))}
        </ul>
      ) : entries.length === 0 ? (
        <p id={`${id}-list`} className={cn(QUIET, 'h-picker-list')}>
          No model matches “{query.trim()}”
        </p>
      ) : (
        <div
          id={`${id}-list`}
          role="listbox"
          aria-label={`Models of ${agent.name}`}
          // Walked from the search, never focused by the keyboard: reachable by the hand that scrolls.
          tabIndex={-1}
          className={LIST}
        >
          {entries.map((entry, index) => {
            const first = entries[index - 1]?.group !== entry.group
            const selected = entry.model === null ? value === null : mine?.model === entry.model.id
            return (
              <div key={entry.key} className="contents">
                {first && entry.group !== 'default' && (
                  <span className={GROUP_LABEL} aria-hidden="true">
                    {entry.group === 'favourites' ? 'Favourites' : 'Models'}
                  </span>
                )}
                <div
                  id={optionId(entry)}
                  role="option"
                  aria-selected={selected}
                  data-active={index === current}
                  className={OPTION}
                  onPointerMove={() => setActive(index)}
                  onClick={() => pick(entry)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {entry.model === null ? (
                      <>
                        Use the default
                        {fallback !== undefined && (
                          <span className="text-muted-foreground">
                            {' · '}
                            {choiceWords([agent], { agent: fallback.agent, model: fallback.model })}
                          </span>
                        )}
                      </>
                    ) : (
                      entry.model.name
                    )}
                  </span>
                  {entry.model?.favourite === true && (
                    <IconStar
                      size="sm"
                      weight="filled"
                      aria-hidden="true"
                      className="text-muted-foreground"
                    />
                  )}
                  <span
                    className={cn('flex size-icon-sm', !selected && 'invisible')}
                    aria-hidden="true"
                  >
                    <IconCheck size="sm" />
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex min-h-control-md items-end gap-2 border-t border-border pt-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {mine !== null && efforts.length > 0 && model !== undefined && (
            <RadioRow
              label="Effort"
              items={[
                { value: 'default', label: 'Default' },
                ...efforts.map((effort) => ({ value: effort, label: effort })),
              ]}
              value={mine.effort ?? 'default'}
              onChoose={(effort) =>
                onChange(
                  effort === 'default'
                    ? { agent: mine.agent, model: mine.model, mode: mine.mode }
                    : { agent: mine.agent, model: mine.model, effort, mode: mine.mode },
                )
              }
              render={(item) =>
                item.value === 'default' ? null : (
                  <span className="flex h-4 items-end">
                    <span
                      className={cn(
                        'w-1.5 rounded-full',
                        EFFORT_BARS[EFFORTS.indexOf(item.value)],
                        mine.effort !== undefined &&
                          EFFORTS.indexOf(item.value) <= EFFORTS.indexOf(mine.effort)
                          ? 'primary-fill'
                          : 'bg-border',
                      )}
                    />
                  </span>
                )
              }
            />
          )}
          {mine !== null && modes.length > 1 && (
            <RadioRow
              label="Mode"
              items={modes.map((mode) => ({ value: mode.id, label: mode.label }))}
              value={mine.mode ?? modes[0]?.id ?? ''}
              onChoose={(mode) =>
                onChange({
                  agent: mine.agent,
                  model: mine.model,
                  effort: mine.effort,
                  mode: mode === modes[0]?.id ? undefined : mode,
                })
              }
            />
          )}
        </div>
        <Tooltip label="Choose favourites and hidden models">
          <IconButton
            variant="ghost"
            size="sm"
            icon={<IconPencil size="sm" />}
            aria-label="Choose favourites and hidden models"
            aria-pressed={editing}
            onClick={() => onEditing(!editing)}
          />
        </Tooltip>
      </div>
    </div>
  )
}

export function ModelPicker({
  label,
  agents,
  value,
  fallback,
  judge = 'you',
  open,
  onOpenChange,
  onChange,
  onFavourite,
  onHide,
}: ModelPickerProps): ReactNode {
  const search = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState(value?.agent ?? fallback?.agent ?? agents[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const shown = value ?? fallback
  const words =
    value === null
      ? fallback === undefined
        ? 'Choose a model'
        : `Default (${choiceWords(agents, { agent: fallback.agent, model: fallback.model })})`
      : choiceWords(agents, value, judge)

  return (
    <Popover
      label={label}
      align="start"
      open={open}
      onOpenChange={onOpenChange}
      initialFocus={search}
      trigger={
        <Tooltip label={words}>
          <Button size="sm" aria-label={`${label}: ${words}`} className="max-w-full min-w-0">
            <span className={cn(TRIGGER_WORDS, value === null && 'text-muted-foreground')}>
              {shown === undefined
                ? 'Choose a model'
                : choiceWords(agents, { agent: shown.agent, model: shown.model })}
            </span>
            {value !== null && <Marks agents={agents} choice={value} judge={judge} />}
            <IconChevronDown size="sm" aria-hidden="true" />
          </Button>
        </Tooltip>
      }
    >
      <Tabs
        label="Agents"
        value={tab}
        onValueChange={setTab}
        items={agents.map((agent) => ({
          value: agent.id,
          label: agent.name,
          panel: agent.installed ? (
            <AgentPane
              agent={agent}
              value={value}
              fallback={fallback}
              query={query}
              onQuery={setQuery}
              editing={editing}
              onEditing={setEditing}
              search={search}
              onChange={onChange}
              onFavourite={onFavourite}
              onHide={onHide}
            />
          ) : (
            <div className={PANE}>
              <div className="flex h-picker-list flex-col items-start gap-2 px-2 py-3 text-sm">
                <span className="text-muted-foreground">Not installed</span>
                <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs break-all">
                  {agent.install}
                </code>
              </div>
            </div>
          ),
        }))}
      />
    </Popover>
  )
}
