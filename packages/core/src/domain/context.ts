/**
 * What Hemera provides to an agent, and how a change of it reaches it (design D6-07 … D6-10).
 *
 * The provided context is the base and nothing else: the Project's instructions are the
 * Workspace's `AGENTS.md`, which the three agents read natively, so Hemera never sends it — it
 * records its fingerprint and says in the Context view that it was read natively. The base is
 * three sentences the agent is given once, at the start of the Session, by whatever means its
 * adapter has: the system prompt on Claude Code, an embedded resource in the first prompt on
 * Codex and OpenCode.
 *
 * A change of `AGENTS.md` is not a prompt: it leaves between two turns as an identifiable
 * delivery — the new text as a resource, and a marker saying who sent it — so that a thread
 * shows a delivery and never a sentence attributed to the user.
 */

/** The file the Project's instructions live in, at the root of the Workspace. */
export const AGENTS_FILE = 'AGENTS.md'

/**
 * The base every Session is given, word for word.
 *
 * It is here and not in the engine because it is a product sentence: what an agent is told about
 * where it works is a rule of the product, and a rule that lives in a constant is one that can
 * be read without reading a service.
 */
export const CONTEXT_BASE = [
  'You are working inside Hemera, a desktop cockpit for agents.',
  'Use the tools Hemera lends you — they are the only ones you have — and prefer them to any habit of your own: reading, writing, searching and running commands all go through them.',
  'Everything they do is recorded, and an action outside the workspace root is decided by the user, never by you: a refusal is an answer, not an obstacle.',
].join('\n')

/** Where a source of the context came from, which is what the Context view lists it under. */
export const CONTEXT_SOURCES = ['base', 'agents-file', 'delivery'] as const

export type ContextSource = (typeof CONTEXT_SOURCES)[number]

/**
 * What a delivery says about itself, on the first line of the text it carries.
 *
 * The marker is what makes a delivery identifiable in a thread that otherwise holds prompts: it
 * is Hemera's own sentence, and it is not written in the user's voice (D6-08).
 */
export const DELIVERY_MARKER = '[hemera:context]'

/** The text of one delivery: the marker, and the instructions as they now stand. */
export function deliveryText(instructions: string): string {
  return `${DELIVERY_MARKER} the project instructions changed; they now read:\n\n${instructions}`
}

/**
 * How a source of the context reached the agent, which the Context view says beside it (D6-10).
 *
 * The base goes through the system prompt where the agent has one to hand over — Claude Code's
 * `_meta.systemPrompt` — and as an embedded resource in the first prompt everywhere else; the
 * Workspace's `AGENTS.md` is read by the agent itself; a change of it goes as a prompt of its own,
 * made of the marker and the new text as a resource, between two turns (D6-07, D6-08).
 */
export const CONTEXT_REACHES = [
  'system_prompt',
  'embedded_resource',
  'read_natively',
  'delivery_prompt',
] as const

export type ContextReach = (typeof CONTEXT_REACHES)[number]

/** How the base reaches an agent: one of the two means an adapter declares (D6-07). */
export type BaseReach = Extract<ContextReach, 'system_prompt' | 'embedded_resource'>

/** The address a provided text is named by in a prompt, which is Hemera's and no file's. */
export function contextUri(path: string): string {
  return `hemera://context/${path === '' ? 'base' : path}`
}
