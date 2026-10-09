/**
 * The Spec settings of a Project, under its ticket providers (#104): where Specs live, the
 * language they are written in and the key prefix of the next missions. The sync interval is a
 * seam: its row is drawn only once something feeds it. No Effect here: the link's calls are
 * promises. A write answered after a later one is dropped; the key prefix is sent once the typing
 * settles, and the engine's refusal is shown under the field.
 */

import type { SpecMode } from '@hemera/core/domain'
import type { Project } from '@hemera/ipc'
import { SpecFields, type SpecModeChoice } from '@hemera/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { Link } from './link.ts'
import {
  OFFERED_MODES,
  PREFIX_SETTLES_MS,
  answerGate,
  prefixEditOf,
  prefixWords,
  settingWords,
} from './spec-settings-model.ts'

export interface SpecSettingsPartProps {
  link: Link
  engineReady: boolean
  projectId: string
  project: Project | null
}

/** What the section has read of the Spec settings, and what it is writing. */
interface Held {
  readonly mode: SpecMode | null
  readonly language: string | null
  /** The prefix as typed, until the engine has answered it. */
  readonly typed: string | null
  readonly prefixRefused: string | undefined
  readonly refused: string | undefined
}

const NOTHING: Held = {
  mode: null,
  language: null,
  typed: null,
  prefixRefused: undefined,
  refused: undefined,
}

/** The Spec settings of a Project (mode, language, key prefix; the sync interval is not fed yet). */
export function SpecSettingsPart({
  link,
  engineReady,
  projectId,
  project,
}: SpecSettingsPartProps): ReactNode {
  const [held, setHeld] = useState<Held>(NOTHING)
  const change = (part: Partial<Held>): void => setHeld((before) => ({ ...before, ...part }))
  // The Project as the section knows it: the newer of what it was given and what it last wrote.
  const [written, setWritten] = useState<Project | null>(null)
  const known = [project, written]
    .filter((one): one is Project => one !== null && one.id === projectId)
    .toSorted((a, b) => b.version - a.version)[0]
  const current = useRef<Project | undefined>(known)
  useEffect(() => {
    current.current = known
  }, [known])
  const gates = useRef({
    mode: answerGate(),
    language: answerGate(),
    prefix: answerGate(),
  })
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; prefix: string } | null>(null)

  useEffect(() => {
    setHeld(NOTHING)
    setWritten(null)
    const mine = { mode: answerGate(), language: answerGate(), prefix: answerGate() }
    gates.current = mine
    if (!engineReady) return undefined
    let live = true
    const stop = link.onTicketSettings(
      projectId,
      (settings) => {
        if (live) setHeld((before) => ({ ...before, mode: settings.specMode }))
      },
      (failure) => {
        if (live) setHeld((before) => ({ ...before, refused: settingWords('Spec mode', failure) }))
      },
    )
    link.specLanguage(projectId).then(
      (language) => {
        if (live) setHeld((before) => ({ ...before, language }))
      },
      (failure: Error) => {
        if (live) {
          setHeld((before) => ({ ...before, refused: settingWords('Spec language', failure) }))
        }
      },
    )
    return () => {
      live = false
      stop()
      mine.mode.close()
      mine.language.close()
      mine.prefix.close()
      // A prefix typed and not yet sent is sent as the section is left, not lost.
      const waiting = pending.current
      pending.current = null
      if (waiting !== null && current.current !== undefined) {
        clearTimeout(waiting.timer)
        link.setKeyPrefix(prefixEditOf(current.current, waiting.prefix)).catch(() => undefined)
      }
    }
  }, [link, engineReady, projectId])

  const chooseMode = (choice: SpecModeChoice): void => {
    if (choice === 'remote' || held.mode === null) return
    const before = held.mode
    const ticket = gates.current.mode.begin()
    const gate = gates.current.mode
    change({ mode: choice, refused: undefined })
    link.setSpecMode(projectId, choice).then(
      (mode) => {
        if (gate.isLatest(ticket)) change({ mode })
      },
      (failure: Error) => {
        if (gate.isLatest(ticket)) {
          change({ mode: before, refused: settingWords('Spec mode', failure) })
        }
      },
    )
  }

  const chooseLanguage = (tag: string): void => {
    const before = held.language
    const ticket = gates.current.language.begin()
    const gate = gates.current.language
    change({ language: tag, refused: undefined })
    link.setSpecLanguage(projectId, tag).then(
      (language) => {
        if (gate.isLatest(ticket)) change({ language })
      },
      (failure: Error) => {
        if (gate.isLatest(ticket)) {
          change({ language: before, refused: settingWords('Spec language', failure) })
        }
      },
    )
  }

  const writePrefix = (prefix: string): void => {
    pending.current = null
    const record = current.current
    if (record === undefined) return
    if (prefix.trim().toUpperCase() === record.keyPrefix) {
      change({ typed: null, prefixRefused: undefined })
      return
    }
    const gate = gates.current.prefix
    const ticket = gate.begin()
    link.setKeyPrefix(prefixEditOf(record, prefix)).then(
      (answer) => {
        if (!gate.isLatest(ticket)) return
        setWritten(answer)
        change({ typed: null, prefixRefused: undefined })
      },
      (failure: Error) => {
        if (gate.isLatest(ticket)) change({ prefixRefused: prefixWords(failure) })
      },
    )
  }

  const typePrefix = (prefix: string): void => {
    if (pending.current !== null) clearTimeout(pending.current.timer)
    gates.current.prefix.begin()
    change({ typed: prefix, prefixRefused: undefined })
    const timer = setTimeout(() => writePrefix(prefix), PREFIX_SETTLES_MS)
    pending.current = { timer, prefix }
  }

  return (
    <SpecFields
      mode={held.mode}
      modes={OFFERED_MODES}
      onMode={chooseMode}
      language={held.language}
      onLanguage={chooseLanguage}
      prefix={held.typed ?? known?.keyPrefix ?? null}
      prefixRefused={held.prefixRefused}
      onPrefix={typePrefix}
      sync={undefined}
      refused={held.refused}
    />
  )
}
