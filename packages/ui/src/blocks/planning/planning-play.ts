import { expect, userEvent, waitFor } from 'storybook/test'

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

/**
 * A button that sent something works, then fades back once it is taken: a story ends once it is
 * back, so what is read of it is the button at rest.
 */
export const settled = (button: HTMLElement): Promise<void> =>
  waitFor(() => expect(getComputedStyle(button).opacity).toBe('1'))
