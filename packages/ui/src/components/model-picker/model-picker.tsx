import { Slider } from '@base-ui/react/slider'
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
import { AgentMark } from '../agent-mark/agent-mark.tsx'
import { Button, IconButton } from '../button/button.tsx'
import { Popover } from '../popover/popover.tsx'
import { Tabs } from '../tabs/tabs.tsx'
import { Tooltip } from '../tooltip/tooltip.tsx'

/**
 * The model picker: one popover, the same wherever a model is chosen — the app's settings, a
 * Project's, a mission's override, the check before a launch, the Chat's composer.
 *
 * - The trigger is the agent's mark and the model, then compact marks for what is not the
 *   default: a gauge for the effort, a shield when Hemera Auto judges permissions, a warning for
 *   a model the agent no longer offers. The words are the trigger's tooltip and its name.
 * - The agents are tabs drawn as their marks, their names in the tooltips. Only the agents this
 *   machine has are offered: one that is not installed is said in the app's settings, not here.
 * - The popover opens with the focus in the search. The models are a list the search filters,
 *   favourites first, hidden ones left out; Up and Down walk it, Enter picks. Beside it, the
 *   effort is a vertical scale — more at the top — that the arrows, the hand and a press on a
 *   level all set. It stays open and updates in place: the list keeps one height whatever it
 *   holds, so nothing moves while typing.
 * - The mode is not offered: Hemera sets it, since an agent left in a mode of its own (planning
 *   only, say) could no longer do what Hemera asks of it.
 * - Where a level inherits a model (a Project, a mission), "Use the default" heads the list.
 * - Favourites and hidden models are chosen in the list's edit mode.
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

/** An agent this machine has, and the models it offers. */
export interface PickerAgent {
  id: string
  name: string
  models: readonly PickerModel[]
}

export interface ModelChoice {
  agent: string
  model: string
  /** Left out: the model's own default. */
  effort?: Effort | undefined
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
  /** A trigger with no frame of its own, for a picker set inside another box: the composer. */
  bare?: boolean | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
  /** A new choice, or null for the default. */
  onChange: (choice: ModelChoice | null) => void
  onFavourite: (agent: string, model: string, favourite: boolean) => void
  onHide: (agent: string, model: string, hidden: boolean) => void
}

const MARKS = 'flex shrink-0 items-center gap-1.5 text-muted-foreground'
const PANE = 'flex w-picker gap-3'
const LIST =
  'flex h-picker-list flex-col gap-0.5 overflow-y-auto scrollbar-stable rounded-md outline-none'
const OPTION =
  'flex min-h-control-md min-w-0 items-center gap-2 rounded-md px-2 text-sm select-none hover-motion hover:tinted data-[active=true]:tinted'
const GROUP_LABEL = 'px-2 pt-2 pb-1 text-xs text-muted-foreground'
const QUIET = 'px-2 py-3 text-sm text-muted-foreground'
const EFFORT_COLUMN = 'flex w-20 shrink-0 flex-col gap-2 border-l border-border pl-3'
const LEVEL =
  'flex h-control-sm items-center rounded-md px-1.5 text-xs text-muted-foreground outline-none hover-motion hover:text-foreground data-[on=true]:font-medium data-[on=true]:text-foreground'

/** The words of a choice, as the trigger's name and tooltip say them. */
export function choiceWords(
  agents: readonly PickerAgent[],
  choice: ModelChoice,
  judge: Judge = 'you',
): string {
  const agent = agents.find((one) => one.id === choice.agent)
  const model = agent?.models.find((one) => one.id === choice.model)
  return [
    agent?.name ?? choice.agent,
    model?.name ?? choice.model,
    choice.effort === undefined ? null : `effort ${choice.effort}`,
    judge === 'auto' ? 'Hemera Auto judges permissions' : null,
    agent !== undefined && model === undefined ? `${agent.name} no longer offers this model` : null,
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
  const offered = agent === undefined || agent.models.some((one) => one.id === choice.model)
  return (
    <span className={MARKS} aria-hidden="true">
      {!offered && <IconAlertTriangle size="sm" className="text-warning" />}
      {choice.effort !== undefined && <EffortGauge effort={choice.effort} />}
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

const LEVEL_WORDS: Record<Effort | 'default', string> = {
  default: 'Default',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}

/**
 * The effort as a vertical scale: the model's levels, its own default at the foot, more effort
 * further up. One control — a slider the arrows walk, Up for more — and each level's word beside
 * its notch sets it under a press.
 */
function EffortScale({
  efforts,
  effort,
  onEffort,
}: {
  efforts: readonly Effort[]
  effort: Effort | undefined
  onEffort: (effort: Effort | undefined) => void
}): ReactNode {
  const levels: readonly (Effort | 'default')[] = ['default', ...efforts]
  const at = effort === undefined ? 0 : Math.max(0, levels.indexOf(effort))
  const choose = (index: number) => {
    const level = levels[index]
    onEffort(level === undefined || level === 'default' ? undefined : level)
  }
  return (
    <div className={EFFORT_COLUMN}>
      <span className="text-xs text-muted-foreground">Effort</span>
      <div className="flex min-h-0 flex-1 gap-2">
        <Slider.Root
          orientation="vertical"
          min={0}
          max={levels.length - 1}
          step={1}
          value={at}
          onValueChange={(value) => choose(value)}
          className="flex"
        >
          <Slider.Control className="flex h-full w-4 justify-center py-2.5">
            <Slider.Track className="relative w-1 rounded-full bg-border">
              <Slider.Indicator className="w-full rounded-full primary-fill" />
              <Slider.Thumb
                aria-label="Effort"
                getAriaValueText={(_, value) => LEVEL_WORDS[levels[value] ?? 'default']}
                className="size-3 rounded-full border border-primary-strong bg-card shadow-sm outline-none focus-ring"
              />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
        <div className="flex flex-col-reverse justify-between" aria-hidden="true">
          {levels.map((level, index) => (
            <button
              key={level}
              type="button"
              tabIndex={-1}
              data-on={index === at}
              className={LEVEL}
              onClick={() => choose(index)}
            >
              {LEVEL_WORDS[level]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

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
  agent: PickerAgent
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
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-1">
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

        {editing ? (
          <ul id={`${id}-list`} aria-label={`Models of ${agent.name}`} className={LIST}>
            {agent.models
              .filter((one) => matches(one.name, query))
              .map((one) => (
                <li key={one.id} className="flex min-h-control-md items-center gap-1 px-2">
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
            className={LIST}
          >
            {entries.map((entry, index) => {
              const first = entries[index - 1]?.group !== entry.group
              const selected =
                entry.model === null ? value === null : mine?.model === entry.model.id
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
                              {choiceWords([agent], {
                                agent: fallback.agent,
                                model: fallback.model,
                              })}
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
      </div>
      {mine !== null && efforts.length > 0 ? (
        <EffortScale
          efforts={efforts}
          effort={mine.effort}
          onEffort={(effort) => onChange({ agent: mine.agent, model: mine.model, effort })}
        />
      ) : (
        // The column keeps its room when the model takes no effort, so the list never widens.
        <div className={EFFORT_COLUMN} aria-hidden="true" />
      )}
    </div>
  )
}

export function ModelPicker({
  label,
  agents,
  value,
  fallback,
  judge = 'you',
  bare = false,
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
  const agentShown = agents.find((one) => one.id === shown?.agent)
  const words =
    value === null
      ? fallback === undefined
        ? 'Choose a model'
        : `Default (${choiceWords(agents, { agent: fallback.agent, model: fallback.model })})`
      : choiceWords(agents, value, judge)
  const modelName =
    shown === undefined
      ? 'Choose a model'
      : (agentShown?.models.find((one) => one.id === shown.model)?.name ?? shown.model)

  return (
    <Popover
      label={label}
      side={bare ? 'top' : 'bottom'}
      align="start"
      open={open}
      onOpenChange={onOpenChange}
      initialFocus={search}
      trigger={
        <Tooltip label={words}>
          <Button
            variant={bare ? 'ghost' : 'secondary'}
            size="sm"
            aria-label={`${label}: ${words}`}
            className="max-w-full min-w-0"
          >
            {agentShown !== undefined && (
              <AgentMark id={agentShown.id} name={agentShown.name} size="sm" />
            )}
            <span className={cn('min-w-0 truncate', value === null && 'text-muted-foreground')}>
              {modelName}
            </span>
            {value !== null && <Marks agents={agents} choice={value} judge={judge} />}
            <IconChevronDown size="sm" aria-hidden="true" />
          </Button>
        </Tooltip>
      }
    >
      {agents.length === 0 ? (
        <p className={cn(QUIET, 'w-picker')}>No agent installed</p>
      ) : (
        <Tabs
          label="Agents"
          iconsOnly
          value={tab}
          onValueChange={setTab}
          items={agents.map((agent) => ({
            value: agent.id,
            label: agent.name,
            icon: <AgentMark id={agent.id} name={agent.name} />,
            panel: (
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
            ),
          }))}
        />
      )}
    </Popover>
  )
}
