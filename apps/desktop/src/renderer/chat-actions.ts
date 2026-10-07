/**
 * What a Chat's page and its sidebar row ask the engine (#52), with no React: the page holds the
 * draft and what to say, these hold the calls. A message and a new Chat go once per press while
 * the last is on its way; whatever the engine refuses is said in words, never dropped.
 */

import { type ChatMention, type ModelSettingValue, PermissionAnswer } from '@hemera/core/domain'

import type { AgentProvider } from '@hemera/core/domain'
import type { ModelMark } from '@hemera/ipc'

import type { Link } from './link.ts'

/** A press that starts work the engine answers later: ignored while the last is on its way. */
export interface Flight {
  /** Starts `work` unless the last is still on its way; null when it did not. */
  readonly take: <A>(work: () => Promise<A>) => Promise<A> | null
}

/** One press at a time; `onBusy` hears when one starts and when it lands. */
export function flight(onBusy: (busy: boolean) => void = () => undefined): Flight {
  let flying = false
  return {
    take: (work) => {
      if (flying) return null
      flying = true
      onBusy(true)
      const done = work()
      const land = () => {
        flying = false
        onBusy(false)
      }
      done.then(land, land)
      return done
    },
  }
}

/** "New Chat": a Chat created, then opened; one per press while the last is on its way. */
export function startChat(
  link: Pick<Link, 'createChat'>,
  projectId: string,
  creating: Flight,
  opened: (chatId: string) => void,
  say: (sentence: string | null) => void,
): void {
  const started = creating.take(() => link.createChat(projectId))
  if (started === null) return
  say(null)
  started.then(
    (created) => opened(created.id),
    (failure: Error) => say(`The Chat could not be started: ${failure.message}`),
  )
}

/** What a call the engine refused leaves said, after what it was. */
const saidAs =
  (say: (sentence: string) => void, what: string) =>
  (failure: Error): void =>
    say(`${what}: ${failure.message}`)

export interface ChatWorld {
  readonly link: Pick<
    Link,
    'sendToChat' | 'stopChat' | 'setChatModel' | 'renameChat' | 'answerNeed' | 'markModel'
  >
  readonly chatId: string
  /** One message at a time. */
  readonly sending: Flight
  /** What the page could not do, in words; null once something new is tried. */
  readonly say: (sentence: string | null) => void
  /** The Chat read again. */
  readonly reread: () => void
  /** The models' marks read again. */
  readonly remarked: () => void
}

export interface ChatActions {
  /** Sends a message; false when one is still on its way. `back` takes a refused text back. */
  readonly send: (
    text: string,
    mentions: ReadonlyArray<ChatMention>,
    back: (text: string) => void,
  ) => boolean
  readonly stop: () => void
  readonly setModel: (setting: ModelSettingValue) => void
  readonly rename: (title: string) => void
  readonly answer: (needId: string, answer: 'allow' | 'deny') => void
  /** A model starred or hidden from the picker. */
  readonly mark: (mark: ModelMark) => void
}

/** A model's mark after a change from the picker: the change, over what it was marked before. */
export function markedAs(
  marks: ReadonlyArray<ModelMark>,
  agent: AgentProvider,
  model: string,
  change: { readonly favourite?: boolean; readonly hidden?: boolean },
): ModelMark {
  const before = marks.find((one) => one.agent === agent && one.model === model)
  return {
    agent,
    model,
    favourite: change.favourite ?? before?.favourite ?? false,
    hidden: change.hidden ?? before?.hidden ?? false,
  }
}

export function chatActions({
  link,
  chatId,
  sending,
  say,
  reread,
  remarked,
}: ChatWorld): ChatActions {
  return {
    send: (text, mentions, back) => {
      const sent = sending.take(() => link.sendToChat(chatId, text, mentions))
      if (sent === null) return false
      say(null)
      sent.then(
        () => undefined,
        (failure: Error) => {
          say(failure.message)
          back(text)
        },
      )
      return true
    },
    stop: () => {
      link.stopChat(chatId).catch(saidAs(say, 'The agent could not be stopped'))
    },
    setModel: (setting) => {
      link.setChatModel(chatId, setting).catch(saidAs(say, 'The model could not be changed'))
    },
    rename: (title) => {
      link.renameChat(chatId, title).catch(saidAs(say, 'The Chat could not be renamed'))
    },
    // Answered or not, the Chat is read again: its card shows the call as it stands.
    answer: (needId, answer) => {
      link
        .answerNeed({
          id: needId,
          key: `chat:${needId}`,
          answer: PermissionAnswer.make({ choice: answer === 'allow' ? 'allow-once' : 'deny' }),
        })
        .then(reread, (failure: Error) => {
          saidAs(say, 'Your answer could not be given')(failure)
          reread()
        })
    },
    mark: (mark) => {
      link.markModel(mark).then(remarked, saidAs(say, 'The model could not be marked'))
    },
  }
}
