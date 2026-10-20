import { expect, waitFor } from 'storybook/test'

/**
 * An element that left the page played its own exit before it went: motion leaves the end of the
 * `collapse` kind, a height of 0, on what it folded, and drops nothing until the fold has ended.
 * An element cut from the page by its container, or with it, keeps the height it was drawn at.
 * The stories run asking for less movement, where the fold takes no time but is still played.
 */
export async function foldedOut(element: HTMLElement): Promise<void> {
  await waitFor(() => expect(element).not.toBeInTheDocument())
  expect(element.style.height).toBe('0px')
}
