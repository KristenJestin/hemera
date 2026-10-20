type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string }

const BULLET = /^\s*[-*]\s+/

const NUMBERED = /^\s*\d+[.)]\s+/

/** The blocks of a Markdown text, in order. */
export function blocksOf(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let at = 0
  while (at < lines.length) {
    const line = lines[at] ?? ''
    if (line.trim() === '') {
      at += 1
      continue
    }
    if (line.trimStart().startsWith('```')) {
      const code: string[] = []
      at += 1
      while (at < lines.length && !(lines[at] ?? '').trimStart().startsWith('```')) {
        code.push(lines[at] ?? '')
        at += 1
      }
      blocks.push({ kind: 'code', text: code.join('\n') })
      at += 1
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      blocks.push({ kind: 'heading', text: line.replace(/^#{1,6}\s+/, '') })
      at += 1
      continue
    }
    const marker = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null
    if (marker !== null) {
      const items: string[] = []
      while (at < lines.length && marker.test(lines[at] ?? '')) {
        items.push((lines[at] ?? '').replace(marker, ''))
        at += 1
      }
      blocks.push({ kind: 'list', ordered: marker === NUMBERED, items })
      continue
    }
    const paragraph: string[] = []
    while (
      at < lines.length &&
      (lines[at] ?? '').trim() !== '' &&
      !BULLET.test(lines[at] ?? '') &&
      !NUMBERED.test(lines[at] ?? '') &&
      !(lines[at] ?? '').trimStart().startsWith('```')
    ) {
      paragraph.push(lines[at] ?? '')
      at += 1
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') })
  }
  return blocks
}
