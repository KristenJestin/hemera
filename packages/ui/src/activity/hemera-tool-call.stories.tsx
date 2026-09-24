import type { Meta, StoryObj } from '@storybook/react-vite'
import { type ReactNode, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { movesLess, withinFrames } from '../../.storybook/reduced-motion.ts'
import { HemeraToolCall, type HemeraToolMark } from './hemera-tool-call.tsx'

/**
 * A call to a tool Hemera lent the agent (design D6-06).
 *
 * The stories are the states a call is read in: a read that is done and folded, the same call
 * opened by the reader, an edit, a write, a search that hit its limit, a call in flight, a call
 * that failed, a call Hemera refused, and a write waiting for the reader's decision, then the
 * whole catalogue, one line per tool. The line carries the tool's own mark, its label, what the
 * call is about, in the tone of a caption (recettes 3 and 5), and no brand;
 * the word `Hemera` is still what the line is announced by. Where the call stands is the dot,
 * and how long it took is the dot's hover (recette 4): the provenance is the entry's and the
 * Journal's, and no foot of identifiers closes the body.
 */

const meta = {
  tags: ['autodocs', 'updated'],
  title: 'Blocks/Activity/HemeraToolCall',
  component: HemeraToolCall,
  parameters: { layout: 'padded' },
  args: {
    tool: 'fs_read',
    label: 'Read file',
    mark: 'read-file',
    subject: { text: 'src/billing/export.ts', path: 'src/billing/export.ts' },
    status: 'completed',
    summary: '4 812 bytes read from src/billing/export.ts, 1 of 1 page.',
    arguments: [
      { label: 'path', value: 'src/billing/export.ts' },
      { label: 'range', value: '0–262144' },
    ],
    ms: 18,
    onOpenPath: fn(),
  },
  argTypes: {
    tool: { control: 'text', description: 'The tool, as the catalogue names it.' },
    label: { control: 'text', description: 'What a reader calls the tool.' },
    mark: { control: 'select', description: 'The tool’s own mark.' },
    subject: {
      control: 'object',
      description: 'What the call is about; a path is the press that goes there.',
    },
    status: {
      control: 'inline-radio',
      options: ['pending', 'in_progress', 'completed', 'failed', 'refused'],
      description: 'Where the call stands: running and waiting are held open, done folds.',
    },
    summary: { control: 'text', description: 'What the call returned, in one line.' },
    arguments: { control: 'object', description: 'The arguments as they were bounded.' },
    ms: { control: 'number', description: 'How long the call took: the dot’s hover.' },
    error: { control: 'text', description: 'Why the call failed, or why it was refused.' },
    onOpenPath: { control: false, description: 'What a press on a subject that is a path does.' },
    children: { control: false, description: 'What the call returned, already drawn.' },
  },
} satisfies Meta<typeof HemeraToolCall>

export default meta

type Story = StoryObj<typeof meta>

/** How many frames a fold is watched for: the better part of the journey of the spring. */
const A_FOLD = 30

/**
 * The fold opening, with the path the call touched on its line (trials of 23 September 2026).
 *
 * The press on the path sat beside the whole fold and was centred on it, so it slid down the
 * block while the body opened under it. It is on the fold's own line now, the one line that
 * never moves, and pressing it goes to the path without opening the block. Since recette 3 it is
 * the subject itself, where the line is read, and there is no second copy of it at the end.
 */
export const AFoldOpening: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read file/ })
    const path = canvas.getByRole('button', { name: 'src/billing/export.ts' })
    // A press inside the fold's own button would be one the keyboard walks over.
    await expect(row.contains(path)).toBe(false)
    // Once: the subject is the press, and nothing else on the line names the file.
    await expect(canvas.getAllByText('src/billing/export.ts')).toHaveLength(1)
    // Where it is read: after the label, before the dot.
    const label = canvas.getByText('Read file').getBoundingClientRect()
    const dot = canvas.getByRole('img', { name: 'Done' }).getBoundingClientRect()
    const at = path.getBoundingClientRect()
    await expect(at.left).toBeGreaterThan(label.right)
    await expect(at.right).toBeLessThanOrEqual(dot.left)
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
    await expect(canvas.getByText('0–262144')).toBeVisible()
  },
}

/** The fold closing: the path stays on its line while the body folds away under it. */
export const AFoldClosing: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read file/ })
    const path = canvas.getByRole('button', { name: 'src/billing/export.ts' })
    await expect(canvas.getByText('0–262144')).toBeVisible()
    const open = path.getBoundingClientRect().top
    const moved = () => Math.abs(path.getBoundingClientRect().top - open) > 0.5

    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(await withinFrames(moved, A_FOLD), 'the path slid while the block closed').toBe(
      false,
    )
    await waitFor(() => {
      expect(canvas.queryByText('0–262144')).toBeNull()
    })
    await expect(moved()).toBe(false)
  },
}

/** A call that is done, folded: the mark, the label, the file it read, the tool, the state. */
export const ReadFolded: Story = {
  // A subject that is not a press, so the line is the fold's own button and nothing else.
  args: { subject: { text: 'src/billing/export.ts' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The line wears the tool's own mark and no brand: the word `Hemera` is only heard, so the
    // line reads "Hemera, what the tool does, what it did it to, where the call stands".
    const row = canvas.getByRole('button', { name: 'Hemera Read file src/billing/export.ts Done' })
    const mark = row.querySelector('[data-mark]')
    await expect(mark).toHaveAttribute('data-mark', 'read-file')
    await expect(mark?.querySelector('svg')).toBeVisible()
    await expect(canvas.queryByRole('img', { name: 'Hemera' })).toBeNull()
    // The whole line is a caption (recette 5 of 24 September 2026): the label and the subject are
    // drawn in the tone of the mark, and the catalogue's name is not on the line at all.
    const label = canvas.getByText('Read file')
    const quiet = getComputedStyle(mark ?? label).color
    await expect(getComputedStyle(label).color).toBe(quiet)
    await expect(canvas.queryByText('fs_read')).toBeNull()
    // The subject is mono, as a path is read, and in the same tone.
    const subject = canvas.getByText('src/billing/export.ts')
    await expect(getComputedStyle(subject).fontFamily).toMatch(/mono|Fira/i)
    await expect(getComputedStyle(subject).color).toBe(quiet)
    // Where it stands is a dot, and the word is only what the dot is announced by.
    await expect(canvas.getByRole('img', { name: 'Done' })).toBeVisible()
    await expect(canvas.queryByText('Done')).toBeNull()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(subject).toBeVisible()
  },
}

/**
 * The same call opened: what it was asked and what it answered, and nothing under it.
 *
 * The foot of identifiers is gone (recette 4 of 23 September 2026): the Session, the agent and
 * the token are the entry's and the Journal's, and how long the call took is the dot's hover
 * and what the dot is described by.
 */
export const ReadOpen: Story = {
  args: { defaultOpen: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read file/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('0–262144')).toBeVisible()
    await expect(canvas.getByText(/4 812 bytes read/)).toBeVisible()
    // The catalogue's name heads the arguments, as the first pair of the list.
    const first = canvasElement.querySelector('dl > div')
    await expect(first).toHaveTextContent('toolfs_read')
    // No foot: no token, no agent, no duration written on the page.
    await expect(canvas.queryByText(/token/)).toBeNull()
    await expect(canvas.queryByText(/ms/)).toBeNull()
    const dot = canvas.getByRole('img', { name: 'Done' })
    await expect(dot).toHaveAttribute('title', '18 ms')
    await expect(dot).toHaveAccessibleDescription('18 ms')
  },
}

/** A write: one effect, and the idempotency key it was asked under. */
export const Written: Story = {
  args: {
    tool: 'fs_write',
    label: 'Write file',
    mark: 'write-file',
    subject: { text: 'src/billing/export.test.ts', path: 'src/billing/export.test.ts' },
    summary: 'src/billing/export.test.ts written, 1 204 bytes.',
    arguments: [
      { label: 'path', value: 'src/billing/export.test.ts' },
      { label: 'key', value: 'write-export-test' },
    ],
    ms: 9,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Write file/ }))
    await expect(canvas.getByText('write-export-test')).toBeVisible()
    await expect(canvas.getByText(/1 204 bytes/)).toBeVisible()
  },
}

/** An edit: the unique text it replaced, and the file it left behind. */
export const Edited: Story = {
  args: {
    tool: 'fs_edit',
    label: 'Edit file',
    mark: 'edit-file',
    summary: '1 occurrence replaced in src/billing/export.ts.',
    arguments: [
      { label: 'path', value: 'src/billing/export.ts' },
      { label: 'old', value: 'const lines = rows.map((row) => format(row))' },
      { label: 'new', value: 'for (const row of rows) await out.write(format(row))' },
    ],
    ms: 12,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Edit file/ }))
    await expect(canvas.getByText(/const lines = rows\.map/)).toBeVisible()
    await expect(canvas.getByText(/1 occurrence replaced/)).toBeVisible()
  },
}

/** A search that hit its bound: the limit it hit is said, and the cursor goes on from there. */
export const SearchTruncated: Story = {
  args: {
    tool: 'search',
    label: 'Search',
    mark: 'search',
    subject: { text: '"exportInvoices" in src/' },
    summary: '200 matches shown of more, 1 MiB scanned — cursor eyJvZmZzZXQiOjIwMH0.',
    arguments: [
      { label: 'query', value: 'exportInvoices' },
      { label: 'scope', value: 'src/' },
    ],
    ms: 64,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: /Search/ }))
    await expect(canvas.getByText(/200 matches shown of more/)).toBeVisible()
    await expect(canvas.getByText(/1 MiB scanned/)).toBeVisible()
  },
}

/** A call in flight: the dot that moves, and the body open on what the reader is waiting on. */
export const Running: Story = {
  args: {
    tool: 'search',
    label: 'Search',
    mark: 'search',
    subject: { text: '"exportInvoices"' },
    status: 'in_progress',
    summary: 'Searching for exportInvoices under src/.',
    arguments: [{ label: 'query', value: 'exportInvoices' }],
    ms: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Running' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Search/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

/**
 * A call that failed: the dot says so, and the reason is the first line of the open body.
 *
 * Said once (recette 4 of 23 September 2026): the entry's summary is the error itself, and the
 * red line is all that is drawn of it.
 */
export const Failed: Story = {
  args: {
    tool: 'fs_read',
    status: 'failed',
    summary: 'src/billing/export.csv does not exist.',
    error: 'src/billing/export.csv does not exist.',
    subject: { text: 'src/billing/export.csv', path: 'src/billing/export.csv' },
    arguments: [{ label: 'path', value: 'src/billing/export.csv' }],
    ms: 3,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Failed' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Read file/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(canvas.getByText(/does not exist/)).toBeVisible()
    await expect(canvas.getAllByText(/does not exist/)).toHaveLength(1)
  },
}

/** A call Hemera refused: nothing ran, and it opens on the reason, which the reader may fold. */
export const Refused: Story = {
  args: {
    tool: 'fs_write',
    label: 'Write file',
    mark: 'write-file',
    subject: { text: '/etc/hosts', path: '/etc/hosts' },
    status: 'refused',
    summary: 'No effect: the Session does not offer fs_write.',
    error: 'The guard refused this call: fs_write is not in the set of this Session.',
    arguments: [{ label: 'path', value: '/etc/hosts' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Write file/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('img', { name: 'Refused' })).toBeVisible()
    await expect(canvas.getByText(/not in the set of this Session/)).toBeVisible()
    // Over, so the reader's to fold (recette 4 of 23 September 2026).
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
  },
}

/**
 * A failed call folds (recette 4 of 23 September 2026): it opens on its reason, and once it is
 * over the fold is the reader's. It used to be held open for good, in the way of the thread.
 */
export const AFailedCallFolds: Story = {
  args: {
    status: 'failed',
    summary: 'src/billing/export.csv does not exist.',
    error: 'src/billing/export.csv does not exist.',
    ms: 3,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Read file/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => {
      expect(canvas.queryByText(/does not exist/)).toBeNull()
    })
  },
}

/** A call in flight stays open: a press on its line does not fold what the reader waits on. */
export const ARunningCallStaysOpen: Story = {
  args: {
    tool: 'search',
    label: 'Search',
    mark: 'search',
    subject: { text: '"exportInvoices"' },
    status: 'in_progress',
    summary: 'Searching for exportInvoices under src/.',
    arguments: [{ label: 'query', value: 'exportInvoices' }],
    ms: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Search/ })
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/Searching for exportInvoices/)).toBeVisible()
  },
}

/** A call that runs, then ends as it is told: the line, and the button that ends it, as a turn would. */
function EndingCall({ ending }: { ending: 'completed' | 'failed' }): ReactNode {
  const [over, setOver] = useState(false)
  const failed = ending === 'failed'
  const answer = failed ? 'src/ could not be read.' : '3 match(es) for "exportInvoices"'
  return (
    <div className="flex flex-col items-start gap-2">
      <button type="button" onClick={() => setOver(true)}>
        End the call
      </button>
      <HemeraToolCall
        tool="search"
        label="Search"
        mark="search"
        status={over ? ending : 'in_progress'}
        summary={over ? answer : 'Searching for exportInvoices.'}
        error={over && failed ? answer : undefined}
        arguments={[{ label: 'query', value: 'exportInvoices' }]}
        ms={over ? 64 : undefined}
      />
    </div>
  )
}

/**
 * A call that ends done folds itself at that moment (recette 5 of 24 September 2026): held open
 * while it ran, folded on `collapse` once it is over — the body folds away rather than vanishing —
 * and the reader can open it again.
 */
export const ACallThatEndsFolds: Story = {
  render: () => <EndingCall ending="completed" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Search/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('exportInvoices')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'End the call' }))
    await expect(canvas.getByRole('img', { name: 'Done' })).toBeVisible()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    if (!movesLess()) {
      // Mid-exit: the line already says it is folded, and the body is still in the page folding
      // away. A body that snapped shut would be gone here.
      await expect(canvas.getByText('exportInvoices')).toBeInTheDocument()
    }
    await waitFor(() => {
      expect(canvas.queryByText('exportInvoices')).toBeNull()
    })
    // Over, and the reader's: it opens again on what it answered.
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText(/3 match\(es\)/)).toBeVisible()
  },
}

/**
 * A call that ends failing stays open on its reason, as decided in recette 4 of 23 September
 * 2026, and folds under the reader's next press.
 */
export const AFailedCallStaysOpen: Story = {
  render: () => <EndingCall ending="failed" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const row = canvas.getByRole('button', { name: /Search/ })
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'End the call' }))
    await expect(canvas.getByRole('img', { name: 'Failed' })).toBeVisible()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('src/ could not be read.')).toBeVisible()
    await userEvent.click(row)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
  },
}

/** A write outside the Workspace root: it is waiting for the reader, and it says so. */
export const WaitingForYou: Story = {
  args: {
    tool: 'fs_write',
    label: 'Write file',
    mark: 'write-file',
    subject: { text: '/home/someone/notes.md', path: '/home/someone/notes.md' },
    status: 'pending',
    summary: 'Held: the permission block of this turn is asking the reader.',
    arguments: [{ label: 'path', value: '/home/someone/notes.md' }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('img', { name: 'Waiting for you' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: /Write file/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

/**
 * The catalogue, one line per tool, each as a call with realistic arguments would draw it:
 * the tool, what a reader calls it, its mark, and what it is about.
 */
const CATALOGUE: readonly (readonly [string, string, HemeraToolMark, string | null, string])[] = [
  ['fs_read', 'Read file', 'read-file', 'notes.md', 'Reading notes.md'],
  ['fs_list', 'List folder', 'list-folder', 'src/billing', 'Listing src/billing'],
  ['search', 'Search', 'search', '"exportInvoices" in src', 'Searching for exportInvoices'],
  ['fs_write', 'Write file', 'write-file', 'src/billing/export.test.ts', 'Writing the test'],
  ['fs_edit', 'Edit file', 'edit-file', 'src/billing/export.ts', 'Editing the export'],
  ['commands_run', 'Run command', 'run-command', 'check', 'Running check'],
  ['commands_stop', 'Stop command', 'stop-command', 'dev', 'Stopping dev'],
  ['commands_list', 'List commands', 'list-commands', null, 'Reading the catalogue'],
  ['commands_output', 'Command output', 'command-output', 'check', 'Reading the output of check'],
  ['commands_propose', 'Propose command', 'propose-command', 'test', 'Proposing test'],
  ['project_get', 'Project', 'project', null, 'Reading the Project'],
  ['session_get', 'Session', 'session', null, 'Reading this Session'],
  ['spec_read', 'Read Spec', 'read-spec', 'HEM-7', 'Reading HEM-7'],
  ['spec_write', 'Write Spec', 'write-spec', 'scope', 'Writing the scope'],
  ['spec_propose', 'Propose', 'propose-spec', 'shape', 'Declaring shape finished'],
]

/**
 * The catalogue as the thread reads it (recette 3 of 23 September 2026): fifteen tools, fifteen
 * marks and fifteen labels, and what each call is about where it is about something. A mark per
 * kind of tool drew `fs_list` as `fs_read` and the four commands as one.
 */
export const EveryTool: Story = {
  args: { status: 'completed' },
  render: () => (
    <div className="flex flex-col gap-1">
      {CATALOGUE.map(([tool, label, mark, subject, summary]) => (
        <HemeraToolCall
          key={tool}
          tool={tool}
          label={label}
          mark={mark}
          subject={subject === null ? undefined : { text: subject }}
          status="completed"
          summary={summary}
        />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const marks = [...canvasElement.querySelectorAll('[data-mark]')]
    await expect(marks).toHaveLength(CATALOGUE.length)
    await expect(new Set(marks.map((mark) => mark.getAttribute('data-mark'))).size).toBe(
      CATALOGUE.length,
    )
    // One picture per tool, and not one drawn twice.
    const pictures = marks.map((mark) => mark.querySelector('svg')?.getAttribute('class') ?? '')
    await expect(new Set(pictures).size).toBe(CATALOGUE.length)
    for (const [tool, label, mark, subject] of CATALOGUE) {
      const name = ['Hemera', label, subject, 'Done'].filter((word) => word !== null).join(' ')
      const row = canvas.getByRole('button', { name })
      expect(row.querySelector('[data-mark]')).toHaveAttribute('data-mark', mark)
      // Folded, a call reads its label, its subject and its dot, and not its code name.
      expect(within(row).queryByText(tool)).toBeNull()
      if (subject !== null) expect(within(row).getByText(subject)).toBeVisible()
    }
    // The code name is in the body, heading the arguments: "List folder src/billing" reads
    // `fs_list` once it is opened.
    const list = canvas.getByRole('button', { name: 'Hemera List folder src/billing Done' })
    await userEvent.click(list)
    await expect(canvas.getByText('fs_list')).toBeVisible()
    await expect(canvas.getByText('fs_list').previousElementSibling).toHaveTextContent('tool')
  },
}
