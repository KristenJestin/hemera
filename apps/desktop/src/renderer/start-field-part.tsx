import {
  StartField,
  type StartResultView,
  type StartTriage,
  type StartTriageAction,
} from '@hemera/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { Link } from './link.ts'
import {
  EMPTY_FOLD,
  type StartFold,
  createFromTicket,
  createOf,
  foldStart,
  settleStart,
  triageOf,
  triageStep,
  viewsOf,
} from './start-results.ts'

export interface StartFieldPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  projectName: string
  onOpenMission: (key: string) => void
  onOpenChat: () => void
}

/** What the search for the text typed has said, and whether it ended. */
interface Search {
  for: string
  fold: StartFold
  ended: string | null
}

/** The mission just created, which the Planner has not answered yet. */
interface Created {
  id: string
  key: string
}

const newChoice = (): string => crypto.randomUUID()

/**
 * The Project page's field that starts a mission: the text typed searches (each keystroke
 * interrupts the search before it), a choice creates under its own key, and the Planner's answer
 * on the mission just created stands under the field.
 */
export function StartFieldPart({
  link,
  engineReady,
  projectId,
  projectName,
  onOpenMission,
  onOpenChat,
}: StartFieldPartProps): ReactNode {
  const [text, setText] = useState('')
  const [search, setSearch] = useState<Search | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  const [triage, setTriage] = useState<StartTriage | undefined>(undefined)
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
            ended: null,
          }))
        },
        (failure) => {
          if (stopped) return
          setSearch((before) => ({
            for: typed,
            fold: before?.for === typed ? before.fold : EMPTY_FOLD,
            ended: `The search stopped: ${failure.message}`,
          }))
        },
      )
      return () => {
        stopped = true
        unsubscribe()
      }
    })()
  }, [link, engineReady, projectId, typed])

  const createdId = created?.id ?? null
  useEffect(() => {
    if (created === null) return undefined
    let stopped = false
    const settled = (answer: StartTriage) => {
      if (!stopped) setTriage(answer)
    }
    const unsubscribe = link.onMissionChanges(
      (change) => {
        const settle = settleStart(change, created.id)
        if (stopped || settle === null) return
        if (settle.kind === 'answer') setTriage(settle.triage)
        else {
          setText('')
          setCreated(null)
          setTriage(undefined)
          choice.current = null
          onOpenMission(settle.key)
        }
      },
      () => undefined,
    )
    // An answer that came before the listening began.
    link.mission(created.id).then(
      (mission) => {
        const answer = triageOf(mission)
        if (answer !== undefined) settled(answer)
      },
      () => undefined,
    )
    return () => {
      stopped = true
      unsubscribe()
    }
    // Only a new mission restarts the listening.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [link, createdId])

  const fold = search?.for === typed ? search.fold : EMPTY_FOLD
  const views = viewsOf(fold)
  const results: readonly StartResultView[] | 'searching' =
    search?.for === typed && (views.length > 0 || search.ended !== null) ? views : 'searching'
  const notice = refused ?? (search?.for === typed ? (search.ended ?? fold.notice) : null)

  const create = (made: Parameters<Link['createStart']>[0]) => {
    setRefused(null)
    link.createStart(made).then(
      (mission) => {
        setCreated({ id: mission.id, key: mission.key })
        setTriage(triageOf(mission) ?? { kind: 'reading' })
      },
      (failure: Error) => setRefused(`The mission could not be started: ${failure.message}`),
    )
  }

  const onOpen = (key: string) => {
    const hit = fold.tickets.find((found) => found.hit.key === key)?.hit
    if (hit === undefined) onOpenMission(key)
    else if (hit.linkedMission !== null) onOpenMission(hit.linkedMission)
    else create(createFromTicket(projectId, hit, choiceKey()))
  }

  const onTriageAction = (action: StartTriageAction) => {
    const step = triageStep(action, triage, created)
    if (step === null) return
    if (step.kind === 'chat') onOpenChat()
    else if (step.kind === 'open') onOpenMission(step.key)
    else {
      // Kept, the mission goes on planning: its change opens it, as for any mission planned.
      setRefused(null)
      link
        .keepAfterTriage(step.missionId)
        .catch((failure: Error) => setRefused(`The mission could not be kept: ${failure.message}`))
    }
  }

  return (
    <StartField
      projectName={projectName}
      text={text}
      onText={(next) => {
        setText(next)
        setCreated(null)
        setTriage(undefined)
        setRefused(null)
        choice.current = null
      }}
      results={results}
      notice={notice ?? undefined}
      triage={triage}
      onOpen={onOpen}
      onCreate={() => create(createOf(projectId, typed, fold, choiceKey()))}
      onTriageAction={onTriageAction}
    />
  )
}
