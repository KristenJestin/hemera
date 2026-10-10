/**
 * The system prompt a fake agent was handed in a session's `_meta`, as the suites read it: the
 * text a session kept (the blocks of Claude Code put back together, the cache boundary in place).
 */

import { Option, Schema } from 'effect'

const Meta = Schema.fromJsonString(
  Schema.Struct({
    claudeCode: Schema.Struct({
      options: Schema.Struct({
        systemPrompt: Schema.Struct({
          prompt: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
        }),
      }),
    }),
  }),
)
const readMeta = Schema.decodeUnknownOption(Meta)

/** The kept instructions, from the `_meta` JSON of a Claude Code session; empty when it has none. */
export const keptPrompt = (meta: string | null | undefined): string =>
  Option.match(readMeta(meta), {
    onNone: () => '',
    onSome: ({ claudeCode }) => [claudeCode.options.systemPrompt.prompt].flat().join('\n\n'),
  })
