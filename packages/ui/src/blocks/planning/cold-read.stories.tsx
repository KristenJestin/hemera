import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CHANGES, FINDINGS_PASS } from '../../surfaces/planning/planning-fixtures.ts'
import { ColdReadReport } from './cold-read.tsx'
import { settled } from './planning-play.ts'

/**
 * The cold read's report in the rail: its chip while a fresh reader goes through the Spec, its
 * findings by severity with what became of each (asked as a question, fixed by the Planner,
 * dismissed), "the cold read read an earlier text" when the Spec moved since, Dismiss, and "Run
 * another cold read", the user's only way to launch one.
 */
const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Planning/ColdReadReport',
  component: ColdReadReport,
  args: {
    passes: [FINDINGS_PASS],
    freshness: { current: true, changes: [] },
    onDismiss: fn(() => Promise.resolve()),
    onRunAgain: fn(() => Promise.resolve()),
  },
  decorators: [
    (Story) => (
      <div className="w-view-narrow">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ColdReadReport>

export default meta
type Story = StoryObj<typeof meta>

/** Running: its chip, skeleton rows where the findings will be, no other pass to run. */
export const Running: Story = {
  args: {
    passes: [
      {
        ...FINDINGS_PASS,
        state: 'running',
        startedAt: Date.now() - 42_000,
        endedAt: null,
        findings: [],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: /Cold read C1/ })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Findings' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    await expect(canvas.queryByRole('button', { name: 'Run another cold read' })).toBeNull()
  },
}

/** Its findings by severity, blocking first, each with its fate; Dismiss on what is open. */
export const Findings: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    const rows = within(canvas.getByRole('list', { name: 'Findings' })).getAllByRole('listitem')
    await expect(rows).toHaveLength(4)
    await expect(within(rows[0]!).getByRole('img', { name: 'Blocking' })).toBeVisible()
    await expect(rows[0]).toHaveTextContent('Asked as Q8')
    await expect(rows[1]).toHaveTextContent('Fixed by the Planner')
    const pressed = canvas.getByRole('button', { name: 'Dismiss C1.F3' })
    await userEvent.click(pressed)
    await expect(args.onDismiss).toHaveBeenCalledWith('C1.F3')
    await settled(pressed)
    const again = canvas.getByRole('button', { name: 'Run another cold read' })
    await userEvent.click(again)
    await expect(args.onRunAgain).toHaveBeenCalled()
    await settled(again)
  },
}

/** The Spec moved since the pass read it: said in plain words, the changes folded under it. */
export const EarlierText: Story = {
  args: { freshness: { current: false, changes: CHANGES } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const line = canvas.getByRole('button', { name: /The cold read read an earlier text/ })
    await expect(line).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(line)
    await expect(
      await canvas.findByRole('list', { name: 'Changed since the cold read' }),
    ).toBeVisible()
    await expect(canvas.queryByText(/version/i)).toBeNull()
  },
}

/** Failed: why, in words, and another pass to run. */
export const Failed: Story = {
  args: {
    passes: [
      {
        ...FINDINGS_PASS,
        state: 'failed',
        failure: 'its session gave no sign for five minutes and was ended. Nothing was read.',
        findings: [],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(/The cold read failed: its session gave no sign/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Run another cold read' })).toBeVisible()
  },
}

/** Nothing found: said once. */
export const NothingFound: Story = {
  args: { passes: [{ ...FINDINGS_PASS, findings: [] }] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Nothing found.')).toBeVisible()
  },
}

/** No pass yet: the card is not drawn. */
export const NotYet: Story = {
  args: { passes: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('region', { name: 'Cold read' })).toBeNull()
  },
}
