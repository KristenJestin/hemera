import { useState } from 'react'
import type { ReactNode } from 'react'

import type { AgentProvider, ConfigOption } from '@hemera/ipc'
import {
  ActivityFrame,
  AgentSelector,
  Composer,
  EmptyProject,
  Greeting,
  SessionsFrame,
  type HomeSession,
  type JournalLine,
  type OfferedAgent,
} from '@hemera/ui'

import { controlsOf } from '../agent-controls.tsx'

/**
 * The Home of the active Project (design D4-07, D4b-02, D5-17).
 *
 * The page is the assembly: the greeting, the composer, the last Sessions of the Project, the
 * last entries of the Journal. None of that is a component, because none of it is drawn anywhere
 * else.
 *
 * What is written and what is attached live here for as long as the page does. Sending is the
 * caller's: from here a message makes a Session, and a Session is made with the agent it will run
 * — so the agent is chosen before the first word is written, and what it offers is chosen with
 * it. Nothing is written before there is somebody to answer: the action stays off until an agent
 * is picked, and says so where the box is.
 *
 * The choices are held here rather than asked of the engine: there is no Session yet to ask, and
 * what the user picked is a decision about the Session being made — the caller starts it with
 * that agent and hands the choices to it as it starts.
 */
const PAGE = 'mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10'

/** How many entries the Activity frame carries, which the prototype settled at four. */
const ACTIVITY_ENTRIES = 4

export function HomePage({
  projectName,
  sessions,
  entries,
  agents,
  offeringOf,
  onChooseAgent,
  onOpenSession,
  onOpenAllSessions,
  onOpenJournal,
  onSearchFiles,
  onPickFiles,
  onSend,
}: {
  projectName: string
  /** The last Sessions of this Project, most recently written first. */
  sessions: HomeSession[]
  entries: JournalLine[]
  /** The agents this machine has, as the registry named them. */
  agents: readonly OfferedAgent<AgentProvider>[]
  /** What an agent offers this Project, or nothing while the engine is being told. */
  offeringOf: (provider: AgentProvider) => readonly ConfigOption[]
  /** Asks what an agent offers this Project, which is what starts it the first time. */
  onChooseAgent: (provider: AgentProvider) => void
  onOpenSession: (id: string) => void
  onOpenAllSessions: () => void
  onOpenJournal: () => void
  onSearchFiles: (query: string) => Promise<string[]>
  onPickFiles: () => Promise<string[]>
  /** Starts the Session with the chosen agent and these choices, and says what to write. */
  onSend: (
    text: string,
    agent: AgentProvider,
    choices: ReadonlyMap<string, string>,
  ) => Promise<string | null>
}): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [agent, setAgent] = useState<AgentProvider | null>(null)
  const [choices, setChoices] = useState<ReadonlyMap<string, string>>(new Map())
  const options = agent === null ? [] : offeringOf(agent)

  /**
   * Picks the agent the Session will run.
   *
   * What an agent offers is its own answer, and the choices made against one agent are not
   * choices about the next: picking another one clears them, and the engine is asked what the
   * new one offers — once, whatever is picked afterwards.
   */
  const choose = (provider: AgentProvider): void => {
    setAgent(provider)
    setChoices(new Map())
    onChooseAgent(provider)
  }

  /** Keeps one of the agent's own choices, to be handed over when the Session is made. */
  const pick = (optionId: string, chosen: string): void => {
    const next = new Map(choices)
    next.set(optionId, chosen)
    setChoices(next)
  }

  // The reason the first word cannot be written yet, and it is not a refusal: nothing was lost,
  // and nothing is waiting on an answer — the choice above the box is.
  const missing =
    agent !== null
      ? undefined
      : agents.some((one) => one.available)
        ? 'Choose an agent: a Session is made with the one it runs.'
        : 'No agent on this machine yet. The Settings name the one to install.'

  return (
    <div className={PAGE}>
      <Greeting
        projectName={projectName}
        note="Write freely. It becomes a Session the moment you send."
      />
      <Composer
        value={value}
        onValueChange={setValue}
        files={files}
        onFilesChange={setFiles}
        onSearchFiles={onSearchFiles}
        onPickFiles={onPickFiles}
        missing={missing}
        controls={
          <>
            <AgentSelector agents={agents} value={agent} onValueChange={choose} />
            {agent === null
              ? null
              : controlsOf(
                  agent,
                  options,
                  (option) => choices.get(option.id) ?? option.current ?? '',
                  pick,
                )}
          </>
        }
        onSend={async (text) =>
          agent === null ? (missing ?? '') : await onSend(text, agent, choices)
        }
      />
      {sessions.length === 0 ? (
        <EmptyProject projectName={projectName} onOpenJournal={onOpenJournal} />
      ) : (
        <SessionsFrame
          sessions={sessions}
          onOpenSession={onOpenSession}
          onOpenAll={onOpenAllSessions}
        />
      )}
      <ActivityFrame entries={entries.slice(0, ACTIVITY_ENTRIES)} onOpenJournal={onOpenJournal} />
    </div>
  )
}
