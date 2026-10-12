import { expect, type within, waitFor } from 'storybook/test'

type Scope = ReturnType<typeof within>

/**
 * A popup is read once it has finished coming in, not once it has begun. Base UI mounts a dialog,
 * a popover or a menu carrying `data-starting-style`, which the theme draws at opacity 0, and
 * takes it off a frame later: a play that asserts `toBeVisible()` in between fails on a loaded
 * runner and passes when run alone. This waits for that frame, on the element or on the popup
 * around it, and gives the element back.
 */
export async function entered<Target extends HTMLElement>(element: Target): Promise<Target> {
  await waitFor(() => {
    expect(element.closest('[data-starting-style]')).toBeNull()
    expect(element).toBeVisible()
  })
  return element
}

/** `findByRole` for a popup: the element once it has finished entering. */
export async function findOpen(
  scope: Scope,
  role: Parameters<Scope['findByRole']>[0],
  options?: Parameters<Scope['findByRole']>[1],
): Promise<HTMLElement> {
  return entered(await scope.findByRole(role, options))
}
