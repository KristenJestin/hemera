import type { Meta, StoryObj } from '@storybook/react-vite'
import { MotionConfig } from 'motion/react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CHECKPOINT, EMPTY, LONG, OUTSIDE, REVIEWING } from './diff-fixtures.ts'
import {
  codeText,
  commentOf,
  drawnSplit,
  goToFile,
  hasRow,
  headOf,
  stageOf,
  tabTo,
  treeRow,
} from './diff-play.ts'
import { DiffScreen, type DiffScreenProps } from './diff-screen-fixture.tsx'

/**
 * The diff of a mission: a view of the mission's stack like every other, a wide sheet over the
 * base with its crumb — `ACME-12 › Review · round 1 › Diff` — opened from Review or from
 * Building · round N, and Back finds the base intact. The tree of what changed on the left, one
 * root per repository; every file in one scroll beside it, drawn by `@pierre/diffs`. Comments
 * stand under their lines, and they are the Review page's remarks: one list, the diff their place
 * in the code.
 */
const meta = {
  title: 'Surfaces/Diff',
  component: DiffScreen,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: {
    moment: REVIEWING,
    onComment: fn(),
    onAction: fn(),
    onEdit: fn(),
    onFollowUp: fn(),
    onShow: fn(),
    onOpenForge: fn(),
    onOpenVersion: fn(),
  },
} satisfies Meta<typeof DiffScreen>

export default meta
type Story = StoryObj<typeof meta>

const body = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body)

/** The last crumb of the trail: where the user is. */
const here = (canvasElement: HTMLElement): string =>
  canvasElement.ownerDocument.querySelector('[aria-current="page"]')?.textContent ?? ''

// --- The tree -------------------------------------------------------------------------------

/**
 * One root per repository of the Workspace, each with its totals; under it, every file with
 * Git's letter and its counts. `.env.local` and `notes/export-plan.md` are not tracked yet (U).
 * `export.ts` is in `api` and in `web`: two rows under two roots, never one.
 */
export const TreeTwoRoots: Story = {
  play: async ({ canvasElement }) => {
    for (const root of ['api', 'web', 'shared']) {
      // oxlint-disable-next-line no-await-in-loop -- one root after the other
      await expect(await treeRow(canvasElement, `${root}/`)).toHaveAttribute('aria-level', '1')
    }
    const api = await treeRow(canvasElement, 'api/src/billing/export.ts')
    const web = await treeRow(canvasElement, 'web/src/billing/export.ts')
    await expect(api).not.toBe(web)
    await expect(api).toHaveAttribute('data-item-git-status', 'added')
    await expect(await treeRow(canvasElement, 'api/.env.local')).toHaveAttribute(
      'data-item-git-status',
      'untracked',
    )
    await expect(await treeRow(canvasElement, 'web/src/billing/legacy-export.ts')).toHaveAttribute(
      'data-item-git-status',
      'deleted',
    )
    await expect(await treeRow(canvasElement, 'api/')).toHaveTextContent(/\+89/)
    await expect(api).toHaveTextContent(/\+40/)
  },
}

/** Search in the tree: what does not match leaves it, and both `export.ts` stay. */
export const SearchInTheTree: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(
      body(canvasElement).getByRole('textbox', { name: 'Find a file' }),
      'export.ts',
    )
    await waitFor(() =>
      expect(hasRow(canvasElement, 'shared/src/billing/time-zone.ts')).toBe(false),
    )
    await expect(await treeRow(canvasElement, 'api/src/billing/export.ts')).toBeVisible()
    await expect(await treeRow(canvasElement, 'web/src/billing/export.ts')).toBeVisible()
  },
}

// --- The files ------------------------------------------------------------------------------

/**
 * Every file one after the other in one scroll, in the tree's order, each under its head: its
 * repository, its path, its letter, its counts, its comments. A file chosen in the tree is
 * brought to the top.
 */
export const EveryFileInOneScroll: Story = {
  play: async ({ canvasElement }) => {
    const first = await headOf(canvasElement, 'api/db/migrations/0042_invoice_exports.sql')
    await expect(within(first).getByText('api')).toBeVisible()
    await waitFor(() => expect(codeText(canvasElement)).toMatch(/CREATE TABLE invoice_exports/))
    const zone = await goToFile(canvasElement, 'shared/src/billing/time-zone.ts')
    await expect(zone).toHaveTextContent('1 comment')
    await waitFor(() => expect(codeText(canvasElement)).toMatch(/formatOf\(zone\)/))
  },
}

/** Each file folds on its own, from its head, and opens again. */
export const FoldingAFile: Story = {
  play: async ({ canvasElement }) => {
    const head = await headOf(canvasElement, 'api/db/migrations/0042_invoice_exports.sql')
    const fold = within(head).getByRole('button', { name: /^Fold api\/db/ })
    await userEvent.click(fold)
    await waitFor(() => expect(codeText(canvasElement)).not.toMatch(/CREATE TABLE invoice_exports/))
    const unfold = within(head).getByRole('button', { name: /^Unfold api\/db/ })
    await expect(unfold).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(unfold)
    await waitFor(() => expect(codeText(canvasElement)).toMatch(/CREATE TABLE invoice_exports/))
  },
}

/** Split and stacked are one toggle, the view's: stacked at rest, where the sheet is narrow. */
export const SplitAndStacked: Story = {
  play: async ({ canvasElement }) => {
    const layout = within(body(canvasElement).getByRole('group', { name: 'Layout of the diff' }))
    await expect(layout.getByRole('button', { name: 'Stacked' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(layout.getByRole('button', { name: 'Split' }))
    await expect(layout.getByRole('button', { name: 'Split' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await waitFor(() => expect(drawnSplit(canvasElement)).toBe(true))
  },
}

/** Split, as the grown sheet reads it best. */
export const Split: Story = { args: { layout: 'split' } }

/** A generated file comes folded, said by its mark, and opens from its head. */
export const GeneratedFileFolded: Story = {
  play: async ({ canvasElement }) => {
    const head = await goToFile(canvasElement, 'web/src/api/generated/client.ts')
    await expect(within(head).getByRole('img', { name: /^Generated/ })).toBeVisible()
    const unfold = within(head).getByRole('button', { name: /^Unfold web\/src\/api/ })
    await expect(unfold).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(unfold)
    await waitFor(() => expect(codeText(canvasElement)).toMatch(/exportInvoices: \{/))
  },
}

/** A binary file is its head and its sizes: nothing to fold, nothing to comment on. */
export const BinaryFileSizes: Story = {
  play: async ({ canvasElement }) => {
    const head = await goToFile(canvasElement, 'web/public/icons/download.png')
    await expect(head).toHaveTextContent('1.2 KB → 1.6 KB')
    await expect(within(head).queryByRole('button', { name: /^(Fold|Unfold)/ })).toBeNull()
    await expect(within(head).queryByRole('button', { name: /^Comment on/ })).toBeNull()
  },
}

/** A file of 10,000 lines waits for its Show, then scrolls as a short one. */
export const LargeFileOnRequest: Story = {
  play: async ({ canvasElement, args }) => {
    const head = await goToFile(canvasElement, 'web/src/billing/fixtures/invoices.csv')
    await userEvent.click(within(head).getByRole('button', { name: 'Show its 10,000 lines' }))
    await expect(args.onShow).toHaveBeenCalledWith('web/src/billing/fixtures/invoices.csv')
    // Ten thousand lines are parsed and highlighted once they arrive: a slow runner takes seconds.
    await waitFor(() => expect(codeText(canvasElement)).toMatch(/ACME-INV-0000/), {
      timeout: 10_000,
    })
    await expect(
      within(await headOf(canvasElement, 'web/src/billing/fixtures/invoices.csv')).getByRole(
        'button',
        {
          name: /^Fold web/,
        },
      ),
    ).toHaveAttribute('aria-expanded', 'true')
  },
}

/** `web` was changed outside Hemera: its root wears the dot, the file its mark, in words. */
export const ChangedOutsideHemera: Story = {
  args: { moment: OUTSIDE },
  play: async ({ canvasElement }) => {
    await expect(await treeRow(canvasElement, 'web/')).toHaveTextContent('●')
    const head = await goToFile(canvasElement, 'web/src/billing/invoice-table.tsx')
    await expect(within(head).getByRole('img', { name: 'Changed outside Hemera' })).toBeVisible()
    await expect(head).toHaveTextContent(
      'src/billing/invoices-table.tsx→src/billing/invoice-table.tsx',
    )
  },
}

/** A file that may hold secrets is listed, its content withheld: its lock, and nothing else. */
export const SensitiveFileWithheld: Story = {
  play: async ({ canvasElement }) => {
    const head = await goToFile(canvasElement, 'api/.env.local')
    await expect(within(head).getByRole('img', { name: /^Withheld/ })).toBeVisible()
    await expect(
      within(head).queryByRole('button', { name: /^(Fold|Unfold|Comment on)/ }),
    ).toBeNull()
  },
}

// --- Writing a comment ----------------------------------------------------------------------

/** On one line: the line chosen (its number pressed, or the arrows), Enter, the words, Enter. */
export const CommentOnALine: Story = {
  play: async ({ canvasElement, args }) => {
    const stage = await stageOf(canvasElement)
    stage.focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    const where = 'api/db/migrations/0042_invoice_exports.sql, line 1'
    const box = await waitFor(() =>
      body(canvasElement).getByRole('textbox', { name: `A comment on ${where}` }),
    )
    await expect(box).toHaveFocus()
    await userEvent.type(box, 'Name the table after what it holds: export requests.{Enter}')
    await expect(args.onComment).toHaveBeenCalledWith({
      kind: 'remark',
      text: 'Name the table after what it holds: export requests.',
      place: {
        repository: 'api',
        path: 'db/migrations/0042_invoice_exports.sql',
        side: 'new',
        lines: { start: 1, end: 1 },
      },
    })
    const added = await commentOf(canvasElement, 'F15')
    await expect(added).toHaveAccessibleName('F15, waiting for the next round')
    await expect(stage).toHaveFocus()
  },
}

/** On a range: Shift with the arrows stretches the choice, as a drag over the numbers does. */
export const CommentOnARange: Story = {
  play: async ({ canvasElement }) => {
    const stage = await stageOf(canvasElement)
    stage.focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Shift>}{ArrowDown}{ArrowDown}{/Shift}')
    await waitFor(() => expect(body(canvasElement).getByText(/3 lines chosen/)).toBeInTheDocument())
    await userEvent.keyboard('{Enter}')
    await expect(
      await waitFor(() =>
        body(canvasElement).getByRole('textbox', {
          name: 'A comment on api/db/migrations/0042_invoice_exports.sql, lines 2–4',
        }),
      ),
    ).toHaveFocus()
  },
}

/** On the whole file: the head's comment button; the comment stands at the head of its file. */
export const CommentOnAFile: Story = {
  play: async ({ canvasElement, args }) => {
    const head = await headOf(canvasElement, 'api/db/migrations/0042_invoice_exports.sql')
    await userEvent.click(within(head).getByRole('button', { name: /^Comment on the whole file/ }))
    const box = await waitFor(() =>
      body(canvasElement).getByRole('textbox', {
        name: 'A comment on the whole file api/db/migrations/0042_invoice_exports.sql',
      }),
    )
    await userEvent.type(box, 'Add the down migration.{Enter}')
    await expect(args.onComment).toHaveBeenCalledWith(
      expect.objectContaining({ place: expect.objectContaining({ lines: null }) }),
    )
    await expect(await commentOf(canvasElement, 'F15')).toHaveTextContent('Whole file')
  },
}

/** Marked a question: it gets an answer and never becomes a change, as on the Review page. */
export const MarkingItAQuestion: Story = {
  play: async ({ canvasElement, args }) => {
    const stage = await stageOf(canvasElement)
    stage.focus()
    await userEvent.keyboard('{ArrowDown}{Enter}')
    const form = await waitFor(() =>
      body(canvasElement).getByRole('form', { name: /^A comment on/ }),
    )
    await userEvent.click(within(form).getByRole('button', { name: 'Question' }))
    const box = within(form).getByRole('textbox', { name: /^A question on/ })
    await userEvent.type(box, 'Why a uuid rather than a serial?{Enter}')
    await expect(args.onComment).toHaveBeenCalledWith(expect.objectContaining({ kind: 'question' }))
    await expect(
      within(await commentOf(canvasElement, 'F15')).getByRole('img', { name: /^A question/ }),
    ).toBeVisible()
  },
}

// --- Comments under their lines -------------------------------------------------------------

/** Addressed: the agent's answer under it, and Resolve, Follow up, Withdraw. */
export const AddressedWithTheAnswer: Story = {
  args: { at: 'F1' },
  play: async ({ canvasElement, args }) => {
    const comment = within(await commentOf(canvasElement, 'F1'))
    await expect(comment.getByText('What the agent did')).toBeVisible()
    await expect(comment.getByText(/Proven by S15/)).toBeVisible()
    await userEvent.click(comment.getByRole('button', { name: 'Resolve F1' }))
    await expect(args.onAction).toHaveBeenCalledWith('F1', 'resolve')
    await waitFor(() =>
      expect(
        body(canvasElement).getAllByRole('article', { name: /^F1, resolved/ }).length,
      ).toBeGreaterThan(0),
    )
  },
}

/** Its words written again while it waits: Edit opens them in place, Save keeps the new ones. */
export const EditingAComment: Story = {
  args: { at: 'F8' },
  play: async ({ canvasElement, args }) => {
    const comment = within(await commentOf(canvasElement, 'F8'))
    await userEvent.click(comment.getByRole('button', { name: 'Edit F8' }))
    const box = await waitFor(() => comment.getByRole('textbox', { name: 'Edit F8' }))
    await expect(box).toHaveFocus()
    await userEvent.clear(box)
    await userEvent.type(box, 'Select only the columns the CSV writes.{Enter}')
    await expect(args.onEdit).toHaveBeenCalledWith('F8', 'Select only the columns the CSV writes.')
    await waitFor(() =>
      expect(comment.getByText('Select only the columns the CSV writes.')).toBeVisible(),
    )
  },
}

/** Addressed, and not quite: Follow up writes under the answer, and the comment waits again. */
export const FollowingUpAnAnswer: Story = {
  args: { at: 'F1' },
  play: async ({ canvasElement, args }) => {
    const comment = within(await commentOf(canvasElement, 'F1'))
    await userEvent.click(comment.getByRole('button', { name: 'Follow up F1' }))
    const box = await waitFor(() => comment.getByRole('textbox', { name: 'A follow-up on F1' }))
    await expect(box).toHaveFocus()
    await userEvent.type(box, 'Keyboard presses still start a second export.{Enter}')
    await expect(args.onFollowUp).toHaveBeenCalledWith(
      'F1',
      'Keyboard presses still start a second export.',
    )
    await waitFor(() => expect(comment.getByText('Your follow-up')).toBeVisible())
  },
}

/** Waiting for the next round: Edit and Withdraw, nothing else. */
export const WaitingForTheNextRound: Story = {
  args: { at: 'F8' },
  play: async ({ canvasElement, args }) => {
    const comment = within(await commentOf(canvasElement, 'F8'))
    await expect(comment.getByRole('button', { name: 'Edit F8' })).toBeVisible()
    await expect(comment.queryByRole('button', { name: 'Resolve F8' })).toBeNull()
    await userEvent.click(comment.getByRole('button', { name: 'Withdraw F8' }))
    await expect(args.onAction).toHaveBeenCalledWith('F8', 'withdraw')
  },
}

/** In round 2, and moved with its lines since it was written: its mark says from where. */
export const CommentMovedWithItsLines: Story = {
  args: { at: 'F12' },
  play: async ({ canvasElement }) => {
    const comment = within(await commentOf(canvasElement, 'F12'))
    await expect(
      comment.getByRole('img', { name: /^Moved with its lines: written on line/ }),
    ).toBeVisible()
    await expect(comment.getByRole('img', { name: 'In round 2' })).toBeVisible()
    await expect(comment.getByRole('button', { name: 'Withdraw F12' })).toBeVisible()
    await expect(comment.queryByRole('button', { name: 'Edit F12' })).toBeNull()
  },
}

/** Resolved, and withdrawn: each folds to its line, and opens to the whole of it. */
export const ResolvedAndWithdrawn: Story = {
  args: { at: 'F4' },
  play: async ({ canvasElement }) => {
    const resolved = within(await commentOf(canvasElement, 'F4'))
    await expect(resolved.getByRole('button', { name: 'Fold F4' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(resolved.getByText(/the local helper is gone/)).toBeVisible()
    await expect(resolved.queryByRole('button', { name: /^Withdraw/ })).toBeNull()
    const withdrawn = within(await commentOf(canvasElement, 'F5'))
    const open = withdrawn.getByRole('button', { name: 'Open F5' })
    await expect(open).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(open)
    await expect(withdrawn.getByRole('button', { name: 'Fold F5' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  },
}

/**
 * Outdated: its lines changed since it was written. The excerpt it was written on stands in it,
 * and Open the commented version opens that version on top of the diff, its crumb in the trail.
 */
export const OutdatedComment: Story = {
  args: { at: 'F13' },
  play: async ({ canvasElement, args }) => {
    const comment = within(await commentOf(canvasElement, 'F13'))
    await expect(comment.getByRole('img', { name: /^Outdated/ })).toBeVisible()
    await expect(comment.getByText(/toLocaleString\('en-CA'/)).toBeVisible()
    await userEvent.click(comment.getByRole('button', { name: 'Open the commented version' }))
    await expect(args.onOpenVersion).toHaveBeenCalledWith('F13')
    await waitFor(() =>
      expect(
        body(canvasElement).getByRole('heading', { name: 'time-zone.ts · round 1' }),
      ).toBeVisible(),
    )
  },
}

/** A team member's comment from the forge, with its author and the way back there. */
export const TeamCommentFromTheForge: Story = {
  args: { at: 'C1' },
  play: async ({ canvasElement, args }) => {
    const comment = within(await commentOf(canvasElement, 'C1'))
    await expect(comment.getByText('ana.lopez')).toBeVisible()
    await expect(comment.queryByRole('button', { name: /^(Resolve|Withdraw|Edit)/ })).toBeNull()
    await userEvent.click(comment.getByRole('button', { name: 'Open on GitHub' }))
    await expect(args.onOpenForge).toHaveBeenCalledWith(
      'https://github.com/acme/shop/pull/412#discussion_r1',
    )
  },
}

/** Resolved on the forge: folded to its line under mine, its check saying where it was settled. */
export const ResolvedOnTheForge: Story = {
  args: { at: 'C3' },
  play: async ({ canvasElement }) => {
    const comment = within(await commentOf(canvasElement, 'C3'))
    await expect(comment.getByRole('img', { name: 'Resolved on the forge' })).toBeVisible()
    await expect(comment.getByText('chen.wei')).toBeVisible()
    await expect(within(await commentOf(canvasElement, 'F1')).getByText('You')).toBeVisible()
  },
}

// --- Where the diff is read from ------------------------------------------------------------

/**
 * The diff live: round 2 writes `shared` while the user reads. A new file joins the tree and the
 * scroll in its place; what is read does not move. Its mark in the head says it is live.
 */
export const LiveDuringARound: Story = {
  args: { live: true },
  play: async ({ canvasElement }) => {
    const page = body(canvasElement)
    await expect(
      page.getByRole('img', { name: 'Live: round 2 is writing these files' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Building · round 2' })).toBeVisible()
    await treeRow(canvasElement, 'shared/src/billing/zone-label.ts')
    await waitFor(
      () => expect(page.getByRole('button', { name: 'Play the round again' })).toBeVisible(),
      {
        timeout: 15_000,
      },
    )
  },
}

/** After cleanup or Done: the diff from the last checkpoint, said in words, and read only. */
export const ReadFromTheLastCheckpoint: Story = {
  args: { moment: CHECKPOINT, at: 'F1' },
  play: async ({ canvasElement }) => {
    const page = body(canvasElement)
    await expect(
      page.getByText(/^Read from the last checkpoint, 12 October at 17:02/),
    ).toBeVisible()
    const comment = within(await commentOf(canvasElement, 'F1'))
    await expect(comment.queryByRole('button', { name: 'Resolve F1' })).toBeNull()
    await expect(page.queryByRole('button', { name: /^Comment on the whole file/ })).toBeNull()
  },
}

/** Loading: the tree's rows and the files' heads in their known shapes. */
export const Loading: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const page = body(canvasElement)
    await expect(page.getByRole('list', { name: 'Changed files' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    await expect(page.getByRole('region', { name: 'The diff' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
  },
}

/** A gesture refused — a comment withdrawn that a round already took — said once, in words. */
export const GestureRefused: Story = {
  args: { notice: 'A round already took F8: it cannot be withdrawn now.' },
  play: async ({ canvasElement }) => {
    await expect(body(canvasElement).getByRole('status')).toHaveTextContent(
      'A round already took F8',
    )
  },
}

/** The diff could not be read: why, in words, where the diff would be. */
export const ErrorInWords: Story = {
  args: { error: 'Hemera could not read its storage: the disk is full.' },
  play: async ({ canvasElement }) => {
    const alert = body(canvasElement).getByRole('alert')
    await expect(alert).toHaveTextContent('The diff cannot be read')
    await expect(alert).toHaveTextContent('the disk is full')
  },
}

/** Nothing changed yet: the view says so, once. */
export const Empty: Story = {
  args: { moment: EMPTY, from: 'building' },
  play: async ({ canvasElement }) => {
    await expect(body(canvasElement).getByText('Nothing changed yet')).toBeVisible()
  },
}

// --- Its place in the navigation -----------------------------------------------------------

/**
 * From the mission's `…`: the diff opens as a sheet over the base, its crumb after the stage's;
 * Escape gives the base back as it was.
 */
export const OpenedFromTheMission: Story = {
  args: { opened: false },
  play: async ({ canvasElement }) => {
    const page = body(canvasElement)
    await userEvent.click(page.getByRole('button', { name: 'More for ACME-12' }))
    await userEvent.click(await waitFor(() => page.getByRole('menuitem', { name: 'Diff' })))
    await waitFor(() => expect(here(canvasElement)).toBe('Diff'))
    await expect(page.getByRole('button', { name: 'Review · round 1' })).toBeVisible()
    await stageOf(canvasElement)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('heading', { name: 'Diff' })).toBeNull())
  },
}

/** From Building · round 2: the same view, its crumb after the stage. */
export const OpenedFromBuilding: Story = {
  args: { from: 'building' },
  play: async ({ canvasElement }) => {
    await expect(
      body(canvasElement).getByRole('button', { name: 'Building · round 2' }),
    ).toBeVisible()
  },
}

// --- Keyboard, labels, long text, motion ----------------------------------------------------

/**
 * The keyboard path: the sheet's head (layout, expand, close), the tree's search, the tree, the
 * diff; in the diff the arrows walk the lines, Enter opens the comment box with the focus in it,
 * Escape gives it back to the diff. Each stop wears the focus ring.
 */
export const KeyboardPath: Story = {
  play: async ({ canvasElement }) => {
    const page = body(canvasElement)
    const split = page.getByRole('button', { name: 'Split' })
    await tabTo(split)
    await tabTo(page.getByRole('button', { name: 'Expand Diff' }))
    await tabTo(page.getByRole('textbox', { name: 'Find a file' }))
    const stage = await stageOf(canvasElement)
    await tabTo(stage)
    const ring = stage.closest('[data-diff-stage]')
    if (ring === null) throw new Error('No stage around the diff')
    await expect(getComputedStyle(ring, '::after').opacity).toBe('1')
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(page.getByText(/, line 1: CREATE TABLE invoice_exports \(/)).toBeInTheDocument(),
    )
    await userEvent.keyboard('{ArrowDown}{Enter}')
    const box = await waitFor(() => page.getByRole('textbox', { name: /, line 2$/ }))
    await expect(box).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('textbox', { name: /, line 2$/ })).toBeNull())
    await expect(stage).toHaveFocus()
  },
}

/** Long text in every field: a long path in its head, a 2,000-character comment under its lines. */
export const LongText: Story = {
  args: { moment: LONG, at: 'F10' },
  play: async ({ canvasElement }) => {
    const comment = await commentOf(canvasElement, 'F10')
    await expect(comment).toHaveTextContent(/the first point matters most/)
    await expect(
      await headOf(
        canvasElement,
        'web/src/features/billing/invoices/export/components/export-button/export-progress-indicator.tsx',
      ),
    ).toBeVisible()
  },
}

/** Asked for less movement: the sheet, the folds and the comments are there at once. */
export const ReducedMotion: Story = {
  args: { at: 'F1' },
  render: function Render(args: DiffScreenProps) {
    return (
      <MotionConfig reducedMotion="always">
        <DiffScreen {...args} />
      </MotionConfig>
    )
  },
}
