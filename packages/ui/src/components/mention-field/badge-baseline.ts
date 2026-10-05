/**
 * What the stories check of a text holding mention badges: that every badge's name stands on
 * the baseline of the words of its line, and that a block holding badges is exactly as tall as
 * its lines, so a badge has moved no line. Measured on the text itself, through ranges.
 */

const bottomsOf = (node: Node): number[] => {
  const range = document.createRange()
  range.selectNodeContents(node)
  return [...range.getClientRects()].map((rect) => Math.round(rect.bottom))
}

/** The names of the badges in `block` that do not stand on its words' baseline. */
export function badgesOffBaseline(block: HTMLElement): string[] {
  const badges = [...block.querySelectorAll('button')]
  const words = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      badges.some((badge) => badge.contains(node)) || node.textContent?.trim() === ''
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  const lines = new Set<number>()
  for (let node = words.nextNode(); node !== null; node = words.nextNode()) {
    for (const bottom of bottomsOf(node)) lines.add(bottom)
  }
  return badges
    .filter((badge) => {
      const name = [...badge.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)
      return name === undefined || bottomsOf(name).some((bottom) => !lines.has(bottom))
    })
    .map((badge) => badge.textContent ?? '')
}

/** Whether `block`'s content is a whole number of its own lines tall, its padding aside. */
export function keepsItsLines(block: HTMLElement): boolean {
  const style = getComputedStyle(block)
  const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
  const lines = (block.clientHeight - padding) / Number.parseFloat(style.lineHeight)
  return Math.abs(lines - Math.round(lines)) < 0.01
}
