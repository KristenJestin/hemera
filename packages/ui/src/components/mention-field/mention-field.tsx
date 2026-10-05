import { type ReactNode, Suspense, use } from 'react'

import { Skeleton } from '../loading/loading.tsx'
import { AREA, FieldBox, type MentionFieldProps } from './mention-parts.tsx'

export {
  kindOf,
  MentionBadge,
  type Mentionable,
  type MentionFieldProps,
  type MentionKind,
  type MentionRef,
  mentionsFor,
} from './mention-parts.tsx'

/**
 * The mention field: where a message is written — the Chat's composer, Discuss, an answer, a
 * Review remark, the first field of a mission. On Tiptap, which owns the editing, loaded once a
 * page shows a field: until it is there, the field is drawn in its own shape, a skeleton where
 * the text goes, so nothing moves when the editor arrives.
 *
 * - It never changes height: its box is four lines, and a longer text scrolls inside it.
 * - `@` at the start of a word opens a menu at the caret: the files of the main checkout, the
 *   missions and the commands, the recent first; what follows the `@` searches them, fuzzily.
 *   Up and Down walk it, Enter or Tab write the mention, Escape puts the menu away. The caret
 *   never leaves the field.
 * - A mention is a badge: a file's name alone (its path in the tooltip), a mission's key, a
 *   command's name. Backspace takes it away whole. In the text the field hands back, it is
 *   `@` and the whole path.
 * - Without a menu, Enter sends when the field has somewhere to send to, and Shift+Enter starts
 *   a new line.
 * - A field that sends has its Send in the box's bottom-right corner: a small square with an
 *   arrow up, filled once there is something to send and quiet while there is not. While what
 *   it sent is being worked on, it is Stop, in the same place.
 * - A bar at the foot of the box holds what the caller sets there: the composer's model picker
 *   at its start, then whatever stands before Send.
 */

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

/** One element whatever the moment, so the editor that arrives is never drawn twice. */
function Loaded(props: MentionFieldProps): ReactNode {
  const Field = arrived ?? use(loadMentionEditor())
  return <Field {...props} />
}

/** The field while its editor loads: its box and foot, a skeleton where the words will be. */
export function MentionFieldSkeleton({
  placeholder,
  value,
  onSubmit,
  working = false,
  onStop,
  leading,
  trailing,
  disabled = false,
}: MentionFieldProps): ReactNode {
  return (
    <FieldBox
      disabled={disabled}
      // Quiet until the editor is there: what is written is the editor's to send.
      empty
      submit={onSubmit}
      working={working}
      onStop={onStop}
      leading={leading}
      trailing={trailing}
    >
      <div className={AREA} data-field-skeleton="">
        <Skeleton>{value.split('\n')[0] || placeholder || 'Message'}</Skeleton>
      </div>
    </FieldBox>
  )
}

export function MentionField(props: MentionFieldProps): ReactNode {
  return (
    <Suspense fallback={<MentionFieldSkeleton {...props} />}>
      <Loaded {...props} />
    </Suspense>
  )
}
