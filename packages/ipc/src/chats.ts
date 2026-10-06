/**
 * The Chats of a Project, as a window reads and leads them (#43): list, create, rename, send a
 * message with its mentions, stop the agent's turn, change the Chat's model, read the transcript
 * page by page, and follow every change. The page is #52.
 */

import { ChatEntryKind, ChatMention, ModelSettingValue } from '@hemera/core/domain'
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

import { EngineGone } from './gone.ts'
import { StorageFailed } from './profile.ts'
import { UnknownProject } from './projects.ts'

export const ChatSummary = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  /** The first line of the user's first message, until the user renames it. */
  title: Schema.String,
  setting: ModelSettingValue,
  createdAt: Schema.String,
  lastActivityAt: Schema.String,
})
export type ChatSummary = typeof ChatSummary.Type

/** A line of a transcript: a message, a folded action, or Hemera's notice. Masked. */
export const ChatLine = Schema.Struct({
  sequence: Schema.Number,
  kind: ChatEntryKind,
  text: Schema.String,
  /** For an action: the tool, how it ended (`completed`, `failed`, `held`), its request if held. */
  tool: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(Schema.String),
  request: Schema.NullOr(Schema.Number),
  at: Schema.String,
})
export type ChatLine = typeof ChatLine.Type

/** A page of a transcript, oldest first, and where the older page starts; null at the first. */
export const ChatPage = Schema.Struct({
  entries: Schema.Array(ChatLine),
  before: Schema.NullOr(Schema.Number),
})
export type ChatPage = typeof ChatPage.Type

/** Something changed in a Chat: its title, its model, its transcript. */
export const ChatChanged = Schema.Struct({ chatId: Schema.String, projectId: Schema.String })
export type ChatChanged = typeof ChatChanged.Type

export class UnknownChat extends Schema.TaggedError<UnknownChat>()('UnknownChat', {
  id: Schema.String,
}) {
  override get message(): string {
    return 'This Chat no longer exists.'
  }
}

/** A message the Chat could not hand to its agent, in words. */
export class ChatRefused extends Schema.TaggedError<ChatRefused>()('ChatRefused', {
  reason: Schema.String,
}) {
  override get message(): string {
    return `This message was not sent: ${this.reason}.`
  }
}

const failing = Schema.Union([StorageFailed, EngineGone])
const failingProject = Schema.Union([StorageFailed, EngineGone, UnknownProject])
const failingChat = Schema.Union([StorageFailed, EngineGone, UnknownChat])

export const ChatsRpcs = RpcGroup.make(
  Rpc.make('chats.list', {
    payload: { projectId: Schema.String },
    success: Schema.Array(ChatSummary),
    error: failingProject,
  }),
  Rpc.make('chats.create', {
    payload: { projectId: Schema.String },
    success: ChatSummary,
    error: failingProject,
  }),
  Rpc.make('chats.rename', {
    payload: { chatId: Schema.String, title: Schema.String.check(Schema.isNonEmpty()) },
    success: Schema.Void,
    error: failingChat,
  }),
  /** The user's message, with the mentions of its field: handed to the Chat's agent as it is. */
  Rpc.make('chats.send', {
    payload: {
      chatId: Schema.String,
      text: Schema.String.check(Schema.isNonEmpty()),
      mentions: Schema.Array(ChatMention),
    },
    success: ChatLine,
    error: Schema.Union([StorageFailed, EngineGone, UnknownChat, ChatRefused]),
  }),
  /** Stops the agent's current turn; the conversation stays. */
  Rpc.make('chats.stop', {
    payload: { chatId: Schema.String },
    success: Schema.Void,
    error: failingChat,
  }),
  /** The Chat's own agent, model and effort, from its next turn. */
  Rpc.make('chats.setModel', {
    payload: { chatId: Schema.String, setting: ModelSettingValue },
    success: Schema.Void,
    error: failingChat,
  }),
  Rpc.make('chats.transcript', {
    payload: { chatId: Schema.String, before: Schema.NullOr(Schema.Number) },
    success: ChatPage,
    error: failingChat,
  }),
  Rpc.make('chats.changes', { success: ChatChanged, error: failing, stream: true }),
)
