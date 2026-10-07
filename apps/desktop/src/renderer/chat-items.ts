/**
 * A Chat's transcript as its page draws it (#52), plain values and no React: the user's messages
 * and the agent's, each action folded under the answer that follows it, a held call as its own
 * item, and Hemera's lines (a turn stopped, a restart, a mission drafted, anything else in words).
 * A turn that ended with actions and no words is a silent turn.
 */

import {
  CHAT_INTERRUPTED,
  CHAT_STOPPED,
  type AgentProvider,
  type ChatMention,
  type ModelSettingValue,
  draftOf,
} from '@hemera/core/domain'
import type { AgentState, ChatLine, ModelMark } from '@hemera/ipc'
import type {
  ChatAction,
  ChatActionKind,
  ChatItem,
  Mentionable,
  ModelChoice,
  PickerAgent,
} from '@hemera/ui'

/** How each tool reads in a folded action: a file tool that writes is an edit, any other a read. */
const kindOf = (tool: string | null): ChatActionKind => {
  if (tool === 'fs_write' || tool === 'fs_edit') return 'edit'
  if (tool === 'commands_run') return 'run'
  if (tool === 'search') return 'search'
  return 'read'
}

/** An action's line is its tool's label, then what it was about: the label folds the latter. */
const actionOf = (line: ChatLine): ChatAction => {
  const about = line.text.split(' · ').slice(1).join(' · ')
  return {
    id: `l${String(line.sequence)}`,
    kind: kindOf(line.tool),
    label: about === '' ? line.text : about,
    failed: line.outcome === 'failed' ? true : undefined,
  }
}

const noticeOf = (line: ChatLine): ChatItem => {
  const id = `l${String(line.sequence)}`
  if (line.text === CHAT_STOPPED) return { kind: 'line', id, tone: 'stopped' }
  if (line.text === CHAT_INTERRUPTED) return { kind: 'line', id, tone: 'restarted' }
  const drafted = draftOf(line.text)
  if (drafted !== null) {
    return { kind: 'created', id, missionKey: drafted.key, title: drafted.title }
  }
  return { kind: 'line', id, tone: 'error', text: line.text }
}

/** The items of a transcript, oldest first; `working` while the agent's turn still runs. */
export function chatItemsOf(lines: ReadonlyArray<ChatLine>, working: boolean): ChatItem[] {
  const items: ChatItem[] = []
  let pending: ChatAction[] = []
  /** The actions of a turn that ended with no words. */
  const silent = (sequence: number): void => {
    if (pending.length === 0) return
    items.push({ kind: 'line', id: `s${String(sequence)}`, tone: 'silent' })
    pending = []
  }
  for (const line of lines) {
    const id = `l${String(line.sequence)}`
    if (line.kind === 'user') {
      silent(line.sequence)
      items.push({ kind: 'message', id, from: 'you', text: line.text })
    } else if (line.kind === 'agent') {
      items.push({
        kind: 'message',
        id,
        from: 'agent',
        text: line.text,
        actions: pending.length === 0 ? undefined : pending,
      })
      pending = []
    } else if (line.kind === 'action' && line.held !== null) {
      items.push({
        kind: 'held',
        id: line.held.needId,
        command: line.held.command,
        reason: line.held.reason,
        answer: line.held.answer,
      })
    } else if (line.kind === 'action') {
      pending = [...pending, actionOf(line)]
    } else {
      items.push(noticeOf(line))
    }
  }
  if (!working) silent((lines.at(-1)?.sequence ?? 0) + 1)
  return items
}

/** What may follow a mention's label: a space or the end, after any closing punctuation. */
const MENTION_END = /^[.,;:!?)\]}'"’]*(?:\s|$)/

/**
 * Where a mention starts in a text: `@` and its label, at the start of a word and at its end
 * (`@ACME-12` is no mention of `ACME-1`, nor `@test:e2e` of `test`); -1 if nowhere.
 */
const mentionAt = (text: string, label: string): number => {
  const written = `@${label}`
  for (let from = 0; ;) {
    const at = text.indexOf(written, from)
    if (at < 0) return at
    const starts = at === 0 || /\s|\(/.test(text.charAt(at - 1))
    if (starts && MENTION_END.test(text.slice(at + written.length))) return at
    from = at + 1
  }
}

/**
 * The mentions a message carries, in the order it names them, each once: what the field wrote as
 * `@` and the label of something it offered. A command is named by its id, the rest by label.
 */
export function mentionsIn(
  text: string,
  mentionables: ReadonlyArray<Mentionable>,
): ReadonlyArray<ChatMention> {
  return mentionables
    .map((one) => ({ one, at: mentionAt(text, one.label) }))
    .filter(({ at }) => at >= 0)
    .toSorted((a, b) => a.at - b.at)
    .map(({ one }) => ({ kind: one.kind, ref: one.kind === 'command' ? one.id : one.label }))
}

/** The picker's name for an agent's own default model: no model named, the agent chooses. */
export const OWN_DEFAULT = 'default'

/**
 * The agents a model picker offers: the installed ones, each with its own default first, then the
 * models the user marked and the one the setting is on. No agent says which models it offers
 * without starting it, so nothing else is listed; one not signed in is there, unavailable, with
 * why.
 */
export function pickerAgentsOf(
  agents: ReadonlyArray<Pick<AgentState, 'id' | 'label' | 'installed' | 'signedIn'>>,
  marks: ReadonlyArray<ModelMark>,
  setting: ModelSettingValue,
): PickerAgent[] {
  return agents
    .filter((agent) => agent.installed)
    .map((agent) => {
      const marked = marks.filter((mark) => mark.agent === agent.id)
      const own = setting.agent === agent.id && setting.model !== null ? [setting.model] : []
      const models = [...new Set([...marked.map((mark) => mark.model), ...own])]
      return {
        id: agent.id,
        name: agent.label,
        models: [
          { id: OWN_DEFAULT, name: 'Its default model' },
          ...models.map((model) => {
            const mark = marked.find((one) => one.model === model)
            return { id: model, name: model, favourite: mark?.favourite, hidden: mark?.hidden }
          }),
        ],
        unavailable: agent.signedIn ? undefined : `${agent.label} is not signed in`,
      }
    })
}

/** The setting a choice of the picker is: its own default is no model named. */
export const settingOfChoice = (agent: AgentProvider, choice: ModelChoice): ModelSettingValue => ({
  agent,
  model: choice.model === OWN_DEFAULT ? null : choice.model,
  effort: choice.effort ?? null,
})
