/**
 * The Chat's own words and numbers (#43): a free conversation with an agent about a Project, beside
 * its missions. Its title, how much of the conversation a fresh session is handed, what its
 * transcript holds, and the mentions a message may carry.
 */

import { Schema } from 'effect'

/** How many exchanges of the conversation a fresh session of a Chat is handed. */
export const CHAT_TAIL = 20

/** The longest title a Chat takes from its first message. */
export const CHAT_TITLE_MAX = 60

/** What a Chat is called before its first message. */
export const UNTITLED_CHAT = 'New Chat'

/** A Chat's title from the user's first message: its first line, cut to 60 characters. */
export const chatTitleOf = (text: string): string => {
  const line = text.trim().split('\n')[0]?.trim() ?? ''
  if (line === '') return UNTITLED_CHAT
  return line.length > CHAT_TITLE_MAX ? `${line.slice(0, CHAT_TITLE_MAX - 1)}…` : line
}

/** What a line of a Chat's transcript is: the user's, the agent's, a folded action, or Hemera's. */
export const CHAT_ENTRY_KINDS = ['user', 'agent', 'action', 'notice'] as const
export const ChatEntryKind = Schema.Literals(CHAT_ENTRY_KINDS)
export type ChatEntryKind = typeof ChatEntryKind.Type

/** What a fresh session reads after the end of the conversation. */
export const CHAT_CONTINUE =
  'A previous session of this Chat stopped; continue from the conversation above.'

/** The line a restart leaves in a Chat whose turn was running: nothing resumes on its own. */
export const CHAT_INTERRUPTED = "Hemera restarted; the agent's turn was interrupted"

/** A reference the user's message carries: a file, a mission, a catalogue command. */
export const ChatMention = Schema.Struct({
  kind: Schema.Literals(['file', 'mission', 'command']),
  /** A path in the main checkout, a mission's key, a catalogue command's id. */
  ref: Schema.String.check(Schema.isNonEmpty()),
})
export type ChatMention = typeof ChatMention.Type

/** The mentions of a message as the agent reads them after its text: references to resolve. */
export const mentionsText = (mentions: ReadonlyArray<ChatMention>): string =>
  mentions.length === 0
    ? ''
    : [
        'References:',
        ...mentions.map((mention) => {
          if (mention.kind === 'file') return `- file \`${mention.ref}\` (in the main checkout)`
          if (mention.kind === 'mission')
            return `- mission ${mention.ref} (read it with memory_read)`
          return `- catalogue command \`${mention.ref}\` (run it with commands_run)`
        }),
      ].join('\n')
