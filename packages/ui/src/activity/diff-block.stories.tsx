import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'

import { DiffBlock } from './diff-block.tsx'

/**
 * One file’s change (design D17-07).
 *
 * Three changes: a file that did not exist, a paragraph that was rewritten in place, and a file
 * long enough that the box has to scroll. The counts are on the folded line because that is what
 * the block is asked — how far did this go — and the lines are behind it for when the answer is
 * “show me”.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Activity/DiffBlock',
  component: DiffBlock,
  parameters: { layout: 'padded' },
  args: {
    path: 'packages/ui/src/session/session.tsx',
    oldText: 'export function SessionPage() {\n  return null\n}\n',
    newText: 'export function SessionPage() {\n  return <SessionThread />\n}\n',
    defaultOpen: true,
  },
  argTypes: {
    path: { control: 'text', description: 'The absolute path, as the agent reported it.' },
    oldText: { control: 'text', description: 'What the file held, or null when it was created.' },
    newText: { control: 'text', description: 'What the file holds now.' },
    defaultOpen: { control: 'boolean', description: 'Whether it starts open.' },
  },
} satisfies Meta<typeof DiffBlock>

export default meta

type Story = StoryObj<typeof meta>

/**
 * Whether a line reads as this, whether or not the grammar coloured it: a coloured line is
 * several spans and reads as the one line it is, so the assertion has to look at what they
 * read as rather than at a single node.
 */
/** What a line reads as, whitespace and all, the way a reader reads it. */
function flat(value: string | null): string {
  return (value ?? '').replace(/\s+/gu, ' ').trim()
}

function reads(canvasElement: HTMLElement, text: string): boolean {
  return [...canvasElement.querySelectorAll('span')].some((span) => flat(span.textContent) === text)
}

/** A changed line, counted on both sides. */
export const Changed: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('+1')).toBeVisible()
    await expect(canvas.getByText('-1')).toBeVisible()
    await expect(reads(canvasElement, 'return <SessionThread />')).toBe(true)
    await expect(reads(canvasElement, 'return null')).toBe(true)
  },
}

/** A file the call created: nothing left, and no minus to read. */
export const Created: Story = {
  args: {
    path: 'packages/ui/src/session/stopped-turn.tsx',
    oldText: null,
    newText: 'export function StoppedTurn() {\n  return null\n}\n',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('+3')).toBeVisible()
    await expect(canvas.queryByText(/^-\d+$/), 'a created file has no minus').toBeNull()
  },
}

/** A long file whose only change is at one end: the box takes a height and scrolls inside it. */
export const Long: Story = {
  args: {
    path: 'packages/ui/src/session/session-page.stories.tsx',
    oldText: Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n'),
    newText: Array.from({ length: 30 }, (_, index) =>
      index === 12 ? 'line 12, rewritten' : `line ${index}`,
    ).join('\n'),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('+1')).toBeVisible()
    await expect(reads(canvasElement, 'line 12, rewritten')).toBe(true)
    // The thread keeps its height and the file scrolls inside it, which is the whole reason the
    // block has a box of its own: a thirty-line file in the thread is a turn nobody reads.
    const box = canvas.getByRole('group', {
      name: 'packages/ui/src/session/session-page.stories.tsx',
    })
    await expect(box.scrollHeight).toBeGreaterThan(box.clientHeight)
  },
}

/**
 * The same change, in the language of the file it came from (design D17-13): a keyword, a string
 * and a comment stop looking alike. The grammar arrives after the first frame — the change is
 * drawn plain while it comes — so the wait is part of what this story proves.
 */
export const ColouredInItsOwnLanguage: Story = {
  args: {
    path: 'apps/desktop/src/renderer/agent-store.ts',
    oldText: 'export const TIMEOUT = 30\n// how long a turn waits\n',
    newText: 'export const TIMEOUT = 45\n// how long a turn waits, in seconds\n',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('+2')).toBeVisible()
    // The grammar is a module of its own, imported when the first block of that language is
    // drawn, and the change is drawn plain while it comes. No patience beyond the default: a draw
    // that came back plain because the grammar had not read yet is no longer kept, so the block
    // colours itself as soon as the grammar reads — a wait long enough to outlast a frozen draw is
    // a wait that was hiding it.
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('.tok-keyword').length).toBeGreaterThan(0),
    )
    await expect(canvasElement.querySelectorAll('.tok-comment').length).toBeGreaterThan(0)
  },
}

/** The same block over a stylesheet: what a token is called comes from the language of the file. */
export const ColouredAsAStylesheet: Story = {
  args: {
    path: 'packages/ui/src/theme.css',
    oldText: 'a {\n  color: red;\n}\n',
    newText: 'a {\n  color: blue;\n}\n',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('+1')).toBeVisible()
    // A stylesheet grammar is another module, fetched the same way and waited for the same way.
    await waitFor(() =>
      expect(canvasElement.querySelectorAll('.tok-constant').length).toBeGreaterThan(0),
    )
  },
}

/**
 * A file nothing here has a grammar for is drawn plain rather than coloured by a guess: a shell
 * hook is not a TypeScript file, and colouring it as one would be the block lying about what it
 * read.
 */
export const PlainWhereNoGrammarIs: Story = {
  args: {
    path: 'tools/hooks/pre-commit',
    oldText: '#! /bin/sh\nexit 0\n',
    newText: '#! /bin/sh\nexit 1\n',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('exit 1')).toBeVisible()
    await expect(canvasElement.querySelector('[class*="tok-"]')).toBeNull()
  },
}
