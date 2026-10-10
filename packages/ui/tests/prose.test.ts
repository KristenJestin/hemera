/**
 * How a section of the Spec is read as Markdown on the Planning page: its blocks, in order. The
 * page itself is a story; what is proved here is the part that cuts the text, so that nothing the
 * Planner writes is dropped.
 */

import { describe, expect, test } from 'vite-plus/test'

import { blocksOf } from '../src/blocks/planning/prose.tsx'

describe('A section read as Markdown', () => {
  test('paragraphs are cut at blank lines, their lines joined', () => {
    expect(blocksOf('One line\nand its next.\n\nAnother.')).toEqual([
      { kind: 'paragraph', text: 'One line and its next.' },
      { kind: 'paragraph', text: 'Another.' },
    ])
  })

  test('a list of dashes or numbers is a list, whatever follows it', () => {
    expect(blocksOf('- Export one note\n- Not an import\nAfter.')).toEqual([
      { kind: 'list', ordered: false, items: ['Export one note', 'Not an import'] },
      { kind: 'paragraph', text: 'After.' },
    ])
    expect(blocksOf('1. Seed\n2. Export')).toEqual([
      { kind: 'list', ordered: true, items: ['Seed', 'Export'] },
    ])
  })

  test('a heading and a fenced block keep their text whole', () => {
    expect(blocksOf('## Notes\n```\n$ pnpm test\n\n ok\n```')).toEqual([
      { kind: 'heading', text: 'Notes' },
      { kind: 'code', text: '$ pnpm test\n\n ok' },
    ])
  })

  test('a fence never closed keeps everything after it as code', () => {
    expect(blocksOf('```\nhalf written')).toEqual([{ kind: 'code', text: 'half written' }])
  })

  test('an empty section has no block', () => {
    expect(blocksOf('  \n\n')).toEqual([])
  })
})
