import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { ContextView } from './context-view.tsx'

/**
 * What the agent is working from (design D6-10): its instructions, and the tools it is lent.
 *
 * One story per state of the instructions — nothing gone yet, `AGENTS.md` given at the start,
 * read by the agent, missing, and changed since — and one with the tools unfolded. Each is drawn
 * at the width of a sidebar, narrower than the Session details it lives in: a row that reads whole
 * there reads whole in the dialog (trial of 23 September 2026).
 */

/** When the Session's agent was opened: its tools were lent, and the base went in, then. */
const STARTED = '23 Sep 08:02'

/** The Workspace the agent works in, which every path of the view is read from. */
const WORKSPACE = { name: 'main', path: '/home/kris/projects/atlas' }

/** The base, as it reaches an agent with no system prompt to take it. */
const BASE = { label: 'The base', detail: 'as a resource of the first prompt', at: STARTED }

const GIVEN = {
  label: 'AGENTS.md',
  file: true,
  detail: 'given at the start of the Session',
  at: STARTED,
}

/** The eleven tools a Session is lent, each with the bound it is held to. */
const TOOLS = [
  { name: 'fs_read', bound: '256 KiB a page, inside the Workspace root' },
  { name: 'fs_edit', bound: 'one unique match, inside the Workspace root' },
  { name: 'fs_write', bound: 'the whole file, inside the Workspace root' },
  { name: 'fs_list', bound: 'one level, inside the Workspace root' },
  { name: 'search', bound: '200 matches and 1 MiB scanned a call' },
  { name: 'commands_list', bound: "the Project's catalogue, and this Session's last runs" },
  { name: 'commands_run', bound: 'the catalogue, or a one-off line the user allows' },
  { name: 'commands_output', bound: 'the last 64 KiB a run printed' },
  { name: 'commands_stop', bound: 'a run of this Project, and all it started' },
  { name: 'project_get', bound: 'this Project' },
  { name: 'session_get', bound: 'this Session and its last 20 entries' },
]

const COMMANDS = [
  { name: 'check', command: 'pnpm check' },
  { name: 'dev', command: 'pnpm --filter @hemera/desktop dev' },
]

const meta = {
  tags: ['autodocs', 'new'],
  title: 'Blocks/Session/ContextView',
  component: ContextView,
  parameters: { layout: 'padded' },
  // The narrowest width the view is read at: a sidebar's.
  decorators: [
    (Story) => (
      <div className="w-sidebar px-4">
        <Story />
      </div>
    ),
  ],
  args: {
    workspace: WORKSPACE,
    instructions: [GIVEN, BASE],
    tools: TOOLS,
    lentAt: STARTED,
    commands: COMMANDS,
  },
  argTypes: {
    workspace: { control: 'object', description: 'The Workspace the agent works in.' },
    instructions: {
      control: 'object',
      description: 'How AGENTS.md, its last change and the base reached the agent, and when.',
    },
    tools: { control: 'object', description: 'The tools it lends, with the bound of each.' },
    lentAt: { control: 'text', description: 'When the tools were lent.' },
    commands: { control: 'object', description: 'The commands of the catalogue.' },
  },
} satisfies Meta<typeof ContextView>

export default meta

type Story = StoryObj<typeof meta>

/** The name the tools' line is read by, once they were lent. */
const LENT = `Tools · 11 · lent at ${STARTED}`

/** The rows wider than the view they are read in, by their text: none, when every row wraps. */
function cutRowsIn(canvasElement: HTMLElement): string[] {
  return [...canvasElement.querySelectorAll('li')]
    .filter((row) => row.scrollWidth > row.clientWidth)
    .map((row) => row.textContent)
}

/**
 * A fresh Session whose agent was given `AGENTS.md` with its first message: the Workspace it works
 * in, the file by its path and the time it went in, the base with its own, and the tools folded on
 * one line that says when they were lent (recette 5 of 24 September 2026).
 */
export const GivenAtTheStart: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The Workspace first, by its name and its root: what every path below is read from.
    const workspace = canvas.getByRole('region', { name: 'Workspace' })
    await expect(within(workspace).getByText('main')).toBeVisible()
    await expect(within(workspace).getByText('/home/kris/projects/atlas')).toBeVisible()
    await expect(canvas.getByText('Instructions')).toBeVisible()
    // The file by its path from the root, in the face of a path, and when it reached the agent.
    const file = canvas.getByText('AGENTS.md')
    await expect(getComputedStyle(file).fontFamily).toMatch(/mono|Fira/i)
    await expect(canvas.getByText(', given at the start of the Session')).toBeVisible()
    await expect(canvas.getByText(', as a resource of the first prompt')).toBeVisible()
    await expect(canvas.getAllByText(`· ${STARTED}`)).toHaveLength(2)
    // Folded: the count and the moment are on the line, and the list is not drawn until asked.
    await expect(canvas.getByRole('button', { name: LENT })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await expect(canvas.queryByText('fs_read')).toBeNull()
    // Nothing is said of what the agent keeps to itself: that is Settings' to say.
    await expect(canvas.queryByText(/does not control/)).toBeNull()
  },
}

/** An agent that reads `AGENTS.md` itself, with the base in its system prompt. */
export const ReadByTheAgent: Story = {
  args: {
    instructions: [
      { label: 'AGENTS.md', file: true, detail: 'read by the agent', at: STARTED },
      { label: 'The base', detail: 'through its system prompt', at: STARTED },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText(', read by the agent')).toBeVisible()
    await expect(canvas.getByText(', through its system prompt')).toBeVisible()
  },
}

/**
 * A Workspace with no `AGENTS.md`: said in a sentence under the Workspace it is about, and the
 * base went in all the same, at its time.
 */
export const NoAgentsFile: Story = {
  args: { instructions: [{ label: 'This Workspace has no AGENTS.md' }, BASE] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('/home/kris/projects/atlas')).toBeVisible()
    await expect(canvas.getByText('This Workspace has no AGENTS.md')).toBeVisible()
    await expect(canvas.getByText('The base')).toBeVisible()
    await expect(canvas.getByText(`· ${STARTED}`)).toBeVisible()
    await expect(canvas.getByRole('button', { name: LENT })).toBeVisible()
  },
}

/**
 * `AGENTS.md` changed during the Session and the change was delivered between two turns: the file
 * says when it last changed, the last change is a line of its own with the time it was delivered,
 * and every line reads whole at the column's width.
 */
export const AfterADelivery: Story = {
  args: {
    instructions: [
      { ...GIVEN, changed: '23 Sep 09:14' },
      { label: 'Last change', detail: 'delivered between two turns', at: '23 Sep 09:14' },
      BASE,
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('· changed 23 Sep 09:14')).toBeVisible()
    await expect(canvas.getByText('Last change')).toBeVisible()
    await expect(canvas.getByText('· 23 Sep 09:14')).toBeVisible()
    // Whole: no row is cut, and nothing is wider than the column it is read in.
    await expect(cutRowsIn(canvasElement)).toEqual([])
  },
}

/**
 * Before the first message: nothing has gone to the agent, and the tools it will be lent are
 * counted, with no time until they are.
 */
export const NothingGoneYet: Story = {
  args: { instructions: [], lentAt: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('Nothing has gone to the agent yet.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Tools · 11' })).toBeVisible()
  },
}

/**
 * The tools unfolded: each with its bound, wrapped under its name when the line is longer than the
 * column, and the catalogue `commands_run` runs from.
 */
export const ToolsOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: LENT }))
    await expect(canvas.getByText('fs_read')).toBeVisible()
    await expect(canvas.getByText('the catalogue, or a one-off line the user allows')).toBeVisible()
    await expect(canvas.getByText('The catalogue commands_run runs from')).toBeVisible()
    await expect(canvas.getByText('pnpm check')).toBeVisible()
    await expect(cutRowsIn(canvasElement)).toEqual([])
  },
}
