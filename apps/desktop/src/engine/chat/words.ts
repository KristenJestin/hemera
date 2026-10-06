/**
 * What the Chats keep about each session while it runs (#43): the Chat it belongs to (null for a
 * session of no Chat), the words its agent said and that are not written yet, and how many turns
 * it began, so a late write never takes the next turn's words.
 *
 * Words are kept at once, before the session is known, because the end of a turn comes right
 * behind its last words; once a session is known to be no Chat's, nothing of its words is kept.
 * A session that ended is forgotten whole.
 */

export const sessionBook = () => {
  const chats = new Map<string, string | null>()
  const words = new Map<string, string[]>()
  const turns = new Map<string, number>()
  return {
    /** The Chat of a session, null for none, undefined while it is not known yet. */
    chatOf: (sessionId: string): string | null | undefined => chats.get(sessionId),
    knowChat: (sessionId: string, chatId: string | null) => {
      chats.set(sessionId, chatId)
      if (chatId === null) words.delete(sessionId)
    },
    hear: (sessionId: string, text: string) => {
      if (chats.get(sessionId) === null) return
      words.set(sessionId, [...(words.get(sessionId) ?? []), text])
    },
    /** What the agent said and is not written yet, taken. */
    take: (sessionId: string): string => {
      const said = (words.get(sessionId) ?? []).join('').trim()
      words.delete(sessionId)
      return said
    },
    turnBegan: (sessionId: string) => turns.set(sessionId, (turns.get(sessionId) ?? 0) + 1),
    turnOf: (sessionId: string): number => turns.get(sessionId) ?? 0,
    forget: (sessionId: string) => {
      chats.delete(sessionId)
      words.delete(sessionId)
      turns.delete(sessionId)
    },
    /** How many sessions anything is kept about. */
    followed: (): number => new Set([...chats.keys(), ...words.keys(), ...turns.keys()]).size,
  }
}
