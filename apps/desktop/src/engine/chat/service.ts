/**
 * The Chats (#43): free conversations of the user with an agent about a Project, beside its
 * missions. Several per Project, each its own sessions of the `chat` role, owned by the Project,
 * in its main checkout, with every tool through the same gate as the missions and no grace delay.
 *
 * - **A message** is written into the transcript, then handed to the Chat's live session as the
 *   user's own words, with no marker. A Chat with no live session (its first message, a stop, a
 *   restart, a model changed) gets a fresh one on its lineage, which takes the end of the
 *   conversation first and what was queued for the lineage (an approval's result).
 * - **The transcript** holds the user's messages, the agent's (written at the end of each turn),
 *   each of its tool calls folded to one line with its outcome and, when held, the approval
 *   request, and Hemera's notices. Masked; permanent.
 * - **Stop** cancels the turn; the conversation stays.
 * - **The model** is the cascade's for the `chat` role when the Chat is made; a change applies
 *   from the next turn, on a fresh session.
 * - **After a restart**, a Chat whose turn was running says so, and nothing resumes on its own.
 */

import {
  CHAT_INTERRUPTED,
  type ChatMention,
  type ModelSettingValue,
  TOOLS,
  USER_MESSAGE,
  hemeraToolNamed,
  mentionsText,
  waitingText,
} from '@hemera/core/domain'
import type { UnknownChat, UnknownProject } from '@hemera/ipc'
import { Context, Effect, Layer, Option, Predicate, Schema, Semaphore, Stream } from 'effect'

import type { AgentEvent, ToolCallReport } from '../agents/client.ts'
import { AgentRuntime } from '../agents/runtime.ts'
import { DomainEvents } from '../domain-events.ts'
import { getProject } from '../projects.ts'
import type { Secrets } from '../secrets.ts'
import { resolvedSetting } from '../sessions/cascade.ts'
import type { DeliveryKindRefused } from '../sessions/deliveries.ts'
import { SessionPost } from '../sessions/post.ts'
import { type SessionRefused, Sessions } from '../sessions/service.ts'
import { type RoleSession, getSession, sessionsIn } from '../sessions/store.ts'
import type { Database, DatabaseError } from '../storage/database.ts'
import {
  type Chat,
  type ChatEntry,
  addEntry,
  chatOfLineage,
  getChat,
  insertChat,
  setChatLineage,
  setChatSetting,
} from './store.ts'
import { sessionBook } from './words.ts'

type ChatFailure = DatabaseError | UnknownChat

export class Chats extends Context.Service<
  Chats,
  {
    /** A new Chat of a Project, on the cascade's setting for the `chat` role. */
    readonly create: (projectId: string) => Effect.Effect<Chat, DatabaseError | UnknownProject>
    /** The user's message: written, then handed to the Chat's session. */
    readonly send: (
      chatId: string,
      text: string,
      mentions: ReadonlyArray<ChatMention>,
    ) => Effect.Effect<ChatEntry, ChatFailure | SessionRefused | DeliveryKindRefused>
    /** Cancels the agent's turn; the conversation stays. */
    readonly stop: (chatId: string) => Effect.Effect<void, ChatFailure>
    /** The Chat's own agent, model and effort, from its next turn. */
    readonly setSetting: (
      chatId: string,
      setting: ModelSettingValue,
    ) => Effect.Effect<void, ChatFailure>
  }
>()('Chats') {}

/** The states of a session still on its lineage. */
const LIVE = ['starting', 'working', 'idle', 'stuck'] as const

const HeldAnswer = Schema.Struct({ text: Schema.String })
const readHeld = Schema.decodeUnknownOption(HeldAnswer)

/**
 * The approval request a held call's answer names, or null: the gate's own answer, word for word
 * from its start, never a request a file or a command's output happens to name.
 */
const requestNamed = (call: typeof ToolCallReport.Type): number | null => {
  for (const piece of call.content) {
    const text = Option.match(readHeld(piece), { onNone: () => '', onSome: (one) => one.text })
    const number = Number(/^Waiting for the user's approval, request #(\d+)\./.exec(text)?.[1])
    if (Number.isInteger(number) && text.startsWith(waitingText(number))) return number
  }
  return null
}

/** What a call is about, gathered from its reports. */
type Called = Partial<Pick<typeof ToolCallReport.Type, 'title' | 'kind' | 'locations' | 'rawInput'>>

/** The fields of a call's report it gave a value. */
const withoutNulls = (call: typeof ToolCallReport.Type): Called => ({
  ...(call.title === null ? undefined : { title: call.title }),
  ...(call.kind === null ? undefined : { kind: call.kind }),
  ...(call.locations.length === 0 ? undefined : { locations: call.locations }),
  ...(call.rawInput === null ? undefined : { rawInput: call.rawInput }),
})

const Pointed = Schema.fromJsonString(
  Schema.Struct({
    path: Schema.optionalKey(Schema.String),
    line: Schema.optionalKey(Schema.String),
    pattern: Schema.optionalKey(Schema.String),
    title: Schema.optionalKey(Schema.String),
    mission: Schema.optionalKey(Schema.String),
  }),
)
const readPointed = Schema.decodeUnknownOption(Pointed)

/** What a call's arguments point at: a path, a command line, a pattern, a title, a mission. */
const pointedAt = (rawInput: string | null | undefined): string | null =>
  Option.match(readPointed(rawInput ?? ''), {
    onNone: () => null,
    onSome: (args) => args.path ?? args.line ?? args.pattern ?? args.title ?? args.mission ?? null,
  })

/** A folded action's one line: the tool, and what it was about. */
const actionLine = (call: Called) => {
  const named = hemeraToolNamed(call.title ?? '')
  const about = call.locations?.[0]?.path ?? pointedAt(call.rawInput)
  const said = named === null ? (call.title ?? 'a tool call') : TOOLS[named].label.label
  return {
    tool: named ?? call.title ?? call.kind ?? 'tool',
    text: [said, about].filter(Predicate.isNotNull).join(' · '),
  }
}

/** How long after a turn's end the last of its words may still come. */
const WORDS_SETTLE = '250 millis'

type Needs = Database | DomainEvents | Secrets | Sessions | AgentRuntime | SessionPost

export const chatsLayer = Layer.effect(
  Chats,
  Effect.gen(function* () {
    const context = yield* Effect.context<Needs>()
    const run = <A, E>(effect: Effect.Effect<A, E, Needs>) => Effect.provide(effect, context)
    const sessions = yield* Sessions
    const runtime = yield* AgentRuntime
    const post = yield* SessionPost
    const scope = yield* Effect.scope
    /** What is kept about each session while it runs: its Chat, its words, its turns. */
    const book = sessionBook()
    /** What each call in progress is about, by its id, as its first report said it. */
    const calls = new Map<string, Called>()
    /** One message or setting change at a time per Chat: two at once never open two sessions. */
    const chatLocks = new Map<string, Semaphore.Semaphore>()
    const oneAtATime = (chatId: string) => {
      const found = chatLocks.get(chatId) ?? Semaphore.makeUnsafe(1)
      chatLocks.set(chatId, found)
      return Semaphore.withPermits(found, 1)
    }

    const chatOf = (sessionId: string) =>
      Effect.gen(function* () {
        const known = book.chatOf(sessionId)
        if (known !== undefined) return known
        const session = yield* getSession(sessionId).pipe(Effect.orElseSucceed(() => null))
        const chat =
          session === null || session.role !== 'chat' ? null : yield* chatOfLineage(session.lineage)
        const id = chat?.id ?? null
        book.knowChat(sessionId, id)
        return id
      })

    /** What the agent said and is not written yet, written as one line of the transcript. */
    const flush = (sessionId: string, chatId: string) =>
      Effect.gen(function* () {
        const text = book.take(sessionId)
        if (text !== '') yield* addEntry(chatId, { kind: 'agent', text })
      })

    const heard = (sessionId: string, event: AgentEvent) =>
      Effect.gen(function* () {
        if (Predicate.isTagged(event, 'MessageChunk') && !event.replay) {
          book.hear(sessionId, event.text)
          return
        }
        if (!Predicate.isTagged(event, 'ToolCall') || event.replay) return
        const chatId = yield* chatOf(sessionId)
        if (chatId === null) return
        // An update of a call names only what changed: what it is about is kept from its start.
        const call = { ...calls.get(event.call.id), ...withoutNulls(event.call) }
        calls.set(event.call.id, call)
        const status = event.call.status
        if (status !== 'completed' && status !== 'failed') return
        calls.delete(event.call.id)
        yield* flush(sessionId, chatId)
        const request = requestNamed(event.call)
        const line = actionLine(call)
        yield* addEntry(chatId, {
          kind: 'action',
          text: line.text,
          tool: line.tool,
          outcome: request === null ? status : 'held',
          request,
        })
      }).pipe(
        run,
        Effect.catchCause(() => Effect.void),
      )

    yield* runtime.activity.pipe(
      Stream.runForEach((one) => heard(one.sessionId, one.event)),
      Effect.forkIn(scope),
    )
    /**
     * The agent's words are written when its turn ends, and the few its report brings a moment
     * after the end; a turn that begins first takes what is left of the one before.
     */
    const turned = (sessionId: string, on: boolean) =>
      Effect.gen(function* () {
        const chatId = yield* chatOf(sessionId)
        if (chatId === null) return
        yield* flush(sessionId, chatId)
        if (on) {
          book.turnBegan(sessionId)
          return
        }
        const number = book.turnOf(sessionId)
        yield* Effect.sleep(WORDS_SETTLE).pipe(
          Effect.andThen(
            Effect.suspend(() =>
              book.turnOf(sessionId) === number ? flush(sessionId, chatId) : Effect.void,
            ),
          ),
          run,
          Effect.catchCause(() => Effect.void),
          Effect.forkIn(scope),
        )
      }).pipe(
        run,
        Effect.catchCause(() => Effect.void),
      )

    yield* post.turns.pipe(
      Stream.runForEach((turn) => turned(turn.sessionId, turn.on)),
      Effect.forkIn(scope),
    )

    /** A session that ended: what it said last is written, then nothing of it is kept. */
    const ended = (sessionId: string) =>
      Effect.gen(function* () {
        const chatId = book.chatOf(sessionId)
        if (Predicate.isString(chatId)) yield* flush(sessionId, chatId)
        book.forget(sessionId)
      }).pipe(
        run,
        Effect.catchCause(() => Effect.sync(() => book.forget(sessionId))),
      )

    const committed = yield* DomainEvents.use((events) => events.subscribe)
    yield* committed.pipe(
      Stream.runForEach((event) =>
        event.type === 'session.stopped' ? ended(event.entityId) : Effect.void,
      ),
      Effect.forkIn(scope),
    )

    /** The session a Chat's lineage runs on now, and the last one it ran on. */
    const sessionsOf = (chat: Chat) =>
      Effect.gen(function* () {
        if (chat.lineage === null) return { live: null, last: null }
        const all = (yield* sessionsIn(
          ['starting', 'working', 'idle', 'stuck', 'ended', 'failed', 'replaced'],
          {
            kind: 'project',
            projectId: chat.projectId,
          },
        )).filter((one) => one.lineage === chat.lineage)
        const last = all.toSorted((a, b) => b.epoch - a.epoch)[0] ?? null
        const live = last !== null && LIVE.some((state) => state === last.state) ? last : null
        return { live, last }
      })

    const sameSetting = (session: RoleSession, setting: ModelSettingValue) =>
      session.provider === setting.agent &&
      session.chosen.model === setting.model &&
      session.chosen.effort === setting.effort

    /**
     * The Chat's live session on its setting: the one running, or a fresh one on its lineage,
     * whose brief holds the end of the conversation when it follows an earlier one.
     */
    const liveSession = (chat: Chat) =>
      Effect.gen(function* () {
        const { live } = yield* sessionsOf(chat)
        if (live !== null && sameSetting(live, chat.setting)) return live
        const project = yield* getProject(chat.projectId).pipe(Effect.orDie)
        const asked = {
          owner: { kind: 'project' as const, projectId: chat.projectId },
          role: 'chat',
          provider: chat.setting.agent,
          chosen: { model: chat.setting.model, effort: chat.setting.effort, mode: null },
          folder: project.mainCheckout,
        }
        if (chat.lineage !== null) {
          // Under the Sessions' lock: what still lives or starts on the lineage ends first, even
          // a successor a replacement opened since it was read here.
          return yield* sessions.reopen(chat.lineage, asked, 'the Chat’s model changed')
        }
        const opened = yield* sessions.open(asked)
        yield* setChatLineage(chat.id, opened.lineage)
        return opened
      })

    return {
      create: (projectId) =>
        Effect.gen(function* () {
          yield* getProject(projectId)
          const setting = yield* resolvedSetting({ kind: 'project', projectId }, 'chat')
          return yield* insertChat(projectId, {
            agent: setting.agent,
            model: setting.model,
            effort: setting.effort,
          })
        }).pipe(run),
      send: (chatId, text, mentions) =>
        Effect.gen(function* () {
          const chat = yield* getChat(chatId)
          const body = [text.trim(), mentionsText(mentions)]
            .filter((part) => part !== '')
            .join('\n\n')
          // What the agent said last is written before the message that answers it, and before a
          // fresh session's brief reads the conversation.
          const { live } = yield* sessionsOf(chat)
          if (live !== null) yield* flush(live.id, chatId)
          const session = yield* liveSession(chat)
          const entry = yield* addEntry(chatId, { kind: 'user', text: body })
          yield* sessions.deliver({
            owner: { kind: 'project', projectId: chat.projectId },
            target: { lineage: session.lineage },
            kind: USER_MESSAGE,
            body,
          })
          return entry
        }).pipe(oneAtATime(chatId), run),
      stop: (chatId) =>
        Effect.gen(function* () {
          const chat = yield* getChat(chatId)
          if (chat.lineage !== null) yield* sessions.cancelTurn(chat.lineage)
        }).pipe(run),
      setSetting: (chatId, setting) =>
        setChatSetting(chatId, setting).pipe(oneAtATime(chatId), run),
    }
  }),
)

/**
 * At the start, before the sessions a stopped engine left are rebuilt: a Chat whose turn was
 * running says so in its transcript. Nothing resumes on its own.
 */
export const markInterruptedChats = Effect.gen(function* () {
  const working = yield* sessionsIn(['working'])
  for (const session of working.filter((one) => one.role === 'chat')) {
    const chat = yield* chatOfLineage(session.lineage)
    if (chat !== null) yield* addEntry(chat.id, { kind: 'notice', text: CHAT_INTERRUPTED })
  }
})
