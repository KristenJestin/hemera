import { StartField, type StartResultView } from '@hemera/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { Link } from './link.ts'
import {
  EMPTY_FOLD,
  createFromTicket,
  createOf,
  foldStart,
  searchPending,
  type Search,
  startAndOpen,
  viewsOf,
} from './start-results.ts'

export interface StartFieldPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  projectName: string
  onOpenMission: (key: string) => void
}

const newChoice = (): string => crypto.randomUUID()

/**
 * The Project page's field that starts a mission: the text typed searches (each keystroke
 * interrupts the search before it), and a choice creates under its own key and opens the mission
 * at once: the Planner's answer stands on the mission's page.
 */
export function StartFieldPart({
  link,
  engineReady,
  projectId,
  projectName,
  onOpenMission,
}: StartFieldPartProps): ReactNode {
  const [text, setText] = useState('')
  const [search, setSearch] = useState<Search | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const choice = useRef<string | null>(null)
  const choiceKey = (): string => (choice.current ??= newChoice())
  const typed = text.trim()

  useEffect(() => {
    if (!engineReady || typed === '') return undefined
    let stopped = false
    return (() => {
      const unsubscribe = link.searchStart(
        projectId,
        typed,
        (result) => {
          if (stopped) return
          setSearch((before) => ({
            for: typed,
            fold: foldStart(before?.for === typed ? before.fold : EMPTY_FOLD, result),
            done: false,
            ended: null,
          }))
        },
        (failure) => {
          if (stopped) return
          setSearch((before) => ({
            for: typed,
            fold: before?.for === typed ? before.fold : EMPTY_FOLD,
            done: false,
            ended: `The search stopped: ${failure.message}`,
          }))
        },
        () => {
          if (stopped) return
          setSearch((before) => ({
            for: typed,
            fold: before?.for === typed ? before.fold : EMPTY_FOLD,
            done: true,
            ended: before?.for === typed ? before.ended : null,
          }))
        },
      )
      return () => {
        stopped = true
        unsubscribe()
      }
    })()
  }, [link, engineReady, projectId, typed])

  const fold = search?.for === typed ? search.fold : EMPTY_FOLD
  const views = viewsOf(fold)
  const results: readonly StartResultView[] | 'searching' =
    search?.for === typed && (views.length > 0 || search.ended !== null || search.done)
      ? views
      : 'searching'
  const notice = refused ?? (search?.for === typed ? (search.ended ?? fold.notice) : null)

  const create = (made: Parameters<Link['createStart']>[0]) => {
    setRefused(null)
    void startAndOpen(link, made, {
      opened: (key) => {
        setText('')
        choice.current = null
        onOpenMission(key)
      },
      refused: setRefused,
    })
  }

  const onOpen = (key: string) => {
    const hit = fold.tickets.find((found) => found.hit.key === key)?.hit
    if (hit === undefined) onOpenMission(key)
    else if (hit.linkedMission !== null) onOpenMission(hit.linkedMission)
    else create(createFromTicket(projectId, hit, choiceKey()))
  }

  return (
    <StartField
      projectName={projectName}
      text={text}
      onText={(next) => {
        setText(next)
        setRefused(null)
        choice.current = null
      }}
      results={results}
      searching={searchPending(search, typed)}
      notice={notice ?? undefined}
      onOpen={onOpen}
      onCreate={() => create(createOf(projectId, typed, fold, choiceKey()))}
    />
  )
}
