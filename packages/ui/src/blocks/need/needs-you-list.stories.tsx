import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { Frame } from '../../components/frame/frame.tsx'
import { SectionHead } from '../../components/section-head/section-head.tsx'
import type { NeedState } from './need-card.tsx'
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
  // The list is a grid that sizes itself to the column it is given, as Home's and a mission's
  // are: the canvas gives it the page's width rather than shrinking around it.
  parameters: { layout: 'padded' },
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
      <section aria-label="Needs you" className="flex w-full max-w-4xl flex-col gap-3 p-8">
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

const SETTLED = new Map<string, NeedState>([
  ['table', { state: 'applied', answer: 'invoices' }],
  ['git', { state: 'expired', reason: 'what was missing is there now' }],
])

/**
 * Answered and expired needs stay in their place a moment, one faint line each, before they
 * leave the list; the needs still waiting keep their rows.
 */
export const Settled: Story = {
  args: {
    rows: ROWS.map((row) =>
      Object.assign({}, row, {
        need: Object.assign({}, row.need, {
          status: SETTLED.get(row.id) ?? row.need.status,
        }),
      }),
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Applied')).toBeVisible()
    await expect(canvas.getByText('Expired')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Answer here' })).toHaveLength(2)
    await expect(canvas.queryByRole('button', { name: 'Retry here' })).toBeNull()
  },
}

/** While a mission has no page to open, the unfolded card offers no way to it. */
export const WithoutMissionLink: StoryObj<typeof NeedsYouList> = {
  args: { open: 'ssh', onOpenMission: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Allow once' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /Open ACME-12/ })).toBeNull()
  },
}

/** The keyboard path: a row's button unfolds its card, and Tab reaches the card's choices. */
export const KeyboardPath: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const retry = canvas.getByRole('button', { name: 'Retry here' })
    retry.focus()
    await userEvent.keyboard('{Enter}')
    await expect(retry).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Retry' })).toBeVisible())
    await userEvent.tab()
    await expect(canvas.getAllByRole('img', { name: 'Something missing' })[1]).toHaveFocus()
    await userEvent.tab()
    await expect(canvas.getByRole('button', { name: 'Retry' })).toHaveFocus()
  },
}

/** In a narrow column, as Home's half at 1366×768: the titles give way, the actions stay whole. */
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const cut = canvas
      .getAllByRole('button', { name: /here$/ })
      .filter((button) => button.scrollWidth > button.clientWidth)
    await expect(cut).toEqual([])
  },
}

/** What "Allow these" and the cards of the group answer, by need. */
const answered = fn()

/** Three Probes asking at once: each one's requests on one row. */
const PROBE_ROWS: readonly NeedRow[] = [
  ...['tests/cli/install.test.ts', 'tests/cli/update.test.ts', 'tests/cli/remove.test.ts'].map(
    (path, at): NeedRow => ({
      id: `probe-1-${String(at)}`,
      project: 'Acme',
      agent: { id: 'probe-1', name: 'the Probe' },
      need: {
        title: `Write ${path} in its Probe folder`,
        missionKey: 'ACME-12',
        when: `${String(3 - at)} min`,
        role: 'probe',
        ask: {
          kind: 'permission',
          command: `fs_write ~/.hemera/probes/ACME-12/1/${path}`,
          hemeraReason:
            'No rule of this Project allows this write for the Probe, and no judge is set up to rate it.',
          settings: 'Hemera Auto',
          choices: ['allow-once', 'allow-for-mission', 'deny'],
        },
      },
    }),
  ),
  {
    id: 'probe-2-0',
    project: 'Acme',
    agent: { id: 'probe-2', name: 'the Probe' },
    need: {
      title: 'Run git rev-parse HEAD',
      missionKey: 'ACME-12',
      when: '1 min',
      role: 'probe',
      ask: {
        kind: 'permission',
        command: 'git rev-parse HEAD',
        hemeraReason:
          'No rule of this Project allows this command for the Probe, and no judge is set up to rate it.',
        settings: 'Hemera Auto',
        choices: ['allow-once', 'allow-for-mission', 'deny'],
      },
    },
  },
]

/**
 * The requests of one agent on one row, with their count and "Allow these" in its menu; an agent
 * with one request keeps its own row.
 */
export const GroupedByAgent: StoryObj<typeof NeedsYouList> = {
  args: {
    rows: [...PROBE_ROWS, ...ROWS.slice(2, 3)],
    on: (id: string) => ({ onPermission: (choice) => answered(id, choice) }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('3 requests from the Probe')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Answer here' })).toHaveLength(3)
    answered.mockClear()
    // "Allow these" is not the row's action: it waits in the row's menu.
    await expect(canvas.queryByRole('button', { name: 'Allow these' })).toBeNull()
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for 3 requests from the Probe' }),
    )
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Allow these' }))
    await expect(answered).toHaveBeenCalledTimes(3)
    await expect(answered).toHaveBeenCalledWith('probe-1-0', 'allow-once')
    await expect(answered).toHaveBeenCalledWith('probe-1-2', 'allow-once')
    await expect(answered).not.toHaveBeenCalledWith('probe-2-0', 'allow-once')
  },
}

/** The group's own button opens its requests, each answered on its own. */
export const GroupUnfolded: Story = {
  args: { rows: [...PROBE_ROWS, ...ROWS.slice(2, 3)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const [group] = canvas.getAllByRole('button', { name: 'Answer here' })
    if (group === undefined) throw new globalThis.Error('the group is the first row')
    await userEvent.click(group)
    await expect(group).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() =>
      expect(canvas.getByText('Write tests/cli/update.test.ts in its Probe folder')).toBeVisible(),
    )
    await expect(canvas.getAllByRole('button', { name: 'Answer here' })).toHaveLength(6)
  },
}

/** Once answered, a group's requests settle in place, and the group says what still waits. */
export const GroupPartlyAnswered: Story = {
  args: {
    rows: PROBE_ROWS.map((row) =>
      row.id === 'probe-1-0'
        ? Object.assign({}, row, {
            need: Object.assign({}, row.need, {
              status: { state: 'applied', answer: 'Allowed once' },
            }),
          })
        : row,
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('2 requests from the Probe')).toBeVisible()
  },
}

/**
 * Every kind of row, every length of time, a row without a key (Hemera's own), one without a
 * detail, and an agent's group: one grid, every column on one edge.
 */
const ALIGNED: readonly NeedRow[] = [
  ...ROWS.map((row, at) =>
    Object.assign({}, row, {
      need: Object.assign({}, row.need, {
        when: ['2 h', '25 min', '1 min', '3 d', 'now'][at],
        text: row.id === 'table' ? undefined : row.need.text,
      }),
    }),
  ),
  ...PROBE_ROWS,
]

/** The cells of the list, by column: each one's left edge, and the time's right edge. */
const COLUMNS = ['project', 'key', 'kind', 'title', 'detail', 'when', 'action'] as const

const edgesOf = (root: Element) =>
  Object.fromEntries(
    COLUMNS.map((column) => {
      const cells = [...root.querySelectorAll(`[data-need-cell="${column}"]`)]
      const lefts = new Set(cells.map((cell) => Math.round(cell.getBoundingClientRect().left)))
      const rights = new Set(cells.map((cell) => Math.round(cell.getBoundingClientRect().right)))
      return [column, { cells: cells.length, lefts: lefts.size, rights: rights.size }]
    }),
  )

/**
 * Every row but the first has its rule above it: some element's bottom border ends where the
 * row's line begins (its own, or the one of the row it follows, or of what holds it).
 */
const rulesAbove = (root: Element) => {
  const rules = [...root.querySelectorAll('*')]
    .filter((one) => Number.parseFloat(getComputedStyle(one).borderBottomWidth) > 0)
    .map((one) => Math.round(one.getBoundingClientRect().bottom))
  const lines = [...root.querySelectorAll('[data-need-row]')]
  return {
    rows: lines.length,
    ruled: lines.filter(
      (line, at) => at === 0 || rules.includes(Math.round(line.getBoundingClientRect().top)),
    ).length,
  }
}

/** Every column on one edge, the times ending on one edge too. */
const aligned = (cells: number) => {
  const edges: Record<string, ReturnType<typeof expect.objectContaining>> = {}
  for (const column of COLUMNS) {
    edges[column] = expect.objectContaining({ cells, lefts: 1 })
  }
  edges.when = expect.objectContaining({ cells, lefts: 1, rights: 1 })
  return edges
}

/** A row's menu holds what the row offers besides its action: the way to its mission. */
export const RowMenu: Story = {
  args: { rows: ROWS.slice(1, 3), onOpenMission: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      canvas.getByRole('button', { name: 'More actions for Which table holds the invoices?' }),
    )
    const menu = await waitFor(() => within(document.body).getByRole('menu'))
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open ACME-14' }))
    await expect(args.onOpenMission).toHaveBeenCalledWith('table')
  },
}

/**
 * Needs you is a table: the Project, the key, the kind, the title, the detail, when and the
 * action each start on one edge on every row, a row without a key or a detail keeping its empty
 * cell; the times end on one edge; an agent's group and its unfolded rows share the columns.
 */
export const Aligned: Story = {
  args: { rows: ALIGNED },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(edgesOf(canvasElement)).toEqual(aligned(7))
    await expect(rulesAbove(canvasElement)).toEqual({ rows: 7, ruled: 7 })
    // One action and one menu on every row, the same two controls whatever the row offers.
    const controls = [...canvasElement.querySelectorAll('[data-need-cell="action"]')].map((cell) =>
      [...cell.querySelectorAll('button')].map((one) => one.getAttribute('aria-label') ?? ''),
    )
    await expect(controls).toHaveLength(7)
    await expect(controls.map((names) => names.length)).toEqual(Array(7).fill(2))
    await expect(controls.map(([action]) => /here$/.test(action ?? ''))).toEqual(
      Array(7).fill(true),
    )
    await expect(controls.map(([, more]) => /^More actions for /.test(more ?? ''))).toEqual(
      Array(7).fill(true),
    )
    await expect(canvas.queryByRole('button', { name: 'Allow these' })).toBeNull()
    const actions = canvas.getAllByRole('button', { name: /here$/ })
    await expect(
      new Set(actions.map((one) => Math.round(one.getBoundingClientRect().right))).size,
    ).toBe(1)
    await expect(
      new Set(actions.map((one) => Math.round(one.getBoundingClientRect().left))).size,
    ).toBe(1)
    // An agent's group unfolded: its own rows keep the same columns.
    const group = canvas
      .getAllByRole('button', { name: 'Answer here' })
      .find((one) => one.closest('[data-agent]') !== null)
    if (group === undefined) throw new globalThis.Error('the Probe has a group')
    await userEvent.click(group)
    // Under the hand a button grows by a pixel each side: the edges are read once it has left.
    await userEvent.unhover(group)
    await waitFor(() => expect(edgesOf(canvasElement)).toEqual(aligned(10)))
    // The group's own line and the rows it unfolds to are each ruled off from the one above.
    await waitFor(() => expect(rulesAbove(canvasElement)).toEqual({ rows: 10, ruled: 10 }))
  },
}
