/**
 * The Chat's page and its rows in the sidebar (#52), over the link: the page follows its Chat
 * (summary and transcript) and the Project's missions and commands for the mentions; it sends,
 * stops, answers a held call, renames and changes the model through the engine. No Effect here:
 * the link's calls are promises.
 */

import type { AgentState, Command, Mission, ModelMark, Project } from '@hemera/ipc'
import {
  ChatPage,
  EFFORTS,
  ErrorState,
  SidebarChatRow,
  type ChatItem,
  type Mentionable,
  type ModelChoice,
} from '@hemera/ui'
import { type ReactNode, useEffect, useState } from 'react'

import { chatActions, flight, markedAs, startChat } from './chat-actions.ts'
import {
  OWN_DEFAULT,
  chatItemsOf,
  mentionsIn,
  pickerAgentsOf,
  settingOfChoice,
} from './chat-items.ts'
import type { Link } from './link.ts'
import { useChat, useChats } from './use-chats.ts'

interface ProjectChatsProps {
  link: Link
  engineReady: boolean
  projectId: string
  /** The Chat the page shows, when it is one of this Project's. */
  current: string | null
  onOpen: (chatId: string) => void
}

/** A Project's Chats under it in the sidebar, then the row that starts a new one. */
export function ProjectChats({
  link,
  engineReady,
  projectId,
  current,
  onOpen,
}: ProjectChatsProps): ReactNode {
  const state = useChats(link, engineReady, projectId)
  const chats = state.kind === 'ready' ? state.chats : []
  const [creating, setCreating] = useState(false)
  const [newChat] = useState(() => flight(setCreating))
  /** Why the last Chat could not be started, in words, under "New Chat". */
  const [refused, setRefused] = useState<string | null>(null)
  return (
    <>
      {chats.map((chat) => (
        <SidebarChatRow
          key={chat.id}
          id={chat.id}
          title={chat.title}
          current={chat.id === current}
          onPress={() => onOpen(chat.id)}
        />
      ))}
      <SidebarChatRow
        id={`new:${projectId}`}
        title="New Chat"
        pending={creating}
        error={refused ?? undefined}
        onPress={() => startChat(link, projectId, newChat, onOpen, setRefused)}
      />
    </>
  )
}

/** What the mention field offers: the Project's missions by key, its commands by name. */
const mentionablesOf = (
  missions: ReadonlyArray<Mission>,
  commands: ReadonlyArray<Command>,
): Mentionable[] => [
  ...missions.map((mission) => ({
    kind: 'mission' as const,
    id: mission.key,
    label: mission.key,
    detail: mission.title,
  })),
  ...commands.map((command) => ({
    kind: 'command' as const,
    id: command.id,
    label: command.name,
    detail: command.line,
  })),
]

/** What the page reads besides its Chat: once per Project, the marks again once one changes. */
interface Around {
  readonly mentionables: Mentionable[]
  readonly agents: ReadonlyArray<AgentState>
  readonly marks: ReadonlyArray<ModelMark>
}

const NOTHING_AROUND: Around = { mentionables: [], agents: [], marks: [] }

/** What the page reads besides its Chat, and a way to read the models' marks again. */
function useAround(link: Link, engineReady: boolean, projectId: string): [Around, () => void] {
  const [around, setAround] = useState<Around>(NOTHING_AROUND)
  const [marksRead, setMarksRead] = useState(0)
  useEffect(() => {
    if (!engineReady) return undefined
    let stopped = false
    const settled = <A,>(asked: Promise<ReadonlyArray<A>>) => asked.catch(() => [])
    void Promise.all([
      settled(link.missions(projectId)),
      settled(link.catalogue(projectId)),
      settled(link.agents()),
    ]).then(([missions, commands, agents]) => {
      if (!stopped) {
        setAround((before) => ({
          ...before,
          mentionables: mentionablesOf(missions, commands),
          agents,
        }))
      }
    })
    return () => {
      stopped = true
    }
  }, [link, engineReady, projectId])
  useEffect(() => {
    if (!engineReady) return undefined
    let stopped = false
    link.modelMarks().then(
      (marks) => {
        if (!stopped) setAround((before) => ({ ...before, marks }))
      },
      () => undefined,
    )
    return () => {
      stopped = true
    }
  }, [link, engineReady, marksRead])
  return [around, () => setMarksRead((before) => before + 1)]
}

interface ChatRouteProps {
  link: Link
  engineReady: boolean
  project: Project
  chatId: string
  onOpenMission: (missionKey: string) => void
}

/** A Chat's page: the conversation, the composer, the held call's card. */
export function ChatRoute({
  link,
  engineReady,
  project,
  chatId,
  onOpenMission,
}: ChatRouteProps): ReactNode {
  const [state, retry] = useChat(link, engineReady, project.id, chatId)
  const [around, remarked] = useAround(link, engineReady, project.id)
  const [draft, setDraft] = useState('')
  /** What the page could not do last, in words; said at the end of the thread. */
  const [refused, setRefused] = useState<string | null>(null)
  const [sending] = useState(() => flight())
  if (state.kind === 'failed') {
    return (
      <ErrorState title="This Chat cannot be shown" description={state.sentence} onRetry={retry} />
    )
  }
  const chat = state.kind === 'ready' ? state.chat : null
  const working = chat?.working ?? false
  const lines = state.kind === 'ready' ? state.lines : []
  const items: ChatItem[] = [
    ...chatItemsOf(lines, working),
    ...(refused === null
      ? []
      : [{ kind: 'line' as const, id: 'refused', tone: 'error' as const, text: refused }]),
  ]
  const setting = chat?.setting ?? { agent: 'claude' as const, model: null, effort: null }
  const model: ModelChoice = {
    agent: setting.agent,
    model: setting.model ?? OWN_DEFAULT,
    effort: EFFORTS.find((effort) => effort === setting.effort),
  }
  const actions = chatActions({
    link,
    chatId,
    sending,
    say: setRefused,
    reread: retry,
    remarked,
  })
  const send = (): void => {
    const text = draft.trim()
    if (text === '') return
    // The draft goes with the message, so Send goes with it until the engine answers; a message
    // refused comes back to the draft, unless something new was written meanwhile.
    const sent = actions.send(text, mentionsIn(text, around.mentionables), (back) =>
      setDraft((now) => (now === '' ? back : now)),
    )
    if (sent) setDraft('')
  }
  return (
    <ChatPage
      title={chat?.title ?? ''}
      project={{ name: project.name }}
      checkout={project.mainCheckout}
      agents={pickerAgentsOf(around.agents, around.marks, setting)}
      model={model}
      items={items}
      turn={working ? 'working' : 'idle'}
      mentionables={around.mentionables}
      draft={draft}
      onDraft={setDraft}
      onSend={send}
      onStop={actions.stop}
      onModel={(choice) => {
        // The picker offers the agents it was given: one it names is one of them.
        const agent = around.agents.find((one) => one.id === choice?.agent)?.id
        if (choice === null || agent === undefined) return
        actions.setModel(settingOfChoice(agent, choice))
      }}
      onFavourite={(agentId, name, favourite) => {
        const agent = around.agents.find((one) => one.id === agentId)?.id
        if (agent !== undefined) actions.mark(markedAs(around.marks, agent, name, { favourite }))
      }}
      onHide={(agentId, name, hidden) => {
        const agent = around.agents.find((one) => one.id === agentId)?.id
        if (agent !== undefined) actions.mark(markedAs(around.marks, agent, name, { hidden }))
      }}
      onAnswer={actions.answer}
      onOpenMission={onOpenMission}
      onRename={actions.rename}
      onRetry={retry}
    />
  )
}
