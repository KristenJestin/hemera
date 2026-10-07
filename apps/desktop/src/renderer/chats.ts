/**
 * The Chats as the window follows them (#52): a Project's list for the sidebar, and one Chat for
 * its page — its summary (title, model, whether its agent is in a turn) and the newest page of its
 * transcript. A change names a Chat and its Project only, so each follower reads again on the
 * changes that are its own; an answer to an earlier read is dropped. Plain functions over the
 * link; the hooks that hold their state are in `use-chats.ts`.
 */

import type { ChatChanged, ChatLine, ChatSummary } from '@hemera/ipc'

import type { Link } from './link.ts'
import type { Following } from './projects.ts'

export type ChatsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly chats: ReadonlyArray<ChatSummary> }
  | { readonly kind: 'failed'; readonly sentence: string }

export type ChatState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready'
      readonly chat: ChatSummary
      readonly lines: ReadonlyArray<ChatLine>
    }
  | { readonly kind: 'failed'; readonly sentence: string }

type ChatsLink = Pick<Link, 'chats' | 'transcript' | 'onChatChanges'>

/** What a Chat no longer listed says: the engine's own words for it. */
const GONE = 'This Chat no longer exists.'

/** Reads, then reads again on each change `mine` recognises; listening starts before the read. */
function rereading<S>(
  link: ChatsLink,
  read: () => Promise<S>,
  mine: (change: ChatChanged) => boolean,
  onState: (state: S | { readonly kind: 'failed'; readonly sentence: string }) => void,
): Following {
  let stopped = false
  let reads = 0
  const load = (): void => {
    reads += 1
    const asked = reads
    read().then(
      (state) => {
        if (!stopped && asked === reads) onState(state)
      },
      (failure: Error) => {
        if (!stopped && asked === reads) onState({ kind: 'failed', sentence: failure.message })
      },
    )
  }
  const unsubscribe = link.onChatChanges(
    (change) => {
      if (mine(change)) load()
    },
    () => undefined,
  )
  load()
  return {
    retry: load,
    stop: () => {
      stopped = true
      unsubscribe()
    },
  }
}

/** Follows a Project's Chats, for the sidebar. */
export function followChats(
  link: ChatsLink,
  projectId: string,
  onState: (state: ChatsState) => void,
): Following {
  return rereading<ChatsState>(
    link,
    () => link.chats(projectId).then((chats) => ({ kind: 'ready', chats })),
    (change) => change.projectId === projectId,
    onState,
  )
}

/** Follows one Chat, for its page: its own changes, and no other's. */
export function followChat(
  link: ChatsLink,
  projectId: string,
  chatId: string,
  onState: (state: ChatState) => void,
): Following {
  return rereading<ChatState>(
    link,
    async () => {
      const [chats, page] = await Promise.all([
        link.chats(projectId),
        link.transcript(chatId, null),
      ])
      const chat = chats.find((one) => one.id === chatId)
      return chat === undefined
        ? { kind: 'failed', sentence: GONE }
        : { kind: 'ready', chat, lines: page.entries }
    },
    (change) => change.chatId === chatId,
    onState,
  )
}
