import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useState } from 'react'

import { type ChatItem, ChatThread } from '../../blocks/chat/chat-thread.tsx'
import { Button, IconButton } from '../../components/button/button.tsx'
import { Dialog } from '../../components/dialog/dialog.tsx'
import { Empty } from '../../components/empty/empty.tsx'
import { Input } from '../../components/field/field.tsx'
import { type Mentionable, MentionField } from '../../components/mention-field/mention-field.tsx'
import {
  type Judge,
  type ModelChoice,
  ModelPicker,
  type PickerAgent,
} from '../../components/model-picker/model-picker.tsx'
import { type Identity, ProjectMark } from '../../components/project-mark/project-mark.tsx'
import { Tooltip } from '../../components/tooltip/tooltip.tsx'
import { IconArrowUp, IconLock, IconMessages, IconPencil, IconPlayerStop } from '../../icons.ts'
import { collapse, expand, fold, useTransition } from '../../motion.ts'

/**
 * A Chat: a conversation with an agent about a Project, outside any mission.
 *
 * - The header: the Chat's title and its rename, then what it talks about — the Project, its
 *   main checkout. A mission is drafted by the agent when asked to, never by a button here.
 * - The thread scrolls between a header and a composer that stay where they are.
 * - The composer is the mention field, with the Chat's model picker at the start of its foot and
 *   Send at its end, once something is written; while a turn runs, Stop.
 * - A call the agent wants to make waits in a card over the composer: the command, the agent's
 *   reason, Allow once or Deny — a Chat has no mission to allow it for. Answered, the card goes
 *   and its line in the thread says how.
 */

export type ChatTurn = 'idle' | 'working'

export interface ChatPageProps {
  title: string
  project: { name: string; identity?: Identity | undefined }
  /** The Project's main checkout, where the Chat's agent works. */
  checkout: string
  agents: readonly PickerAgent[]
  model: ModelChoice | null
  /** What the Chat inherits from the Project, when it has no model of its own. */
  fallback?: ModelChoice | undefined
  judge?: Judge | undefined
  items: readonly ChatItem[]
  turn: ChatTurn
  mentionables: readonly Mentionable[]
  draft: string
  onDraft: (draft: string) => void
  onSend: () => void
  onStop: () => void
  onModel: (choice: ModelChoice | null) => void
  onFavourite: (agent: string, model: string, favourite: boolean) => void
  onHide: (agent: string, model: string, hidden: boolean) => void
  /** The answer to a held call. */
  onAnswer: (id: string, answer: 'allow' | 'deny') => void
  onOpenMission: (missionKey: string) => void
  onRename: (title: string) => void
  onRetry: () => void
}

/**
 * The header and the dock keep the room of the thread's scrollbar, as the thread does, so the
 * three stand on one column whether the thread scrolls or not.
 */
const STILL = 'shrink-0 overflow-hidden scrollbar-stable'
const HEADER = 'mx-auto flex w-full max-w-measure flex-col gap-1 px-8 pt-6 pb-3'
const TITLE_LINE = 'flex min-h-control-md min-w-0 items-center gap-2'
const TITLE = 'min-w-0 truncate text-2xl font-semibold tracking-tight'
const ABOUT = 'flex min-w-0 items-center gap-2 text-sm text-muted-foreground'
const DOCK = 'mx-auto flex w-full max-w-measure flex-col gap-3 px-8 pb-6'
const CARD =
  'flex flex-col gap-3 overflow-hidden rounded-lg border border-border bg-card p-4 text-sm'

function Rename({ title, onRename }: { title: string; onRename: (title: string) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(title)
  const save = () => {
    if (name.trim() === '') return
    onRename(name.trim())
    setOpen(false)
  }
  return (
    <>
      <Tooltip label="Rename this Chat">
        <IconButton
          variant="ghost"
          size="sm"
          icon={<IconPencil size="sm" />}
          aria-label="Rename this Chat"
          onClick={() => {
            setName(title)
            setOpen(true)
          }}
        />
      </Tooltip>
      <Dialog
        title="Rename this Chat"
        open={open}
        onOpenChange={setOpen}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </>
        }
      >
        <Input
          label="Name"
          value={name}
          onValueChange={setName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
        />
      </Dialog>
    </>
  )
}

function HeldCard({
  item,
  agent,
  onAnswer,
}: {
  item: Extract<ChatItem, { kind: 'held' }>
  agent: string
  onAnswer: (id: string, answer: 'allow' | 'deny') => void
}): ReactNode {
  const folding = useTransition(fold)
  const label = `${agent} asks to run a command`
  return (
    <motion.section
      aria-label={label}
      className={CARD}
      initial={collapse}
      animate={expand}
      exit={collapse}
      transition={folding}
    >
      <p className="flex items-center gap-2 font-medium">
        <IconLock size="sm" aria-hidden="true" className="text-warning" />
        {label}
      </p>
      <pre className="rounded-md bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
        {item.command}
      </pre>
      <p className="max-w-measure text-muted-foreground">{item.reason}</p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={() => onAnswer(item.id, 'allow')}>
          Allow once
        </Button>
        <Button size="sm" onClick={() => onAnswer(item.id, 'deny')}>
          Deny
        </Button>
      </div>
    </motion.section>
  )
}

export function ChatPage({
  title,
  project,
  checkout,
  agents,
  model,
  fallback,
  judge,
  items,
  turn,
  mentionables,
  draft,
  onDraft,
  onSend,
  onStop,
  onModel,
  onFavourite,
  onHide,
  onAnswer,
  onOpenMission,
  onRename,
  onRetry,
}: ChatPageProps): ReactNode {
  const chosen = model ?? fallback
  const agent = agents.find((one) => one.id === chosen?.agent)?.name ?? 'The agent'
  const held = items.find(
    (item): item is Extract<ChatItem, { kind: 'held' }> =>
      item.kind === 'held' && item.answer === 'waiting',
  )
  const working = turn === 'working'
  const send = () => {
    if (draft.trim() !== '' && !working) onSend()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={STILL}>
        <header className={HEADER}>
          <div className={TITLE_LINE}>
            <h1 className={TITLE}>{title}</h1>
            <Rename title={title} onRename={onRename} />
          </div>
          <div className={ABOUT}>
            <ProjectMark name={project.name} identity={project.identity} />
            <span className="min-w-0 shrink truncate text-foreground">{project.name}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">Chat</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 shrink truncate font-mono text-xs">{checkout}</span>
          </div>
        </header>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-stable">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Empty icon={<IconMessages />} title={`Ask anything about ${project.name}`} />
          </div>
        ) : (
          <ChatThread
            items={items}
            agent={agent}
            working={working}
            onOpenMission={onOpenMission}
            onRetry={onRetry}
          />
        )}
      </div>

      <div className={STILL}>
        <div className={DOCK}>
          <AnimatePresence initial={false}>
            {held !== undefined && (
              <HeldCard key={held.id} item={held} agent={agent} onAnswer={onAnswer} />
            )}
          </AnimatePresence>
          <MentionField
            label="Message"
            placeholder="Ask anything… @ a file, a mission, a command"
            value={draft}
            onValueChange={onDraft}
            mentionables={mentionables}
            onSubmit={send}
            leading={
              <ModelPicker
                label="Model of this Chat"
                bare
                agents={agents}
                value={model}
                fallback={fallback}
                judge={judge}
                onChange={onModel}
                onFavourite={onFavourite}
                onHide={onHide}
              />
            }
            autoFocus={items.length === 0}
            trailing={
              working ? (
                <Button size="sm" onClick={onStop}>
                  <IconPlayerStop size="sm" aria-hidden="true" />
                  Stop
                </Button>
              ) : draft.trim() === '' ? null : (
                <Tooltip label="Send" keys="Enter">
                  <IconButton
                    variant="primary"
                    size="sm"
                    icon={<IconArrowUp size="sm" />}
                    aria-label="Send"
                    onClick={send}
                  />
                </Tooltip>
              )
            }
          />
        </div>
      </div>
    </div>
  )
}
