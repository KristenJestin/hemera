import { expect, userEvent, waitFor, within } from 'storybook/test'

/** What the stories of #254 share in their plays. */

/** Presses Tab until the element has the focus, as a hand on the keyboard would. */
export async function tabTo(element: HTMLElement): Promise<void> {
  for (let step = 0; step < 120 && document.activeElement !== element; step += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one key at a time, as a hand presses them
    await userEvent.tab()
  }
  await expect(element).toHaveFocus()
}

/** Opens one of the rail's folds by its name, and gives what it unfolded. */
export async function unfold(canvasElement: HTMLElement, name: string): Promise<HTMLElement> {
  const canvas = within(canvasElement)
  const line = canvas.getByRole('button', { name: new RegExp(`^${name}`) })
  if (line.getAttribute('aria-expanded') !== 'true') await userEvent.click(line)
  await expect(line).toHaveAttribute('aria-expanded', 'true')
  return waitFor(() => canvas.getByRole('list', { name }))
}

/** The page's stage card. */
export const cardOf = (canvasElement: HTMLElement): HTMLElement =>
  within(canvasElement).getByRole('region', { name: 'Review' })
