import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { withinFrames } from '../../.storybook/reduced-motion.ts'
import { HemeraToolCall, type HemeraToolProvenance } from './hemera-tool-call.tsx'

/**
 * A call to a tool Hemera lent the agent (design D6-06).
 *
 * The stories are the states a call is read in: a read that is done and folded, the same call
 * opened by the reader, an edit, a write, a search that hit its limit, a call in flight, a call
 * that failed, a call Hemera refused, and a write waiting for the reader's decision. The `Hemera`
 * mark and the provenance line are what tell this block from a native tool call in the same
 * turn, so both are on every story; where the call stands is the dot beside the tool.
 */
const PROVENANCE: HemeraToolProvenance = {
  session: 'CSV invoice export',
  agent: 'opencode',
  token: '7f31c0',
}

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Activity/HemeraToolCall',
  component: HemeraToolCall,
  parameters: { layout: 'padded' },
  args: {
    tool: 'fs_read',
    status: 'completed',
    summary: '4 812 bytes read from src/billing/export.ts, 1 of 1 page.',
    arguments: [
      { label: 'path', value: 'src/billing/export.ts' },
      { label: 'range', value: '0–262144' },
    ],
    paths: ['src/billing/export.ts'],
    ms: 18,
    provenance: PROVENANCE,
    onOpenPath: fn(),
  },
  argTypes: {
    tool: { control: 'text', description: 'The tool, as the catalogue names it.' },
    status: {
      control: 'inline-radio',
      options: ['pending', 'in_progress', 'completed', 'failed', 'refused'],
      description: 'Where the call stands: running, failed and waiting are open, and stay open.',
    },
    summary: { control: 'text', description: 'What the call returned, in one line.' },
    arguments: { control: 'object', description: 'The arguments as they were bounded.' },
    paths: { control: 'object', description: 'The paths the call touched.' },
    ms: { control: 'number', description: 'How long the call took.' },
    provenance: { control: 'object', description: 'The Session, the agent and the token id.' },
    error: { control: 'text', description: 'Why the call failed, or why it was refused.' },
    onOpenPath: { control: false, description: 'What a press on a path does.' },
    children: { control: false, description: 'What the call returned, already drawn.' },
  },
} satisfies Meta<typeof HemeraToolCall>

export default meta

type Story = StoryObj<typeof meta>

/** How many frames a fold is watched for: the better part of the journey of the spring. */
const A_FOLD = 30

/**
 * The fold opening, with the path the call touched on its line (trial of 23 September 2026).
 *
 * The press on the path sat beside the whole fold and was centred on it, so it slid down the
 * block while the body opened under it. It is on the fold's own line now, the one line that
 * never moves, and pressing it goes to the path without opening the block.
 */
export const AFoldOpening: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /fs_read/ })
    const path = canvas.getByRole('button', { name: 'src/billing/export.ts' })
    // A press inside the fold's own button would be one the keyboard walks over.
    await expect(row.contains(path)).toBe(false)
    await userEvent.click(path)
    await expect(args.onOpenPath).toHaveBeenCalledWith('src/billing/export.ts')
    await expect(row, 'a press on the path opened the block').toHaveAttribute(
      'aria-expanded',
      'false',
    )

    const closed = path.getBoundingClientRect().top
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    const moved = () => Math.abs(path.getBoundingClientRect().top - closed) > 0.5
    await expect(await withinFrames(moved, A_FOLD), 'the path slid while the block opened').toBe(
      false,
    )
    await expect(canvas.getByText('token 7f31c0')).toBeVisible()
  },
}

/** The fold closing: the path stays on its line while the body folds away under it. */
export const AFoldClosing: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /fs_read/ })
    const path = canvas.getByRole('button', { name: 'src/billing/export.ts' })
    await expect(canvas.getByText('token 7f31c0')).toBeVisible()
    const open = path.getBoundingClientRect().top
    const moved = () => Math.abs(path.getBoundingClientRect().top - open) > 0.5

    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(await withinFrames(moved, A_FOLD), 'the path slid while the block closed').toBe(
      false,
    )
    await waitFor(() => {
      expect(canvas.queryByText('token 7f31c0')).toBeNull()
    })
    await expect(moved()).toBe(false)
  },
}

/** A call that is done, folded: the tool, the state, and the file it read. */
export const ReadFolded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The mark is the whole difference from a native call, so it is read on the line, and heard
    // as the word it stands for: the line reads "Hemera, the tool, where the call stands".
    const mark = canvas.getByRole('img', { name: 'Hemera' })
    await expect(mark).toBeVisible()
    // Two tones, the tint pair of a badge: the square in the muted fill, the `H` on it.
    const [square, letter] = [...mark.querySelectorAll('path')].map(
      (path) => getComputedStyle(path).fill,
    )
    await expect(square).not.toBe(letter)
    await expect(canvas.getByText('fs_read')).toBeVisible()
    const row = canvas.getByRole('button', { name: 'Hemera fs_read Done' })
    // Where it stands is a dot, and the word is only what the dot is announced by.
    await expect(canvas.getByRole('img', { name: 'Done' })).toBeVisible()
    await expect(canvas.queryByText('Done')).toBeNull()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.getByText('src/billing/export.ts')).toBeVisible()
  },
}

/** The same call opened: what it was asked, what it answered, and where it was made from. */
export const ReadOpen: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /fs_read/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('0–262144')).toBeVisible()
    await expect(canvas.getByText('token 7f31c0')).toBeVisible()
    await expect(canvas.getByText('18 ms')).toBeVisible()
  },
}

/** A write: one effect, and the idempotency key it was asked under. */
export const Written: Story = {
  args: {
    tool: 'fs_write',
    summary: 'src/billing/export.test.ts written, 1 204 bytes.',
    arguments: [
      { label: 'path', value: 'src/billing/export.test.ts' },
      { label: 'key', value: 'write-export-test' },
    ],
    paths: ['src/billing/export.test.ts'],
    ms: 9,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /fs_write/ }))
    await expect(canvas.getByText('write-export-test')).toBeVisible()
    await expect(canvas.getByText(/1 204 bytes/)).toBeVisible()
  },
}

/** An edit: the unique text it replaced, and the file it left behind. */
export const Edited: Story = {
  args: {
    tool: 'fs_edit',
    summary: '1 occurrence replaced in src/billing/export.ts.',
    arguments: [
      { label: 'path', value: 'src/billing/export.ts' },
      { label: 'old', value: 'const lines = rows.map((row) => format(row))' },
      { label: 'new', value: 'for (const row of rows) await out.write(format(row))' },
    ],
    paths: ['src/billing/export.ts'],
    ms: 12,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /fs_edit/ }))
    await expect(canvas.getByText(/const lines = rows\.map/)).toBeVisible()
    await expect(canvas.getByText(/1 occurrence replaced/)).toBeVisible()
  },
}

/** A search that hit its bound: the limit it hit is said, and the cursor goes on from there. */
export const SearchTruncated: Story = {
  args: {
    tool: 'search',
    summary: '200 matches shown of more, 1 MiB scanned — cursor eyJvZmZzZXQiOjIwMH0.',
    arguments: [
      { label: 'query', value: 'exportInvoices' },
      { label: 'scope', value: 'src/' },
    ],
    paths: [],
    ms: 64,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /search/ }))
    await expect(canvas.getByText(/200 matches shown of more/)).toBeVisible()
    await expect(canvas.getByText(/1 MiB scanned/)).toBeVisible()
  },
}

/** A call in flight: the dot that moves, and the body open on what the reader is waiting on. */
export const Running: Story = {
  args: {
    tool: 'search',
    status: 'in_progress',
    summary: 'Searching for exportInvoices under src/.',
    arguments: [{ label: 'query', value: 'exportInvoices' }],
    paths: [],
    ms: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Running' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /search/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

/** A call that failed: the dot says so, and the reason is the first line of the open body. */
export const Failed: Story = {
  args: {
    tool: 'fs_read',
    status: 'failed',
    summary: 'Nothing read.',
    error: 'src/billing/export.csv does not exist.',
    arguments: [{ label: 'path', value: 'src/billing/export.csv' }],
    paths: [],
    ms: 3,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Failed' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /fs_read/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(canvas.getByText(/does not exist/)).toBeVisible()
  },
}

/** A call Hemera refused: nothing ran, and the reason is on the line, not behind a fold. */
export const Refused: Story = {
  args: {
    tool: 'fs_write',
    status: 'refused',
    summary: 'No effect: the Session does not offer fs_write.',
    error: 'The guard refused this call: fs_write is not in the set of this Session.',
    arguments: [{ label: 'path', value: '/etc/hosts' }],
    paths: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /fs_write/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('img', { name: 'Refused' })).toBeVisible()
    await expect(canvas.getByText(/not in the set of this Session/)).toBeVisible()
    await userEvent.click(row)
    await expect(row, 'a refusal folds away under the reader\u2019s hand').toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

/** A write outside the Workspace root: it is waiting for the reader, and it says so. */
export const WaitingForYou: Story = {
  args: {
    tool: 'fs_write',
    status: 'pending',
    summary: 'Held: the permission block of this turn is asking the reader.',
    arguments: [{ label: 'path', value: '/home/someone/notes.md' }],
    paths: [],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Waiting for you' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /fs_write/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

/** The catalogue as the thread reads it: one line per tool, with the state of the call. */
export const EveryTool: Story = {
  args: { status: 'in_progress' },
  render: () => (
    <div className="flex flex-col gap-1">
      {(
        [
          ['fs_read', 'Reading src/billing/export.ts'],
          ['fs_write', 'Writing src/billing/export.test.ts'],
          ['fs_edit', 'Editing src/billing/export.ts'],
          ['fs_list', 'Listing src/billing'],
          ['search', 'Searching for exportInvoices'],
          ['commands_list', 'Reading the catalogue'],
          ['commands_run', 'Running check'],
          ['commands_output', 'Reading the output of check'],
          ['commands_stop', 'Stopping check'],
          ['project_get', 'Reading the Project'],
          ['session_get', 'Reading this Session'],
        ] as const
      ).map(([tool, summary]) => (
        <HemeraToolCall
          key={tool}
          tool={tool}
          status="in_progress"
          summary={summary}
          provenance={PROVENANCE}
        />
      ))}
    </div>
  ),
}
