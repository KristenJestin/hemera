import { expect, userEvent } from 'storybook/test'

/** What the stories of #149 share in their plays. */

/** Presses Tab until the element has the focus, as a hand on the keyboard would. */
export async function tabTo(element: HTMLElement): Promise<void> {
  for (let step = 0; step < 80 && document.activeElement !== element; step += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one key at a time, as a hand presses them
    await userEvent.tab()
  }
  await expect(element).toHaveFocus()
}
