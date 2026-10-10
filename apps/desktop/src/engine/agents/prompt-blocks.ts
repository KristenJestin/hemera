/**
 * Hemera's instructions in two parts, kept as one text: what every session of a role shares, then
 * `SYSTEM_PROMPT_BOUNDARY` on a paragraph of its own, then what belongs to the session (its
 * owner, the languages, the tester paragraph, the Project's files). Claude Code cuts the text there
 * into blocks, the first ones cached across sessions (`systemPrompt` in the Agent SDK); every
 * other reader takes it as one text. A text with no boundary, kept by a session started before it
 * existed, is sent as it was.
 */

/** The Agent SDK's `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, which marks the end of the cacheable blocks. */
export const SYSTEM_PROMPT_BOUNDARY = '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'

const BREAK = `\n\n${SYSTEM_PROMPT_BOUNDARY}\n\n`

/** The instructions as Claude Code takes them: the blocks around the boundary, or the one text. */
export const promptBlocks = (text: string): string | ReadonlyArray<string> => {
  const at = text.indexOf(BREAK)
  return at < 0 ? text : [text.slice(0, at), SYSTEM_PROMPT_BOUNDARY, text.slice(at + BREAK.length)]
}

/** The instructions as one text, for every reader that takes no blocks: the boundary is a layer break. */
export const promptText = (text: string): string => text.replace(BREAK, '\n\n---\n\n')
