import type { ReactNode } from 'react'

/**
 * A section of the Spec as Markdown, read: paragraphs, headings, lists, fenced code, and inline
 * `code` and **bold**. The Planner writes plain Markdown; what this does not know is shown as the
 * text it is, never dropped. Nothing to edit.
 */

const PROSE = 'flex max-w-measure min-w-0 flex-col gap-3 text-sm leading-6 break-words'

const CODE = 'rounded-sm bg-muted px-1 font-mono text-xs'

const PRE =
  'max-w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap'

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

/** Inline `code` and **bold**; everything else as the text it is. */
function Inline({ text }: { text: string }): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter((part) => part !== '')
  return parts.map((part, index) => {
    const key = `${String(index)}${part}`
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className={CODE}>
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      )
    }
    return <span key={key}>{part}</span>
  })
}

export function Prose({ body }: { body: string }): ReactNode {
  return (
    <div className={PROSE}>
      {blocksOf(body).map((block, index) => {
        const key = `${String(index)}${block.kind}`
        if (block.kind === 'heading') {
          return (
            <h3 key={key} className="font-semibold">
              <Inline text={block.text} />
            </h3>
          )
        }
        if (block.kind === 'code') {
          return (
            <pre key={key} className={PRE}>
              {block.text}
            </pre>
          )
        }
        if (block.kind === 'list') {
          const items = block.items.map((item, at) => (
            <li key={`${String(at)}${item}`}>
              <Inline text={item} />
            </li>
          ))
          return block.ordered ? (
            <ol key={key} className="flex list-decimal flex-col gap-1 pl-5">
              {items}
            </ol>
          ) : (
            <ul key={key} className="flex list-disc flex-col gap-1 pl-5">
              {items}
            </ul>
          )
        }
        return (
          <p key={key}>
            <Inline text={block.text} />
          </p>
        )
      })}
    </div>
  )
}
