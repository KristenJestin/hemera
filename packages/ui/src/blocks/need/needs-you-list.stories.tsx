import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Frame } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import { type NeedRow, NeedsYouList } from './needs-you-list.tsx'

/** Needs you across every Project, in a frame under its head: the application's first. */
const ROWS: readonly NeedRow[] = [
  {
    id: 'git',
    project: 'Hemera',
    need: {
      title: 'Git is not on the PATH',
      text: 'Hemera finds no git command: no Workspace can be made.',
      when: '2 h',
      ask: { kind: 'environment', action: 'Retry' },
    },
  },
  {
    id: 'ssh',
    project: 'Acme',
    need: {
      title: 'Read the deploy host from the SSH configuration',
      text: 'I need the staging host to write the deploy step of the api.',
      missionKey: 'ACME-12',
      when: '25 min',
      role: 'builder',
      ask: {
        kind: 'permission',
        command: 'cat ~/.ssh/config',
        agentReason: 'The deploy step needs the staging host and its user.',
        hemeraReason: 'Outside the Workspace: ~/.ssh/config',
        choices: ['allow-once', 'allow-for-mission', 'deny'],
      },
    },
  },
  {
    id: 'table',
    project: 'Acme',
    need: {
      title: 'Which table holds the invoices?',
      text: 'Both tables exist in the api and in shared; the Spec names neither.',
      missionKey: 'ACME-14',
      when: '12 min',
      role: 'planner',
      ask: {
        kind: 'decision',
        options: [
          { label: 'invoices', recommended: 'the api already reads it' },
          { label: 'billing_invoices' },
        ],
      },
    },
  },
  {
    id: 'shared',
    project: 'Acme',
    need: {
      title: 'The shared package does not build',
      text: 'Three attempts, the same error: a module money.ts is missing.',
      missionKey: 'ACME-15',
      when: '3 min',
      role: 'builder',
      ask: {
        kind: 'error',
        attempts: [
          { what: 'Built shared', output: 'error TS2307: Cannot find module "./money"' },
          {
            what: 'Restored money.ts from the base',
            output: 'error TS2307: Cannot find module "./money"',
          },
          {
            what: 'Rebuilt with a clean cache',
            output: 'error TS2307: Cannot find module "./money"',
          },
        ],
        proposed: 'Move the money helpers back into shared/src and point the api at them.',
      },
    },
  },
  {
    id: 'chat',
    project: 'Acme',
    need: {
      title: 'Run the api’s migrations against the shared database',
      text: 'The Chat asked to check the schema after the migration.',
      when: '1 min',
      role: 'chat',
      ask: {
        kind: 'permission',
        command: 'pnpm --filter api db:migrate',
        agentReason: 'To see the schema the migration leaves.',
        hemeraReason: 'Risk 2.9',
        choices: ['allow-once', 'deny'],
      },
    },
  },
]

const meta = {
  tags: ['autodocs'],
  title: 'Blocks/Needs you/Needs you list',
  component: NeedsYouList,
  args: {
    rows: ROWS,
    projects: ['Acme', 'Hemera'],
    onOpenMission: fn(),
    on: () => ({
      onPermission: fn(),
      onChoose: fn(),
      onWrite: fn(),
      onApply: fn(),
      onLook: fn(),
      onRetry: fn(),
      onSettings: fn(),
      onDiscuss: fn(),
    }),
  },
  decorators: [
    (Story, context) => (
      <section aria-label="Needs you" className="flex max-w-4xl flex-col gap-3 p-8">
        <SectionHead
          title="Needs you"
          count={context.args.loading === true ? undefined : context.args.rows.length || undefined}
          calls
        />
        <Frame>
          <Story />
        </Frame>
      </section>
    ),
  ],
} satisfies Meta<typeof NeedsYouList>

export default meta
type Story = StoryObj<typeof meta>

/** The application's need first, then Acme's, the oldest first. */
export const Filled: Story = {}

/** A row unfolded: the whole card under it, and the way to the mission. */
export const Unfolded: Story = {
  args: { open: 'ssh' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Allow once' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /Open ACME-12/ }))
    await expect(args.onOpenMission).toHaveBeenCalledWith('ssh')
  },
}

/** Pressing a row's button unfolds its card; pressing it again folds it. */
export const UnfoldOnDemand: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [, decide] = canvas.getAllByRole('button', { name: 'Answer here' })
    if (decide === undefined)
      throw new globalThis.Error('the decision is the second need answered here')
    await userEvent.click(decide)
    await expect(decide).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() =>
      expect(canvas.getByRole('textbox', { name: 'Your own answer' })).toBeVisible(),
    )
    await userEvent.click(decide)
    await waitFor(() =>
      expect(canvas.queryByRole('textbox', { name: 'Your own answer' })).toBeNull(),
    )
  },
}

export const Empty: Story = { args: { rows: [] } }

export const Loading: Story = { args: { loading: true } }

/** The same needs again, for a second Project. */
const LABS: NeedRow[] = []
for (const [at, row] of ROWS.slice(1).entries()) {
  LABS.push({
    id: `${row.id}-labs`,
    project: 'Acme Labs',
    need: Object.assign({}, row.need, {
      missionKey: row.need.missionKey === undefined ? undefined : `LABS-${String(at + 3)}`,
    }),
  })
}

/** Many needs across many Projects. */
export const Dense: Story = {
  args: { projects: ['Acme', 'Hemera', 'Acme Labs'], rows: [...ROWS, ...LABS] },
}
