/**
 * The one way an agent's value becomes text. What an agent sends as a tool's input or output, and
 * what the trace writes of each message, is as deep as the agent made it: a value nested a few
 * thousand levels deep makes `JSON.stringify` throw `RangeError`, and the update that carried it was
 * lost, or the session failed with it. This never throws and walks the value once, on a stack of
 * its own rather than in calls.
 *
 * What nests beyond `NESTING_LIMIT` containers is `•••`, where it begins, as `maskRecord` cuts a
 * record: the same limit, the same mark. Secrets are not this module's: the text it gives goes
 * where the registry masks it, as the trace's sink does, and a string it keeps is as the agent
 * wrote it.
 */

import { MASK, NESTING_LIMIT } from '@hemera/core/domain'
import { Predicate, Schema } from 'effect'

/** What `JSON.stringify` calls a replacer: it is given every value, the root under `''`. */
export type Replacer = (key: string, held: Schema.Json) => Schema.Json

/** A container being written: its items, and how many are written. */
interface Open {
  /** The names of the fields of a record; null for a list. */
  readonly names: ReadonlyArray<string> | null
  readonly items: ReadonlyArray<Schema.Json>
  at: number
}

/** A container, as `Array.isArray` does not narrow a read-only array out of a union. */
const isContainer = (value: Schema.Json): value is Schema.JsonObject | Schema.JsonArray =>
  Predicate.isObject(value) || Array.isArray(value)

const open = (container: Schema.JsonObject | Schema.JsonArray): Open => {
  if (Array.isArray(container)) return { names: null, items: container, at: 0 }
  const entries = Object.entries(container)
  return { names: entries.map(([name]) => name), items: entries.map(([, item]) => item), at: 0 }
}

const MASKED = JSON.stringify(MASK)

/**
 * A value as JSON text, `replace` applied to each value as `JSON.stringify` applies its replacer.
 * Whatever cannot be read (a getter that throws) is `"•••"` whole, never an error.
 */
export const agentText = (value: Schema.Json, replace?: Replacer): string => {
  try {
    const parts: string[] = []
    const stack: Open[] = []
    /** Writes one value, or opens it when it is a container that may still nest. */
    const write = (key: string, given: Schema.Json): void => {
      const held = replace === undefined ? given : replace(key, given)
      if (!isContainer(held)) {
        parts.push(JSON.stringify(held))
      } else if (stack.length >= NESTING_LIMIT) {
        parts.push(MASKED)
      } else {
        parts.push(Array.isArray(held) ? '[' : '{')
        stack.push(open(held))
      }
    }
    write('', value)
    for (;;) {
      const level = stack.at(-1)
      if (level === undefined) return parts.join('')
      if (level.at === level.items.length) {
        stack.pop()
        parts.push(level.names === null ? ']' : '}')
        continue
      }
      const at = level.at
      level.at += 1
      if (at > 0) parts.push(',')
      if (level.names !== null) parts.push(`${JSON.stringify(level.names[at])}:`)
      write(String(level.names?.[at] ?? at), level.items[at] ?? null)
    }
  } catch {
    return MASKED
  }
}

const readText = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))

/** A value as `agentText` writes it, kept as a value: the same, with what nests too deep cut. */
export const cutJson = (value: Schema.Json): Schema.Json => readText(agentText(value))
