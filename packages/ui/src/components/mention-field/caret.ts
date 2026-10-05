/**
 * Where a position of a text area's text is drawn, for the mention field's menu to hang there.
 *
 * A text area does not say where its characters are, so its text up to that position is laid in
 * an invisible copy of the box — same font, same padding, same wrapping — with a mark at the end,
 * and the mark's box is read. It follows a box the theme laid out and sizes nothing.
 */

/** What the copy takes from the text area: everything that decides where a line wraps. */
const COPIED = [
  'box-sizing',
  'width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'font-stretch',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'tab-size',
  'text-indent',
  'text-transform',
  'white-space',
  'word-break',
  'overflow-wrap',
]

/** The box of the character at `position`, in the window's coordinates, one line tall. */
export function caretRect(area: HTMLTextAreaElement, position: number): DOMRect {
  const own = window.getComputedStyle(area)
  const copy = document.createElement('div')
  for (const name of COPIED) copy.style.setProperty(name, own.getPropertyValue(name))
  const box = area.getBoundingClientRect()
  copy.style.setProperty('position', 'fixed')
  copy.style.setProperty('visibility', 'hidden')
  copy.style.setProperty('overflow', 'hidden')
  copy.style.setProperty('white-space', 'pre-wrap')
  copy.style.setProperty('top', `${String(box.top)}px`)
  copy.style.setProperty('left', `${String(box.left)}px`)
  copy.textContent = area.value.slice(0, position)
  const mark = document.createElement('span')
  mark.textContent = '\u200b'
  copy.append(mark)
  document.body.append(copy)
  const at = mark.getBoundingClientRect()
  copy.remove()
  // A position scrolled out of the box is drawn at the box's nearest edge.
  const top = Math.min(Math.max(at.top - area.scrollTop, box.top), box.bottom - at.height)
  return new DOMRect(at.left - area.scrollLeft, top, 0, at.height)
}

/**
 * What the menu hangs off: the place of the `@` it belongs to, read each time it is placed, so it
 * follows the box when the window moves under it.
 */
export function caretAnchor(
  area: { readonly current: HTMLTextAreaElement | null },
  position: number | null,
) {
  return {
    getBoundingClientRect: () =>
      area.current === null || position === null
        ? new DOMRect()
        : caretRect(area.current, position),
  }
}
