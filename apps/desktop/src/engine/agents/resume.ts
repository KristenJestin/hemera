/**
 * The bounded context Hemera rebuilds when an agent cannot carry its own session on (design
 * D5-07).
 *
 * A native session is lost for reasons that are not the user's: the agent cleaned it up, the
 * handle expired, the directory moved. What the user must not lose is the conversation, so what
 * the thread holds is rebuilt into one block and sent to the agent with the next prompt — and
 * written into the thread as a `hemera` entry, because what is sent to an agent on the user's
 * behalf is the user's to read.
 *
 * It is bounded on purpose. A thread can hold thousands of entries and a rebuilt context has to
 * fit in a prompt: the last entries are kept, the oldest are dropped, and the block says so
 * rather than pretending it is the whole conversation.
 */
import type { SessionEntry } from '@hemera/core'

/** How many of the thread's last entries a rebuilt context carries at most. */
export const REBUILT_ENTRIES = 20

/** How many bytes of it a rebuilt context carries at most. */
export const REBUILT_BYTES = 32 * 1024

/** What a reader of the thread calls each role, as the block spells it. */
const SPEAKER = { user: 'User', agent: 'Agent', hemera: 'Hemera' } as const

/**
 * What Hemera wrote for itself rather than said in the conversation: a mission brief handed over
 * as a delivery (an agent whose conversation is rebuilt is handed a new one) and a Spec proposal
 * (the Spec is created or it is not).
 * Kept out of the block, a few briefs cannot push the conversation out of its budget. A question
 * of a Spec and its answer stay: they are one line each, and they are the conversation.
 */
const NOT_SAID: readonly SessionEntry['kind'][] = ['mission_brief', 'spec_proposal']

/** One entry as a line of the block: what a reader needs, and nothing of what a window draws. */
function lineOf(entry: SessionEntry): string {
  if (NOT_SAID.includes(entry.kind)) return ''
  const said = entry.body.trim()
  if (said === '') return ''
  return `${SPEAKER[entry.role]}: ${said}`
}

/**
 * The last of a thread, as one block to send to an agent that lost its own copy.
 *
 * The block opens by saying what it is, so an agent reading it knows the conversation was
 * rebuilt rather than continued, and it says how much of the thread it does not carry: a
 * context that hides its own truncation is a context an agent will reason about wrongly.
 */
export function rebuiltContext(entries: readonly SessionEntry[]): string {
  const lines = entries.map(lineOf).filter((line) => line !== '')
  const kept: string[] = []
  let size = 0

  // Newest first while the budget lasts, so what is dropped is what was said longest ago.
  for (const line of [...lines].reverse()) {
    const cost = Buffer.byteLength(line, 'utf8') + 1
    if (kept.length > 0 && (kept.length >= REBUILT_ENTRIES || size + cost > REBUILT_BYTES)) break
    kept.push(line)
    size += cost
  }

  const keptLines = kept.reverse()
  const dropped = lines.length - keptLines.length
  const opening = [
    'This Session is continuing on Hemera after its agent lost the session it was keeping.',
    dropped === 0
      ? 'Here is everything that was said:'
      : `Here is what was said, the last ${keptLines.length} entries of ${lines.length}:`,
  ]

  return [...opening, '', ...keptLines].join('\n')
}
