/**
 * The brief of a Session started to write a Spec: the Home's `New Spec` (issue #128).
 *
 * A Spec is still made the one way it always was: the agent of a `free` Session proposes one with
 * `spec_propose`, kind `spec`, and the user's acceptance turns the Session `define` (Decided 6,
 * 16). `New Spec` only says, on the first turn, what the user started the Session for, so the
 * agent does not have to be asked twice. It rides that turn as a provision behind Hemera's marker
 * (D6-08), never as words of the user's, and the define brief is left as it is: it belongs to the
 * Session once the proposal is accepted, and not before.
 */

import { contextUri } from '@hemera/core'
import type { PromptIntent } from '@hemera/ipc'

import type { Provision } from './client.ts'

/** Where the brief is named, among what Hemera provides. */
export const SPEC_REQUEST_URI = contextUri('spec-request')

/** What the agent is asked, in the words it reads before the user's message. */
export const SPEC_REQUEST = `# Mission: propose a Spec

The user started this Session from Hemera's "New Spec": they want the message below to become a Spec.

- Read the message, and what the Workspace can tell you about it.
- If you cannot yet name what the Spec is about, ask the user your questions first, one at a time, with your recommendation.
- Then propose the Spec with \`spec_propose\`, kind \`spec\`: a short title, and the type that fits (\`feature\`, \`bug\` or \`maintenance\`).
- Do not write the Spec yet and do not change any code: the user accepts or declines the proposal, and accepting it is what starts the work on the Spec.`

/** What a prompt sent with this intent carries in front of the user's text, if anything. */
export function provisionsOf(intent: PromptIntent | undefined): readonly Provision[] {
  if (intent !== 'spec') return []
  return [{ uri: SPEC_REQUEST_URI, text: SPEC_REQUEST, mimeType: 'text/markdown' }]
}
