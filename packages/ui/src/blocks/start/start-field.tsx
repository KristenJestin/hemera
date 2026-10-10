import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { type KeyboardEvent, type ReactNode, use, useRef } from 'react'

import { Button } from '../../components/button/button.tsx'
import { Input } from '../../components/field/field.tsx'
import { Frame } from '../../components/frame/frame.tsx'
import { Kbd } from '../../components/kbd/kbd.tsx'
import { Loading } from '../../components/loading/loading.tsx'
import { IconListCheck, IconPlus, IconSearch, IconWorld } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'
import { MissionField } from '../../surfaces/project/project-page.tsx'

/** What the field finds: a mission of the Project, a remote ticket, or the choice to create. */
export type StartResultView =
  | {
      kind: 'mission'
      key: string
      title: string
      done: boolean
      /** The one the text names: Enter opens it. */
      open: boolean
    }
  | {
      kind: 'ticket'
      key: string
      title: string
      /** The key of the mission already linked to the ticket, if one. */
      linkedMission: string | null
    }
  | { kind: 'create'; title: string; ticket: string | null }

/** What the Planner answered, once it has read what was typed. */
export type StartTriage =
  | { kind: 'reading' }
  | { kind: 'belongs'; key: string }
  | { kind: 'delivered'; key: string; proposed: boolean }
  | { kind: 'small' }

/** What the buttons under the field do: go to the mission, ask in a Chat, or keep going. */
export type StartTriageAction = 'open' | 'chat' | 'anyway'

export interface StartFieldProps {
  projectName: string
  text: string
  onText: (text: string) => void
  /** What was found, or `'searching'` before the first answer. */
  results: readonly StartResultView[] | 'searching'
  /** Whether the search goes on: Enter does not create until it has ended. */
  searching?: boolean | undefined
  /** Something the search said once, in words. */
  notice?: string | undefined
  triage?: StartTriage | undefined
  onOpen: (key: string) => void
  onCreate: () => void
  onTriageAction: (action: StartTriageAction) => void
}

const RESULTS = 'flex flex-col py-1'

const RESULT =
  'flex h-control-md w-full min-w-0 items-center gap-3 px-4 text-left text-sm outline-none hover:bg-muted focus-ring hover-motion'

const RESULT_KEY = 'shrink-0 font-mono text-xs text-muted-foreground'

const QUIET = 'shrink-0 text-xs text-muted-foreground'

const TRIAGE = 'flex min-w-0 flex-wrap items-center gap-3 px-1 text-sm'

function Anyway({ onPress }: { onPress: () => void }): ReactNode {
  return (
    <Button variant="ghost" size="sm" onClick={onPress}>
      Start a mission anyway
    </Button>
  )
}

function TriageLine({
  triage,
  onAction,
}: {
  triage: StartTriage
  onAction: (action: StartTriageAction) => void
}): ReactNode {
  switch (triage.kind) {
    case 'reading':
      return (
        <div className={TRIAGE} role="status">
          <Loading size="sm" label="Hemera reads it" />
          <span className="text-muted-foreground">Hemera reads it…</span>
        </div>
      )
    case 'belongs':
      return (
        <div className={TRIAGE} role="status">
          <span>This belongs to {triage.key}</span>
          <Button variant="secondary" size="sm" onClick={() => onAction('open')}>
            Add it to {triage.key}
          </Button>
          <Anyway onPress={() => onAction('anyway')} />
        </div>
      )
    case 'delivered':
      return (
        <div className={TRIAGE} role="status">
          <span>
            {triage.proposed
              ? `Delivered by ${triage.key}, not validated yet`
              : `Already delivered by ${triage.key}`}
          </span>
          <Button variant="secondary" size="sm" onClick={() => onAction('open')}>
            Open {triage.key}
          </Button>
          <Anyway onPress={() => onAction('anyway')} />
        </div>
      )
    case 'small':
      return (
        <div className={TRIAGE} role="status">
          <span>Too small for a mission</span>
          <Button variant="secondary" size="sm" onClick={() => onAction('chat')}>
            Ask in a Chat
          </Button>
          <Anyway onPress={() => onAction('anyway')} />
        </div>
      )
  }
}

function buttonsOf(list: HTMLElement | null): HTMLElement[] {
  return list === null ? [] : Array.from(list.querySelectorAll<HTMLElement>('button'))
}

/**
 * The field that starts a mission: it searches first and creates last. As it is typed, what it
 * finds unfolds under it and pushes the page down: the Project's missions, then tickets, linked or
 * remote, and "Create a mission" always last. Enter opens the result marked open, or creates only
 * when nothing else shows; the arrows move through the results. The Planner's answer stands
 * under the field.
 */
export function StartField({
  projectName,
  text,
  onText,
  results,
  searching = false,
  notice,
  triage,
  onOpen,
  onCreate,
  onTriageAction,
}: StartFieldProps): ReactNode {
  const folding = useTransition(fold)
  const page = use(MissionField)
  const own = useRef<HTMLInputElement>(null)
  const field = page ?? own
  const list = useRef<HTMLUListElement>(null)
  const typed = text.trim()
  const shown = results === 'searching' ? [] : results
  const others = shown.filter((result) => result.kind !== 'create')

  const enter = () => {
    const opens = shown.flatMap((result) =>
      result.kind === 'mission' && result.open ? [result.key] : [],
    )[0]
    if (opens !== undefined) onOpen(opens)
    else if (others.length === 0 && shown.length > 0 && !searching) onCreate()
  }

  const fromField = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && typed !== '') {
      event.preventDefault()
      enter()
    } else if (event.key === 'ArrowDown') {
      const first = buttonsOf(list.current)[0]
      if (first !== undefined) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  const fromList = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const choices = buttonsOf(list.current)
    const at = choices.findIndex((choice) => choice === document.activeElement)
    event.preventDefault()
    if (event.key === 'ArrowDown') choices[Math.min(at + 1, choices.length - 1)]?.focus()
    else if (at <= 0) field.current?.focus()
    else choices[at - 1]?.focus()
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        label={`Start a mission in ${projectName}`}
        icon={<IconSearch size="sm" />}
        placeholder="A ticket, an idea…"
        value={text}
        onValueChange={onText}
        onKeyDown={fromField}
        trailing={<Kbd keys="Ctrl+K" />}
        inputRef={field}
      />
      <AnimatePresence initial={false}>
        {typed !== '' && (
          <motion.div
            key="results"
            className="overflow-hidden"
            initial={collapse}
            animate={expand}
            exit={collapse}
            transition={folding}
          >
            <Frame>
              {results === 'searching' ? (
                <div className="flex items-center gap-3 px-4 py-3 text-sm" role="status">
                  <Loading size="sm" label="Searching" />
                  <span className="text-muted-foreground">Searching…</span>
                </div>
              ) : (
                // The arrows are the list's own: the buttons inside are real, Enter and Space press them.
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                <ul aria-label="Found" className={RESULTS} ref={list} onKeyDown={fromList}>
                  {shown.map((result, index) => (
                    <li
                      key={result.kind === 'create' ? 'create' : `${result.kind}:${result.key}`}
                      className={cn(
                        result.kind === 'create' && index > 0 && 'border-t border-border',
                      )}
                    >
                      {result.kind === 'create' ? (
                        <button type="button" className={RESULT} onClick={onCreate}>
                          <span aria-hidden="true" className="flex text-primary">
                            <IconPlus size="sm" />
                          </span>
                          <span className="min-w-0 flex-1 truncate">
                            Create a mission “{result.title}”
                          </span>
                          {result.ticket !== null && <span className={QUIET}>{result.ticket}</span>}
                          {others.length === 0 && <Kbd keys="Enter" />}
                        </button>
                      ) : (
                        <button type="button" className={RESULT} onClick={() => onOpen(result.key)}>
                          <span aria-hidden="true" className="flex text-muted-foreground">
                            {result.kind === 'mission' ? (
                              <IconListCheck size="sm" />
                            ) : (
                              <IconWorld size="sm" />
                            )}
                          </span>
                          <span className={RESULT_KEY}>{result.key}</span>
                          <span className="min-w-0 flex-1 truncate">{result.title}</span>
                          {result.kind === 'mission' && result.done && (
                            <span className={QUIET}>Done</span>
                          )}
                          {result.kind === 'ticket' && result.linkedMission !== null && (
                            <span className={QUIET}>{result.linkedMission}</span>
                          )}
                          {result.kind === 'mission' && result.open && <Kbd keys="Enter" />}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {notice !== undefined && (
                <p
                  className="border-t border-border px-4 py-2 text-xs text-muted-foreground"
                  role="status"
                >
                  {notice}
                </p>
              )}
            </Frame>
          </motion.div>
        )}
      </AnimatePresence>
      {triage !== undefined && <TriageLine triage={triage} onAction={onTriageAction} />}
    </div>
  )
}
