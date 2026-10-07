/**
 * The Chats as the database keeps them (#43): one row each, with its title, its own agent, model
 * and effort, and the lineage its sessions run on; and its transcript, one masked line per
 * message, folded action or notice, in order. Each write is a transaction with its `chat.changed`
 * event, which the window's stream of changes follows.
 */

import {
  AGENT_PROVIDERS,
  CHAT_ENTRY_KINDS,
  type ChatEntryKind,
  type ModelSettingValue,
  UNTITLED_CHAT,
  chatTitleOf,
} from '@hemera/core/domain'
import { UnknownChat } from '@hemera/ipc'
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm'
import { Effect, Predicate, Stream } from 'effect'

import { DomainEvents } from '../domain-events.ts'
import type { NewEvent } from '../journal.ts'
import { Secrets } from '../secrets.ts'
import { Database, type EngineTransaction, refusedWhile } from '../storage/database.ts'
import { chatEntries, chats, permissionRequests } from '../storage/schema.ts'
import { mutate } from '../transaction.ts'

export interface Chat {
  readonly id: string
  readonly projectId: string
  readonly title: string
  readonly setting: ModelSettingValue
  /** The lineage its sessions run on; null before its first message. */
  readonly lineage: string | null
  readonly createdAt: string
  readonly lastActivityAt: string
}

/** A held call as its card shows it: what it asks, why, the need it answers, and the answer. */
export interface HeldCall {
  readonly needId: string
  readonly command: string
  readonly reason: string
  readonly answer: 'waiting' | 'allowed' | 'denied'
}

export interface ChatEntry {
  readonly sequence: number
  readonly kind: ChatEntryKind
  readonly text: string
  readonly tool: string | null
  readonly outcome: string | null
  readonly request: number | null
  /** For an action held for the user: its request, as it stands now. */
  readonly held: HeldCall | null
  readonly at: string
}

type ChatRow = typeof chats.$inferSelect

const chatOf = (row: ChatRow): Chat => ({
  id: row.id,
  projectId: row.projectId,
  title: row.title,
  setting: {
    agent: AGENT_PROVIDERS.find((one) => one === row.agent) ?? 'claude',
    model: row.model,
    effort: row.effort,
  },
  lineage: row.lineage,
  createdAt: row.createdAt,
  lastActivityAt: row.lastActivityAt,
})

const entryOf = (
  row: typeof chatEntries.$inferSelect,
  held: HeldCall | null = null,
): ChatEntry => ({
  sequence: row.sequence,
  kind: CHAT_ENTRY_KINDS.find((one) => one === row.kind) ?? 'notice',
  text: row.text,
  tool: row.tool,
  outcome: row.outcome,
  request: row.request,
  held,
  at: row.at,
})

const now = (): string => new Date().toISOString()

/** A Chat's change, for the stream the window follows. */
const changed = (chat: Pick<Chat, 'id' | 'projectId'>): NewEvent => ({
  type: 'chat.changed',
  entityKind: 'chat',
  entityId: chat.id,
  source: 'system',
  author: 'hemera',
  payload: { projectId: chat.projectId },
})

const chatRow = (transaction: EngineTransaction, id: string) =>
  Effect.gen(function* () {
    const [row] = yield* transaction
      .select()
      .from(chats)
      .where(eq(chats.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a Chat')))
    if (row === undefined) return yield* new UnknownChat({ id })
    return row
  })

export const getChat = (id: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(chats)
      .where(eq(chats.id, id))
      .pipe(Effect.mapError(refusedWhile('reading a Chat')))
    if (row === undefined) return yield* new UnknownChat({ id })
    return chatOf(row)
  })

/** The Chat a lineage of sessions belongs to, or null. */
export const chatOfLineage = (lineage: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const [row] = yield* database
      .select()
      .from(chats)
      .where(eq(chats.lineage, lineage))
      .pipe(Effect.mapError(refusedWhile('reading a Chat')))
    return row === undefined ? null : chatOf(row)
  })

/** A Project's Chats, the most recently active first. */
export const chatsOf = (projectId: string) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(chats)
      .where(eq(chats.projectId, projectId))
      .orderBy(desc(chats.lastActivityAt), desc(chats.createdAt))
      .pipe(Effect.mapError(refusedWhile('reading the Chats')))
    return rows.map(chatOf)
  })

/** A new Chat of a Project, on the setting it is given. */
export const insertChat = (projectId: string, setting: ModelSettingValue) =>
  mutate('creating a Chat', (transaction) =>
    Effect.gen(function* () {
      const at = now()
      const [row] = yield* transaction
        .insert(chats)
        .values({
          id: crypto.randomUUID(),
          projectId,
          title: UNTITLED_CHAT,
          renamed: false,
          ...setting,
          lineage: null,
          createdAt: at,
          lastActivityAt: at,
        })
        .returning()
        .pipe(Effect.mapError(refusedWhile('creating a Chat')))
      if (row === undefined) return yield* Effect.die(new Error('the Chat was not written'))
      const chat = chatOf(row)
      return { result: chat, events: [changed(chat)] }
    }),
  )

/** Renames a Chat: its first message no longer names it. */
export const renameChat = (id: string, title: string) =>
  mutate('renaming a Chat', (transaction) =>
    Effect.gen(function* () {
      const row = yield* chatRow(transaction, id)
      yield* transaction
        .update(chats)
        .set({ title: chatTitleOf(title), renamed: true })
        .where(eq(chats.id, id))
        .pipe(Effect.mapError(refusedWhile('renaming a Chat')))
      return { result: undefined, events: [changed(chatOf(row))] }
    }),
  )

/** A Chat's own agent, model and effort, from its next turn. */
export const setChatSetting = (id: string, setting: ModelSettingValue) =>
  mutate('changing a Chat’s model', (transaction) =>
    Effect.gen(function* () {
      const row = yield* chatRow(transaction, id)
      yield* transaction
        .update(chats)
        .set(setting)
        .where(eq(chats.id, id))
        .pipe(Effect.mapError(refusedWhile('changing a Chat’s model')))
      return { result: undefined, events: [changed(chatOf(row))] }
    }),
  )

/** The lineage a Chat's sessions run on, once its first one opened. */
export const setChatLineage = (id: string, lineage: string) =>
  mutate('writing a Chat’s lineage', (transaction) =>
    transaction
      .update(chats)
      .set({ lineage })
      .where(eq(chats.id, id))
      .pipe(
        Effect.mapError(refusedWhile('writing a Chat’s lineage')),
        Effect.as({ result: undefined, events: [] }),
      ),
  )

export interface EntryAsked {
  readonly kind: ChatEntryKind
  readonly text: string
  readonly tool?: string | undefined
  readonly outcome?: string | undefined
  readonly request?: number | null | undefined
}

/**
 * Adds a line to a Chat's transcript, masked, and marks the Chat active. The user's first message
 * names a Chat the user has not renamed.
 */
export const addEntry = (chatId: string, entry: EntryAsked) =>
  Effect.gen(function* () {
    const secrets = yield* Secrets
    return yield* mutate('writing a Chat’s transcript', (transaction) =>
      Effect.gen(function* () {
        const row = yield* chatRow(transaction, chatId)
        const at = now()
        const [written] = yield* transaction
          .insert(chatEntries)
          .values({
            chatId,
            kind: entry.kind,
            text: secrets.mask(entry.text),
            tool: entry.tool ?? null,
            outcome: entry.outcome ?? null,
            request: entry.request ?? null,
            at,
          })
          .returning()
          .pipe(Effect.mapError(refusedWhile('writing a Chat’s transcript')))
        const named = entry.kind === 'user' && !row.renamed && row.title === UNTITLED_CHAT
        yield* transaction
          .update(chats)
          .set({
            lastActivityAt: at,
            title: named ? chatTitleOf(secrets.mask(entry.text)) : row.title,
          })
          .where(eq(chats.id, chatId))
          .pipe(Effect.mapError(refusedWhile('writing a Chat’s transcript')))
        if (written === undefined) return yield* Effect.die(new Error('the line was not written'))
        return { result: entryOf(written), events: [changed(chatOf(row))] }
      }),
    )
  })

/** How many lines one page of a transcript holds. */
export const TRANSCRIPT_PAGE = 100

/** A page of a Chat's transcript, oldest first, before a line (the newest page without one). */
export const transcriptOf = (chatId: string, before: number | null) =>
  Effect.gen(function* () {
    const chat = yield* getChat(chatId)
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(chatEntries)
      .where(
        and(
          eq(chatEntries.chatId, chatId),
          before === null ? undefined : lt(chatEntries.sequence, before),
        ),
      )
      .orderBy(desc(chatEntries.sequence))
      .limit(TRANSCRIPT_PAGE)
      .pipe(Effect.mapError(refusedWhile('reading a Chat’s transcript')))
    const numbers = rows.flatMap((row) => (row.request === null ? [] : [row.request]))
    const requests =
      numbers.length === 0
        ? []
        : yield* database
            .select()
            .from(permissionRequests)
            .where(
              and(
                eq(permissionRequests.ownerKind, 'project'),
                eq(permissionRequests.ownerId, chat.projectId),
                inArray(permissionRequests.number, numbers),
              ),
            )
            .pipe(Effect.mapError(refusedWhile('reading a Chat’s requests')))
    const heldOf = (number: number | null): HeldCall | null => {
      const request = requests.find((one) => one.number === number)
      if (request === undefined) return null
      const answer =
        request.state === 'pending'
          ? 'waiting'
          : request.choice === null || request.choice === 'deny'
            ? 'denied'
            : 'allowed'
      return {
        needId: request.needId,
        command: request.described,
        reason: request.agentReason,
        answer,
      }
    }
    const lines = rows.toReversed().map((row) => entryOf(row, heldOf(row.request)))
    return {
      entries: lines,
      before: rows.length === TRANSCRIPT_PAGE ? (lines[0]?.sequence ?? null) : null,
    }
  })

/** The last `exchanges` exchanges of a Chat, oldest first: from the user's message that opens each. */
export const transcriptTail = (chatId: string, exchanges: number) =>
  Effect.gen(function* () {
    const database = yield* Database
    const rows = yield* database
      .select()
      .from(chatEntries)
      .where(eq(chatEntries.chatId, chatId))
      .orderBy(asc(chatEntries.sequence))
      .pipe(Effect.mapError(refusedWhile('reading a Chat’s transcript')))
    const starts = rows.flatMap((row, at) => (row.kind === 'user' ? [at] : []))
    const from = starts.length > exchanges ? (starts.at(-exchanges) ?? 0) : 0
    return rows.slice(from).map((row) => entryOf(row))
  })

/** Each change of a Chat, as committed: its title, its model, a line of its transcript. */
export const chatChanges = Stream.unwrap(
  Effect.map(
    DomainEvents.use((events) => events.subscribe),
    (committed) =>
      committed.pipe(
        Stream.filter((event) => event.entityKind === 'chat'),
        Stream.map((event) => ({
          chatId: event.entityId,
          projectId: Predicate.isString(event.payload.projectId) ? event.payload.projectId : '',
        })),
      ),
  ),
)
