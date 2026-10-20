import { expect, userEvent, waitFor, within } from 'storybook/test'

/**
 * What the stories of #264 share in their plays. The tree and the code are drawn in shadow roots,
 * which the queries of the testing library do not enter: they are read here through their hosts.
 * The heads of the files and the comments are the view's own, in the page, and read by role.
 */

/** The shadow root the tree draws its rows in. */
function treeRoot(canvasElement: HTMLElement): ShadowRoot {
  const host = canvasElement.ownerDocument.querySelector('file-tree-container')
  if (host?.shadowRoot === null || host?.shadowRoot === undefined) throw new Error('No tree yet')
  return host.shadowRoot
}

/** A row of the tree, by its path: `web/src/billing/export.ts`. */
export async function treeRow(canvasElement: HTMLElement, path: string): Promise<HTMLElement> {
  return waitFor(() => {
    const row = treeRoot(canvasElement).querySelector(`[data-item-path="${path}"]`)
    if (!(row instanceof HTMLElement)) throw new Error(`No row ${path}`)
    return row
  })
}

/** Whether the tree holds a row for a path at all. */
export const hasRow = (canvasElement: HTMLElement, path: string): boolean =>
  treeRoot(canvasElement).querySelector(`[data-item-path="${path}"]`) !== null

/** Everything the code's shadow roots say, as one text. */
export function codeText(canvasElement: HTMLElement): string {
  return [...canvasElement.ownerDocument.querySelectorAll('diffs-container')]
    .map((host) => host.shadowRoot?.textContent ?? '')
    .join('\n')
}

/** Whether a split diff is drawn: the library marks its grid. */
export const drawnSplit = (canvasElement: HTMLElement): boolean =>
  [...canvasElement.ownerDocument.querySelectorAll('diffs-container')].some(
    (host) => host.shadowRoot?.querySelector('[data-diff-type="split"]') !== null,
  )

/** A file's head, once the diff drew it. */
export async function headOf(canvasElement: HTMLElement, id: string): Promise<HTMLElement> {
  return waitFor(() => {
    const head = canvasElement.ownerDocument.querySelector(`[data-file-head="${id}"]`)
    if (!(head instanceof HTMLElement)) throw new Error(`No head ${id}`)
    return head
  })
}

/** Sends the diff to a file through the tree, as a hand would, and gives its head. */
export async function goToFile(canvasElement: HTMLElement, id: string): Promise<HTMLElement> {
  await userEvent.click(await treeRow(canvasElement, id))
  return headOf(canvasElement, id)
}

/** A comment, once it is drawn under its lines. */
export async function commentOf(canvasElement: HTMLElement, id: string): Promise<HTMLElement> {
  return waitFor(() => {
    const comment = canvasElement.ownerDocument.querySelector(`[data-comment="${id}"]`)
    if (!(comment instanceof HTMLElement)) throw new Error(`No comment ${id}`)
    return comment
  })
}

/** The scroll of the diff, the keyboard's stop. */
export const stageOf = (canvasElement: HTMLElement): Promise<HTMLElement> =>
  waitFor(() => within(canvasElement.ownerDocument.body).getByRole('region', { name: 'The diff' }))

/** Presses Tab until the element has the focus, as a hand on the keyboard would. */
export async function tabTo(element: HTMLElement): Promise<void> {
  for (let step = 0; step < 80 && element.ownerDocument.activeElement !== element; step += 1) {
    // oxlint-disable-next-line no-await-in-loop -- one key at a time, as a hand presses them
    await userEvent.tab()
  }
  await expect(element).toHaveFocus()
}
