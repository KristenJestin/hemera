import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import type { ComposerChoice } from '@hemera/ipc'
import {
  ActivityFrame,
  AgentModelMenu,
  Composer,
  EmptyProject,
  Greeting,
  SessionsFrame,
  type HomeSession,
  type JournalLine,
  type OfferedAgent,
} from '@hemera/ui'

import {
  effortDefaultOf,
  effortStage,
  modeStage,
  modelStage,
  openingAgentOf,
} from '../agent-options.ts'
import type { AgentOffering } from '../agent-store.ts'
import type { OfferedWorkspace } from '../sessions-store.ts'

/**
 * The Home of the active Project (design D4-07, D4b-02, D5-17, D17-11).
 *
 * The page is the assembly: the greeting, the composer, the last Sessions of the Project, the
 * last entries of the Journal. None of that is a component, because none of it is drawn anywhere
 * else.
 *
 * What is written and what is attached live here for as long as the page does. Sending is the
 * caller's: from here a message makes a Session, and a Session is made with the agent it will run
 * — so the agent is chosen before the first word is written, and what it offers is chosen with
 * it. Nothing is written before there is somebody to answer: the action stays off until an agent
 * is picked, and says so on the control that would send.
 *
 * The agent, its model and its effort are one menu asking one question at a time, and what the
 * agent is on is the agent's own answer: every choice is handed to the engine, which sets it on
 * the agent and answers with what it announces then — which is the only way the effort of a
 * reasoning model ever appears (D5-13). Nothing about those choices is remembered here and
 * nothing is handed over again when the Session starts: the engine keeps them for it.
 *
 * The Workspace the Session will work in is chosen here too, on the pill at the foot of the box
 * (D8-08): `main` unless another is picked, and handed to the Session when it is made.
 */
const PAGE = 'mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10'

/** How many entries the Activity frame carries, which the prototype settled at four. */
const ACTIVITY_ENTRIES = 4

/** Why the first word cannot be written yet, said on the control that would send it. */
const NO_AGENT = 'Choose an agent first'

export function HomePage({
  projectName,
  sessions,
  entries,
  agents,
  choice,
  offeringOf,
  onChooseAgent,
  onChooseOption,
  onOpenSession,
  onOpenAllSessions,
  onOpenJournal,
  onSearchFiles,
  onPickFiles,
  workspaces,
  onSend,
}: {
  projectName: string
  /** The last Sessions of this Project, most recently written first. */
  sessions: HomeSession[]
  entries: JournalLine[]
  /** The agents this machine has, as the registry named them. */
  agents: OfferedAgent[]
  /**
   * What this Project's composer was left on, as the data folder remembers it (design D5-17).
   *
   * The agent alone is read here: the model, the effort and the mode are the agent's own answer,
   * and the engine seeds the agent it starts from this same preference — so what the menu shows
   * under the agent is what the agent announces it is on, which is what was chosen last time.
   * Null while the preferences are still being read, and null for a Project nothing was ever
   * chosen in.
   */
  choice: ComposerChoice | null
  /** What an agent offers this Project: its options, its refusal, and whether it is answering. */
  offeringOf: (agent: string) => AgentOffering
  /** Asks what an agent offers this Project, which is what starts it the first time. */
  onChooseAgent: (agent: string) => void
  /** Sets one of that agent's own options, and takes back what it announces then. */
  onChooseOption: (agent: string, optionId: string, value: string) => void
  onOpenSession: (id: string) => void
  onOpenAllSessions: () => void
  onOpenJournal: () => void
  onSearchFiles: (query: string) => Promise<string[]>
  onPickFiles: () => Promise<string[]>
  /** The Project's Workspaces a Session may be made in: `ready`, `main` first (D8-08). */
  workspaces: readonly OfferedWorkspace[]
  /**
   * Starts the Session with the chosen agent in the chosen Workspace (null for `main`), and says
   * what to write in it.
   */
  onSend: (text: string, agent: string, workspaceId: string | null) => Promise<string | null>
}): ReactNode {
  const [value, setValue] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [agent, setAgent] = useState<string | null>(null)
  const [named, setNamed] = useState<string | null>(null)
  // The Workspace picked, by the name the pill shows; `main` until another is, and again if the
  // one picked stops being offered — cleaned up meanwhile.
  const workspace = workspaces.find((one) => one.name === named) ?? workspaces[0]
  const offering = agent === null ? null : offeringOf(agent)
  const options = offering?.options ?? []
  const model = modelStage(options)
  const effort = effortStage(options)
  const mode = modeStage(options)

  /**
   * Picks the agent the Session will run.
   *
   * What an agent offers is its own answer, and what was chosen against one agent is not a choice
   * about the next: the engine is asked what the new one offers, and the menu is drawn from that
   * answer alone.
   */
  const choose = (chosen: string): void => {
    setAgent(chosen)
    onChooseAgent(chosen)
  }

  /**
   * The agent this Project was left on, put back the moment the preference is there.
   *
   * Asked for as well as shown: what an agent offers is the engine's answer, and the composer of
   * a Project reopened on its agent has to have that answer to draw a model under it.
   */
  const opening = openingAgentOf(choice, agent)
  useEffect(() => {
    if (opening === null || opening === agent) return
    choose(opening)
  }, [opening])

  /** One of the agent's own options, moved on the agent this composer is being drawn from. */
  const pick = (optionId: string, chosen: string): void => {
    if (agent === null) return
    onChooseOption(agent, optionId, chosen)
  }

  // The reason the send is off, which is not a refusal while no agent is picked: nothing was
  // lost and nothing is waiting on an answer — the menu at the end of the box is.
  const reason = agent === null ? NO_AGENT : (offering?.refusal ?? undefined)

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
        sendDisabledReason={reason}
        // Until the list is read the composer offers its own `main`, which is what null sends.
        workspaces={workspaces.length === 0 ? undefined : [...workspaces]}
        workspace={workspace?.name}
        onWorkspaceChange={setNamed}
        agentMenu={
          <AgentModelMenu
            agents={agents}
            agent={agent}
            onAgentChange={choose}
            models={model?.choices ?? []}
            model={model?.current ?? null}
            onModelChange={(chosen) => {
              if (model !== null) pick(model.optionId, chosen)
            }}
            efforts={effort?.choices ?? []}
            effort={effort?.current ?? null}
            onEffortChange={(chosen) => {
              if (effort !== null) pick(effort.optionId, chosen)
            }}
            // The level the agent recommends, which the scale marks.
            effortDefault={effortDefaultOf(options)}
            // The mode is the fourth row of the same panel: one agent, one control, and a foot
            // that does not wrap when a model has a long name (D17-11, D17-14).
            modes={mode?.choices ?? []}
            mode={mode?.current ?? null}
            onModeChange={(chosen) => {
              if (mode !== null) pick(mode.optionId, chosen)
            }}
            loading={offering?.loading ?? false}
            refusal={offering?.refusal ?? null}
          />
        }
        // The Home is where a Spec is made from the question that starts a Session; a Session is
        // a conversation already under way and offers nothing of the sort (D4b-02).
        spec
        onSend={async (text) =>
          agent === null ? NO_AGENT : await onSend(text, agent, workspace?.id ?? null)
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
