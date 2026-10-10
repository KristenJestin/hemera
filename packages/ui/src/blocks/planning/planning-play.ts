import { userEvent } from 'storybook/test'

import { loadMentionEditor } from '../../components/mention-field/mention-field.tsx'

/** A story whose field is written in loads the editor first, so the field draws ready. */
export const EDITOR_LOADED = [async () => ({ editor: await loadMentionEditor() })]

/** Writes in a mention field one key after the other, as a person does, then sends it. */
export async function writeAndSend(field: HTMLElement, text: string): Promise<void> {
  await userEvent.click(field)
  await [...text].reduce<Promise<void>>(
    (before, key) =>
      before.then(async () => {
        await userEvent.keyboard(key)
      }),
    Promise.resolve(),
  )
  await userEvent.keyboard('{Enter}')
}
