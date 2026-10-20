import type { ReactNode } from 'react'

import type { MentionFieldProps } from './mention-parts.tsx'

type Editor = (props: MentionFieldProps) => ReactNode

/** The editor once it has arrived; nothing until then. */
let arrived: Editor | undefined
let arriving: Promise<Editor> | undefined

/**
 * Fetches the editor, once: a field asks for it as it first draws, and a caller that knows a field
 * is coming — a story, a page about to open — can ask ahead, so the field draws ready.
 */
export function loadMentionEditor(): Promise<Editor> {
  arriving ??= import('./mention-editor.tsx').then(({ MentionEditor }) => {
    arrived = MentionEditor
    return MentionEditor
  })
  return arriving
}

/** The editor if it has already arrived, so a field draws it at once. */
export function mentionEditorArrived(): Editor | undefined {
  return arrived
}
